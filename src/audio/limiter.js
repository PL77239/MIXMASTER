import { dbToLin } from './dsp.js';

// Look-ahead peak limiter operating in the sample domain.
// - `ceilingDb`  target ceiling (dBFS), e.g. -1.0
// - Uses a shared gain envelope across channels so the stereo image is stable.
// - One-pole attack sized to the look-ahead window, slower release, plus a final
//   safety clip to guarantee nothing exceeds the ceiling.
export function limit(channelArrays, sampleRate, ceilingDb = -1.0, releaseMs = 60) {
  const ceiling = dbToLin(ceilingDb);
  const la = Math.max(1, Math.round((1.5 / 1000) * sampleRate)); // 1.5 ms look-ahead
  const n = channelArrays[0].length;
  const nCh = channelArrays.length;

  // Required gain from the (look-ahead delayed) peak across channels.
  const required = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let c = 0; c < nCh; c++) {
      const a = Math.abs(channelArrays[c][i]);
      if (a > peak) peak = a;
    }
    required[i] = peak > ceiling ? ceiling / peak : 1;
  }

  const attackCoef = Math.exp(-1 / (la));
  const releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));

  const gain = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = required[i];
    if (target < g) g = attackCoef * g + (1 - attackCoef) * target;
    else g = releaseCoef * g + (1 - releaseCoef) * target;
    gain[i] = g;
  }

  // Apply with look-ahead: delay audio by `la` so gain dips before the transient.
  const out = channelArrays.map(() => new Float32Array(n));
  for (let c = 0; c < nCh; c++) {
    const inp = channelArrays[c];
    const o = out[c];
    for (let i = 0; i < n; i++) {
      const src = i - la >= 0 ? inp[i - la] : 0;
      let y = src * gain[i];
      if (y > ceiling) y = ceiling;
      else if (y < -ceiling) y = -ceiling;
      o[i] = y;
    }
  }
  return out;
}

// Apply a flat gain (dB) to channel arrays in place, returning them.
export function applyGainDb(channelArrays, db) {
  const lin = dbToLin(db);
  for (const ch of channelArrays) for (let i = 0; i < ch.length; i++) ch[i] *= lin;
  return channelArrays;
}
