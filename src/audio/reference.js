// Reference-track analysis for Matchering-style matching
// (analyze reference first, then pull the target toward its profile).
import { measureRegions, ANALYZE_DYNAMICS } from './analyzeTargets.js';
import { measureLoudness } from './lufs.js';

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

function stereoWidth(channels) {
  if (channels.length < 2) return 0.1;
  const L = channels[0], R = channels[1];
  let midE = 0, sideE = 0;
  const n = Math.min(L.length, R.length);
  for (let i = 0; i < n; i += 2) {
    const mid = (L[i] + R[i]) * 0.5;
    const sd = (L[i] - R[i]) * 0.5;
    midE += mid * mid;
    sideE += sd * sd;
  }
  return midE + sideE > 0 ? sideE / (midE + sideE) : 0.1;
}

function crest(channels) {
  let peak = 0, sum = 0, n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      sum += ch[i] * ch[i];
      n++;
    }
  }
  const rms = Math.sqrt(sum / n);
  return peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : 12;
}

/**
 * Analyze a reference AudioBuffer into a profile the polish chain can match.
 */
export function analyzeReference(audioBuffer, name = 'Reference') {
  const channels = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const fs = audioBuffer.sampleRate;
  const regions = measureRegions(channels, fs);
  const lufs = measureLoudness(channels.map((c) => c), fs).integrated;
  const width = stereoWidth(channels);
  const cr = crest(channels);
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;

  return {
    name,
    regions,
    lufs: isFinite(lufs) ? lufs : -14,
    width: Math.max(ANALYZE_DYNAMICS.widthMin, Math.min(ANALYZE_DYNAMICS.widthMax, width)),
    crest: cr,
    peakDb,
    duration: audioBuffer.duration,
    sampleRate: fs,
  };
}

/**
 * Average multiple reference profiles (when user drops several similar tracks).
 */
export function averageReferences(profiles) {
  if (!profiles.length) return null;
  if (profiles.length === 1) return profiles[0];
  const keys = Object.keys(profiles[0].regions);
  const regions = {};
  for (const k of keys) {
    regions[k] = profiles.reduce((s, p) => s + p.regions[k], 0) / profiles.length;
  }
  let sum = 0;
  for (const k of keys) sum += regions[k];
  for (const k of keys) regions[k] /= sum;
  return {
    name: `${profiles.length} references averaged`,
    regions,
    lufs: profiles.reduce((s, p) => s + p.lufs, 0) / profiles.length,
    width: profiles.reduce((s, p) => s + p.width, 0) / profiles.length,
    crest: profiles.reduce((s, p) => s + p.crest, 0) / profiles.length,
    peakDb: profiles.reduce((s, p) => s + p.peakDb, 0) / profiles.length,
  };
}

/**
 * Build gentle EQ moves to pull target regions toward reference (Matchering idea).
 * Strength kept low — polish, not remould (iZotope / Aurora: small mastering moves).
 */
export function referenceMatchEq(targetRegions, refProfile, strength = 0.35) {
  if (!refProfile) return [];
  const specs = [
    { key: 'sub', freq: 45, type: 'lowshelf', max: 2.0 },
    { key: 'bass', freq: 110, type: 'lowshelf', max: 1.8 },
    { key: 'lowMid', freq: 340, type: 'peak', max: 2.0 },
    { key: 'mid', freq: 1000, type: 'peak', max: 2.2 },
    { key: 'high', freq: 4500, type: 'peak', max: 2.0 },
    { key: 'air', freq: 11000, type: 'highshelf', max: 2.2 },
  ];
  const moves = [];
  for (const s of specs) {
    const cur = Math.max(targetRegions[s.key], 1e-6);
    const tgt = refProfile.regions[s.key];
    let g = 20 * Math.log10(tgt / cur) * strength;
    g = Math.max(-s.max, Math.min(s.max, g));
    if (Math.abs(g) < 0.35) continue;
    moves.push({
      type: s.type,
      freq: s.freq,
      gain: g,
      q: 0.9,
      label: `Match ${s.key}`,
      reason: `Reference match ${(cur * 100).toFixed(0)}% → ${(tgt * 100).toFixed(0)}%`,
    });
  }
  return moves;
}
