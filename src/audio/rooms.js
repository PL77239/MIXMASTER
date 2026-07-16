// Playback-room simulation (iZotope: masters must translate — studio + car).
// Used for A/B audition filtering and optional translation EQ into the polish.

export const ROOMS = {
  studio: {
    id: 'studio',
    label: 'Studio',
    desc: 'Neutral nearfield — trusted mix room',
    // Mild, flat-ish correction (reference listen)
    listenEq: [],
    // No forced translation EQ when polishing for studio
    translateEq: [],
  },
  car: {
    id: 'car',
    label: 'Car',
    desc: 'Cabin boom + muffled highs — road test',
    // Approximate car cabin: bass lift, mid scoop, rolled top
    listenEq: [
      { type: 'lowshelf', freq: 80, gain: 4.5 },
      { type: 'peak', freq: 200, gain: 2.0, q: 0.8 },
      { type: 'peak', freq: 1200, gain: -2.5, q: 0.9 },
      { type: 'highshelf', freq: 6000, gain: -3.5 },
    ],
    // When polishing *for* car translation: pre-empt cabin boom / loss of presence
    translateEq: [
      { type: 'lowshelf', freq: 55, gain: -1.2, label: 'Car sub trim', reason: 'Cars exaggerate sub — leave headroom' },
      { type: 'peak', freq: 180, gain: -1.0, q: 0.9, label: 'Cabin boom', reason: 'Reduce 150–200 Hz car boom' },
      { type: 'peak', freq: 2500, gain: 0.8, q: 1.0, label: 'Car presence', reason: 'Keep vocals audible in noisy cabin' },
      { type: 'highshelf', freq: 8000, gain: 0.6, label: 'Car air', reason: 'Compensate muffled highs' },
    ],
  },
};

export function getRoom(id) {
  return ROOMS[id] || ROOMS.studio;
}
