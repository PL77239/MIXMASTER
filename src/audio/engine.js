import { FFT, hann } from './fft.js';
import { ANALYZE_BAND_EDGES, tintedTarget, ANALYZE_DYNAMICS } from './analyzeTargets.js';
import { GENRES } from './genres.js';
import { analyzeBuffer } from './analyze.js';
import { measureLoudness } from './lufs.js';
import { limit, applyGainDb } from './limiter.js';
import {
  renderGraph, chain, peaking, lowShelf, highShelf, highpass, lowpass,
  gainNode, saturationCurve, compressor, makeBuffer, getChannelArrays, dbToLin,
} from './dsp.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

/*
 * Mastering optimised for PL77239/ANALYZE mix score:
 *   score = 10 * (0.34*balance + 0.30*dynamics + 0.18*clip + 0.18*stereo)
 *
 * balance  → match ANALYZE spectral proportions (genre = light tint)
 * dynamics → preserve crest (~8–12 dB) and DR; compress only when Intensity=High
 * clip     → −1 dBTP ceiling
 * stereo   → keep side/(mid+side) in ~0.05–0.28; don't crush width
 *
 * Mixea Intensity maps to how much we touch dynamics — Medium is intentionally
 * soft so ANALYZE doesn't punish crushed masters. Dolby guidance still applies
 * for loudness (BS.1770) and true-peak.
 */

function monoFromChannels(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][i];
    m[i] = s / channels.length;
  }
  return m;
}

/** Same region fractions ANALYZE uses in frequencyBalance(). */
export function measureRegions(channels, sampleRate) {
  const mono = monoFromChannels(channels);
  const size = 2048;
  const hop = 512;
  const fft = new FFT(size);
  const win = hann(size);
  const edges = [...ANALYZE_BAND_EDGES, sampleRate / 2];
  const nBands = edges.length - 1;
  const binHz = sampleRate / size;
  const binBand = new Int16Array(size / 2);
  for (let b = 0; b < size / 2; b++) {
    const f = b * binHz;
    let band = nBands - 1;
    for (let k = 0; k < nBands; k++) {
      if (f >= edges[k] && f < edges[k + 1]) { band = k; break; }
    }
    binBand[b] = band;
  }

  const sum = new Float64Array(nBands);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const nFrames = Math.max(0, Math.floor((mono.length - size) / hop) + 1);
  const stride = Math.max(1, Math.floor(nFrames / 200));
  let frames = 0;
  for (let fi = 0; fi < nFrames; fi += stride) {
    const off = fi * hop;
    for (let i = 0; i < size; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let b = 1; b < size / 2; b++) {
      const mag2 = re[b] * re[b] + im[b] * im[b];
      sum[binBand[b]] += mag2;
    }
    frames++;
  }

  let total = 0;
  for (let b = 0; b < nBands; b++) total += sum[b];
  total = total || 1e-9;
  const frac = Array.from(sum, (s) => s / total);
  return {
    sub: frac[0],
    bass: frac[1] + frac[2],
    lowMid: frac[3],
    mid: frac[4] + frac[5],
    high: frac[6] + frac[7],
    air: frac[8] + frac[9],
  };
}

function stereoWidth(channels) {
  if (channels.length < 2) return { width: 0, correlation: 1 };
  const L = channels[0], R = channels[1];
  let sLR = 0, sLL = 0, sRR = 0, midE = 0, sideE = 0;
  const n = Math.min(L.length, R.length);
  for (let i = 0; i < n; i += 2) {
    const l = L[i], r = R[i];
    sLR += l * r; sLL += l * l; sRR += r * r;
    const mid = (l + r) * 0.5, sd = (l - r) * 0.5;
    midE += mid * mid; sideE += sd * sd;
  }
  return {
    width: midE + sideE > 0 ? sideE / (midE + sideE) : 0,
    correlation: sLL > 0 && sRR > 0 ? sLR / Math.sqrt(sLL * sRR) : 1,
  };
}

/**
 * Build EQ moves that close the gap to ANALYZE's spectral target.
 * gainDb ≈ 20*log10(target/current) * strength, capped per region.
 */
function balanceMoves(regions, target, tone) {
  const moves = [];
  const strength = 0.45; // close enough without overshooting
  const specs = [
    { key: 'sub', freq: 40, q: 0.7, type: 'lowshelf', maxCut: 4, maxBoost: 1.5 },
    { key: 'bass', freq: 110, q: 0.8, type: 'lowshelf', maxCut: 3.5, maxBoost: 1.5 },
    { key: 'lowMid', freq: 350, q: 0.85, type: 'peak', maxCut: 3, maxBoost: 2.5 },
    { key: 'mid', freq: 1000, q: 0.9, type: 'peak', maxCut: 2, maxBoost: 3.5 },
    { key: 'high', freq: 4500, q: 0.9, type: 'peak', maxCut: 2, maxBoost: 3.0 },
    { key: 'air', freq: 11000, q: 0.7, type: 'highshelf', maxCut: 2, maxBoost: 3.5 },
  ];

  for (const s of specs) {
    const cur = Math.max(regions[s.key], 1e-6);
    const tgt = target[s.key];
    let gain = 20 * Math.log10(tgt / cur) * strength;
    // User tone bias (Mixea warmer/brighter)
    if (s.key === 'sub' || s.key === 'bass') gain += tone.lowShelfDb * 0.5;
    if (s.key === 'air' || s.key === 'high') gain += tone.highShelfDb * 0.5;
    if (s.key === 'mid' || s.key === 'high') gain += tone.presenceDb * 0.35;

    if (gain > 0) gain = Math.min(gain, s.maxBoost);
    else gain = Math.max(gain, -s.maxCut);

    // Skip tiny moves
    if (Math.abs(gain) < 0.3) continue;
    moves.push({
      key: s.key,
      freq: s.freq,
      gain,
      q: s.q,
      type: s.type,
      band: s.key,
      cur: +cur.toFixed(3),
      tgt: +tgt.toFixed(3),
    });
  }
  return moves;
}

function mixeaTone(s) {
  return {
    lowShelfDb: s.warmth * 0.4 + s.bass * 0.45,
    highShelfDb: s.brightness * 0.5,
    presenceDb: s.vocal * 0.5 + s.brightness * 0.12,
  };
}

// Mixea Intensity → how much dynamics we touch. Medium preserves ANALYZE crest/DR.
function intensityPlan(profile, crest) {
  // If already crushed, don't crush further.
  const soft = crest < 8;
  if (profile === 'open') {
    return { multiband: false, glue: false, sat: 0.04, widthBias: 0.02 };
  }
  if (profile === 'punchy') {
    return {
      multiband: !soft,
      glue: true,
      sat: soft ? 0.08 : 0.14,
      widthBias: 0.0,
      glueParams: { threshold: -18, ratio: 1.8, attack: 0.025, release: 0.2 },
      mbScale: soft ? 0.5 : 1.0,
    };
  }
  // balanced / Medium — light glue only, no multiband stack
  return {
    multiband: false,
    glue: !soft,
    sat: 0.06,
    widthBias: 0.03,
    glueParams: { threshold: -22, ratio: 1.45, attack: 0.04, release: 0.28 },
  };
}

function tonePass(inputBuffer, moves, genre) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const nodes = [source];
    nodes.push(highpass(ctx, Math.max(22, genre.character.hpHz * 0.85)));

    for (const m of moves) {
      if (m.type === 'lowshelf') nodes.push(lowShelf(ctx, m.freq, m.gain));
      else if (m.type === 'highshelf') nodes.push(highShelf(ctx, m.freq, m.gain));
      else nodes.push(peaking(ctx, m.freq, m.gain, m.q));
    }
    return chain(nodes);
  });
}

// Multiband only on High intensity — kept light so ANALYZE dynamics don't tank.
function multibandPass(inputBuffer, genre, scale = 1) {
  const [c0, c1, c2] = genre.dynamics.crossovers;
  const bands = genre.dynamics.bands.map((b) => ({
    threshold: b.threshold - 2,
    ratio: 1 + (b.ratio - 1) * 0.55 * scale,
    attack: b.attack,
    release: b.release,
    knee: 8,
  }));
  const defs = [
    { lp: [c0, c0] },
    { hp: [c0, c0], lp: [c1, c1] },
    { hp: [c1, c1], lp: [c2, c2] },
    { hp: [c2, c2] },
  ];
  return renderGraph(inputBuffer, (ctx, source) => {
    const sum = gainNode(ctx, 1);
    for (let i = 0; i < 4; i++) {
      const def = defs[i];
      const nodes = [source];
      if (def.hp) for (const f of def.hp) nodes.push(highpass(ctx, f));
      if (def.lp) for (const f of def.lp) nodes.push(lowpass(ctx, f));
      nodes.push(compressor(ctx, bands[i]));
      nodes.push(gainNode(ctx, dbToLin(0.4)));
      chain(nodes).connect(sum);
    }
    return sum;
  });
}

async function midSidePass(inputBuffer, plan, userWidth, st) {
  const fs = inputBuffer.sampleRate;
  if (inputBuffer.numberOfChannels < 2) return inputBuffer;

  // Target ANALYZE stereo width (side/(mid+side))
  let targetW = ANALYZE_DYNAMICS.widthSweet + plan.widthBias;
  targetW = clamp(targetW * (userWidth / 100), 0.06, 0.3);
  const curW = st.width;
  // Scale side so resulting width ≈ target: w = s/(m+s) => s/m = w/(1-w)
  const curRatio = curW > 1e-6 ? curW / (1 - curW) : 0.02;
  const tgtRatio = targetW / (1 - targetW);
  let sideScale = clamp(tgtRatio / Math.max(curRatio, 1e-4), 0.7, 1.8);

  const L = inputBuffer.getChannelData(0);
  const R = inputBuffer.getChannelData(1);
  const n = L.length;
  const M = new Float32Array(n);
  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    M[i] = 0.5 * (L[i] + R[i]);
    S[i] = 0.5 * (L[i] - R[i]);
  }

  // Keep bass mono: high-pass sides gently (not as aggressively as before)
  const sideOut = await renderGraph(makeBuffer([S], fs), (ctx, source) =>
    chain([
      source,
      highpass(ctx, 140),
      peaking(ctx, 350, -0.8, 0.9),
      highShelf(ctx, 9000, 0.4),
    ]));
  const midOut = await renderGraph(makeBuffer([M], fs), (ctx, source) =>
    chain([
      source,
      peaking(ctx, 1000, 0.4, 0.9),
      peaking(ctx, 3000, 0.3, 1.0),
    ]));

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
  if (!plan.glue) {
    return renderGraph(inputBuffer, (ctx, source) => {
      const shaper = ctx.createWaveShaper();
      shaper.curve = saturationCurve(plan.sat);
      shaper.oversample = '2x';
      return chain([source, shaper]);
    });
  }
  return renderGraph(inputBuffer, (ctx, source) => {
    const glue = compressor(ctx, { ...plan.glueParams, knee: 10 });
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(plan.sat);
    shaper.oversample = '2x';
    return chain([source, glue, shaper, gainNode(ctx, dbToLin(0.6))]);
  });
}

export async function masterTrack(inputBuffer, analysis, settings, onProgress) {
  const genre = GENRES[settings.genre];
  const target = tintedTarget(settings.genre);
  const tone = mixeaTone({
    warmth: settings.warmth, brightness: settings.brightness,
    bass: settings.bass, vocal: settings.vocal,
  });
  const plan = intensityPlan(settings.dynamicsProfile, analysis.crest);
  const report = (p, t) => onProgress && onProgress(p, t);

  report(0.06, 'Measuring ANALYZE spectral balance…');
  const channels = getChannelArrays(inputBuffer);
  const regions = measureRegions(channels, inputBuffer.sampleRate);
  const st = stereoWidth(channels);
  await yieldFrame();

  report(0.18, 'Matching modern-master balance (ANALYZE target)…');
  let moves = balanceMoves(regions, target, tone);
  let buf = await tonePass(inputBuffer, moves, genre);
  await yieldFrame();

  // Second pass closes residual gap (EQ is not perfectly linear in energy %).
  report(0.3, 'Refining spectral fractions…');
  const midRegions = measureRegions(getChannelArrays(buf), buf.sampleRate);
  const refine = balanceMoves(midRegions, target, { lowShelfDb: 0, highShelfDb: 0, presenceDb: 0 })
    .map((m) => ({ ...m, gain: clamp(m.gain * 0.65, -2.5, 2.5) }))
    .filter((m) => Math.abs(m.gain) >= 0.35);
  if (refine.length) {
    buf = await tonePass(buf, refine, genre);
    moves = moves.concat(refine.map((m) => ({ ...m, band: m.band + ' (refine)' })));
  }
  await yieldFrame();

  if (plan.multiband) {
    report(0.4, 'High Intensity — light multiband control…');
    buf = await multibandPass(buf, genre, plan.mbScale || 1);
    await yieldFrame();
  } else {
    report(0.4, 'Preserving dynamics (ANALYZE crest/DR window)…');
    await yieldFrame();
  }

  report(0.55, 'Stereo image — width into ANALYZE sweet spot…');
  buf = await midSidePass(buf, plan, settings.width, st);
  await yieldFrame();

  report(0.68, plan.glue ? 'Light Mixea-style glue…' : 'Soft saturation only…');
  buf = await gluePass(buf, plan);
  await yieldFrame();

  report(0.82, 'ITU-R BS.1770 → target LUFS, −1 dBTP…');
  const fs = buf.sampleRate;
  const base = getChannelArrays(buf);
  const baseLufs = measureLoudness(base.map((c) => c), fs).integrated;
  let gainDb = clamp(settings.targetLufs - baseLufs, -16, 16);
  let limited = base;
  for (let iter = 0; iter < 3; iter++) {
    const work = base.map((c) => c.slice());
    applyGainDb(work, gainDb);
    // Gentler release to preserve crest a bit better
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
  const afterRegions = measureRegions(getChannelArrays(outBuffer), fs);
  await yieldFrame();

  report(1, 'Master ready.');
  return {
    buffer: outBuffer,
    before: analysis,
    after,
    corrective: moves.map((m) => ({
      band: m.band,
      freq: m.freq,
      gain: m.gain,
      detail: `${(m.cur * 100).toFixed(0)}% → ${(m.tgt * 100).toFixed(0)}%`,
    })),
    regionsBefore: regions,
    regionsAfter: afterRegions,
    gainDb,
    genre,
    settings,
    intensity: settings.dynamicsProfile,
  };
}
