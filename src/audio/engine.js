/**
 * Execute an engineer session plan: diagnose → plan → polish.
 * Peak chain: optional soft clip → true-peak limit (Aurora).
 * Spectral refine is residual polish only — never a remould.
 */
import { GENRES } from './genres.js';
import { analyzeBuffer } from './analyze.js';
import { measureLoudness } from './lufs.js';
import { measureRegions } from './analyzeTargets.js';
import { diagnose } from './diagnose.js';
import { planSession } from './planner.js';
import { peakPolish, maxSafeGainDb, exceedsTruePeak } from './peakPolish.js';
import {
  renderGraph, chain, peaking, lowShelf, highShelf, highpass, lowpass,
  gainNode, saturationCurve, compressor, makeBuffer, getChannelArrays, dbToLin,
} from './dsp.js';

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

async function midSideShape(inputBuffer, plan) {
  const fs = inputBuffer.sampleRate;
  if (inputBuffer.numberOfChannels < 2) {
    return renderGraph(inputBuffer, (ctx, source) => {
      const nodes = [source];
      if (plan.eq.some((e) => e.label === 'Lead presence')) {
        const p = plan.eq.find((e) => e.label === 'Lead presence');
        nodes.push(peaking(ctx, p.freq, p.gain * 0.3, 1));
      }
      return chain(nodes);
    });
  }

  const L = inputBuffer.getChannelData(0);
  const R = inputBuffer.getChannelData(1);
  const n = L.length;
  const M = new Float32Array(n);
  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    M[i] = 0.5 * (L[i] + R[i]);
    S[i] = 0.5 * (L[i] - R[i]);
  }

  let midE = 0, sideE = 0;
  for (let i = 0; i < n; i += 2) {
    midE += M[i] * M[i];
    sideE += S[i] * S[i];
  }
  const curW = midE + sideE > 0 ? sideE / (midE + sideE) : 0.05;
  const tgt = plan.widthTarget;
  const curRatio = curW > 1e-6 ? curW / (1 - curW) : 0.03;
  const tgtRatio = Math.max(0.02, tgt / Math.max(1 - tgt, 0.02));
  let sideScale = tgtRatio / Math.max(curRatio, 1e-4);

  // Preserve / widen: never collapse the image (EDM “more mono” bug)
  if (plan.preserveWidth || plan.widthMode === 'preserve' || plan.widthMode === 'widen') {
    sideScale = clamp(sideScale, 0.95, 1.45);
  } else {
    sideScale = clamp(sideScale, 0.75, 1.35);
  }

  // Mono-safe low end only — highpass sides at monoBassHz (true sub), not mid-bass
  const monoHz = plan.monoBassHz || 100;

  const midOut = await renderGraph(makeBuffer([M], fs), (ctx, source) =>
    chain([source, peaking(ctx, 1000, 0.08, 0.9)]));

  const sideNodes = (ctx, source) => {
    const nodes = [source, highpass(ctx, monoHz), highpass(ctx, monoHz)];
    if (plan.sideAir) nodes.push(highShelf(ctx, plan.sideAir.freq, plan.sideAir.gain));
    return chain(nodes);
  };
  const sideOut = await renderGraph(makeBuffer([S], fs), sideNodes);

  const Mp = midOut.getChannelData(0);
  const Sp = sideOut.getChannelData(0);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sw = Sp[i] * sideScale;
    outL[i] = Mp[i] + sw;
    outR[i] = Mp[i] - sw;
  }
  return makeBuffer([outL, outR], fs);
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

function gluePass(inputBuffer, plan) {
  // Near-bypass when glue/sat are essentially off (protect / open)
  const ratio = plan.glue?.ratio || 1;
  const sat = plan.sat || 0;
  if (ratio < 1.08 && sat < 0.02) {
    return inputBuffer;
  }
  return renderGraph(inputBuffer, (ctx, source) => {
    const glue = compressor(ctx, { ...plan.glue, knee: 12 });
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(sat);
    shaper.oversample = '2x';
    const makeup = plan.protectDynamics ? 0.05 : plan.protectLowEnd ? 0.08 : 0.2;
    return chain([source, glue, shaper, gainNode(ctx, dbToLin(makeup))]);
  });
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

  report(0.52, plan.preserveWidth
    ? 'Mid/Side — mono-safe sub only, preserve stereo width…'
    : 'Mid/Side — mono bass, width polish…');
  buf = await midSideShape(buf, plan);
  await yieldFrame();

  report(0.64, plan.protectDynamics
    ? 'Dynamics protect — skipping heavy glue…'
    : 'Light bus glue (tap, don’t slam)…');
  buf = await gluePass(buf, plan);
  await yieldFrame();

  // Residual FR refine only (polish) — capped soft
  report(0.74, plan.refProfile
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
  const base = getChannelArrays(buf);
  const baseLufs = measureLoudness(base.map((c) => c), fs).integrated;
  const tpMargin = peak.tpMarginDb ?? (plan.protectLowEnd ? 1.35 : 1.0);
  let gainDb = clamp(peak.targetLufs - baseLufs, -14, 14);
  // Don't ask for more makeup than peak headroom allows (bass-heavy redline fix)
  gainDb = Math.min(gainDb, maxSafeGainDb(base, peak.ceilingDb, tpMargin));

  let limited = base;
  let appliedGain = gainDb;
  for (let iter = 0; iter < 4; iter++) {
    const polished = peakPolish(base, fs, {
      gainDb,
      softClip: peak.softClip || plan.protectLowEnd,
      softClipDb: peak.softClipDb ?? -0.7,
      ceilingDb: peak.ceilingDb,
      tpMarginDb: tpMargin,
      releaseMs: plan.protectDynamics || plan.protectLowEnd ? 160 : 110,
    });
    limited = polished.channels;
    appliedGain = polished.appliedGainDb;

    const { over, truePeakDb: tp } = exceedsTruePeak(limited, fs, peak.ceilingDb, 0.05);
    if (over) {
      // Back off makeup when true-peak still redlines (common on heavy bass)
      gainDb = clamp(gainDb - Math.max(0.4, (tp - peak.ceilingDb) * 1.2), -14, appliedGain);
      continue;
    }

    const achieved = measureLoudness(limited.map((c) => c), fs).integrated;
    const err = peak.targetLufs - achieved;
    if (Math.abs(err) < 0.35) break;
    const next = clamp(gainDb + err * 0.65, -14, 14);
    gainDb = Math.min(next, maxSafeGainDb(base, peak.ceilingDb, tpMargin));
    await yieldFrame();
  }

  // Final TP safety pass — never ship a redline
  {
    const check = exceedsTruePeak(limited, fs, peak.ceilingDb, 0.02);
    if (check.over) {
      const trim = Math.max(0.25, check.truePeakDb - peak.ceilingDb + 0.15);
      const polished = peakPolish(base, fs, {
        gainDb: Math.min(appliedGain, gainDb) - trim,
        softClip: true,
        softClipDb: Math.min(-0.8, peak.ceilingDb - 0.2),
        ceilingDb: peak.ceilingDb,
        tpMarginDb: Math.max(tpMargin, 1.4),
        releaseMs: 180,
      });
      limited = polished.channels;
      appliedGain = polished.appliedGainDb;
    }
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
    gainDb: appliedGain,
    genre,
    settings: { ...settings, targetLufs: peak.targetLufs },
    intensity: settings.dynamicsProfile,
    engineerLog: plan.log,
  };
}
