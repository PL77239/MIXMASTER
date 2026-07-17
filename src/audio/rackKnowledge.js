/**
 * Mastering rack knowledge — distilled from:
 * - Evren Göknar / Routledge “The Art of Mastering in Music” (ch. sample):
 *   Primary Colors = EQ · Compressor · Brickwall Limiter (BWL)
 * - Parallel compression as upward density (valleys up, peaks preserved)
 * - Soft/optical-style bus glue vs FET-style transient control
 * - Parametric EQ for surgical cuts; shelves for tonal balance; HPF for rumble
 * - −14 dBFS studio reference culture (pop / rock / hip-hop)
 *
 * These are decision rules for our in-browser rack (Web Audio), not a VST host.
 */

/** Ordered polish rack — mirrors a short mastering insert chain. */
export const RACK_ORDER = [
  'eq',          // Primary color 1 — tonal + surgical
  'kickBass',    // Complementary carve / duck
  'transient',   // Attack polish (dance / metal)
  'stereo',      // Width / mono-safe lows
  'multiband',   // Band-wise dynamics
  'parallel',    // NY / upward density
  'glue',        // Bus compressor (optical LA-2A approx or FET DynamicsCompressorNode)
  'exciter',     // Harmonic air (optional)
  'peak',        // Soft clip (genre) + brickwall / true-peak limit
];

export const PRIMARY_COLORS = {
  eq: 'Equalizer',
  compressor: 'dynamics',
  brickwall: 'true-peak limit',
};

/**
 * Genre desk bias from mastering literature + prior MIXA playbooks.
 * optical = soft knee, slower attack (LA-2A / bus glue character)
 * fet = faster attack, more peak control (1176-ish)
 */
export const GENRE_RACK = {
  hiphop: {
    glueStyle: 'fet',
    knee: 8,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176-led grab first; sub weight + vocal forward',
  },
  pop: {
    glueStyle: 'fet',
    knee: 10,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Modern pop — FET grab into soft optical settle',
  },
  edm: {
    glueStyle: 'fet',
    knee: 8,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Electronic — fast peak control; maximize low-end impact',
  },
  latin: {
    glueStyle: 'hybrid',
    knee: 12,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Dembow punch; hybrid glue; transparent peak path',
  },
  rnb: {
    glueStyle: 'optical',
    knee: 18,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'LA-2A / CLA-2A optical glue — warm lows, silky presence',
  },
  lofi: {
    glueStyle: 'optical',
    knee: 18,
    parallelAsUpward: false,
    referenceDbFs: -14,
    note: 'Optical warmth; soft glue; no harsh air',
  },
  rock: {
    glueStyle: 'fet',
    knee: 8,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176-style attack preserve; mid congestion cuts',
  },
  metal: {
    glueStyle: 'fet',
    knee: 6,
    parallelAsUpward: false,
    referenceDbFs: -14,
    note: 'FET peak grab; tight lows; firm limiting',
  },
  acoustic: {
    glueStyle: 'optical',
    knee: 20,
    parallelAsUpward: false,
    referenceDbFs: -16,
    note: 'LA-2A optical — near-invisible, natural crest',
  },
  jazz: {
    glueStyle: 'optical',
    knee: 22,
    parallelAsUpward: false,
    referenceDbFs: -18,
    note: 'LA-2A optical — wide dynamics, minimal footprint',
  },
  classical: {
    glueStyle: 'optical',
    knee: 22,
    parallelAsUpward: false,
    referenceDbFs: -18,
    note: 'Transparent optical polish — do no harm',
  },
  podcast: {
    glueStyle: 'fet',
    knee: 6,
    parallelAsUpward: false,
    referenceDbFs: -16,
    note: 'Speech consistency; firm level control',
  },
};

export function getGenreRack(genreKey) {
  return GENRE_RACK[genreKey] || GENRE_RACK.hiphop;
}

/**
 * Human-readable rack strip for the engineer log / UI.
 */
export function describeRack(plan, genreKey) {
  const g = getGenreRack(genreKey);
  const stages = [];
  if (plan?.eq?.length) stages.push(`EQ ×${plan.eq.length}`);
  if (plan?.kickBass) stages.push('Kick/bass carve');
  if (plan?.transient) stages.push('Transient');
  if (plan?.widthMode) stages.push(`Stereo ${plan.widthMode}`);
  if (plan?.multiband?.enabled) stages.push('Multiband');
  if (plan?.parallel?.mix > 0.02) stages.push(g.parallelAsUpward ? 'Parallel ↑' : 'Parallel');
  if (plan?.glue?.ratio > 1.05) {
    const tag = g.glueStyle === 'optical' ? 'LA-2A' : g.glueStyle === 'fet' ? '1176' : 'hybrid';
    stages.push(`Glue ${tag} ${plan.glue.ratio.toFixed(2)}:1`);
  }
  if (plan?.exciter?.amount > 0.02) stages.push('Exciter');
  if (plan?.peak) {
    stages.push(
      plan.peak.softClip
        ? `Soft clip → BWL @ ${plan.peak.ceilingDb} dBTP`
        : `BWL @ ${plan.peak.ceilingDb} dBTP`
    );
  }
  return {
    style: g.glueStyle,
    knee: g.knee,
    note: g.note,
    stages,
    primary: 'EQ → Compressor → Brickwall (Routledge primary colors)',
  };
}
