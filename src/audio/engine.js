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

/*
 * Mastering philosophy (inspired by published Mixea + Dolby practices —
 * not their proprietary code):
 *
 * Mixea: Intensity (= compression amount) × EQ tone (warmer ↔ brighter);
 *        bass polish, stereo enhancement, EQ, limiting, loudness — light touch.
 *
 * Dolby Music / Atmos mastering guidance (stereo-relevant bits):
 *        prevent masking, preserve dynamics, mono-safe low end, clarity over
 *        colour, true-peak ≤ −1 dBTP, ITU-R BS.1770 loudness discipline.
 *
 * Practical translation here:
 *  1. Subtractive-first EQ (cut mud 200–500 Hz before any boosts)
 *  2. Very gentle content matching (±1.5 dB), never remould the spectrum
 *  3. Mixea-style Intensity scales compression, not tonal identity
 *  4. Mid/Side: bass stays mono; sides get mud cut + air — no low-mid haze
 *  5. Minimal makeup / saturation so the sum stays clean, not "all over"
 */

// Mixea-style Intensity → compression amount. "balanced" is intentionally soft.
function applyIntensity(dyn, profile, crestDb) {
  const out = JSON.parse(JSON.stringify(dyn));
  // Already-squashed sources get even less processing (Dolby: preserve dynamics).
  const alreadyLoud = crestDb < 7 ? 0.65 : crestDb < 10 ? 0.85 : 1;

  let ratioMul = 0.85;
  let threshAdd = -2;
  let satMul = 0.7;
  let glueMul = 0.85;
  if (profile === 'open') {
    // Mixea "Low Intensity"
    ratioMul = 0.55; threshAdd = -6; satMul = 0.4; glueMul = 0.55;
  } else if (profile === 'punchy') {
    // Mixea "High Intensity"
    ratioMul = 1.15; threshAdd = 1; satMul = 1.0; glueMul = 1.1;
  }

  ratioMul *= alreadyLoud;
  glueMul *= alreadyLoud;
  satMul *= alreadyLoud;

  for (const b of out.bands) {
    b.ratio = 1 + (b.ratio - 1) * ratioMul;
    b.threshold = clamp(b.threshold + threshAdd, -48, -8);
  }
  out.glue.ratio = 1 + (out.glue.ratio - 1) * glueMul;
  out.glue.threshold = clamp(out.glue.threshold + threshAdd, -36, -8);
  out.saturation = clamp(out.saturation * satMul, 0, 0.35);
  return out;
}

// Mixea-style EQ tone from warmth/brightness sliders (warmer ↔ brighter).
function mixeaTone(s) {
  // warmth>0 → warmer bass; brightness>0 → clearer top / vocal air
  return {
    lowShelfDb: s.warmth * 0.45 + s.bass * 0.55,
    highShelfDb: s.brightness * 0.55,
    presenceDb: s.vocal * 0.55 + s.brightness * 0.15,
    mudBias: Math.max(0, -s.warmth * 0.25), // warmer → keep a touch more body
  };
}

/**
 * Content-aware EQ — subtractive-first.
 * Protects sub/bass foundation; concentrates cuts in the 200–500 Hz mud zone.
 */
function correctiveEQ(analysis, genre, tone) {
  const measured = analysis.bands.map((b) => b.db);
  const meanMeasured = measured.reduce((a, b) => a + b, 0) / measured.length;
  const meanTarget = genre.target.reduce((a, b) => a + b, 0) / genre.target.length;

  const strength = 0.16;
  const moves = [];

  const rel = measured.map((db) => db - meanMeasured);
  const tgt = genre.target.map((db) => db - meanTarget);

  // How muddy are we? low-mid vs average of bass + presence
  const mudExcess = rel[2] - 0.5 * (rel[1] + rel[5]);

  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    let gain = (tgt[i] - rel[i]) * strength;

    // Band-specific caps — never gut the foundation to "match" a curve
    let maxBoost = 1.0;
    let maxCut = 1.5;
    if (i <= 1) { maxBoost = 0.8; maxCut = 0.8; }       // sub / bass
    else if (i === 2) { maxBoost = 0; maxCut = 2.8; }    // low-mid = mud only
    else if (i >= 6) { maxBoost = 1.0; maxCut = 1.0; }   // brilliance / air

    if (gain > 0) gain = Math.min(gain, maxBoost);
    else gain = Math.max(gain, -maxCut);

    // If mud is the problem, don't also carve sub/bass
    if (i <= 1 && mudExcess > 0.5 && gain < 0) gain *= 0.35;

    if (Math.abs(gain) < 0.25) continue;
    const freq = Math.sqrt(b.lo * b.hi);
    const q = i === 2 ? 0.85 : (i <= 1 || i >= BANDS.length - 1 ? 0.75 : 1.0);
    moves.push({ freq, gain, q, band: b.label });
  }

  // Focused mud / boxiness cuts — the real clarity move
  let mudCut = -1.0;
  if (mudExcess > 0.3) mudCut = clamp(-(1.2 + mudExcess * 0.7), -3.2, -1.0);
  mudCut -= tone.mudBias;
  moves.push({ freq: 260, gain: mudCut, q: 0.75, band: 'Mud (low-mid)' });
  moves.push({ freq: 400, gain: mudCut * 0.65, q: 0.95, band: 'Boxiness' });

  return moves;
}

// ---- Pass 1: clarity EQ (HP → mud cuts → light character → Mixea tone) ----
function tonePass(inputBuffer, genre, s, corrective, tone) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const nodes = [source];
    // Rumble cleanup (always)
    nodes.push(highpass(ctx, Math.max(24, genre.character.hpHz)));

    // Genre character — scaled down so it never dominates
    const charScale = 0.55;
    nodes.push(lowShelf(ctx, genre.character.lowShelf.f,
      genre.character.lowShelf.g * charScale + tone.lowShelfDb));
    for (const p of genre.character.peaks) {
      nodes.push(peaking(ctx, p.f, p.g * charScale, p.q));
    }

    // Content-aware + mandatory mud cuts
    for (const m of corrective) nodes.push(peaking(ctx, m.freq, m.gain, m.q));

    // Mixea-style presence / air
    if (Math.abs(tone.presenceDb) > 0.05) {
      nodes.push(peaking(ctx, 3000, tone.presenceDb, 1.0));
    }
    nodes.push(highShelf(ctx, genre.character.highShelf.f,
      genre.character.highShelf.g * charScale + tone.highShelfDb));

    return chain(nodes);
  });
}

// ---- Pass 2: 4-band dynamics (gentle makeup — was a major mud source) ----
function multibandPass(inputBuffer, dyn) {
  const [c0, c1, c2] = dyn.crossovers;
  // 24 dB/oct Linkwitz-Riley style (cascaded 12 dB filters)
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
      nodes.push(compressor(ctx, dyn.bands[i]));
      // Tiny makeup only — previous 0.35× factor stacked 4–6 dB/band → mud soup
      const makeupDb = clamp(
        Math.abs(dyn.bands[i].threshold) * (1 - 1 / dyn.bands[i].ratio) * 0.1,
        0, 1.8,
      );
      nodes.push(gainNode(ctx, dbToLin(makeupDb)));
      chain(nodes).connect(sum);
    }
    return sum;
  });
}

// ---- Pass 3: Dolby-style M/S clarity (mono bass, side mud cut, controlled width) ----
async function midSidePass(inputBuffer, genre, dyn, s, tone) {
  const fs = inputBuffer.sampleRate;
  // Cap width so "wide" never becomes a diffuse haze
  const widthFactor = clamp((s.width / 100) * (dyn.width || 1), 0.7, 1.2);
  const presence = clamp(dyn.midPresence * 0.45 + tone.presenceDb * 0.5, -1.5, 2.0);

  if (inputBuffer.numberOfChannels < 2) {
    return renderGraph(inputBuffer, (ctx, source) =>
      chain([
        source,
        peaking(ctx, 280, -1.0, 0.8),
        peaking(ctx, 3000, presence, 1.0),
      ]));
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

  // Mid: keep punch/bass, light presence, gentle de-ess
  const midOut = await renderGraph(makeBuffer([M], fs), (ctx, source) =>
    chain([
      source,
      peaking(ctx, 280, -0.6, 0.9),
      peaking(ctx, 3000, presence, 1.0),
      highShelf(ctx, 7500, -dyn.deEss * 1.0),
    ]));

  // Side: kill bass + mud (anti-masking), leave air for width
  const sideOut = await renderGraph(makeBuffer([S], fs), (ctx, source) =>
    chain([
      source,
      highpass(ctx, 180),
      highpass(ctx, 180), // steeper mono-bass shelf
      peaking(ctx, 320, -2.5, 0.8),
      peaking(ctx, 500, -1.2, 1.0),
      highShelf(ctx, 9000, 0.4 + Math.max(0, tone.highShelfDb) * 0.3),
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

// ---- Pass 4: light Mixea-style glue (never the star of the show) ----
function gluePass(inputBuffer, dyn) {
  return renderGraph(inputBuffer, (ctx, source) => {
    const glue = compressor(ctx, {
      ...dyn.glue,
      knee: 8,
    });
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(dyn.saturation);
    shaper.oversample = '2x';
    const makeupDb = clamp(
      Math.abs(dyn.glue.threshold) * (1 - 1 / dyn.glue.ratio) * 0.12,
      0, 2.0,
    );
    return chain([source, glue, shaper, gainNode(ctx, dbToLin(makeupDb))]);
  });
}

export async function masterTrack(inputBuffer, analysis, settings, onProgress) {
  const genre = GENRES[settings.genre];
  const dyn = applyIntensity(genre.dynamics, settings.dynamicsProfile, analysis.crest);
  const s = {
    warmth: settings.warmth, brightness: settings.brightness, bass: settings.bass,
    vocal: settings.vocal, width: settings.width,
  };
  const tone = mixeaTone(s);
  const target = settings.targetLufs;

  const report = (p, t) => onProgress && onProgress(p, t);

  report(0.08, 'Mapping Mixea-style Intensity & scanning for mud…');
  const corrective = correctiveEQ(analysis, genre, tone);
  await yieldFrame();

  report(0.22, 'Subtractive EQ — clearing 200–500 Hz haze…');
  let buf = await tonePass(inputBuffer, genre, s, corrective, tone);
  await yieldFrame();

  report(0.4, 'Gentle 4-band dynamics (bass / drums / mid / air)…');
  buf = await multibandPass(buf, dyn);
  await yieldFrame();

  report(0.58, 'Dolby-style M/S clarity — mono bass, clean sides…');
  buf = await midSidePass(buf, genre, dyn, s, tone);
  await yieldFrame();

  report(0.72, 'Light bus glue & soft saturation…');
  buf = await gluePass(buf, dyn);
  await yieldFrame();

  report(0.84, 'ITU-R BS.1770 loudness → target, −1 dBTP ceiling…');
  const fs = buf.sampleRate;
  const base = getChannelArrays(buf);
  const baseLufs = measureLoudness(base.map((c) => c), fs).integrated;
  let gainDb = clamp(target - baseLufs, -18, 18);
  let limited = base;
  let achieved = baseLufs;
  for (let iter = 0; iter < 3; iter++) {
    const work = base.map((c) => c.slice());
    applyGainDb(work, gainDb);
    limited = limit(work, fs, -1.0, 80);
    achieved = measureLoudness(limited.map((c) => c), fs).integrated;
    const err = target - achieved;
    if (Math.abs(err) < 0.25) break;
    gainDb = clamp(gainDb + err * 0.9, -18, 18);
    await yieldFrame();
  }

  report(0.94, 'Final metering…');
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
    intensity: settings.dynamicsProfile,
  };
}
