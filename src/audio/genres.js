// Genre standards — spectral *hints* (not hard remoulds) + light character EQ.
// Character gains are intentionally modest; the engine scales them further (~0.55×)
// and always applies subtractive mud cleanup. Dynamics follow Mixea-style Intensity
// (scaled in engine.js) and Dolby-style clarity (mono bass, anti-masking).
//
// Band order for `target` matches analyze.js BANDS:
// [sub, bass, lowmid, mid, uppermid, presence, brilliance, air]

export const GENRES = {
  hiphop: {
    label: 'Hip-Hop / Trap',
    emoji: '🎤',
    desc: 'Deep sub, punchy drums, up-front vocals',
    target: [3, 3.5, -1.5, -0.5, 0.5, 1.5, 0.5, 0],
    character: {
      hpHz: 28,
      lowShelf: { f: 85, g: 1.0 },
      highShelf: { f: 9000, g: 0.6 },
      peaks: [
        { f: 280, g: -1.5, q: 0.85 },
        { f: 3000, g: 1.0, q: 1.0 },
      ],
    },
    dynamics: {
      crossovers: [110, 520, 3800],
      bands: [
        { threshold: -24, ratio: 2.4, attack: 0.025, release: 0.18 },
        { threshold: -26, ratio: 1.9, attack: 0.012, release: 0.12 },
        { threshold: -28, ratio: 1.8, attack: 0.007, release: 0.1 },
        { threshold: -30, ratio: 1.6, attack: 0.004, release: 0.08 },
      ],
      glue: { threshold: -20, ratio: 1.7, attack: 0.035, release: 0.25 },
      saturation: 0.14, width: 1.02, midPresence: 1.4, deEss: 0.3,
    },
  },
  pop: {
    label: 'Pop',
    emoji: '✨',
    desc: 'Bright, vocal-forward, radio-ready',
    target: [1, 1.5, -1.5, -0.5, 1, 2, 1.5, 1.5],
    character: {
      hpHz: 35,
      lowShelf: { f: 90, g: 0.4 },
      highShelf: { f: 10000, g: 1.2 },
      peaks: [
        { f: 280, g: -1.8, q: 0.9 },
        { f: 2500, g: 1.2, q: 1.0 },
      ],
    },
    dynamics: {
      crossovers: [120, 550, 4200],
      bands: [
        { threshold: -24, ratio: 2.2, attack: 0.022, release: 0.16 },
        { threshold: -26, ratio: 1.9, attack: 0.01, release: 0.12 },
        { threshold: -27, ratio: 2.0, attack: 0.006, release: 0.09 },
        { threshold: -30, ratio: 1.7, attack: 0.003, release: 0.07 },
      ],
      glue: { threshold: -19, ratio: 1.8, attack: 0.025, release: 0.2 },
      saturation: 0.12, width: 1.06, midPresence: 1.8, deEss: 0.4,
    },
  },
  edm: {
    label: 'EDM / House',
    emoji: '🔊',
    desc: 'Tight lows, clean mids, wide highs',
    // Was [5,4,-1,-2,…] with +2 dB low shelf → muddy. Now clarity-first.
    target: [2.5, 2.5, -2.5, -1, 0.5, 1, 2, 2],
    character: {
      hpHz: 30,
      lowShelf: { f: 80, g: 0.5 },
      highShelf: { f: 10500, g: 1.0 },
      peaks: [
        { f: 250, g: -2.2, q: 0.85 },
        { f: 400, g: -1.6, q: 1.0 },
        { f: 5500, g: 0.8, q: 1.1 },
      ],
    },
    dynamics: {
      crossovers: [100, 500, 5000],
      bands: [
        { threshold: -22, ratio: 2.6, attack: 0.018, release: 0.14 }, // sub/kick tighten
        { threshold: -26, ratio: 2.0, attack: 0.01, release: 0.11 },  // low-mid control
        { threshold: -28, ratio: 1.7, attack: 0.006, release: 0.09 }, // synths/vocals
        { threshold: -30, ratio: 1.8, attack: 0.003, release: 0.06 }, // hats/air
      ],
      glue: { threshold: -19, ratio: 1.7, attack: 0.025, release: 0.18 },
      saturation: 0.1, width: 1.08, midPresence: 0.6, deEss: 0.25,
    },
  },
  rock: {
    label: 'Rock / Alt',
    emoji: '🎸',
    desc: 'Mid-forward, gutsy, glued',
    target: [0, 1, -0.5, 1, 1, 0.5, 0, 0],
    character: {
      hpHz: 35,
      lowShelf: { f: 95, g: 0.5 },
      highShelf: { f: 9000, g: 0.5 },
      peaks: [
        { f: 350, g: -1.2, q: 1.0 },
        { f: 1500, g: 1.0, q: 0.9 },
      ],
    },
    dynamics: {
      crossovers: [120, 600, 4200],
      bands: [
        { threshold: -24, ratio: 2.2, attack: 0.022, release: 0.18 },
        { threshold: -26, ratio: 2.0, attack: 0.012, release: 0.12 },
        { threshold: -26, ratio: 1.9, attack: 0.008, release: 0.1 },
        { threshold: -30, ratio: 1.6, attack: 0.004, release: 0.08 },
      ],
      glue: { threshold: -19, ratio: 1.9, attack: 0.03, release: 0.22 },
      saturation: 0.16, width: 1.02, midPresence: 0.9, deEss: 0.25,
    },
  },
  rnb: {
    label: 'R&B / Soul',
    emoji: '💜',
    desc: 'Warm lows, silky top, wide',
    target: [2, 2.5, -0.5, 0, 0, 0.5, 1, 1.5],
    character: {
      hpHz: 30,
      lowShelf: { f: 100, g: 0.9 },
      highShelf: { f: 10000, g: 0.9 },
      peaks: [
        { f: 280, g: -1.2, q: 0.9 },
        { f: 2500, g: -0.4, q: 1.2 },
      ],
    },
    dynamics: {
      crossovers: [110, 520, 4200],
      bands: [
        { threshold: -24, ratio: 2.0, attack: 0.028, release: 0.2 },
        { threshold: -26, ratio: 1.8, attack: 0.015, release: 0.14 },
        { threshold: -28, ratio: 1.7, attack: 0.008, release: 0.12 },
        { threshold: -30, ratio: 1.5, attack: 0.004, release: 0.1 },
      ],
      glue: { threshold: -20, ratio: 1.6, attack: 0.035, release: 0.25 },
      saturation: 0.12, width: 1.08, midPresence: 1.1, deEss: 0.45,
    },
  },
  acoustic: {
    label: 'Acoustic / Folk',
    emoji: '🪕',
    desc: 'Natural, gentle, dynamic',
    target: [-0.5, 0, -0.5, 0, 0.5, 1, 1, 1],
    character: {
      hpHz: 40,
      lowShelf: { f: 100, g: 0.2 },
      highShelf: { f: 11000, g: 0.7 },
      peaks: [{ f: 300, g: -1.0, q: 0.9 }, { f: 3000, g: 0.5, q: 1.0 }],
    },
    dynamics: {
      crossovers: [150, 700, 5000],
      bands: [
        { threshold: -28, ratio: 1.5, attack: 0.03, release: 0.25 },
        { threshold: -30, ratio: 1.4, attack: 0.02, release: 0.2 },
        { threshold: -30, ratio: 1.4, attack: 0.012, release: 0.15 },
        { threshold: -32, ratio: 1.35, attack: 0.006, release: 0.12 },
      ],
      glue: { threshold: -22, ratio: 1.4, attack: 0.04, release: 0.3 },
      saturation: 0.06, width: 1.02, midPresence: 0.7, deEss: 0.3,
    },
  },
  lofi: {
    label: 'Lo-Fi / Chill',
    emoji: '🌆',
    desc: 'Warm, rolled-off, cozy',
    target: [1.5, 2, 0.5, 0.5, 0, -0.5, -2, -3],
    character: {
      hpHz: 30,
      lowShelf: { f: 120, g: 1.0 },
      highShelf: { f: 8000, g: -2.0 },
      peaks: [{ f: 350, g: -0.8, q: 1.0 }, { f: 500, g: 0.5, q: 1.0 }],
    },
    dynamics: {
      crossovers: [120, 600, 4000],
      bands: [
        { threshold: -24, ratio: 2.0, attack: 0.03, release: 0.22 },
        { threshold: -26, ratio: 1.9, attack: 0.02, release: 0.18 },
        { threshold: -28, ratio: 1.7, attack: 0.012, release: 0.14 },
        { threshold: -30, ratio: 1.5, attack: 0.008, release: 0.12 },
      ],
      glue: { threshold: -20, ratio: 1.7, attack: 0.04, release: 0.28 },
      saturation: 0.22, width: 0.96, midPresence: 0.3, deEss: 0.2,
    },
  },
  latin: {
    label: 'Reggaeton / Latin',
    emoji: '🌴',
    desc: 'Dembow punch, bright percussion',
    target: [2.5, 3, -1.5, -0.5, 1, 1.5, 1, 1],
    character: {
      hpHz: 28,
      lowShelf: { f: 85, g: 0.8 },
      highShelf: { f: 10000, g: 1.0 },
      peaks: [
        { f: 280, g: -1.6, q: 0.9 },
        { f: 3500, g: 1.0, q: 1.0 },
      ],
    },
    dynamics: {
      crossovers: [110, 500, 4200],
      bands: [
        { threshold: -23, ratio: 2.4, attack: 0.018, release: 0.16 },
        { threshold: -26, ratio: 2.0, attack: 0.01, release: 0.11 },
        { threshold: -28, ratio: 1.8, attack: 0.006, release: 0.09 },
        { threshold: -30, ratio: 1.6, attack: 0.003, release: 0.07 },
      ],
      glue: { threshold: -19, ratio: 1.8, attack: 0.022, release: 0.18 },
      saturation: 0.12, width: 1.05, midPresence: 1.2, deEss: 0.3,
    },
  },
  metal: {
    label: 'Metal / Heavy',
    emoji: '🤘',
    desc: 'Tight lows, controlled bite, loud',
    target: [1, 1.5, -1, 0.5, 1, 0, 0, -0.5],
    character: {
      hpHz: 35,
      lowShelf: { f: 90, g: 0.4 },
      highShelf: { f: 8000, g: 0.3 },
      peaks: [
        { f: 300, g: -1.5, q: 1.0 },
        { f: 3500, g: -1.0, q: 1.4 },
        { f: 1200, g: 0.7, q: 1.0 },
      ],
    },
    dynamics: {
      crossovers: [110, 600, 4200],
      bands: [
        { threshold: -24, ratio: 2.6, attack: 0.014, release: 0.14 },
        { threshold: -26, ratio: 2.2, attack: 0.008, release: 0.1 },
        { threshold: -26, ratio: 2.0, attack: 0.005, release: 0.08 },
        { threshold: -28, ratio: 1.8, attack: 0.003, release: 0.06 },
      ],
      glue: { threshold: -18, ratio: 2.0, attack: 0.022, release: 0.16 },
      saturation: 0.14, width: 1.02, midPresence: 0.7, deEss: 0.28,
    },
  },
  jazz: {
    label: 'Jazz',
    emoji: '🎷',
    desc: 'Warm, open, very dynamic',
    target: [0, 0.5, -0.5, 0, 0, 0, 0.5, 0.5],
    character: {
      hpHz: 30,
      lowShelf: { f: 100, g: 0.4 },
      highShelf: { f: 12000, g: 0.5 },
      peaks: [{ f: 300, g: -0.8, q: 0.9 }],
    },
    dynamics: {
      crossovers: [150, 700, 5000],
      bands: [
        { threshold: -30, ratio: 1.35, attack: 0.04, release: 0.3 },
        { threshold: -32, ratio: 1.3, attack: 0.025, release: 0.25 },
        { threshold: -32, ratio: 1.25, attack: 0.015, release: 0.2 },
        { threshold: -34, ratio: 1.25, attack: 0.008, release: 0.16 },
      ],
      glue: { threshold: -24, ratio: 1.3, attack: 0.05, release: 0.35 },
      saturation: 0.06, width: 1.04, midPresence: 0.5, deEss: 0.2,
    },
  },
  classical: {
    label: 'Classical / Score',
    emoji: '🎻',
    desc: 'Transparent, dynamics preserved',
    target: [0, 0, -0.5, 0, 0, 0, 0.5, 0.5],
    character: {
      hpHz: 24,
      lowShelf: { f: 80, g: 0.15 },
      highShelf: { f: 13000, g: 0.4 },
      peaks: [{ f: 300, g: -0.6, q: 0.9 }],
    },
    dynamics: {
      crossovers: [150, 800, 6000],
      bands: [
        { threshold: -32, ratio: 1.2, attack: 0.05, release: 0.4 },
        { threshold: -34, ratio: 1.2, attack: 0.03, release: 0.3 },
        { threshold: -34, ratio: 1.15, attack: 0.02, release: 0.25 },
        { threshold: -36, ratio: 1.15, attack: 0.01, release: 0.2 },
      ],
      glue: { threshold: -26, ratio: 1.2, attack: 0.06, release: 0.4 },
      saturation: 0.03, width: 1.01, midPresence: 0.2, deEss: 0.1,
    },
  },
  podcast: {
    label: 'Podcast / Vocal',
    emoji: '🎙️',
    desc: 'Speech clarity, tight leveling',
    target: [-3, -1.5, -1, 1, 2, 2, 0, -0.5],
    character: {
      hpHz: 80,
      lowShelf: { f: 140, g: -1.2 },
      highShelf: { f: 9000, g: 0.4 },
      peaks: [
        { f: 250, g: -2.0, q: 1.1 },
        { f: 3000, g: 1.5, q: 1.0 },
      ],
    },
    dynamics: {
      crossovers: [200, 900, 5000],
      bands: [
        { threshold: -28, ratio: 2.6, attack: 0.02, release: 0.2 },
        { threshold: -26, ratio: 2.6, attack: 0.012, release: 0.15 },
        { threshold: -24, ratio: 2.8, attack: 0.008, release: 0.12 },
        { threshold: -30, ratio: 2.0, attack: 0.004, release: 0.1 },
      ],
      glue: { threshold: -20, ratio: 2.4, attack: 0.02, release: 0.2 },
      saturation: 0.05, width: 1.0, midPresence: 1.8, deEss: 0.55,
    },
  },
};

export const DEFAULT_GENRE = 'hiphop';
