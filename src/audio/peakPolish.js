/**
 * Soft-clip (wave-shaper) then hard limit — Aurora / Ozone-style peak polish.
 * Soft clip catches overs gently; limiter catches the rest to a true-peak ceiling.
 */
import { applyGainDb, limit } from './limiter.js';
import { dbToLin } from './dsp.js';

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
      // Soft saturate above ceiling toward ±ceiling
      const over = (a - ceiling) / Math.max(1e-9, 1 - ceiling);
      const soft = ceiling + (1 - ceiling) * Math.tanh(over * amount);
      o[i] = Math.sign(x) * Math.min(soft, ceiling + (1 - ceiling) * 0.15);
    }
    return o;
  });
  return out;
}

/**
 * Gain → optional soft clip → look-ahead limit. Returns limited channel arrays.
 */
export function peakPolish(channelArrays, sampleRate, opts = {}) {
  const {
    gainDb = 0,
    softClip = false,
    softClipDb = -0.5,
    ceilingDb = -1.0,
    releaseMs = 100,
  } = opts;
  const work = channelArrays.map((c) => c.slice());
  if (Math.abs(gainDb) > 0.01) applyGainDb(work, gainDb);
  const clipped = softClip ? softClipChannels(work, softClipDb, 0.5) : work;
  return limit(clipped, sampleRate, ceilingDb, releaseMs);
}
