// Spectral targets aligned with PL77239/ANALYZE mix scoring
// (assets/js/dsp/mix.js frequencyBalance target proportions).
//
// ANALYZE band edges: [0, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000, Nyquist]
// Regions: sub=0-60, bass=60-250, lowMid=250-500, mid=500-2000, high=2k-8k, air=8k+

export const ANALYZE_BAND_EDGES = [0, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const ANALYZE_MIX_TARGET = {
  sub: 0.08,
  bass: 0.28,
  lowMid: 0.2,
  mid: 0.26,
  high: 0.13,
  air: 0.05,
};

// Light genre tints applied on top of ANALYZE_MIX_TARGET, then re-normalised.
// Keep these small — ANALYZE rewards the baseline curve hard (34% of mix score).
export const GENRE_TINTS = {
  hiphop: { sub: 0.03, bass: 0.04, lowMid: -0.02, mid: -0.02, high: 0.0, air: -0.01 },
  pop: { sub: 0.0, bass: 0.0, lowMid: -0.02, mid: 0.01, high: 0.02, air: 0.02 },
  edm: { sub: 0.02, bass: 0.03, lowMid: -0.03, mid: -0.01, high: 0.01, air: 0.01 },
  rock: { sub: -0.01, bass: 0.0, lowMid: 0.0, mid: 0.03, high: 0.01, air: 0.0 },
  rnb: { sub: 0.02, bass: 0.02, lowMid: 0.0, mid: -0.01, high: 0.0, air: 0.01 },
  acoustic: { sub: -0.01, bass: -0.02, lowMid: 0.0, mid: 0.02, high: 0.01, air: 0.01 },
  lofi: { sub: 0.01, bass: 0.03, lowMid: 0.02, mid: 0.0, high: -0.03, air: -0.03 },
  latin: { sub: 0.02, bass: 0.03, lowMid: -0.02, mid: 0.0, high: 0.01, air: 0.0 },
  metal: { sub: 0.0, bass: 0.01, lowMid: -0.01, mid: 0.02, high: 0.0, air: -0.01 },
  jazz: { sub: 0.0, bass: 0.0, lowMid: 0.0, mid: 0.01, high: 0.0, air: 0.01 },
  classical: { sub: 0.0, bass: -0.01, lowMid: 0.0, mid: 0.01, high: 0.0, air: 0.01 },
  podcast: { sub: -0.04, bass: -0.06, lowMid: -0.02, mid: 0.06, high: 0.04, air: 0.0 },
};

export function tintedTarget(genreKey) {
  const tint = GENRE_TINTS[genreKey] || {};
  const out = {};
  let sum = 0;
  for (const k of Object.keys(ANALYZE_MIX_TARGET)) {
    out[k] = Math.max(0.01, ANALYZE_MIX_TARGET[k] + (tint[k] || 0));
    sum += out[k];
  }
  for (const k of Object.keys(out)) out[k] /= sum;
  return out;
}

// Ideal ANALYZE dynamics window (from mix.js normRange bounds).
export const ANALYZE_DYNAMICS = {
  crestMin: 6,
  crestMax: 16,
  crestSweet: 10, // aim near middle of the rewarded range
  drMin: 3,
  drMax: 14,
  widthMin: 0.05,
  widthMax: 0.28,
  widthSweet: 0.16,
};
