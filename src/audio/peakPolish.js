/**
 * Soft-clip then look-ahead limit — Aurora / Ozone-style peak polish.
 * Bass/808 material needs a real true-peak margin: sample limiting alone
 * does not stop intersample overs after soft-clip harmonics.
 */
import { applyGainDb, limit } from './limiter.js';
import { dbToLin } from './dsp.js';
import { samplePeakDb, truePeakDb } from './lufs.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Soft knee into `clipDb`, then hard-cap at `hardDb` (never float above).
 * Previous soft-clip could wander toward 0 dBFS and create TP overs.
 */
export function softClipChannels(channelArrays, clipDb = -0.5, amount = 0.55, hardDb = null) {
  const knee = dbToLin(clipDb);
  const hard = dbToLin(hardDb == null ? clipDb : hardDb);
  const out = channelArrays.map((ch) => {
    const o = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const a = Math.abs(x);
      if (a <= knee) {
        o[i] = x;
        continue;
      }
      const over = (a - knee) / Math.max(1e-9, 1 - knee);
      const soft = knee + (hard - knee) * Math.tanh(over * amount);
      o[i] = Math.sign(x) * Math.min(soft, hard);
    }
    return o;
  });
  return out;
}

/**
 * Max makeup (dB) that keeps sample peaks under (ceilingDb - tpMarginDb)
 * before limiting — stops LUFS chase from slamming bass into the brickwall.
 */
export function maxSafeGainDb(channelArrays, ceilingDb = -1, tpMarginDb = 1.2) {
  const peak = samplePeakDb(channelArrays);
  if (!Number.isFinite(peak)) return 0;
  const budget = ceilingDb - tpMarginDb - peak;
  return Math.min(14, Math.max(-24, budget));
}

/** Linear trim so sample peaks sit under `ceilingDb`. */
export function trimToSamplePeak(channelArrays, ceilingDb) {
  const peak = samplePeakDb(channelArrays);
  if (!Number.isFinite(peak) || peak <= ceilingDb) {
    return { channels: channelArrays, trimDb: 0 };
  }
  const trimDb = ceilingDb - peak;
  const work = channelArrays.map((c) => c.slice());
  applyGainDb(work, trimDb);
  return { channels: work, trimDb };
}

/**
 * Iterate trim + limit until true-peak is at/under ceiling (bass/808 safe).
 * Prefers staying under ceiling over hitting a loudness target.
 */
export function enforceTruePeak(channelArrays, sampleRate, ceilingDb, opts = {}) {
  const {
    releaseMs = 140,
    tol = 0.02,
    maxIters = 6,
    tpMarginDb = 1.6,
  } = opts;

  let work = channelArrays.map((c) => c.slice());
  let totalTrim = 0;
  let tp = truePeakDb(work, sampleRate);

  for (let i = 0; i < maxIters; i++) {
    tp = truePeakDb(work, sampleRate);
    if (!Number.isFinite(tp) || tp <= ceilingDb + tol) break;

    // Trim just past the measured over — avoid deep successive pulls (squash)
    const over = tp - ceilingDb;
    const trimDb = -(over + 0.12 + i * 0.05);
    applyGainDb(work, trimDb);
    totalTrim += trimDb;

    const sampleCeiling = ceilingDb - Math.max(0.7, Math.min(tpMarginDb, 1.6));
    work = limit(work, sampleRate, sampleCeiling, releaseMs);
  }

  tp = truePeakDb(work, sampleRate);
  // Last resort: linear pull only (no second soft-clip stage)
  if (Number.isFinite(tp) && tp > ceilingDb + tol) {
    const pull = ceilingDb - tp - 0.08;
    applyGainDb(work, pull);
    totalTrim += pull;
    tp = truePeakDb(work, sampleRate);
  }

  return { channels: work, trimDb: totalTrim, truePeakDb: tp };
}

/**
 * Gain → optional light soft clip → look-ahead limit → true-peak enforce.
 * Soft-clip is a gentle polish only — never a second brickwall (that sounds
 * like two clippers on one rack).
 */
export function peakPolish(channelArrays, sampleRate, opts = {}) {
  const {
    gainDb = 0,
    softClip = false,
    softClipDb = -0.5,
    softClipAmount = 0.35,
    ceilingDb = -1.0,
    tpMarginDb = 1.0,
    releaseMs = 100,
    enforce = true,
  } = opts;

  const work = channelArrays.map((c) => c.slice());

  const safe = maxSafeGainDb(work, ceilingDb, tpMarginDb);
  const appliedGain = Math.min(gainDb, safe);
  if (Math.abs(appliedGain) > 0.01) applyGainDb(work, appliedGain);

  // Sample limiter sits a modest margin under the advertised TP ceiling
  const sampleCeiling = ceilingDb - Math.max(0.7, Math.min(tpMarginDb, 1.8));
  // Soft clip (if any) only shaves a little above the limiter — not a deep rack
  const softDb = Math.min(softClipDb, ceilingDb - 0.15);
  const hardDb = Math.min(sampleCeiling + 0.35, ceilingDb);
  const clipped = softClip
    ? softClipChannels(work, softDb, clamp(softClipAmount, 0.15, 0.55), hardDb)
    : work;

  let limited = limit(clipped, sampleRate, sampleCeiling, releaseMs);

  let enforceTrim = 0;
  let tp = truePeakDb(limited, sampleRate);
  if (enforce) {
    const enforced = enforceTruePeak(limited, sampleRate, ceilingDb, {
      releaseMs: Math.max(releaseMs, 120),
      tpMarginDb: Math.min(tpMarginDb, 1.6),
      tol: 0.05,
      maxIters: 4,
    });
    limited = enforced.channels;
    enforceTrim = enforced.trimDb;
    tp = enforced.truePeakDb;
  }

  return {
    channels: limited,
    appliedGainDb: appliedGain + enforceTrim,
    truePeakDb: tp,
  };
}

/** True-peak check helper for the LUFS / peak iteration loop. */
export function exceedsTruePeak(channelArrays, sampleRate, ceilingDb, tol = 0.05) {
  const tp = truePeakDb(channelArrays, sampleRate);
  return { over: Number.isFinite(tp) && tp > ceilingDb + tol, truePeakDb: tp };
}

/** Classify a peak reading against a delivery ceiling. */
export function peakStatus(peakDb, ceilingDb = -1.0) {
  if (!Number.isFinite(peakDb)) return 'idle';
  if (peakDb > ceilingDb + 0.05) return 'clip';
  if (peakDb > ceilingDb - 0.5) return 'hot';
  if (peakDb > ceilingDb - 3) return 'warn';
  return 'ok';
}
