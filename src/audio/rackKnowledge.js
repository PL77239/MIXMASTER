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
  'glue',        // Bus compressor (DynamicsCompressorNode)
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
    glueStyle: 'optical',
    knee: 16,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Sub weight + vocal forward; soft bus glue, transparent limit',
  },
  pop: {
    glueStyle: 'optical',
    knee: 14,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Clarity + controlled low; radio glue without squash',
  },
  edm: {
    glueStyle: 'hybrid',
    knee: 12,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Maximize low-end impact; transient polish; mono-safe sub only',
  },
  latin: {
    glueStyle: 'optical',
    knee: 15,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Dembow punch; light glue; transparent peak path',
  },
  rnb: {
    glueStyle: 'optical',
    knee: 16,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Warm lows, silky presence; gentle dynamics',
  },
  lofi: {
    glueStyle: 'optical',
    knee: 18,
    parallelAsUpward: false,
    referenceDbFs: -14,
    note: 'Intentional warmth; soft glue; no harsh air',
  },
  rock: {
    glueStyle: 'hybrid',
    knee: 12,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Preserve drum/guitar attack; mid congestion cuts',
  },
  metal: {
    glueStyle: 'fet',
    knee: 8,
    parallelAsUpward: false,
    referenceDbFs: -14,
    note: 'Tight lows; denser mid control; firm limiting',
  },
  acoustic: {
    glueStyle: 'optical',
    knee: 18,
    parallelAsUpward: false,
    referenceDbFs: -16,
    note: 'Near-invisible processing; natural crest',
  },
  jazz: {
    glueStyle: 'optical',
    knee: 20,
    parallelAsUpward: false,
    referenceDbFs: -18,
    note: 'Wide dynamics; minimal footprint',
  },
  classical: {
    glueStyle: 'optical',
    knee: 22,
    parallelAsUpward: false,
    referenceDbFs: -18,
    note: 'Transparent — do no harm; BWL for broadcast safety only',
  },
  podcast: {
    glueStyle: 'fet',
    knee: 6,
    parallelAsUpward: false,
    referenceDbFs: -16,
    note: 'Speech consistency; de-ess; firm level control',
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
  if (plan?.glue?.ratio > 1.05) stages.push(`Glue ${plan.glue.ratio.toFixed(2)}:1`);
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
