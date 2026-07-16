// Engineer session planner — turns diagnostics + genre playbook into a concrete
// processing plan (EQ moves, kick/bass separation, M/S, glue, notes).
// This is the "thinking" step: if finding X, apply technique Y from the playbook.

import { getPlaybook } from './playbooks.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function intensityScale(profile, protectDynamics) {
  if (protectDynamics) {
    return { glueMul: 0.4, satMul: 0.5, duckMul: 0.6, eqMul: 0.75 };
  }
  if (profile === 'open') return { glueMul: 0.45, satMul: 0.5, duckMul: 0.7, eqMul: 0.7 };
  if (profile === 'punchy') return { glueMul: 1.15, satMul: 1.1, duckMul: 1.15, eqMul: 1.0 };
  return { glueMul: 0.85, satMul: 0.85, duckMul: 1.0, eqMul: 0.9 }; // Medium
}

/**
 * Build an engineer plan from diagnose() output + user settings.
 */
export function planSession(diag, settings) {
  const pb = diag.playbook || getPlaybook(settings.genre);
  const t = pb.techniques;
  const protect = diag.findings.some((f) => f.action === 'protect_dynamics');
  const scale = intensityScale(settings.dynamicsProfile, protect);
  const actions = new Set(diag.findings.map((f) => f.action));
  const sev = (id) => diag.findings.find((f) => f.action === id)?.severity || 0;

  const eq = [];
  const log = [];

  log.push({
    type: 'role',
    text: `Session as: ${pb.role}`,
  });
  log.push({
    type: 'priorities',
    text: `Priorities: ${pb.priorities.join(' · ')}`,
  });
  for (const f of diag.findings.slice(0, 6)) {
    log.push({ type: 'finding', text: f.note, severity: f.severity });
  }

  // Always: rumble cleanup
  eq.push({ type: 'highpass', freq: t.rumbleHp, label: 'Rumble HPF', reason: 'Clean sub-sonic rumble' });

  // Conditional EQ from findings + playbook recipes
  const wantsMudCut = actions.has('cut_mud') || (actions.has('polish') && !actions.has('fill_lowmid'));
  if (wantsMudCut && t.mudCut) {
    const g = t.mudCut.g * scale.eqMul * (actions.has('cut_mud') ? (0.7 + 0.5 * sev('cut_mud')) : 0.5);
    eq.push({ type: 'peak', freq: t.mudCut.f, gain: g, q: t.mudCut.q, label: 'Mud cut', reason: '250–500 Hz masking / congestion' });
    if (t.boxCut && actions.has('cut_mud')) {
      eq.push({ type: 'peak', freq: t.boxCut.f, gain: t.boxCut.g * scale.eqMul, q: t.boxCut.q, label: 'Boxiness', reason: 'Clear low-mid box' });
    }
  }

  if (actions.has('cut_sub')) {
    eq.push({
      type: 'lowshelf', freq: 45, gain: -2.2 * sev('cut_sub') * scale.eqMul, label: 'Sub trim',
      reason: 'Sub overweight for this genre — keep punch, lose boom',
    });
  }

  if (actions.has('boost_upper_bass') || (t.upperBassShelf && !actions.has('cut_sub'))) {
    const shelf = t.upperBassShelf || t.lowShelf;
    if (shelf) {
      const g = (shelf.g || 0.6) * scale.eqMul * (actions.has('boost_upper_bass') ? 1.1 : 0.55);
      if (Math.abs(g) > 0.15) {
        eq.push({ type: 'lowshelf', freq: shelf.f, gain: g, label: 'Upper-bass weight', reason: '80–150 Hz for small-speaker translation' });
      }
    }
  } else if (t.lowShelf && !actions.has('cut_sub')) {
    const g = t.lowShelf.g * 0.55 * scale.eqMul + settings.bass * 0.35;
    if (Math.abs(g) > 0.15) {
      eq.push({ type: 'lowshelf', freq: t.lowShelf.f, gain: g, label: 'Low shelf', reason: 'Genre low-end character' });
    }
  }

  if (actions.has('fill_lowmid')) {
    eq.push({ type: 'peak', freq: 350, gain: 2.2 * scale.eqMul, q: 0.85, label: 'Body fill', reason: 'Restore scooped low-mids (don\'t leave it hollow)' });
    eq.push({ type: 'peak', freq: 500, gain: 1.2 * scale.eqMul, q: 1.0, label: 'Body fill 2', reason: 'Support midrange foundation' });
  }

  if (t.vocalPocket && (actions.has('boost_presence') || actions.has('kick_bass_sep') || settings.genre === 'hiphop')) {
    eq.push({
      type: 'peak', freq: t.vocalPocket.f, gain: t.vocalPocket.g * scale.eqMul, q: t.vocalPocket.q,
      label: 'Vocal↔808 pocket', reason: 'Carve 120–180 Hz so vocal chest & 808 can coexist',
    });
  }

  if (actions.has('boost_presence') || t.vocalPresence) {
    const vp = t.vocalPresence;
    if (vp) {
      const g = vp.g * scale.eqMul * (actions.has('boost_presence') ? (0.7 + 0.5 * sev('boost_presence')) : 0.45)
        + settings.vocal * 0.4;
      eq.push({ type: 'peak', freq: vp.f, gain: g, q: vp.q, label: 'Lead presence', reason: '2–5 kHz intelligibility / cut-through' });
    }
  }

  if (t.guitarBite && (settings.genre === 'rock' || settings.genre === 'metal')) {
    eq.push({ type: 'peak', freq: t.guitarBite.f, gain: t.guitarBite.g * scale.eqMul, q: t.guitarBite.q, label: 'Guitar bite', reason: 'Midrange definition for guitars' });
  }
  if (t.harshCut && (actions.has('harsh') || settings.genre === 'metal')) {
    eq.push({ type: 'peak', freq: t.harshCut.f, gain: t.harshCut.g * scale.eqMul, q: t.harshCut.q, label: 'Harshness dip', reason: 'Tame fatiguing upper-mids' });
  }

  // Air / top
  let airGain = 0;
  if (actions.has('add_air') && t.highShelf) airGain = Math.max(1.8, t.highShelf.g) * scale.eqMul * (0.85 + 0.4 * sev('add_air'));
  else if (actions.has('tame_air') && t.highShelf) airGain = -Math.abs(t.highShelf.g) * 0.9 * scale.eqMul;
  else if (t.highShelf) airGain = t.highShelf.g * 0.45 * scale.eqMul;
  airGain += settings.brightness * 0.4 + settings.warmth * -0.15;
  if (Math.abs(airGain) > 0.2 && (t.highShelf || actions.has('add_air'))) {
    const f = t.highShelf?.f || 10000;
    eq.push({ type: 'highshelf', freq: f, gain: airGain, label: 'Air / top', reason: actions.has('tame_air') ? 'Reduce fatigue' : 'Genre sparkle / open the top' });
  }
  if (actions.has('add_air')) {
    eq.push({ type: 'peak', freq: 5500, gain: 1.4 * scale.eqMul, q: 0.9, label: 'Presence air', reason: 'Lift dull highs into the mix' });
  }
  if (t.deEss && (actions.has('boost_presence') || actions.has('harsh') || settings.genre === 'pop' || settings.genre === 'podcast' || settings.genre === 'rnb')) {
    eq.push({ type: 'highshelf', freq: t.deEss.f, gain: t.deEss.g * scale.eqMul, label: 'De-ess shelf', reason: 'Control sibilance after presence work' });
  }

  // User warmth leftover
  if (Math.abs(settings.warmth) > 0.5 && !eq.some((e) => e.label === 'Low shelf' || e.label === 'Upper-bass weight')) {
    eq.push({ type: 'lowshelf', freq: 120, gain: settings.warmth * 0.35, label: 'Warmth', reason: 'User warmth control' });
  }

  // Kick/bass separation decision
  let kickBass = null;
  if (actions.has('kick_bass_sep') && t.kickBassSep?.enabled) {
    const k = t.kickBassSep;
    kickBass = {
      bandHz: k.bandHz,
      duckDb: k.duckDb * scale.duckMul * (0.6 + 0.5 * sev('kick_bass_sep')),
      attackMs: k.attackMs,
      releaseMs: k.releaseMs,
    };
    log.push({
      type: 'decision',
      text: `Decision: kick/bass separation — duck ~${kickBass.duckDb.toFixed(1)} dB around ${k.bandHz} Hz on sustain (genre sidechain technique).`,
    });
  } else if (t.kickBassSep?.enabled && settings.dynamicsProfile === 'punchy') {
    kickBass = { ...t.kickBassSep, duckDb: t.kickBassSep.duckDb * 0.6 * scale.duckMul };
    log.push({ type: 'decision', text: 'Decision: light preventive kick/bass separation (High Intensity).' });
  } else {
    log.push({ type: 'decision', text: 'Decision: leave kick/bass relationship — no strong conflict detected (or genre prefers natural lows).' });
  }

  // Stereo plan
  let widthTarget = pb.checks.targetWidth;
  if (actions.has('widen')) widthTarget = Math.min(0.28, widthTarget * 1.25);
  if (actions.has('narrow') || actions.has('fix_phase')) widthTarget = Math.min(widthTarget, 0.12);
  widthTarget *= settings.width / 100;
  widthTarget = clamp(widthTarget, 0.05, 0.3);

  const sideAir = t.airSide ? { freq: t.airSide.f, gain: t.airSide.g * scale.eqMul * (actions.has('widen') ? 1.2 : 0.7) } : null;
  log.push({
    type: 'decision',
    text: `Decision: stereo width target ${(widthTarget * 100).toFixed(0)}% (ANALYZE-safe) · bass mono below ${t.monoBassHz} Hz.`,
  });

  // Glue
  const glue = {
    ...t.glue,
    threshold: t.glue.threshold - (scale.glueMul < 0.6 ? 4 : 0),
    ratio: 1 + (t.glue.ratio - 1) * scale.glueMul,
  };
  const sat = clamp(t.sat * scale.satMul, 0, 0.3);
  if (protect) {
    log.push({ type: 'decision', text: 'Decision: protect dynamics — soft glue only, no multiband crush.' });
  } else {
    log.push({
      type: 'decision',
      text: `Decision: Mixea Intensity ${settings.dynamicsProfile} → glue ${glue.ratio.toFixed(2)}:1 @ ${glue.threshold} dB, sat ${(sat * 100).toFixed(0)}%.`,
    });
  }

  return {
    role: pb.role,
    priorities: pb.priorities,
    eq,
    kickBass,
    widthTarget,
    monoBassHz: t.monoBassHz,
    sideAir,
    glue,
    sat,
    protectDynamics: protect,
    spectrumTarget: pb.spectrum,
    log,
    findings: diag.findings,
  };
}
