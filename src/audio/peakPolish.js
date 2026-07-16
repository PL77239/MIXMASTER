/**
 * Soft-clip then look-ahead limit — Aurora / Ozone-style peak polish.
 * Uses a true-peak margin so sample-peak limiting leaves room for
 * intersample overs (critical on bass-heavy material).
 */
import { applyGainDb, limit } from './limiter.js';
import { dbToLin } from './dsp.js';
import { samplePeakDb, truePeakDb } from './lufs.js';

/**
 * Soft knee clip toward `clipDb` (e.g. -0.5). Amount 0..1 controls how hard.
 */
export function softClipChannels(channelArrays, clipDb = -0.5, amount = 0.55) {
  const ceiling = dbToLin(clipDb);
  const out = channelArrays.map((ch) => {
    const o = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const a = Math.abs(x);
      if (a <= ceiling) {
        o[i] = x;
        continue;
      }
      const over = (a - ceiling) / Math.max(1e-9, 1 - ceiling);
      const soft = ceiling + (1 - ceiling) * Math.tanh(over * amount);
      o[i] = Math.sign(x) * Math.min(soft, ceiling + (1 - ceiling) * 0.12);
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
  return Math.min(14, Math.max(-14, budget));
}

/**
 * Gain → optional soft clip → look-ahead limit.
 * `tpMarginDb` lowers the *sample* ceiling so true-peak overs are rare.
 */
export function peakPolish(channelArrays, sampleRate, opts = {}) {
  const {
    gainDb = 0,
    softClip = false,
    softClipDb = -0.5,
    ceilingDb = -1.0,
    tpMarginDb = 1.0,
    releaseMs = 100,
  } = opts;

  const work = channelArrays.map((c) => c.slice());

  // Cap makeup by remaining peak headroom (bass-heavy tracks are peaky vs LUFS)
  const safe = maxSafeGainDb(work, ceilingDb, tpMarginDb);
  const appliedGain = Math.min(gainDb, safe);
  if (Math.abs(appliedGain) > 0.01) applyGainDb(work, appliedGain);

  const softDb = Math.min(softClipDb, ceilingDb - 0.15);
  const clipped = softClip ? softClipChannels(work, softDb, softClip ? 0.55 : 0.4) : work;

  // Sample limiter sits below the advertised TP ceiling
  const sampleCeiling = ceilingDb - Math.max(0.6, tpMarginDb);
  return {
    channels: limit(clipped, sampleRate, sampleCeiling, releaseMs),
    appliedGainDb: appliedGain,
  };
}

/** True-peak check helper for the LUFS / peak iteration loop. */
export function exceedsTruePeak(channelArrays, sampleRate, ceilingDb, tol = 0.05) {
  const tp = truePeakDb(channelArrays, sampleRate);
  return { over: Number.isFinite(tp) && tp > ceilingDb + tol, truePeakDb: tp };
}
