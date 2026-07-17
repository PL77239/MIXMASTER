/**
 * Execute an engineer session plan: diagnose → plan → polish.
 * Peak chain: optional soft clip → true-peak limit (Aurora).
 * Spectral refine is residual polish only — never a remould.
 */
import { GENRES } from './genres.js';
import { analyzeBuffer } from './analyze.js';
import { measureLoudness } from './lufs.js';
import { measureRegions, measureClarity } from './analyzeTargets.js';
import { diagnose } from './diagnose.js';
import { planSession } from './planner.js';
import { peakPolish, maxSafeGainDb, exceedsTruePeak } from './peakPolish.js';
import {
  renderGraph, chain, peaking, lowShelf, highShelf, highpass, lowpass,
  makeBuffer, getChannelArrays, dbToLin,
} from './dsp.js';
import {
  multibandCompress,
  parallelCompress,
  harmonicExciter,
  stereoImage,
} from './stages.js';
import { opticalCompress } from './opticalCompress.js';
import { fetCompress } from './fetCompress.js';
import { getGenreRack } from './rackKnowledge.js';
import { assessClarityLoss } from './clarityGuard.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export { measureRegions };

function applyEqPlan(inputBuffer, eqMoves) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const nodes = [source];
    for (const m of eqMoves) {
      if (m.type === 'highpass') nodes.push(highpass(ctx, m.freq));
      else if (m.type === 'lowshelf') nodes.push(lowShelf(ctx, m.freq, m.gain));
      else if (m.type === 'highshelf') nodes.push(highShelf(ctx, m.freq, m.gain));
      else if (m.type === 'peak') nodes.push(peaking(ctx, m.freq, m.gain, m.q || 1));
    }
    return chain(nodes);
  });
}

/**
 * Kick/bass separation without stems:
 * Duck low-band sustain when a transient hits — approximates multiband sidechain.
 */
async function kickBassSeparate(inputBuffer, spec) {
  if (!spec) return inputBuffer;
  const fs = inputBuffer.sampleRate;
  const channels = getChannelArrays(inputBuffer);
  const n = channels[0].length;
  const nCh = channels.length;

  const lowBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, lowpass(ctx, spec.bandHz * 1.4), lowpass(ctx, spec.bandHz * 1.4)]));
  const highBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, highpass(ctx, spec.bandHz * 1.4), highpass(ctx, spec.bandHz * 1.4)]));

  const low = [];
  for (let c = 0; c < nCh; c++) low.push(lowBuf.getChannelData(c));

  const atk = Math.exp(-1 / Math.max(1, (spec.attackMs / 1000) * fs));
  const rel = Math.exp(-1 / Math.max(1, (spec.releaseMs / 1000) * fs));
  let env = 0;
  const duckLin = dbToLin(-Math.abs(spec.duckDb));
  const gainEnv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (let c = 0; c < nCh; c++) x += Math.abs(low[c][i]);
    x /= nCh;
    env = x > env ? atk * env + (1 - atk) * x : rel * env + (1 - rel) * x;
    const key = clamp(env * 8, 0, 1);
    gainEnv[i] = 1 - key * (1 - duckLin);
  }

  const out = channels.map(() => new Float32Array(n));
  for (let c = 0; c < nCh; c++) {
    const hi = highBuf.getChannelData(c);
    const lo = low[c];
    for (let i = 0; i < n; i++) out[c][i] = hi[i] + lo[i] * gainEnv[i];
  }
  return makeBuffer(out, fs);
}

/**
 * Transient polish on low band (MasteringBOX shaper idea / EDM kick punch).
 * Boosts attack envelope without broadband loudness.
 */
async function transientEnhance(inputBuffer, spec) {
  if (!spec || !(spec.attackDb > 0.2)) return inputBuffer;
  const fs = inputBuffer.sampleRate;
  const channels = getChannelArrays(inputBuffer);
  const n = channels[0].length;
  const nCh = channels.length;

  const lowBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, lowpass(ctx, spec.bandHz * 1.6), lowpass(ctx, spec.bandHz * 1.6)]));
  const highBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, highpass(ctx, spec.bandHz * 1.6)]));

  const low = [];
  for (let c = 0; c < nCh; c++) low.push(lowBuf.getChannelData(c));

  const atk = Math.exp(-1 / Math.max(1, 0.003 * fs));
  const rel = Math.exp(-1 / Math.max(1, 0.08 * fs));
  let env = 0;
  let prev = 0;
  const boost = dbToLin(spec.attackDb);
  const gainEnv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (let c = 0; c < nCh; c++) x += Math.abs(low[c][i]);
    x /= nCh;
    env = x > env ? atk * env + (1 - atk) * x : rel * env + (1 - rel) * x;
    const rise = Math.max(0, env - prev);
    prev = env;
    const key = clamp(rise * 40, 0, 1);
    gainEnv[i] = 1 + key * (boost - 1);
  }

  const out = channels.map(() => new Float32Array(n));
  for (let c = 0; c < nCh; c++) {
    const hi = highBuf.getChannelData(c);
    const lo = low[c];
    for (let i = 0; i < n; i++) out[c][i] = hi[i] + lo[i] * gainEnv[i];
  }
  return makeBuffer(out, fs);
}

/**
 * Bus glue: classic 1176 → LA-2A series (genre-weighted), or single-character desks.
 * Approximations only — no VST / pink-noise captures required.
 */
function gluePass(inputBuffer, plan, genreKey) {
  const ratio = plan.glue?.ratio || 1;
  const sat = plan.sat || 0;
  const rack = getGenreRack(genreKey || plan.genre || 'hiphop');
  const chainMode = plan.glue?.chain || rack.glueChain || 'series';
  const depth = clamp(((ratio - 1) / 1.2) * 0.7 + 0.15, 0.05, 1);

  let fetDrive = plan.glue?.fetDrive ?? rack.fetDrive ?? 0;
  let opticalDrive = plan.glue?.opticalDrive ?? rack.opticalDrive ?? 0;
  if (chainMode === 'fet') opticalDrive = 0;
  if (chainMode === 'optical') fetDrive = Math.min(fetDrive, 0.12);

  fetDrive *= depth;
  opticalDrive *= depth;

  if (fetDrive < 0.05 && opticalDrive < 0.05 && sat < 0.02) {
    return inputBuffer;
  }

  const protectMul = plan.protectDynamics ? 0.45 : plan.protectLowEnd ? 0.65 : 1;
  fetDrive *= protectMul;
  opticalDrive *= protectMul;

  let buf = inputBuffer;

  // 1) FET / 1176 — fast peak grab
  if (fetDrive >= 0.05) {
    buf = fetCompress(buf, {
      inputDrive: clamp(fetDrive, 0.05, 0.95),
      gain: plan.protectDynamics ? 0.06 : plan.protectLowEnd ? 0.1 : 0.18,
      thresholdDb: (plan.glue?.threshold ?? -20) + 2,
      ratio: clamp(4 + fetDrive * 4, 3.5, 8),
      kneeDb: plan.glue?.fetKnee ?? Math.min(rack.knee ?? 8, 10),
      attackMs: plan.protectLowEnd ? 2.2 : 1.4,
      releaseMs: plan.protectLowEnd ? 120 : 85,
      sat: Math.max(sat * 0.4, fetDrive * 0.035),
    });
  }

  // 2) Optical / LA-2A — program-dependent settle
  if (opticalDrive >= 0.05) {
    buf = opticalCompress(buf, {
      peakReduction: clamp(opticalDrive * 0.92, 0.05, 0.85),
      gain: plan.protectDynamics ? 0.06 : plan.protectLowEnd ? 0.1 : 0.2,
      thresholdDb: (plan.glue?.threshold ?? -24) - 1,
      ratio: Math.min(3.6, 2.4 + opticalDrive * 1.0),
      kneeDb: plan.glue?.knee ?? Math.max(rack.knee ?? 14, 14),
      sat: Math.max(sat * 0.5, opticalDrive * 0.035),
    });
  }

  return buf;
}

export async function masterTrack(inputBuffer, analysis, settings, onProgress) {
  const genre = GENRES[settings.genre];
  const report = (p, t) => onProgress && onProgress(p, t);
  const channels = getChannelArrays(inputBuffer);

  report(0.04, `Listening as ${settings.genre} engineer… detecting instruments…`);
  const diag = diagnose(channels, inputBuffer.sampleRate, analysis, settings.genre);
  await yieldFrame();

  // Pass peak info + refs/room into planner
  const planSettings = {
    ...settings,
    _truePeakDb: analysis.truePeakDb,
    _crest: analysis.crest,
  };

  report(0.1, 'Building polish plan (peaks, instruments, references)…');
  const plan = planSession(diag, planSettings);
  await yieldFrame();

  report(0.2, plan.log.find((l) => l.type === 'finding')?.text || 'Applying polish EQ…');
  let buf = await applyEqPlan(inputBuffer, plan.eq);
  await yieldFrame();

  if (plan.kickBass) {
    report(0.38, 'Kick/bass space (gentle sidechain-style duck)…');
    buf = await kickBassSeparate(buf, plan.kickBass);
    await yieldFrame();
  } else {
    report(0.38, 'Lows OK — skipping kick/bass separation…');
    await yieldFrame();
  }

  if (plan.transient) {
    report(0.45, 'Transient polish (kick/stab attack)…');
    buf = await transientEnhance(buf, plan.transient);
    await yieldFrame();
  }

  report(0.5, plan.preserveWidth
    ? 'Stereo image — mono-safe sub, preserve width…'
    : 'Stereo image — mono bass, width polish…');
  buf = await stereoImage(buf, plan);
  await yieldFrame();

  // Snapshot clarity before density stages scrub presence/air
  const clarityBefore = measureClarity(getChannelArrays(buf), buf.sampleRate);

  if (plan.multiband?.enabled) {
    report(0.56, 'Multiband compress — low / mid / high control…');
    buf = await multibandCompress(buf, plan.multiband);
    await yieldFrame();
  } else {
    report(0.56, 'Multiband — skipped (protect / open desk)…');
    await yieldFrame();
  }

  if (plan.parallel?.mix > 0.02) {
    report(0.62, 'Parallel (NY) compression — density under the dry bus…');
    buf = await parallelCompress(buf, plan.parallel);
    await yieldFrame();
  }

  {
    const rack = getGenreRack(settings.genre);
    const mode = plan.glue?.chain || rack.glueChain || 'series';
    const msg = plan.protectDynamics
      ? 'Dynamics protect — light glue only…'
      : mode === 'series'
        ? 'Series glue: 1176 → LA-2A…'
        : mode === 'optical'
          ? 'Optical glue (LA-2A / CLA-2A style)…'
          : 'FET glue (1176-style grab)…';
    report(0.66, msg);
  }
  buf = await gluePass(buf, plan, settings.genre);
  await yieldFrame();

  if (plan.exciter?.amount > 0.02) {
    report(0.7, 'Harmonic exciter — high-band air / edge…');
    buf = await harmonicExciter(buf, plan.exciter);
    await yieldFrame();
  }

  // Residual FR refine only (polish) — capped soft
  report(0.76, plan.refProfile
    ? 'Closing toward analyzed reference spectrum…'
    : 'Light spectral polish (not a remould)…');
  const midRegions = measureRegions(getChannelArrays(buf), buf.sampleRate);
  const refine = [];
  const tgt = plan.spectrumTarget;
  const refineMul = plan.refineMul ?? 0.18;
  const specs = [
    { key: 'sub', freq: 40, type: 'lowshelf', max: plan.protectLowEnd ? 0.8 : 1.4 },
    { key: 'bass', freq: 110, type: 'lowshelf', max: plan.protectLowEnd ? 0.9 : 1.2 },
    { key: 'lowMid', freq: 350, type: 'peak', max: 1.4 },
    { key: 'mid', freq: 1100, type: 'peak', max: 1.5 },
    { key: 'high', freq: 4500, type: 'peak', max: 1.4 },
    { key: 'air', freq: 11000, type: 'highshelf', max: 1.5 },
  ];
  for (const s of specs) {
    const cur = Math.max(midRegions[s.key], 1e-6);
    let g = 20 * Math.log10(tgt[s.key] / cur) * refineMul;
    // Protect low end: damp cuts AND forbid boosts that feed the limiter
    if (plan.protectLowEnd && (s.key === 'sub' || s.key === 'bass')) {
      if (g < 0) g *= 0.25;
      else g *= 0.15; // almost never add more bass into the peak chain
    }
    // Anti-mud: never re-boost lowMid after density stages; prefer residual cuts
    if (s.key === 'lowMid') {
      if (plan.cutMud || cur > (tgt.lowMid || 0.18) * 1.05) {
        if (g > 0) g = 0;
        else g *= plan.cutMud ? 1.35 : 1.15;
      }
    }
    // Preserve detail: resist darkening high/air after glue unless harsh
    if ((s.key === 'high' || s.key === 'air') && g < 0 && !plan.cutHarsh) {
      g *= 0.3;
    }
    g = clamp(g, -s.max, s.max);
    if (Math.abs(g) < 0.35) continue;
    refine.push({
      type: s.type,
      freq: s.freq,
      gain: g,
      q: 0.9,
      label: `Polish ${s.key}`,
      reason: `Close to target (${(cur * 100).toFixed(0)}% → ${(tgt[s.key] * 100).toFixed(0)}%)`,
    });
  }
  if (refine.length) {
    buf = await applyEqPlan(buf, refine);
    plan.eq = plan.eq.concat(refine);
  }
  await yieldFrame();

  const peak = plan.peak || {
    softClip: false,
    softClipDb: -0.5,
    ceilingDb: -1.0,
    targetLufs: settings.targetLufs,
  };

  report(
    0.84,
    peak.softClip
      ? `Peak polish: soft clip → limit @ ${peak.ceilingDb} dBTP…`
      : `Loudness → ${peak.targetLufs.toFixed(1)} LUFS · limit @ ${peak.ceilingDb} dBTP…`
  );

  const fs = buf.sampleRate;
  let base = getChannelArrays(buf);
  const runPeakPolish = (channels, startGainDb) => {
    const baseLufs = measureLoudness(channels.map((c) => c), fs).integrated;
    const tpMargin = peak.tpMarginDb ?? (plan.protectLowEnd ? 1.45 : 1.15);
    const ceilingDb = peak.ceilingDb ?? -1.0;
    const useSoftClip = Boolean(peak.softClip);
    const softClipDb = peak.softClipDb ?? -0.5;
    const softClipAmount = peak.softClipAmount ?? (plan.protectLowEnd ? 0.28 : 0.38);
    let gainDb = clamp(peak.targetLufs - baseLufs, -18, 14);
    gainDb = Math.min(gainDb, maxSafeGainDb(channels, ceilingDb, tpMargin));
    if (Number.isFinite(startGainDb)) {
      gainDb = Math.min(gainDb, startGainDb);
    }

    let limited = channels;
    let appliedGain = gainDb;
    for (let iter = 0; iter < 5; iter++) {
      const polished = peakPolish(channels, fs, {
        gainDb,
        softClip: useSoftClip,
        softClipDb,
        softClipAmount,
        ceilingDb,
        tpMarginDb: tpMargin,
        releaseMs: plan.protectDynamics || plan.protectLowEnd ? 150 : 110,
        enforce: true,
      });
      limited = polished.channels;
      appliedGain = polished.appliedGainDb;

      const { over, truePeakDb: tp } = exceedsTruePeak(limited, fs, ceilingDb, 0.05);
      if (over) {
        gainDb = clamp(gainDb - Math.max(0.35, (tp - ceilingDb) * 1.15), -18, appliedGain - 0.2);
        continue;
      }

      const achieved = measureLoudness(limited.map((c) => c), fs).integrated;
      const err = peak.targetLufs - achieved;
      if (Math.abs(err) < 0.4) break;
      const headroom = ceilingDb - (Number.isFinite(tp) ? tp : ceilingDb);
      if (err > 0 && headroom < 0.4) break;
      const next = clamp(gainDb + err * 0.55, -18, 14);
      gainDb = Math.min(next, maxSafeGainDb(channels, ceilingDb, tpMargin));
    }

    // Delivery gate — trim + limit only (never a second soft-clip pass)
    const check = exceedsTruePeak(limited, fs, ceilingDb, 0.05);
    if (check.over) {
      const polished = peakPolish(channels, fs, {
        gainDb: Math.min(appliedGain, gainDb) - Math.max(0.25, (check.truePeakDb - ceilingDb) + 0.2),
        softClip: false,
        ceilingDb,
        tpMarginDb: Math.min(Math.max(tpMargin, 1.35), 1.7),
        releaseMs: 160,
        enforce: true,
      });
      limited = polished.channels;
      appliedGain = polished.appliedGainDb;
    }
    return { limited, appliedGain, ceilingDb, tpMargin };
  };

  let { limited, appliedGain } = runPeakPolish(base);
  await yieldFrame();

  // Post-master clarity check — restore presence/air if density scrubbed detail
  report(0.9, 'Clarity check — presence & air…');
  let clarityAfter = measureClarity(limited, fs);
  const clarity = assessClarityLoss(clarityBefore, clarityAfter, {
    harsh: plan.cutHarsh,
    protectDynamics: plan.protectDynamics,
    genre: settings.genre,
  });
  if (clarity.lost) {
    report(0.91, 'Clarity dipped — restoring detail (pre-limit)…');
    const restoredBuf = await applyEqPlan(makeBuffer(base, fs), clarity.moves);
    base = getChannelArrays(restoredBuf);
    ({ limited, appliedGain } = runPeakPolish(base, appliedGain));
    plan.eq = plan.eq.concat(clarity.moves);
    clarityAfter = measureClarity(limited, fs);
    plan.log.push({
      type: 'decision',
      text: `Clarity check: presence −${(clarity.presenceDrop * 100).toFixed(1)} pt · top −${(clarity.topDrop * 100).toFixed(1)} pt → restored ${clarity.moves.map((m) => m.label).join(' + ')}.`,
    });
    await yieldFrame();
  } else {
    plan.log.push({
      type: 'decision',
      text: `Clarity check: presence ${(clarityAfter.presence * 100).toFixed(1)}% · top ${(clarityAfter.top * 100).toFixed(1)}% — detail held.`,
    });
  }

  report(0.94, 'Final metering…');
  const outBuffer = makeBuffer(limited, fs);
  const after = analyzeBuffer(outBuffer);
  const regionsAfter = measureRegions(getChannelArrays(outBuffer), fs);
  await yieldFrame();

  report(1, 'Master ready.');
  return {
    buffer: outBuffer,
    before: analysis,
    after,
    plan,
    diag,
    corrective: plan.eq
      .filter((e) => e.type !== 'highpass')
      .map((e) => ({
        band: e.label,
        freq: e.freq,
        gain: e.gain || 0,
        detail: e.reason,
      })),
    regionsBefore: diag.regions,
    regionsAfter,
    clarity: {
      before: clarityBefore,
      after: clarityAfter,
      restored: clarity.lost,
      moves: clarity.moves,
    },
    gainDb: appliedGain,
    genre,
    settings: { ...settings, targetLufs: peak.targetLufs },
    intensity: settings.dynamicsProfile,
    engineerLog: plan.log,
  };
}
