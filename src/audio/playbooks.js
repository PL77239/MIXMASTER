// Genre engineer playbooks — how a specialist would approach the session.
// Sources synthesized from published mastering/mixing practice (AudioSpectra,
// MasteringTheMix, Alexander Wright, Mixea Intensity model, Dolby loudness
// discipline, Matchering mid/side FR matching idea, trap/EDM masking guides).
// Not proprietary code — decision rules an engineer would actually use.

import { ANALYZE_MIX_TARGET } from './analyzeTargets.js';

/**
 * @typedef {object} Playbook
 * @property {string} role
 * @property {string[]} priorities   what the engineer obsesses over first
 * @property {object} spectrum       ideal ANALYZE-style fractions for this genre
 * @property {object} checks         diagnostic thresholds
 * @property {object} techniques     named techniques with parameters
 * @property {string[]} sessionNotes template lines for the session log
 */

function spec(overrides = {}) {
  const base = { ...ANALYZE_MIX_TARGET };
  for (const k of Object.keys(overrides)) base[k] = overrides[k];
  let s = 0;
  for (const k of Object.keys(base)) s += base[k];
  for (const k of Object.keys(base)) base[k] /= s;
  return base;
}

export const PLAYBOOKS = {
  hiphop: {
    role: 'Hip-Hop / Trap mix & mastering engineer',
    priorities: [
      '808 / kick relationship (sub punch without mud)',
      'Vocal sits in front of the beat',
      'Drum transient punch preserved',
      'Competitive loudness without squashing the groove',
    ],
    spectrum: spec({ sub: 0.11, bass: 0.32, lowMid: 0.16, mid: 0.22, high: 0.13, air: 0.06 }),
    checks: {
      maxSub: 0.18, minBass: 0.22, maxLowMid: 0.22, minPresence: 0.08,
      minCrest: 7, targetWidth: 0.14, vocalPresenceHz: 2800,
    },
    techniques: {
      rumbleHp: 28,
      // Keep 80–150 Hz solid for earbuds (AudioSpectra hip-hop tip)
      upperBassShelf: { f: 100, g: 0.8 },
      mudCut: { f: 280, g: -1.8, q: 0.85 },
      // Vocal pocket vs 808 chest (trap mixing guides)
      vocalPocket: { f: 160, g: -1.5, q: 1.4 },
      vocalPresence: { f: 2800, g: 1.8, q: 1.0 },
      deEss: { f: 7500, g: -1.2 },
      // Kick/bass: multiband sidechain-style duck on sustained low end
      kickBassSep: { enabled: true, bandHz: 90, duckDb: 2.5, attackMs: 8, releaseMs: 120 },
      airSide: { f: 10000, g: 0.8 },
      glue: { threshold: -20, ratio: 1.6, attack: 0.035, release: 0.22 },
      sat: 0.12,
      monoBassHz: 110,
      preserveWidth: true,
      protectLowEnd: true,
    },
  },

  pop: {
    role: 'Pop mix & mastering engineer',
    priorities: [
      'Vocal clarity and consistency',
      'Polished, bright top without harshness',
      'Tight controlled low end',
      'Radio / streaming glue',
    ],
    spectrum: spec({ sub: 0.07, bass: 0.26, lowMid: 0.17, mid: 0.27, high: 0.15, air: 0.08 }),
    checks: {
      maxSub: 0.12, minBass: 0.2, maxLowMid: 0.22, minPresence: 0.1,
      minCrest: 7, targetWidth: 0.18, vocalPresenceHz: 2500,
    },
    techniques: {
      rumbleHp: 35,
      lowShelf: { f: 80, g: 0.4 },
      mudCut: { f: 300, g: -2.0, q: 0.9 },
      vocalPresence: { f: 2500, g: 2.0, q: 1.0 },
      deEss: { f: 7000, g: -1.8 },
      highShelf: { f: 11000, g: 1.4 },
      kickBassSep: { enabled: true, bandHz: 100, duckDb: 1.5, attackMs: 10, releaseMs: 100 },
      airSide: { f: 10500, g: 1.2 },
      glue: { threshold: -19, ratio: 1.7, attack: 0.025, release: 0.18 },
      sat: 0.1,
      monoBassHz: 130,
    },
  },

  edm: {
    role: 'EDM / House mix & mastering engineer',
    priorities: [
      'Maximize low-end impact (tight, not thin)',
      'Kick transients cut through the drop',
      'Wide highs / FX; mono-safe sub only',
      'Club translation + clean limiting',
    ],
    // Production Expert / MtM: EDM needs weight + punch, not scooped bass
    spectrum: spec({ sub: 0.12, bass: 0.34, lowMid: 0.13, mid: 0.2, high: 0.14, air: 0.07 }),
    checks: {
      maxSub: 0.22, minBass: 0.28, maxLowMid: 0.22, minPresence: 0.06,
      minCrest: 7.0, targetWidth: 0.24, vocalPresenceHz: 3000,
    },
    techniques: {
      rumbleHp: 28,
      lowShelf: { f: 65, g: 1.1 },
      mudCut: { f: 350, g: -1.0, q: 0.9 },
      boxCut: { f: 480, g: -0.7, q: 1.0 },
      kickBassSep: { enabled: true, bandHz: 80, duckDb: 2.4, attackMs: 5, releaseMs: 85 },
      highShelf: { f: 10500, g: 0.9 },
      airSide: { f: 11000, g: 1.4 },
      vocalPresence: { f: 3000, g: 0.5, q: 1.0 },
      deEss: { f: 8000, g: -0.6 },
      glue: { threshold: -22, ratio: 1.3, attack: 0.04, release: 0.2 },
      sat: 0.05,
      // Mono only true sub — keep mid-bass stereo (Pirate / stereo balance)
      monoBassHz: 90,
      transientEnhance: { enabled: true, attackDb: 1.4, bandHz: 120 },
      preserveWidth: true,
      protectLowEnd: true,
    },
  },

  rock: {
    role: 'Rock / Alt mix & mastering engineer',
    priorities: [
      'Preserve drum & guitar transients',
      'Clear congestion in 300–600 Hz',
      'Guitar / vocal midrange pocket',
      'Energy without brickwall squash',
    ],
    spectrum: spec({ sub: 0.06, bass: 0.24, lowMid: 0.18, mid: 0.3, high: 0.15, air: 0.07 }),
    checks: {
      maxSub: 0.1, minBass: 0.18, maxLowMid: 0.24, minPresence: 0.09,
      minCrest: 8, targetWidth: 0.16, vocalPresenceHz: 2200,
    },
    techniques: {
      rumbleHp: 35,
      mudCut: { f: 400, g: -2.0, q: 0.9 }, // classic rock congestion cut
      guitarBite: { f: 1500, g: 1.0, q: 0.9 },
      vocalPresence: { f: 2200, g: 1.2, q: 1.0 },
      highShelf: { f: 9000, g: 0.6 },
      kickBassSep: { enabled: false },
      airSide: { f: 9000, g: 0.6 },
      glue: { threshold: -21, ratio: 1.55, attack: 0.04, release: 0.25 },
      sat: 0.14,
      monoBassHz: 110,
    },
  },

  rnb: {
    role: 'R&B / Soul mix & mastering engineer',
    priorities: [
      'Warm, controlled lows',
      'Silky vocal presence without harsh S\'s',
      'Wide but smooth stereo',
      'Gentle dynamics — the groove breathes',
    ],
    spectrum: spec({ sub: 0.09, bass: 0.28, lowMid: 0.18, mid: 0.24, high: 0.13, air: 0.08 }),
    checks: {
      maxSub: 0.14, minBass: 0.22, maxLowMid: 0.22, minPresence: 0.09,
      minCrest: 7.5, targetWidth: 0.18, vocalPresenceHz: 2400,
    },
    techniques: {
      rumbleHp: 30,
      lowShelf: { f: 100, g: 0.7 },
      mudCut: { f: 280, g: -1.4, q: 0.9 },
      vocalPresence: { f: 2400, g: 1.2, q: 1.1 },
      deEss: { f: 7200, g: -2.0 },
      highShelf: { f: 10000, g: 1.0 },
      kickBassSep: { enabled: true, bandHz: 95, duckDb: 1.8, attackMs: 12, releaseMs: 140 },
      airSide: { f: 10000, g: 1.0 },
      glue: { threshold: -21, ratio: 1.5, attack: 0.035, release: 0.25 },
      sat: 0.1,
      monoBassHz: 120,
    },
  },

  acoustic: {
    role: 'Acoustic / Folk mix & mastering engineer',
    priorities: [
      'Natural dynamics — almost invisible processing',
      'Clear vocal / guitar separation',
      'No fake loudness',
      'Gentle air, no harshness',
    ],
    spectrum: spec({ sub: 0.05, bass: 0.22, lowMid: 0.2, mid: 0.28, high: 0.15, air: 0.1 }),
    checks: {
      maxSub: 0.09, minBass: 0.16, maxLowMid: 0.24, minPresence: 0.1,
      minCrest: 9, targetWidth: 0.14, vocalPresenceHz: 3000,
    },
    techniques: {
      rumbleHp: 40,
      mudCut: { f: 300, g: -1.2, q: 0.9 },
      vocalPresence: { f: 3000, g: 0.8, q: 1.0 },
      highShelf: { f: 12000, g: 0.8 },
      kickBassSep: { enabled: false },
      airSide: { f: 11000, g: 0.5 },
      glue: { threshold: -24, ratio: 1.3, attack: 0.05, release: 0.3 },
      sat: 0.04,
      monoBassHz: 100,
    },
  },

  lofi: {
    role: 'Lo-Fi / Chill mix & mastering engineer',
    priorities: [
      'Intentional warmth and rolled-off top',
      'Cozy low-mids, not modern brightness',
      'Soft dynamics',
      'Narrower, intimate image',
    ],
    spectrum: spec({ sub: 0.09, bass: 0.3, lowMid: 0.22, mid: 0.24, high: 0.1, air: 0.05 }),
    checks: {
      maxSub: 0.14, minBass: 0.24, maxLowMid: 0.28, minPresence: 0.05,
      minCrest: 7, targetWidth: 0.1, vocalPresenceHz: 2000,
    },
    techniques: {
      rumbleHp: 30,
      lowShelf: { f: 120, g: 1.0 },
      mudCut: { f: 350, g: -0.6, q: 1.0 },
      highShelf: { f: 8000, g: -2.5 },
      vocalPresence: { f: 2000, g: 0.4, q: 1.0 },
      kickBassSep: { enabled: false },
      airSide: { f: 7000, g: -0.5 },
      glue: { threshold: -20, ratio: 1.6, attack: 0.04, release: 0.28 },
      sat: 0.22,
      monoBassHz: 130,
    },
  },

  latin: {
    role: 'Reggaeton / Latin mix & mastering engineer',
    priorities: [
      'Dembow kick punch',
      'Bright percussion / hats',
      'Vocal forward without harshness',
      'Controlled sub for club systems',
    ],
    spectrum: spec({ sub: 0.1, bass: 0.3, lowMid: 0.16, mid: 0.22, high: 0.14, air: 0.08 }),
    checks: {
      maxSub: 0.16, minBass: 0.24, maxLowMid: 0.2, minPresence: 0.09,
      minCrest: 7.5, targetWidth: 0.16, vocalPresenceHz: 3200,
    },
    techniques: {
      rumbleHp: 28,
      lowShelf: { f: 85, g: 0.6 },
      mudCut: { f: 280, g: -1.8, q: 0.9 },
      vocalPresence: { f: 3200, g: 1.5, q: 1.0 },
      highShelf: { f: 10000, g: 1.2 },
      kickBassSep: { enabled: true, bandHz: 90, duckDb: 2.8, attackMs: 6, releaseMs: 100 },
      airSide: { f: 10500, g: 1.2 },
      deEss: { f: 7500, g: -1.0 },
      glue: { threshold: -19, ratio: 1.65, attack: 0.022, release: 0.18 },
      sat: 0.11,
      monoBassHz: 130,
    },
  },

  metal: {
    role: 'Metal / Heavy mix & mastering engineer',
    priorities: [
      'Tight, controlled low end (no flub)',
      'Guitar density without midrange smear',
      'Drum attack preserved under limiting',
      'Loud but not fatiguing',
    ],
    spectrum: spec({ sub: 0.07, bass: 0.26, lowMid: 0.17, mid: 0.3, high: 0.14, air: 0.06 }),
    checks: {
      maxSub: 0.11, minBass: 0.2, maxLowMid: 0.22, minPresence: 0.08,
      minCrest: 7, targetWidth: 0.14, vocalPresenceHz: 2500,
    },
    techniques: {
      rumbleHp: 35,
      mudCut: { f: 300, g: -1.8, q: 1.0 },
      harshCut: { f: 3500, g: -1.2, q: 1.4 },
      guitarBite: { f: 1200, g: 0.8, q: 1.0 },
      vocalPresence: { f: 2500, g: 0.8, q: 1.0 },
      kickBassSep: { enabled: true, bandHz: 80, duckDb: 2.0, attackMs: 5, releaseMs: 80 },
      airSide: { f: 9000, g: 0.4 },
      glue: { threshold: -18, ratio: 1.8, attack: 0.02, release: 0.16 },
      sat: 0.12,
      monoBassHz: 110,
    },
  },

  jazz: {
    role: 'Jazz mix & mastering engineer',
    priorities: [
      'Wide open dynamics',
      'Natural instrument tone',
      'Minimal processing footprint',
      'Stereo realism',
    ],
    spectrum: spec({ sub: 0.06, bass: 0.24, lowMid: 0.2, mid: 0.28, high: 0.14, air: 0.08 }),
    checks: {
      maxSub: 0.1, minBass: 0.18, maxLowMid: 0.24, minPresence: 0.08,
      minCrest: 10, targetWidth: 0.16, vocalPresenceHz: 2500,
    },
    techniques: {
      rumbleHp: 30,
      mudCut: { f: 300, g: -0.8, q: 0.9 },
      highShelf: { f: 12000, g: 0.5 },
      vocalPresence: { f: 2500, g: 0.4, q: 1.0 },
      kickBassSep: { enabled: false },
      airSide: { f: 11000, g: 0.4 },
      glue: { threshold: -26, ratio: 1.25, attack: 0.05, release: 0.35 },
      sat: 0.05,
      monoBassHz: 90,
    },
  },

  classical: {
    role: 'Classical / Score mix & mastering engineer',
    priorities: [
      'Transparent — do no harm',
      'Preserve micro-dynamics and room',
      'Broadcast-safe peaks only',
      'Natural spectral balance',
    ],
    spectrum: spec({ sub: 0.06, bass: 0.22, lowMid: 0.2, mid: 0.28, high: 0.14, air: 0.1 }),
    checks: {
      maxSub: 0.1, minBass: 0.16, maxLowMid: 0.24, minPresence: 0.08,
      minCrest: 11, targetWidth: 0.14, vocalPresenceHz: 2000,
    },
    techniques: {
      rumbleHp: 24,
      mudCut: { f: 300, g: -0.5, q: 0.9 },
      highShelf: { f: 13000, g: 0.4 },
      kickBassSep: { enabled: false },
      airSide: { f: 12000, g: 0.3 },
      glue: { threshold: -28, ratio: 1.15, attack: 0.06, release: 0.4 },
      sat: 0.02,
      monoBassHz: 80,
    },
  },

  podcast: {
    role: 'Podcast / Vocal engineer',
    priorities: [
      'Speech intelligibility first',
      'Kill rumble and plosives',
      'Tight level consistency',
      'De-ess without lisping',
    ],
    spectrum: spec({ sub: 0.03, bass: 0.12, lowMid: 0.18, mid: 0.35, high: 0.22, air: 0.1 }),
    checks: {
      maxSub: 0.06, minBass: 0.08, maxLowMid: 0.24, minPresence: 0.14,
      minCrest: 6, targetWidth: 0.08, vocalPresenceHz: 3000,
    },
    techniques: {
      rumbleHp: 80,
      mudCut: { f: 250, g: -2.2, q: 1.1 },
      vocalPresence: { f: 3000, g: 2.2, q: 1.0 },
      deEss: { f: 7000, g: -2.5 },
      highShelf: { f: 9000, g: 0.4 },
      kickBassSep: { enabled: false },
      airSide: { f: 8000, g: 0.2 },
      glue: { threshold: -20, ratio: 2.4, attack: 0.015, release: 0.15 },
      sat: 0.04,
      monoBassHz: 200,
    },
  },
};

export function getPlaybook(genreKey) {
  return PLAYBOOKS[genreKey] || PLAYBOOKS.hiphop;
}
