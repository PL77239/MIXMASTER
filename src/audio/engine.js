// Execute an engineer session plan: diagnose → plan → process like a genre specialist.
import { GENRES } from './genres.js';
import { analyzeBuffer } from './analyze.js';
import { measureLoudness } from './lufs.js';
import { measureRegions } from './analyzeTargets.js';
import { diagnose } from './diagnose.js';
import { planSession } from './planner.js';
import { limit, applyGainDb } from './limiter.js';
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
 * Kick/bass separation without stems (house/trap engineer technique):
 * Split low band into transient vs sustain via envelope follower.
 * Duck the sustain briefly when a transient hits — approximates multiband sidechain.
 */
async function kickBassSeparate(inputBuffer, spec) {
  if (!spec) return inputBuffer;
  const fs = inputBuffer.sampleRate;
  const channels = getChannelArrays(inputBuffer);
  const n = channels[0].length;
  const nCh = channels.length;

  // Isolate low band
  const lowBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, lowpass(ctx, spec.bandHz * 1.4), lowpass(ctx, spec.bandHz * 1.4)]));
  const highBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, highpass(ctx, spec.bandHz * 1.4), highpass(ctx, spec.bandHz * 1.4)]));

  const low = [];
  for (let c = 0; c < nCh; c++) low.push(lowBuf.getChannelData(c));

  // Envelope on mono low
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
    // When envelope rises fast, duck sustain more — use env itself as sidechain key
    // Soft-knee: map env to gain between 1 and duckLin
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

  // Measure current width to scale sides
  let midE = 0, sideE = 0;
  for (let i = 0; i < n; i += 2) {
    midE += M[i] * M[i];
    sideE += S[i] * S[i];
  }
  const curW = midE + sideE > 0 ? sideE / (midE + sideE) : 0.05;
  const tgt = plan.widthTarget;
  const curRatio = curW > 1e-6 ? curW / (1 - curW) : 0.03;
  const tgtRatio = tgt / (1 - tgt);
  const sideScale = clamp(tgtRatio / Math.max(curRatio, 1e-4), 0.65, 1.9);

  const midOut = await renderGraph(makeBuffer([M], fs), (ctx, source) =>
    chain([source, peaking(ctx, 1000, 0.25, 0.9)]));

  const sideNodes = (ctx, source) => {
    const nodes = [source, highpass(ctx, plan.monoBassHz), highpass(ctx, plan.monoBassHz)];
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

function gluePass(inputBuffer, plan) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const glue = compressor(ctx, { ...plan.glue, knee: 10 });
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(plan.sat);
    shaper.oversample = '2x';
    const makeup = plan.protectDynamics ? 0.3 : 0.7;
    return chain([source, glue, shaper, gainNode(ctx, dbToLin(makeup))]);
  });
}

export async function masterTrack(inputBuffer, analysis, settings, onProgress) {
  const genre = GENRES[settings.genre];
  const report = (p, t) => onProgress && onProgress(p, t);
  const channels = getChannelArrays(inputBuffer);

  report(0.05, `Listening as ${settings.genre} engineer…`);
  const diag = diagnose(channels, inputBuffer.sampleRate, analysis, settings.genre);
  await yieldFrame();

  report(0.12, 'Building the session plan from genre playbook…');
  const plan = planSession(diag, settings);
  await yieldFrame();

  report(0.22, plan.log.find((l) => l.type === 'finding')?.text || 'Applying genre EQ recipe…');
  let buf = await applyEqPlan(inputBuffer, plan.eq);
  await yieldFrame();

  if (plan.kickBass) {
    report(0.4, 'Kick/bass separation (genre sidechain technique)…');
    buf = await kickBassSeparate(buf, plan.kickBass);
    await yieldFrame();
  } else {
    report(0.4, 'Lows OK — skipping kick/bass separation…');
    await yieldFrame();
  }

  report(0.55, 'Mid/Side — mono bass, genre width & side air…');
  buf = await midSideShape(buf, plan);
  await yieldFrame();

  report(0.7, 'Bus glue & colour…');
  buf = await gluePass(buf, plan);
  await yieldFrame();

  // Closing pass: gently close remaining gap to the genre spectrum target
  // (Matchering-style idea — match FR to a reference curve — but only residual).
  report(0.78, 'Closing genre spectral target (Matchering-style refine)…');
  const midRegions = measureRegions(getChannelArrays(buf), buf.sampleRate);
  const refine = [];
  const tgt = plan.spectrumTarget;
  const specs = [
    { key: 'sub', freq: 40, type: 'lowshelf', max: 2.5 },
    { key: 'bass', freq: 110, type: 'lowshelf', max: 2.0 },
    { key: 'lowMid', freq: 350, type: 'peak', max: 2.5 },
    { key: 'mid', freq: 1100, type: 'peak', max: 3.0 },
    { key: 'high', freq: 4500, type: 'peak', max: 2.5 },
    { key: 'air', freq: 11000, type: 'highshelf', max: 3.0 },
  ];
  for (const s of specs) {
    const cur = Math.max(midRegions[s.key], 1e-6);
    let g = 20 * Math.log10(tgt[s.key] / cur) * 0.4;
    g = clamp(g, -s.max, s.max);
    if (Math.abs(g) < 0.4) continue;
    refine.push({
      type: s.type, freq: s.freq, gain: g, q: 0.9,
      label: `Refine ${s.key}`, reason: `Close to genre target (${(cur * 100).toFixed(0)}% → ${(tgt[s.key] * 100).toFixed(0)}%)`,
    });
  }
  if (refine.length) {
    buf = await applyEqPlan(buf, refine);
    plan.eq = plan.eq.concat(refine);
  }
  await yieldFrame();

  report(0.86, 'ITU-R BS.1770 loudness → target, −1 dBTP…');
  const fs = buf.sampleRate;
  const base = getChannelArrays(buf);
  const baseLufs = measureLoudness(base.map((c) => c), fs).integrated;
  let gainDb = clamp(settings.targetLufs - baseLufs, -16, 16);
  let limited = base;
  for (let iter = 0; iter < 3; iter++) {
    const work = base.map((c) => c.slice());
    applyGainDb(work, gainDb);
    limited = limit(work, fs, -1.0, 100);
    const achieved = measureLoudness(limited.map((c) => c), fs).integrated;
    const err = settings.targetLufs - achieved;
    if (Math.abs(err) < 0.25) break;
    gainDb = clamp(gainDb + err * 0.85, -16, 16);
    await yieldFrame();
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
    gainDb,
    genre,
    settings,
    intensity: settings.dynamicsProfile,
    engineerLog: plan.log,
  };
}
