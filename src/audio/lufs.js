// ITU-R BS.1770-4 loudness measurement (integrated / momentary / short-term)
// and a simple oversampled true-peak estimator.
//
// The K-weighting filter is designed for the actual sample rate using the
// bilinear-transform coefficients that reproduce the BS.1770 48 kHz reference.

function stage1Coeffs(fs) {
  const f0 = 1681.9744509555319;
  const G = 3.99984385397;
  const Q = 0.7071752369554193;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function stage2Coeffs(fs) {
  const f0 = 38.13547087613982;
  const Q = 0.5003270373253953;
  const K = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

// Transposed direct form II biquad over a copy of the input.
function biquad(input, c) {
  const out = new Float32Array(input.length);
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

// K-weight a single channel.
function kWeight(channel, fs) {
  const c1 = stage1Coeffs(fs);
  const c2 = stage2Coeffs(fs);
  return biquad(biquad(channel, c1), c2);
}

// Channel weights (stereo / mono use 1.0). Surround weights kept for completeness.
function channelWeight(index, count) {
  if (count >= 5 && (index === 3 || index === 4)) return 1.41; // Ls / Rs
  return 1.0;
}

// Returns { integrated, momentary(max), shortTerm(max), blocks } in LUFS.
export function measureLoudness(channels, fs) {
  const nCh = channels.length;
  const filtered = channels.map((ch) => kWeight(ch, fs));
  const len = filtered[0].length;

  const blockSec = 0.4;
  const stepSec = 0.1; // 75% overlap
  const blockLen = Math.round(blockSec * fs);
  const stepLen = Math.round(stepSec * fs);
  if (len < blockLen) {
    return { integrated: -Infinity, momentary: -Infinity, shortTerm: -Infinity };
  }

  // mean-square power per block, weighted-summed across channels
  const zBlocks = [];
  for (let start = 0; start + blockLen <= len; start += stepLen) {
    let z = 0;
    for (let c = 0; c < nCh; c++) {
      const g = channelWeight(c, nCh);
      const buf = filtered[c];
      let sum = 0;
      for (let i = start; i < start + blockLen; i++) sum += buf[i] * buf[i];
      z += g * (sum / blockLen);
    }
    zBlocks.push(z);
  }

  const loud = (z) => -0.691 + 10 * Math.log10(z);

  // absolute gate at -70 LUFS
  const absKept = zBlocks.filter((z) => z > 0 && loud(z) > -70);
  if (absKept.length === 0) return { integrated: -Infinity, momentary: -Infinity, shortTerm: -Infinity };

  const meanAbs = absKept.reduce((a, b) => a + b, 0) / absKept.length;
  const relThresh = loud(meanAbs) - 10;

  const relKept = zBlocks.filter((z) => z > 0 && loud(z) > -70 && loud(z) > relThresh);
  const meanRel = (relKept.length ? relKept : absKept).reduce((a, b) => a + b, 0) /
    (relKept.length || absKept.length);
  const integrated = loud(meanRel);

  // momentary (400ms) & short-term (3s) maxima
  let momentary = -Infinity;
  for (const z of zBlocks) if (z > 0) momentary = Math.max(momentary, loud(z));

  const stBlockLen = Math.round(3 * fs);
  let shortTerm = -Infinity;
  for (let start = 0; start + stBlockLen <= len; start += stepLen) {
    let z = 0;
    for (let c = 0; c < nCh; c++) {
      const g = channelWeight(c, nCh);
      const buf = filtered[c];
      let sum = 0;
      for (let i = start; i < start + stBlockLen; i++) sum += buf[i] * buf[i];
      z += g * (sum / stBlockLen);
    }
    if (z > 0) shortTerm = Math.max(shortTerm, loud(z));
  }
  if (shortTerm === -Infinity) shortTerm = momentary;

  return { integrated, momentary, shortTerm };
}

// Sample peak in dBFS across all channels.
export function samplePeakDb(channels) {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

// 4x oversampled true-peak estimate (dBTP) using a short windowed-sinc FIR.
// To stay fast on full-length tracks we only reconstruct the intersample points
// in the neighbourhood of samples that are already near the sample peak — those
// are the only places an inter-sample "over" can occur.
export function truePeakDb(channels, fs) {
  const OS = 4;
  const taps = 24;
  const half = taps / 2;
  const phases = [];
  for (let p = 1; p < OS; p++) {
    const coeffs = new Float32Array(taps);
    let norm = 0;
    for (let t = 0; t < taps; t++) {
      const x = t - half + 1 - p / OS;
      const s = Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (t + 1)) / (taps + 1)));
      coeffs[t] = s * w;
      norm += coeffs[t];
    }
    for (let t = 0; t < taps; t++) coeffs[t] /= norm;
    phases.push(coeffs);
  }

  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
  }
  const thresh = peak * 0.6;

  for (const ch of channels) {
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      if (Math.abs(ch[i]) < thresh) continue;
      for (const c of phases) {
        let acc = 0;
        for (let t = 0; t < taps; t++) {
          const idx = i - half + 1 + t;
          if (idx >= 0 && idx < n) acc += ch[idx] * c[t];
        }
        const a = Math.abs(acc);
        if (a > peak) peak = a;
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
