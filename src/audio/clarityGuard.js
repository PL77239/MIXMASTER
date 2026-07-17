/**
 * Post-master clarity guard — polish, not remould.
 *
 * Density stages (multiband / parallel / 1176→LA-2A / peak) can soften
 * 2–5 kHz presence and air. After the master, compare against a pre-density
 * snapshot and restore tiny presence/air EQ if detail dipped.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * @param {object} before measureClarity() before density stages
 * @param {object} after measureClarity() after peak polish
 * @param {object} [opts]
 * @param {boolean} [opts.harsh] diagnose said top is already hot
 * @param {boolean} [opts.protectDynamics]
 * @param {string} [opts.genre]
 */
export function assessClarityLoss(before, after, opts = {}) {
  if (!before || !after) {
    return { lost: false, presenceDrop: 0, topDrop: 0, severity: 0, moves: [] };
  }

  // Absolute share drops (presence ≈ 0.08–0.18 typical)
  const presenceDrop = before.presence - after.presence;
  const topDrop = before.top - after.top;

  // Relative drop vs pre-density (more sensitive on already-soft material)
  const presenceRel = before.presence > 1e-4 ? presenceDrop / before.presence : 0;
  const topRel = before.top > 1e-4 ? topDrop / before.top : 0;

  const harsh = Boolean(opts.harsh);
  // Soft desks (jazz/classical/lofi) allow more natural top recession
  const softDesk = ['jazz', 'classical', 'lofi', 'acoustic'].includes(opts.genre);

  const presenceThresh = harsh ? 0.04 : softDesk ? 0.018 : 0.012;
  const topThresh = harsh ? 0.06 : softDesk ? 0.028 : 0.018;
  const presenceRelThresh = harsh ? 0.28 : softDesk ? 0.16 : 0.1;
  const topRelThresh = harsh ? 0.28 : softDesk ? 0.16 : 0.1;

  const presenceLost =
    !harsh && (presenceDrop > presenceThresh || presenceRel > presenceRelThresh);
  const topLost = !harsh && (topDrop > topThresh || topRel > topRelThresh);

  if (!presenceLost && !topLost) {
    return { lost: false, presenceDrop, topDrop, severity: 0, moves: [] };
  }

  const severity = clamp(
    Math.max(presenceDrop / 0.05, topDrop / 0.07, presenceRel / 0.25, topRel / 0.25),
    0.2,
    1,
  );

  const moves = [];
  const dynMul = opts.protectDynamics ? 0.55 : 1;

  if (presenceLost) {
    const g = clamp(Math.max(presenceDrop * 42, presenceRel * 4.5) * dynMul, 0.3, 1.05);
    moves.push({
      type: 'peak',
      freq: 3400,
      gain: g,
      q: 0.85,
      label: 'Clarity restore',
      reason: `Presence dipped after density (−${(presenceDrop * 100).toFixed(1)} pt) — restore detail`,
    });
  }

  if (topLost) {
    const g = clamp(Math.max(topDrop * 30, topRel * 3.2) * dynMul, 0.22, 0.75);
    moves.push({
      type: 'highshelf',
      freq: 10800,
      gain: g,
      label: 'Air restore',
      reason: `Air/top dipped after density (−${(topDrop * 100).toFixed(1)} pt) — restore sparkle`,
    });
  }

  return { lost: moves.length > 0, presenceDrop, topDrop, severity, moves };
}
