/**
 * Methodology distilled from:
 * - MasteringBOX: frequency analysis, headroom, stereo balance, transients,
 *   ear fatigue, Atmos notes, phase/polarity, frequency masking, transient shapers
 * - Production Expert / Mastering The Mix / Pirate.com: genre-tailored mastering
 * - Maztr — mastering different genres (multiband, parallel, saturation, imaging)
 * - Mixing & Mastering on the Box — bus / NY parallel / exciters
 * - Digital Natural Sound — multiband tips, gentle master-bus moves
 * - iZotope Mixing Guide — parallel compression, harmonic excitement, imaging
 * - Routledge / Evren Göknar “Art of Mastering”: Primary Colors =
 *   EQ → Compressor → Brickwall Limiter; parallel = upward density;
 *   classic series bus: FET (1176) peak grab → optical (LA-2A) settle;
 *   −14 dBFS studio reference culture
 *
 * Used as decision rules in diagnose → plan → polish (not blind remoulding).
 * Bus glue: sample-domain 1176 → LA-2A (fetCompress / opticalCompress).
 * DynamicsCompressorNode remains for multiband / parallel stages (dsp.js).
 */

export const METHODOLOGY = {
  // Frequency analysis (MasteringBOX)
  spectrum: {
    bass: [20, 250],
    mids: [250, 2000],
    treble: [2000, 20000],
    // Subtractive EQ first; cut mud/box before boosting (clarity > loudness)
    preferSubtractive: true,
  },

  // Headroom (MasteringBOX): peaks ≠ loudness; true-peak ceiling for delivery
  headroom: {
    mixPeakTargetDb: -6, // classic premaster headroom (guideline, not absolute)
    masterCeilingDbTp: -1.0,
    note: 'Leave space for EQ/limiting; LUFS ≠ headroom',
  },

  // Routledge primary colors — order of the short mastering rack
  primaryColors: {
    order: ['eq', 'compressor', 'brickwall'],
    parallelIsUpward: true,
    note: 'EQ tonal/surgical → 1176→LA-2A series glue → true-peak BWL',
  },

  // Stereo balance (MasteringBOX): center kick/bass/vocal; width on supports
  stereo: {
    centerEssentials: ['kick', 'bass', 'lead', 'snare'],
    widenSupports: true,
    monoCheck: true, // mono-safe lows — not “make the whole mix mono”
    monoBassHzDefault: 100, // true sub/bass foundation only
    neverCollapseUnlessPhase: true,
  },

  // Frequency masking (MasteringBOX): kick vs bass, carve don’t flatten
  masking: {
    kickBass: 'sidechain_or_complementary_eq',
    preferCarveOverBroadbandCut: true,
  },

  // Transients (MasteringBOX / Production Expert EDM): punch without loudness race
  transients: {
    enhanceKickForEdm: true,
    avoidGlueThatKillsAttack: true,
  },

  // Ear fatigue: tame harshness; don’t over-brighten to “fix” dullness
  fatigue: {
    avoidHarshHighs: true,
    referenceOften: true,
  },

  // Phase (MasteringBOX): if correlation collapses, favour mid / mono lows
  phase: {
    fixByNarrowingSides: true,
    correlationWarn: 0.1,
  },

  // Genre signatures (Production Expert, Mastering The Mix, Pirate, Routledge)
  genres: {
    edm: {
      maximizeLowEndImpact: true, // do NOT gut sub/bass
      enhanceTransients: true,
      wideHighsAndFx: true, // stereo enhancement on sides
      monoSafeLowEnd: true, // check mono, keep sub centered — keep sides wide above
      brightButNotHarsh: true,
    },
    hiphop: { heavySub: true, vocalForward: true, referenceDbFs: -14 },
    pop: { clarityPunch: true, controlledLow: true, sideWidth: true, referenceDbFs: -14 },
    rock: { preserveDynamics: true, midControl: true, wideGuitars: true, referenceDbFs: -14 },
    metal: { tightLows: true, denseMids: true, firmLimit: true },
    acoustic: { warmth: true, naturalDynamics: true },
    jazz: { openDynamics: true, transparent: true },
    classical: { doNoHarm: true, broadcastSafePeaks: true },
  },
};

/** True if genre wants protected / maximized low end (don’t over-cut). */
export function protectsLowEnd(genreKey) {
  return ['edm', 'hiphop', 'latin', 'rnb', 'lofi'].includes(genreKey);
}

/** True if genre wants wide sides (ear candy) while keeping bass mono-safe. */
export function wantsWideSides(genreKey) {
  return ['edm', 'pop', 'latin', 'hiphop', 'rnb'].includes(genreKey);
}
