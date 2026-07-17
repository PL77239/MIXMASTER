/**
 * Mastering rack knowledge — distilled from:
 * - Evren Göknar / Routledge “The Art of Mastering in Music” (ch. sample):
 *   Primary Colors = EQ · Compressor · Brickwall Limiter (BWL)
 * - Parallel compression as upward density (valleys up, peaks preserved)
 * - Classic bus chain: FET (1176) peak grab → optical (LA-2A) settle
 * - Parametric EQ for surgical cuts; shelves for tonal balance; HPF for rumble
 * - −14 dBFS studio reference culture (pop / rock / hip-hop)
 *
 * These are decision rules for our in-browser rack (Web Audio), not a VST host.
 * Drives are character weights — no pink-noise / CLA captures required.
 */

/** Ordered polish rack — mirrors a short mastering insert chain. */
export const RACK_ORDER = [
  'eq',          // Primary color 1 — tonal + surgical
  'kickBass',    // Complementary carve / duck
  'transient',   // Attack polish (dance / metal)
  'stereo',      // Width / mono-safe lows
  'multiband',   // Band-wise dynamics
  'parallel',    // NY / upward density
  'glue',        // Bus: 1176 → LA-2A (or optical-only / FET-only)
  'exciter',     // Harmonic air (optional)
  'peak',        // Soft clip (genre) + brickwall / true-peak limit
];

export const PRIMARY_COLORS = {
  eq: 'equalizer',
  compressor: 'dynamics',
  brickwall: 'true-peak limit',
};

/**
 * Genre desk bias.
 * glueChain:
 *   'series'  — 1176 (FET) then LA-2A (optical) — modern default
 *   'optical' — LA-2A only (soft desks)
 *   'fet'     — 1176 only (speech / firm control)
 * fetDrive / opticalDrive: 0..1 relative intensity within the chain
 */
export const GENRE_RACK = {
  hiphop: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.72,
    opticalDrive: 0.32,
    knee: 8,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176 → LA-2A — FET grab first, optical settle; sub + vocal forward',
  },
  pop: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.55,
    opticalDrive: 0.45,
    knee: 10,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176 → LA-2A — modern pop series glue',
  },
  edm: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.75,
    opticalDrive: 0.22,
    knee: 8,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176 → light LA-2A — fast peak control, low-end impact',
  },
  latin: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.52,
    opticalDrive: 0.4,
    knee: 12,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176 → LA-2A — dembow punch with soft settle; transparent peak',
  },
  rnb: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.28,
    opticalDrive: 0.72,
    knee: 16,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: 'Light 1176 → LA-2A/CLA-2A — warm lows, silky presence',
  },
  lofi: {
    glueChain: 'optical',
    glueStyle: 'optical',
    fetDrive: 0,
    opticalDrive: 0.7,
    knee: 18,
    parallelAsUpward: false,
    referenceDbFs: -14,
    note: 'LA-2A only — optical warmth; soft glue; no harsh air',
  },
  rock: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.68,
    opticalDrive: 0.35,
    knee: 8,
    parallelAsUpward: true,
    referenceDbFs: -14,
    note: '1176 → LA-2A — attack preserve then bus glue',
  },
  metal: {
    glueChain: 'series',
    glueStyle: 'series',
    fetDrive: 0.8,
    opticalDrive: 0.18,
    knee: 6,
    parallelAsUpward: false,
    referenceDbFs: -14,
    note: '1176 → touch of LA-2A — firm peak grab, tight lows',
  },
  acoustic: {
    glueChain: 'optical',
    glueStyle: 'optical',
    fetDrive: 0.08,
    opticalDrive: 0.75,
    knee: 20,
    parallelAsUpward: false,
    referenceDbFs: -16,
    note: 'LA-2A-led — near-invisible optical; optional hair of FET',
  },
  jazz: {
    glueChain: 'optical',
    glueStyle: 'optical',
    fetDrive: 0,
    opticalDrive: 0.8,
    knee: 22,
    parallelAsUpward: false,
    referenceDbFs: -18,
    note: 'LA-2A only — wide dynamics, minimal footprint',
  },
  classical: {
    glueChain: 'optical',
    glueStyle: 'optical',
    fetDrive: 0,
    opticalDrive: 0.65,
    knee: 22,
    parallelAsUpward: false,
    referenceDbFs: -18,
    note: 'Transparent optical polish — do no harm',
  },
  podcast: {
    glueChain: 'fet',
    glueStyle: 'fet',
    fetDrive: 0.85,
    opticalDrive: 0,
    knee: 6,
    parallelAsUpward: false,
    referenceDbFs: -16,
    note: '1176 only — speech consistency; firm level control',
  },
};

export function getGenreRack(genreKey) {
  return GENRE_RACK[genreKey] || GENRE_RACK.hiphop;
}

function glueTag(g) {
  if (g.glueChain === 'series') return '1176→LA-2A';
  if (g.glueChain === 'optical') return 'LA-2A';
  if (g.glueChain === 'fet') return '1176';
  return g.glueStyle || 'glue';
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
    stages.push(`Glue ${glueTag(g)} ${plan.glue.ratio.toFixed(2)}:1`);
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
    chain: g.glueChain,
    knee: g.knee,
    note: g.note,
    stages,
    primary: 'EQ → Compressor → Brickwall (Routledge primary colors)',
  };
}
