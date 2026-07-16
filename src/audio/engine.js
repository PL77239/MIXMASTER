import { GENRES } from './genres.js';
import { BANDS, analyzeBuffer } from './analyze.js';
import { measureLoudness } from './lufs.js';
import { limit, applyGainDb } from './limiter.js';
import {
  renderGraph, chain, peaking, lowShelf, highShelf, highpass, lowpass,
  gainNode, saturationCurve, compressor, makeBuffer, getChannelArrays, dbToLin,
} from './dsp.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// Scale a genre's dynamics settings by the chosen dynamics profile.
function profileScale(dyn, profile) {
  const out = JSON.parse(JSON.stringify(dyn));
  let ratioMul = 1;
  let threshAdd = 0;
  let satAdd = 0;
  if (profile === 'open') { ratioMul = 0.72; threshAdd = -5; satAdd = -0.05; }
  else if (profile === 'punchy') { ratioMul = 1.3; threshAdd = 3; satAdd = 0.06; }
  for (const b of out.bands) {
    b.ratio = 1 + (b.ratio - 1) * ratioMul;
    b.threshold = clamp(b.threshold + threshAdd, -50, -5);
  }
  out.glue.ratio = 1 + (out.glue.ratio - 1) * ratioMul;
  out.glue.threshold = clamp(out.glue.threshold + threshAdd, -40, -4);
  out.saturation = clamp(out.saturation + satAdd, 0, 0.6);
  return out;
}

// Content-aware corrective EQ: nudge the measured spectrum toward the genre's
// target signature. Returns [{ freq, gain, q }].
function correctiveEQ(analysis, genre) {
  const measured = analysis.bands.map((b) => b.db);
  const meanMeasured = measured.reduce((a, b) => a + b, 0) / measured.length;
  const meanTarget = genre.target.reduce((a, b) => a + b, 0) / genre.target.length;
  const strength = 0.35;
  const maxCut = 3.5;
  const moves = [];
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    const targetRel = genre.target[i] - meanTarget;
    const measuredRel = measured[i] - meanMeasured;
    const gain = clamp((targetRel - measuredRel) * strength, -maxCut, maxCut);
    if (Math.abs(gain) < 0.2) continue;
    const freq = Math.sqrt(b.lo * b.hi);
    const q = i <= 1 || i >= BANDS.length - 1 ? 0.8 : 1.1;
    moves.push({ freq, gain, q, band: b.label });
  }
  return moves;
}

// ---- Pass 1: tonal / character EQ ----
function tonePass(inputBuffer, genre, s, corrective) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const nodes = [source];
    nodes.push(highpass(ctx, genre.character.hpHz));
    nodes.push(lowShelf(ctx, genre.character.lowShelf.f,
      genre.character.lowShelf.g + s.warmth * 0.6 + s.bass * 0.7));
    for (const p of genre.character.peaks) nodes.push(peaking(ctx, p.f, p.g, p.q));
    for (const m of corrective) nodes.push(peaking(ctx, m.freq, m.gain, m.q));
    if (Math.abs(s.vocal) > 0.01) nodes.push(peaking(ctx, 2800, s.vocal * 0.8, 1.0));
    nodes.push(highShelf(ctx, genre.character.highShelf.f,
      genre.character.highShelf.g + s.brightness * 0.8));
    return chain(nodes);
  });
}

// ---- Pass 2: 4-band (stem-aware) dynamics ----
function multibandPass(inputBuffer, dyn) {
  const [c0, c1, c2] = dyn.crossovers;
  const bandDefs = [
    { lp: [c0, c0] },
    { hp: [c0, c0], lp: [c1, c1] },
    { hp: [c1, c1], lp: [c2, c2] },
    { hp: [c2, c2] },
  ];
  return renderGraph(inputBuffer, (ctx, source) => {
    const sum = gainNode(ctx, 1);
    for (let i = 0; i < 4; i++) {
      const def = bandDefs[i];
      const nodes = [source];
      if (def.hp) for (const f of def.hp) nodes.push(highpass(ctx, f));
      if (def.lp) for (const f of def.lp) nodes.push(lowpass(ctx, f));
      const comp = compressor(ctx, dyn.bands[i]);
      nodes.push(comp);
      const makeupDb = clamp(Math.abs(dyn.bands[i].threshold) *
        (1 - 1 / dyn.bands[i].ratio) * 0.35, 0, 6);
      nodes.push(gainNode(ctx, dbToLin(makeupDb)));
      chain(nodes).connect(sum);
    }
    return sum;
  });
}

// ---- Pass 3: mid/side vocal & width shaping ----
async function midSidePass(inputBuffer, genre, dyn, s) {
  const fs = inputBuffer.sampleRate;
  const widthFactor = s.width / 100;
  const presence = dyn.midPresence + s.vocal * 0.5;

  if (inputBuffer.numberOfChannels < 2) {
    // mono: only vocal presence shaping
    const out = await renderGraph(inputBuffer, (ctx, source) =>
      chain([source, peaking(ctx, 2800, presence, 1.0)]));
    return out;
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

  const midBuf = makeBuffer([M], fs);
  const sideBuf = makeBuffer([S], fs);

  const midOut = await renderGraph(midBuf, (ctx, source) =>
    chain([
      source,
      peaking(ctx, 2800, presence, 1.0),
      highShelf(ctx, 7000, -genre.dynamics.deEss * 1.5),
    ]));
  const sideOut = await renderGraph(sideBuf, (ctx, source) =>
    chain([
      source,
      highpass(ctx, 200),
      highShelf(ctx, 9000, s.brightness * 0.3 + 0.5),
    ]));

  const Mp = midOut.getChannelData(0);
  const Sp = sideOut.getChannelData(0);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sw = Sp[i] * widthFactor;
    outL[i] = Mp[i] + sw;
    outR[i] = Mp[i] - sw;
  }
  return makeBuffer([outL, outR], fs);
}

// ---- Pass 4: glue compression + saturation ----
function gluePass(inputBuffer, dyn) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const glue = compressor(ctx, dyn.glue);
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(dyn.saturation);
    shaper.oversample = '4x';
    const makeupDb = clamp(Math.abs(dyn.glue.threshold) *
      (1 - 1 / dyn.glue.ratio) * 0.3, 0, 5);
    return chain([source, glue, shaper, gainNode(ctx, dbToLin(makeupDb))]);
  });
}

export async function masterTrack(inputBuffer, analysis, settings, onProgress) {
  const genre = GENRES[settings.genre];
  const dyn = profileScale(genre.dynamics, settings.dynamicsProfile);
  const s = {
    warmth: settings.warmth, brightness: settings.brightness, bass: settings.bass,
    vocal: settings.vocal, width: settings.width,
  };
  const target = settings.targetLufs;

  const report = (p, t) => onProgress && onProgress(p, t);

  report(0.08, 'Analyzing tonal balance & building corrective EQ…');
  const corrective = correctiveEQ(analysis, genre);
  await yieldFrame();

  report(0.2, 'Sculpting frequencies to the genre signature…');
  let buf = await tonePass(inputBuffer, genre, s, corrective);
  await yieldFrame();

  report(0.38, 'Balancing bass, drums & instrumental dynamics…');
  buf = await multibandPass(buf, dyn);
  await yieldFrame();

  report(0.55, 'Placing vocals & shaping the stereo image…');
  buf = await midSidePass(buf, genre, dyn, s);
  await yieldFrame();

  report(0.7, 'Applying bus glue & analog warmth…');
  buf = await gluePass(buf, dyn);
  await yieldFrame();

  report(0.82, 'Metering loudness & normalizing to target…');
  const fs = buf.sampleRate;
  const base = getChannelArrays(buf);
  const baseLufs = measureLoudness(base.map((c) => c), fs).integrated;
  let gainDb = clamp(target - baseLufs, -24, 24);
  let limited = base;
  let achieved = baseLufs;
  for (let iter = 0; iter < 3; iter++) {
    const work = base.map((c) => c.slice());
    applyGainDb(work, gainDb);
    limited = limit(work, fs, -1.0, 60);
    achieved = measureLoudness(limited.map((c) => c), fs).integrated;
    const err = target - achieved;
    if (Math.abs(err) < 0.3) break;
    gainDb = clamp(gainDb + err, -24, 24);
    await yieldFrame();
  }

  report(0.92, 'Finalizing master & re-analyzing…');
  const outBuffer = makeBuffer(limited, fs);
  const after = analyzeBuffer(outBuffer);
  await yieldFrame();

  report(1, 'Master ready.');
  return {
    buffer: outBuffer,
    before: analysis,
    after,
    corrective,
    gainDb,
    genre,
    settings,
  };
}
