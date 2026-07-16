/**
 * In-browser mastering stages distilled from:
 * - Maztr — genre techniques (multiband, parallel, saturation, stereo imaging)
 * - Mixing & Mastering on the Box — bus compression / NY parallel / exciters
 * - Digital Natural Sound — multiband control, gentle master-bus moves
 * - iZotope Mixing Guide — parallel compression, harmonic excitement, imaging
 *
 * These are Web Audio / sample-domain polish stages (not VST3 hosts).
 */

import {
  renderGraph, chain, peaking, highpass, lowpass, highShelf,
  compressor, gainNode, saturationCurve, makeBuffer, getChannelArrays, dbToLin,
} from './dsp.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Multiband compress — control low / mid / high dynamics separately
 * (rock/EDM tightness without broadband squash).
 */
export async function multibandCompress(inputBuffer, spec) {
  if (!spec?.enabled) return inputBuffer;
  const lowHz = spec.lowHz ?? 180;
  const highHz = spec.highHz ?? 4200;

  const lowBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, lowpass(ctx, lowHz), lowpass(ctx, lowHz)]));
  const midBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, highpass(ctx, lowHz), highpass(ctx, lowHz), lowpass(ctx, highHz), lowpass(ctx, highHz)]));
  const highBuf = await renderGraph(inputBuffer, (ctx, source) =>
    chain([source, highpass(ctx, highHz), highpass(ctx, highHz)]));

  const runBand = (buf, band) => {
    if (!band || (band.ratio || 1) < 1.05) return buf;
    const makeup = dbToLin(band.makeupDb || 0);
    return renderGraph(buf, (ctx, source) =>
      chain([
        source,
        compressor(ctx, {
          threshold: band.threshold ?? -22,
          ratio: band.ratio ?? 1.4,
          attack: band.attack ?? 0.02,
          release: band.release ?? 0.2,
          knee: band.knee ?? 10,
        }),
        gainNode(ctx, makeup),
      ]));
  };

  const [lowC, midC, highC] = await Promise.all([
    runBand(lowBuf, spec.low),
    runBand(midBuf, spec.mid),
    runBand(highBuf, spec.high),
  ]);

  const fs = inputBuffer.sampleRate;
  const nCh = inputBuffer.numberOfChannels;
  const n = inputBuffer.length;
  const out = [];
  for (let c = 0; c < nCh; c++) {
    const a = lowC.getChannelData(c);
    const b = midC.getChannelData(c);
    const d = highC.getChannelData(c);
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = a[i] + b[i] + d[i];
    out.push(ch);
  }
  return makeBuffer(out, fs);
}

/**
 * Parallel (“New York”) compression — blend a heavily compressed copy
 * under the dry bus for density without killing transients (iZotope / on-the-box).
 */
export async function parallelCompress(inputBuffer, spec) {
  const mix = clamp(spec?.mix ?? 0, 0, 0.55);
  if (mix < 0.02) return inputBuffer;

  // Optional HPF on wet path — keeps NY density out of the mud band (250–500 Hz)
  const wetHpHz = spec.wetHpHz || 0;

  const wet = await renderGraph(inputBuffer, (ctx, source) => {
    const nodes = [source];
    if (wetHpHz >= 120) {
      nodes.push(highpass(ctx, wetHpHz), highpass(ctx, wetHpHz));
    }
    const c1 = compressor(ctx, {
      threshold: spec.threshold ?? -28,
      ratio: spec.ratio ?? 4,
      attack: spec.attack ?? 0.003,
      release: spec.release ?? 0.16,
      knee: 4,
    });
    const c2 = compressor(ctx, {
      threshold: (spec.threshold ?? -28) + 4,
      ratio: Math.min(8, (spec.ratio ?? 4) * 1.25),
      attack: 0.01,
      release: 0.22,
      knee: 6,
    });
    const makeup = gainNode(ctx, dbToLin(spec.makeupDb ?? 4));
    nodes.push(c1, c2, makeup);
    return chain(nodes);
  });

  const dry = getChannelArrays(inputBuffer);
  const nCh = dry.length;
  const n = dry[0].length;
  const out = dry.map(() => new Float32Array(n));
  const dryGain = 1 - mix * 0.85;
  for (let c = 0; c < nCh; c++) {
    const w = wet.getChannelData(c);
    const d = dry[c];
    for (let i = 0; i < n; i++) out[c][i] = d[i] * dryGain + w[i] * mix;
  }
  return makeBuffer(out, inputBuffer.sampleRate);
}

/**
 * Harmonic exciter — saturate a high band and blend back for air / edge
 * without a broadband bright shelf (Maztr rock/EDM, iZotope excitement).
 */
export async function harmonicExciter(inputBuffer, spec) {
  const amount = clamp(spec?.amount ?? 0, 0, 0.45);
  const mix = clamp(spec?.mix ?? 0.18, 0, 0.4);
  if (amount < 0.02 || mix < 0.02) return inputBuffer;

  const freq = spec.freq ?? 3200;
  const excited = await renderGraph(inputBuffer, (ctx, source) => {
    const hp = highpass(ctx, freq);
    const hp2 = highpass(ctx, freq);
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(amount);
    shaper.oversample = '2x';
    const g = gainNode(ctx, mix);
    return chain([source, hp, hp2, shaper, g]);
  });

  const dry = getChannelArrays(inputBuffer);
  const nCh = dry.length;
  const n = dry[0].length;
  const out = dry.map(() => new Float32Array(n));
  for (let c = 0; c < nCh; c++) {
    const e = excited.getChannelData(c);
    const d = dry[c];
    for (let i = 0; i < n; i++) out[c][i] = d[i] + e[i];
  }
  return makeBuffer(out, inputBuffer.sampleRate);
}

/**
 * Stereo imaging polish — Mid/Side width + mono-safe lows
 * (Maztr pop widening / hip-hop punch; Mixing on the Box imaging).
 */
export async function stereoImage(inputBuffer, plan) {
  const fs = inputBuffer.sampleRate;
  if (inputBuffer.numberOfChannels < 2) {
    return renderGraph(inputBuffer, (ctx, source) => {
      const nodes = [source];
      const p = plan.eq?.find((e) => e.label === 'Lead presence');
      if (p) nodes.push(peaking(ctx, p.freq, p.gain * 0.3, 1));
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

  let midE = 0;
  let sideE = 0;
  for (let i = 0; i < n; i += 2) {
    midE += M[i] * M[i];
    sideE += S[i] * S[i];
  }
  const curW = midE + sideE > 0 ? sideE / (midE + sideE) : 0.05;
  const tgt = plan.widthTarget;
  const curRatio = curW > 1e-6 ? curW / (1 - curW) : 0.03;
  const tgtRatio = Math.max(0.02, tgt / Math.max(1 - tgt, 0.02));
  let sideScale = tgtRatio / Math.max(curRatio, 1e-4);

  if (plan.preserveWidth || plan.widthMode === 'preserve' || plan.widthMode === 'widen') {
    sideScale = clamp(sideScale, 0.95, 1.45);
  } else {
    sideScale = clamp(sideScale, 0.75, 1.35);
  }

  const monoHz = plan.monoBassHz || 100;

  const midOut = await renderGraph(makeBuffer([M], fs), (ctx, source) =>
    chain([source, peaking(ctx, 1000, 0.08, 0.9)]));

  const sideOut = await renderGraph(makeBuffer([S], fs), (ctx, source) => {
    const nodes = [source, highpass(ctx, monoHz), highpass(ctx, monoHz)];
    if (plan.sideAir) nodes.push(highShelf(ctx, plan.sideAir.freq, plan.sideAir.gain));
    return chain(nodes);
  });

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
