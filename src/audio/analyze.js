import { FFT, hann } from './fft.js';
import { measureLoudness, samplePeakDb, truePeakDb } from './lufs.js';

// Frequency bands used both for reporting and for corrective EQ decisions.
export const BANDS = [
  { name: 'sub', lo: 20, hi: 60, label: 'Sub' },
  { name: 'bass', lo: 60, hi: 150, label: 'Bass' },
  { name: 'lowmid', lo: 150, hi: 400, label: 'Low-mid' },
  { name: 'mid', lo: 400, hi: 1000, label: 'Mid' },
  { name: 'uppermid', lo: 1000, hi: 3000, label: 'Upper-mid' },
  { name: 'presence', lo: 3000, hi: 6000, label: 'Presence' },
  { name: 'brilliance', lo: 6000, hi: 12000, label: 'Brilliance' },
  { name: 'air', lo: 12000, hi: 20000, label: 'Air' },
];

function getChannels(audioBuffer) {
  const chs = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) chs.push(audioBuffer.getChannelData(c));
  return chs;
}

// Average magnitude spectrum -> per-band average level in dB.
function spectrumBands(channels, fs) {
  const size = 4096;
  const fft = new FFT(size);
  const win = hann(size);
  const mono = channels.length === 1
    ? channels[0]
    : (() => {
        const m = new Float32Array(channels[0].length);
        for (let i = 0; i < m.length; i++) {
          let s = 0;
          for (let c = 0; c < channels.length; c++) s += channels[c][i];
          m[i] = s / channels.length;
        }
        return m;
      })();

  const hop = size; // non-overlapping is fine for an average estimate
  const totalFrames = Math.floor((mono.length - size) / hop);
  if (totalFrames <= 0) {
    return BANDS.map((b) => ({ ...b, db: -80 }));
  }
  const maxFrames = 220;
  const stride = Math.max(1, Math.floor(totalFrames / maxFrames));

  const mag = new Float64Array(size / 2);
  let frames = 0;
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let f = 0; f < totalFrames; f += stride) {
    const off = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < size / 2; k++) {
      mag[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    frames++;
  }
  for (let k = 0; k < size / 2; k++) mag[k] /= frames;

  const binHz = fs / size;
  return BANDS.map((b) => {
    const kLo = Math.max(1, Math.floor(b.lo / binHz));
    const kHi = Math.min(size / 2 - 1, Math.ceil(b.hi / binHz));
    let energy = 0;
    let count = 0;
    for (let k = kLo; k <= kHi; k++) {
      energy += mag[k] * mag[k];
      count++;
    }
    const rms = count ? Math.sqrt(energy / count) : 0;
    const db = rms > 0 ? 20 * Math.log10(rms) : -120;
    return { ...b, db };
  });
}

// Crest factor & RMS give a dynamics readout.
function dynamics(channels) {
  let peak = 0;
  let sumSq = 0;
  let n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      sumSq += ch[i] * ch[i];
      n++;
    }
  }
  const rms = Math.sqrt(sumSq / n);
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120;
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -120;
  return { crest: peakDb - rmsDb, rmsDb, peakDb };
}

// Stereo correlation (-1..1) and side/mid energy ratio.
function stereo(channels) {
  if (channels.length < 2) return { correlation: 1, width: 0, mono: true };
  const L = channels[0];
  const R = channels[1];
  let sLR = 0;
  let sLL = 0;
  let sRR = 0;
  let midE = 0;
  let sideE = 0;
  const n = Math.min(L.length, R.length);
  for (let i = 0; i < n; i++) {
    sLR += L[i] * R[i];
    sLL += L[i] * L[i];
    sRR += R[i] * R[i];
    const m = (L[i] + R[i]) * 0.5;
    const s = (L[i] - R[i]) * 0.5;
    midE += m * m;
    sideE += s * s;
  }
  const correlation = sLL > 0 && sRR > 0 ? sLR / Math.sqrt(sLL * sRR) : 1;
  const width = midE > 0 ? Math.sqrt(sideE / midE) : 0;
  return { correlation, width, mono: false };
}

export function analyzeBuffer(audioBuffer) {
  const fs = audioBuffer.sampleRate;
  const channels = getChannels(audioBuffer);
  const loudness = measureLoudness(channels, fs);
  const bands = spectrumBands(channels, fs);
  const dyn = dynamics(channels);
  const st = stereo(channels);
  const peakDb = samplePeakDb(channels);
  const tpDb = truePeakDb(channels, fs);
  return {
    sampleRate: fs,
    duration: audioBuffer.duration,
    channels: channels.length,
    lufs: loudness.integrated,
    momentary: loudness.momentary,
    shortTerm: loudness.shortTerm,
    peakDb,
    truePeakDb: tpDb,
    bands,
    crest: dyn.crest,
    rmsDb: dyn.rmsDb,
    stereo: st,
  };
}
