// Genre "standards": each preset carries
//  - target: a normalised spectral signature (dB, relative to the average band
//    level) that the engine matches the track toward, band by band.
//  - character: static tonal moves (shelves / peaks) that give the genre its
//    identity regardless of the source.
//  - dynamics: 4-band compression + glue settings (the bass / drums / vocal /
//    instrumental "stem" treatment) and saturation / width / presence.
//
// Band order for `target` matches analyze.js BANDS:
// [sub, bass, lowmid, mid, uppermid, presence, brilliance, air]

export const GENRES = {
  hiphop: {
    label: 'Hip-Hop / Trap',
    emoji: '🎤',
    desc: 'Deep sub, punchy drums, up-front vocals',
    target: [4, 5, 0, -1, 0, 1, 0, -1],
    character: { hpHz: 28, lowShelf: { f: 90, g: 1.5 }, highShelf: { f: 9000, g: 1.0 },
      peaks: [{ f: 3000, g: 1.5, q: 1.0 }] },
    dynamics: {
      crossovers: [110, 500, 3500],
      bands: [
        { threshold: -22, ratio: 3.0, attack: 0.02, release: 0.18 }, // low: tame 808/sub
        { threshold: -24, ratio: 2.2, attack: 0.01, release: 0.12 }, // low-mid: drum body
        { threshold: -26, ratio: 2.0, attack: 0.006, release: 0.1 }, // mid: vocal/instr
        { threshold: -30, ratio: 1.8, attack: 0.003, release: 0.08 }, // high
      ],
      glue: { threshold: -18, ratio: 2.0, attack: 0.03, release: 0.25 },
      saturation: 0.28, width: 1.05, midPresence: 2.0, deEss: 0.3,
    },
  },
  pop: {
    label: 'Pop',
    emoji: '✨',
    desc: 'Bright, vocal-forward, radio-ready',
    target: [1, 2, -1, -1, 1, 2, 2, 2],
    character: { hpHz: 32, lowShelf: { f: 80, g: 0.8 }, highShelf: { f: 10000, g: 2.0 },
      peaks: [{ f: 2500, g: 2.0, q: 1.1 }, { f: 300, g: -1.0, q: 1.0 }] },
    dynamics: {
      crossovers: [120, 500, 4000],
      bands: [
        { threshold: -22, ratio: 2.6, attack: 0.02, release: 0.16 },
        { threshold: -24, ratio: 2.2, attack: 0.01, release: 0.12 },
        { threshold: -26, ratio: 2.4, attack: 0.005, release: 0.09 },
        { threshold: -30, ratio: 2.0, attack: 0.003, release: 0.07 },
      ],
      glue: { threshold: -16, ratio: 2.2, attack: 0.02, release: 0.2 },
      saturation: 0.22, width: 1.12, midPresence: 2.5, deEss: 0.45,
    },
  },
  edm: {
    label: 'EDM / House',
    emoji: '🔊',
    desc: 'Massive lows, wide, energetic',
    target: [5, 4, -1, -2, 0, 1, 2, 3],
    character: { hpHz: 26, lowShelf: { f: 70, g: 2.0 }, highShelf: { f: 11000, g: 2.5 },
      peaks: [{ f: 400, g: -1.5, q: 1.0 }] },
    dynamics: {
      crossovers: [120, 450, 4500],
      bands: [
        { threshold: -20, ratio: 3.4, attack: 0.015, release: 0.14 },
        { threshold: -24, ratio: 2.4, attack: 0.008, release: 0.1 },
        { threshold: -26, ratio: 2.0, attack: 0.005, release: 0.08 },
        { threshold: -30, ratio: 2.2, attack: 0.003, release: 0.06 },
      ],
      glue: { threshold: -14, ratio: 2.6, attack: 0.015, release: 0.16 },
      saturation: 0.3, width: 1.25, midPresence: 1.0, deEss: 0.3,
    },
  },
  rock: {
    label: 'Rock / Alt',
    emoji: '🎸',
    desc: 'Mid-forward, gutsy, glued',
    target: [0, 1, 1, 1, 1, 1, 0, 0],
    character: { hpHz: 35, lowShelf: { f: 90, g: 1.0 }, highShelf: { f: 9000, g: 1.0 },
      peaks: [{ f: 1500, g: 1.5, q: 0.9 }, { f: 400, g: 1.0, q: 1.2 }] },
    dynamics: {
      crossovers: [120, 600, 4000],
      bands: [
        { threshold: -22, ratio: 2.6, attack: 0.02, release: 0.18 },
        { threshold: -24, ratio: 2.4, attack: 0.012, release: 0.12 },
        { threshold: -24, ratio: 2.2, attack: 0.008, release: 0.1 },
        { threshold: -28, ratio: 1.8, attack: 0.004, release: 0.08 },
      ],
      glue: { threshold: -16, ratio: 2.4, attack: 0.03, release: 0.22 },
      saturation: 0.35, width: 1.05, midPresence: 1.2, deEss: 0.25,
    },
  },
  rnb: {
    label: 'R&B / Soul',
    emoji: '💜',
    desc: 'Warm lows, silky top, wide',
    target: [3, 3, 1, 0, -1, 0, 1, 2],
    character: { hpHz: 30, lowShelf: { f: 100, g: 1.8 }, highShelf: { f: 10000, g: 1.5 },
      peaks: [{ f: 2500, g: -1.0, q: 1.5 }, { f: 200, g: 1.0, q: 1.0 }] },
    dynamics: {
      crossovers: [110, 500, 4000],
      bands: [
        { threshold: -22, ratio: 2.4, attack: 0.025, release: 0.2 },
        { threshold: -24, ratio: 2.0, attack: 0.015, release: 0.14 },
        { threshold: -26, ratio: 1.9, attack: 0.008, release: 0.12 },
        { threshold: -30, ratio: 1.7, attack: 0.004, release: 0.1 },
      ],
      glue: { threshold: -18, ratio: 1.9, attack: 0.03, release: 0.25 },
      saturation: 0.24, width: 1.15, midPresence: 1.5, deEss: 0.5,
    },
  },
  acoustic: {
    label: 'Acoustic / Folk',
    emoji: '🪕',
    desc: 'Natural, gentle, dynamic',
    target: [-1, 0, 0, 0, 1, 1, 1, 1],
    character: { hpHz: 40, lowShelf: { f: 90, g: 0.5 }, highShelf: { f: 11000, g: 1.2 },
      peaks: [{ f: 3000, g: 0.8, q: 1.0 }] },
    dynamics: {
      crossovers: [150, 700, 5000],
      bands: [
        { threshold: -24, ratio: 1.8, attack: 0.03, release: 0.25 },
        { threshold: -26, ratio: 1.6, attack: 0.02, release: 0.2 },
        { threshold: -28, ratio: 1.6, attack: 0.01, release: 0.15 },
        { threshold: -32, ratio: 1.5, attack: 0.006, release: 0.12 },
      ],
      glue: { threshold: -20, ratio: 1.6, attack: 0.04, release: 0.3 },
      saturation: 0.12, width: 1.05, midPresence: 1.0, deEss: 0.35,
    },
  },
  lofi: {
    label: 'Lo-Fi / Chill',
    emoji: '🌆',
    desc: 'Warm, rolled-off, cozy',
    target: [2, 3, 2, 1, 0, -1, -3, -5],
    character: { hpHz: 30, lowShelf: { f: 120, g: 2.0 }, highShelf: { f: 8000, g: -3.0 },
      peaks: [{ f: 500, g: 1.2, q: 1.0 }] },
    dynamics: {
      crossovers: [120, 600, 4000],
      bands: [
        { threshold: -22, ratio: 2.4, attack: 0.03, release: 0.22 },
        { threshold: -24, ratio: 2.2, attack: 0.02, release: 0.18 },
        { threshold: -26, ratio: 2.0, attack: 0.012, release: 0.14 },
        { threshold: -30, ratio: 1.8, attack: 0.008, release: 0.12 },
      ],
      glue: { threshold: -18, ratio: 2.0, attack: 0.04, release: 0.28 },
      saturation: 0.4, width: 0.95, midPresence: 0.5, deEss: 0.2,
    },
  },
  latin: {
    label: 'Reggaeton / Latin',
    emoji: '🌴',
    desc: 'Dembow punch, bright percussion',
    target: [3, 4, 0, -1, 1, 2, 1, 1],
    character: { hpHz: 28, lowShelf: { f: 85, g: 1.5 }, highShelf: { f: 10000, g: 1.8 },
      peaks: [{ f: 3500, g: 1.5, q: 1.0 }] },
    dynamics: {
      crossovers: [110, 500, 4000],
      bands: [
        { threshold: -21, ratio: 3.0, attack: 0.018, release: 0.16 },
        { threshold: -24, ratio: 2.3, attack: 0.01, release: 0.11 },
        { threshold: -26, ratio: 2.1, attack: 0.006, release: 0.09 },
        { threshold: -30, ratio: 1.9, attack: 0.003, release: 0.07 },
      ],
      glue: { threshold: -16, ratio: 2.3, attack: 0.02, release: 0.18 },
      saturation: 0.28, width: 1.1, midPresence: 1.8, deEss: 0.35,
    },
  },
  metal: {
    label: 'Metal / Heavy',
    emoji: '🤘',
    desc: 'Tight lows, controlled bite, loud',
    target: [1, 2, 0, 1, 1, 0, 0, -1],
    character: { hpHz: 35, lowShelf: { f: 90, g: 0.8 }, highShelf: { f: 8000, g: 0.5 },
      peaks: [{ f: 3500, g: -1.5, q: 1.5 }, { f: 1200, g: 1.0, q: 1.0 }] },
    dynamics: {
      crossovers: [110, 600, 4000],
      bands: [
        { threshold: -22, ratio: 3.2, attack: 0.012, release: 0.14 },
        { threshold: -24, ratio: 2.6, attack: 0.008, release: 0.1 },
        { threshold: -24, ratio: 2.4, attack: 0.005, release: 0.08 },
        { threshold: -28, ratio: 2.2, attack: 0.003, release: 0.06 },
      ],
      glue: { threshold: -15, ratio: 2.6, attack: 0.02, release: 0.16 },
      saturation: 0.32, width: 1.05, midPresence: 1.0, deEss: 0.3,
    },
  },
  jazz: {
    label: 'Jazz',
    emoji: '🎷',
    desc: 'Warm, open, very dynamic',
    target: [0, 1, 1, 0, 0, 0, 1, 1],
    character: { hpHz: 30, lowShelf: { f: 100, g: 0.8 }, highShelf: { f: 12000, g: 1.0 },
      peaks: [] },
    dynamics: {
      crossovers: [150, 700, 5000],
      bands: [
        { threshold: -26, ratio: 1.6, attack: 0.04, release: 0.3 },
        { threshold: -28, ratio: 1.5, attack: 0.025, release: 0.25 },
        { threshold: -30, ratio: 1.4, attack: 0.015, release: 0.2 },
        { threshold: -34, ratio: 1.4, attack: 0.008, release: 0.16 },
      ],
      glue: { threshold: -22, ratio: 1.5, attack: 0.05, release: 0.35 },
      saturation: 0.14, width: 1.08, midPresence: 0.8, deEss: 0.25,
    },
  },
  classical: {
    label: 'Classical / Score',
    emoji: '🎻',
    desc: 'Transparent, dynamics preserved',
    target: [0, 0, 0, 0, 0, 0, 1, 1],
    character: { hpHz: 24, lowShelf: { f: 80, g: 0.3 }, highShelf: { f: 13000, g: 0.8 },
      peaks: [] },
    dynamics: {
      crossovers: [150, 800, 6000],
      bands: [
        { threshold: -30, ratio: 1.3, attack: 0.05, release: 0.4 },
        { threshold: -32, ratio: 1.3, attack: 0.03, release: 0.3 },
        { threshold: -34, ratio: 1.2, attack: 0.02, release: 0.25 },
        { threshold: -38, ratio: 1.2, attack: 0.01, release: 0.2 },
      ],
      glue: { threshold: -26, ratio: 1.3, attack: 0.06, release: 0.4 },
      saturation: 0.05, width: 1.02, midPresence: 0.3, deEss: 0.15,
    },
  },
  podcast: {
    label: 'Podcast / Vocal',
    emoji: '🎙️',
    desc: 'Speech clarity, tight leveling',
    target: [-4, -2, 0, 1, 2, 2, 0, -1],
    character: { hpHz: 80, lowShelf: { f: 120, g: -1.0 }, highShelf: { f: 9000, g: 0.5 },
      peaks: [{ f: 3000, g: 2.0, q: 1.0 }, { f: 250, g: -1.5, q: 1.2 }] },
    dynamics: {
      crossovers: [200, 900, 5000],
      bands: [
        { threshold: -28, ratio: 3.0, attack: 0.02, release: 0.2 },
        { threshold: -26, ratio: 3.0, attack: 0.012, release: 0.15 },
        { threshold: -24, ratio: 3.2, attack: 0.008, release: 0.12 },
        { threshold: -30, ratio: 2.4, attack: 0.004, release: 0.1 },
      ],
      glue: { threshold: -18, ratio: 3.0, attack: 0.02, release: 0.2 },
      saturation: 0.1, width: 1.0, midPresence: 2.5, deEss: 0.6,
    },
  },
};

export const DEFAULT_GENRE = 'hiphop';
