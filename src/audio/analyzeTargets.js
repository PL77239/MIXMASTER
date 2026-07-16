// Spectral measurement helpers shared by the engineer + ANALYZE alignment.
import { FFT, hann } from './fft.js';

export const ANALYZE_BAND_EDGES = [0, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const ANALYZE_MIX_TARGET = {
  sub: 0.08,
  bass: 0.28,
  lowMid: 0.2,
  mid: 0.26,
  high: 0.13,
  air: 0.05,
};

export const ANALYZE_DYNAMICS = {
  crestMin: 6,
  crestMax: 16,
  crestSweet: 10,
  drMin: 3,
  drMax: 14,
  widthMin: 0.05,
  widthMax: 0.28,
  widthSweet: 0.16,
};

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
  for (let fi = 0; fi < nFrames; fi += stride) {
    const off = fi * hop;
    for (let i = 0; i < size; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let b = 1; b < size / 2; b++) {
      sum[binBand[b]] += re[b] * re[b] + im[b] * im[b];
    }
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
