// Approximate instrument / stem energy detection from a stereo mix
// (no true demixing — band + transient heuristics an engineer uses by ear).
// Inspired by iZotope Neutron-style group thinking: drums, bass, harmonics, vocals.

import { FFT, hann } from './fft.js';

function monoFrom(channels) {
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

/**
 * Detect relative presence of instrument families in a stereo mix.
 * Returns 0..1 scores and engineering notes.
 */
export function detectInstruments(channels, sampleRate) {
  const mono = monoFrom(channels);
  const size = 2048;
  const hop = 1024;
  const fft = new FFT(size);
  const win = hann(size);
  const binHz = sampleRate / size;

  const bands = {
    kick: { lo: 40, hi: 80, e: 0 },
    bass: { lo: 80, hi: 180, e: 0 },
    lowmid: { lo: 180, hi: 400, e: 0 },
    drumsBody: { lo: 150, hi: 250, e: 0 }, // snare body-ish
    mid: { lo: 400, hi: 1500, e: 0 },
    presence: { lo: 2000, hi: 5000, e: 0 }, // vocals / leads
    hats: { lo: 6000, hi: 12000, e: 0 },
    air: { lo: 12000, hi: 18000, e: 0 },
  };

  // Transient vs sustain in kick band (for kick detection)
  let transientKick = 0, sustainBass = 0, frames = 0;
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const nFrames = Math.max(0, Math.floor((mono.length - size) / hop));
  const stride = Math.max(1, Math.floor(nFrames / 150));
  let prevKick = 0;

  for (let fi = 0; fi < nFrames; fi += stride) {
    const off = fi * hop;
    for (let i = 0; i < size; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    fft.transform(re, im);
    const frameE = {};
    for (const k of Object.keys(bands)) frameE[k] = 0;
    for (let b = 1; b < size / 2; b++) {
      const e = re[b] * re[b] + im[b] * im[b];
      const f = b * binHz;
      for (const [name, band] of Object.entries(bands)) {
        if (f >= band.lo && f < band.hi) band.e += e;
      }
      if (f >= 40 && f < 80) frameE.kick += e;
      if (f >= 80 && f < 180) frameE.bass += e;
    }
    const kickNow = Math.sqrt(frameE.kick || 0);
    if (kickNow > prevKick * 1.8) transientKick += kickNow - prevKick;
    sustainBass += Math.sqrt(frameE.bass || 0);
    prevKick = kickNow * 0.7 + prevKick * 0.3;
    frames++;
  }

  let total = 0;
  for (const b of Object.values(bands)) total += b.e;
  total = total || 1e-9;
  const frac = {};
  for (const [k, b] of Object.entries(bands)) frac[k] = b.e / total;

  const instruments = {
    kick: {
      present: frac.kick > 0.04 || transientKick > 0.01,
      strength: Math.min(1, frac.kick * 8 + transientKick * 2),
      label: 'Kick',
    },
    bass: {
      present: frac.bass > 0.08,
      strength: Math.min(1, frac.bass * 5),
      label: 'Bass / 808',
    },
    drums: {
      present: frac.hats > 0.02 || frac.drumsBody > 0.04,
      strength: Math.min(1, (frac.hats + frac.drumsBody) * 6),
      label: 'Drums / percussion',
    },
    vocals: {
      present: frac.presence > 0.08,
      strength: Math.min(1, frac.presence * 6),
      label: 'Vocals / lead',
    },
    instruments: {
      present: frac.mid > 0.1,
      strength: Math.min(1, frac.mid * 4),
      label: 'Harmonic instruments',
    },
  };

  // Kick-below vs kick-above bass (Aurora guide)
  const kickBelowBass = frac.kick >= frac.bass * 0.35 && transientKick > sustainBass * 0.02;
  const relationship = kickBelowBass ? 'kick-below-bass' : 'kick-above-bass';

  const detected = Object.values(instruments).filter((i) => i.present).map((i) => i.label);

  return {
    instruments,
    detected,
    relationship,
    fractions: frac,
    notes: [
      detected.length
        ? `Heard: ${detected.join(', ')}.`
        : 'Sparse mix — treating as general polish.',
      `Low-end relationship reads as ${relationship.replace(/-/g, ' ')} (Aurora kick/bass space rule).`,
    ],
  };
}
