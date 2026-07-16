/**
 * Engineer session planner — diagnose → decide → polish.
 *
 * Principles (iZotope mix/master guide + Aurora “BEAST” guide):
 * - Mastering = small polish, not a remould
 * - Tap compressors — don’t slam (especially Medium)
 * - Treat peaks & limits, not only EQ
 * - Kick/bass get space; instruments inform presence decisions
 * - References: analyze first, then pull the upload toward them
 * - Translation: studio vs car room EQ
 */

import { getPlaybook } from './playbooks.js';
import { getRoom } from './rooms.js';
import {
  analyzeReference,
  averageReferences,
  referenceMatchEq,
} from './reference.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Polish-first intensity. Medium previously crushed EDM (glue~0.85, sat~0.85).
 * Now Medium is gentle polish; Punch is the only “louder” desk.
 */
function intensityScale(profile, protectDynamics) {
  if (protectDynamics) {
    return {
      label: 'Protect',
      glueMul: 0.15,
      satMul: 0.12,
      duckMul: 0.45,
      eqMul: 0.55,
      polishCap: 1.2,
      refineMul: 0.12,
      ceilingDb: -1.2,
      softClip: false,
    };
  }
  if (profile === 'open') {
    return {
      label: 'Open',
      glueMul: 0.2,
      satMul: 0.15,
      duckMul: 0.55,
      eqMul: 0.6,
      polishCap: 1.3,
      refineMul: 0.15,
      ceilingDb: -1.2,
      softClip: false,
    };
  }
  if (profile === 'punchy') {
    return {
      label: 'Punch',
      glueMul: 0.55,
      satMul: 0.35,
      duckMul: 0.9,
      eqMul: 0.85,
      polishCap: 2.2,
      refineMul: 0.28,
      ceilingDb: -0.9,
      softClip: true,
    };
  }
  // Medium — balanced polish (NOT the old heavy Medium)
  return {
    label: 'Medium',
    glueMul: 0.28,
    satMul: 0.18,
    duckMul: 0.7,
    eqMul: 0.7,
    polishCap: 1.6,
    refineMul: 0.18,
    ceilingDb: -1.0,
    softClip: false,
  };
}

function capGain(g, cap) {
  return clamp(g, -cap, cap);
}

/**
 * Build an engineer plan from diagnose() output + user settings.
 * settings.referenceBuffers?: AudioBuffer[]
 * settings.room?: 'studio' | 'car'
 */
export function planSession(diag, settings) {
  const pb = diag.playbook || getPlaybook(settings.genre);
  const t = pb.techniques;
  const room = getRoom(settings.room || 'studio');
  const protect = diag.findings.some((f) => f.action === 'protect_dynamics');
  const scale = intensityScale(settings.dynamicsProfile, protect);
  const actions = new Set(diag.findings.map((f) => f.action));
  const sev = (id) => diag.findings.find((f) => f.action === id)?.severity || 0;

  const eq = [];
  const log = [];

  log.push({ type: 'role', text: `Session as: ${pb.role}` });
  log.push({
    type: 'priorities',
    text: `Priorities: ${pb.priorities.join(' · ')}`,
  });
  log.push({
    type: 'room',
    text: `Translation room: ${room.label} — ${room.desc}`,
  });

  for (const f of diag.findings.slice(0, 7)) {
    if (f.action === 'note_instruments') {
      log.push({ type: 'finding', text: `🎛 ${f.note}`, severity: f.severity });
    } else {
      log.push({ type: 'finding', text: f.note, severity: f.severity });
    }
  }

  // ── Analyze references FIRST (Matchering-style) ───────────────────
  let refProfile = null;
  const refBuffers = settings.referenceBuffers?.filter(Boolean) || [];
  if (refBuffers.length) {
    const profiles = refBuffers.map((b, i) =>
      analyzeReference(b, settings.referenceNames?.[i] || `Reference ${i + 1}`)
    );
    refProfile = averageReferences(profiles);
    log.push({
      type: 'decision',
      text: `Analyzed ${profiles.length} similar track(s) first — matching tone / loudness / width toward “${refProfile.name}”.`,
    });
    for (const p of profiles) {
      log.push({
        type: 'finding',
        text: `${p.name}: ${p.lufs.toFixed(1)} LUFS · crest ${p.crest.toFixed(1)} dB · width ${(p.width * 100).toFixed(0)}%`,
      });
    }
  }

  // Always: rumble cleanup
  eq.push({
    type: 'highpass',
    freq: t.rumbleHp,
    label: 'Rumble HPF',
    reason: 'Clean sub-sonic rumble',
  });

  const polish = (g) => capGain(g, scale.polishCap);

  // Conditional EQ from findings + playbook recipes (capped = polish)
  const wantsMudCut =
    actions.has('cut_mud') || (actions.has('polish') && !actions.has('fill_lowmid'));
  if (wantsMudCut && t.mudCut) {
    const g =
      t.mudCut.g *
      scale.eqMul *
      (actions.has('cut_mud') ? 0.7 + 0.5 * sev('cut_mud') : 0.45);
    eq.push({
      type: 'peak',
      freq: t.mudCut.f,
      gain: polish(g),
      q: t.mudCut.q,
      label: 'Mud cut',
      reason: '250–500 Hz masking / congestion',
    });
    if (t.boxCut && actions.has('cut_mud')) {
      eq.push({
        type: 'peak',
        freq: t.boxCut.f,
        gain: polish(t.boxCut.g * scale.eqMul),
        q: t.boxCut.q,
        label: 'Boxiness',
        reason: 'Clear low-mid box',
      });
    }
  }

  if (actions.has('cut_sub')) {
    eq.push({
      type: 'lowshelf',
      freq: 45,
      gain: polish(-2.0 * sev('cut_sub') * scale.eqMul),
      label: 'Sub trim',
      reason: 'Sub overweight — keep punch, lose boom',
    });
  }

  if (actions.has('boost_upper_bass') || (t.upperBassShelf && !actions.has('cut_sub'))) {
    const shelf = t.upperBassShelf || t.lowShelf;
    if (shelf) {
      const g =
        (shelf.g || 0.6) *
        scale.eqMul *
        (actions.has('boost_upper_bass') ? 1.0 : 0.45);
      if (Math.abs(g) > 0.15) {
        eq.push({
          type: 'lowshelf',
          freq: shelf.f,
          gain: polish(g),
          label: 'Upper-bass weight',
          reason: '80–150 Hz for small-speaker translation',
        });
      }
    }
  } else if (t.lowShelf && !actions.has('cut_sub')) {
    const g = t.lowShelf.g * 0.45 * scale.eqMul + (settings.bass || 0) * 0.3;
    if (Math.abs(g) > 0.15) {
      eq.push({
        type: 'lowshelf',
        freq: t.lowShelf.f,
        gain: polish(g),
        label: 'Low shelf',
        reason: 'Genre low-end character',
      });
    }
  }

  if (actions.has('fill_lowmid')) {
    eq.push({
      type: 'peak',
      freq: 350,
      gain: polish(1.6 * scale.eqMul),
      q: 0.85,
      label: 'Body fill',
      reason: "Restore scooped low-mids (don't leave it hollow)",
    });
  }

  if (
    t.vocalPocket &&
    (actions.has('boost_presence') ||
      actions.has('kick_bass_sep') ||
      settings.genre === 'hiphop')
  ) {
    eq.push({
      type: 'peak',
      freq: t.vocalPocket.f,
      gain: polish(t.vocalPocket.g * scale.eqMul * 0.85),
      q: t.vocalPocket.q,
      label: 'Vocal↔808 pocket',
      reason: 'Carve so vocal chest & 808 can coexist',
    });
  }

  if (actions.has('boost_presence') || t.vocalPresence) {
    const vp = t.vocalPresence;
    if (vp) {
      const g =
        vp.g *
          scale.eqMul *
          (actions.has('boost_presence') ? 0.65 + 0.4 * sev('boost_presence') : 0.35) +
        (settings.vocal || 0) * 0.35;
      eq.push({
        type: 'peak',
        freq: vp.f,
        gain: polish(g),
        q: vp.q,
        label: 'Lead presence',
        reason: '2–5 kHz intelligibility / cut-through',
      });
    }
  }

  if (t.guitarBite && (settings.genre === 'rock' || settings.genre === 'metal')) {
    eq.push({
      type: 'peak',
      freq: t.guitarBite.f,
      gain: polish(t.guitarBite.g * scale.eqMul),
      q: t.guitarBite.q,
      label: 'Guitar bite',
      reason: 'Midrange definition for guitars',
    });
  }
  if (t.harshCut && (actions.has('harsh') || settings.genre === 'metal')) {
    eq.push({
      type: 'peak',
      freq: t.harshCut.f,
      gain: polish(t.harshCut.g * scale.eqMul),
      q: t.harshCut.q,
      label: 'Harshness dip',
      reason: 'Tame fatiguing upper-mids',
    });
  }

  // Air / top — polish amounts
  let airGain = 0;
  if (actions.has('add_air') && t.highShelf) {
    airGain = Math.max(1.2, t.highShelf.g) * scale.eqMul * (0.7 + 0.3 * sev('add_air'));
  } else if (actions.has('tame_air') && t.highShelf) {
    airGain = -Math.abs(t.highShelf.g) * 0.75 * scale.eqMul;
  } else if (t.highShelf) {
    airGain = t.highShelf.g * 0.35 * scale.eqMul;
  }
  airGain += (settings.brightness || 0) * 0.35 + (settings.warmth || 0) * -0.12;
  if (Math.abs(airGain) > 0.2 && (t.highShelf || actions.has('add_air'))) {
    eq.push({
      type: 'highshelf',
      freq: t.highShelf?.f || 10000,
      gain: polish(airGain),
      label: 'Air / top',
      reason: actions.has('tame_air') ? 'Reduce fatigue' : 'Genre sparkle (polish)',
    });
  }
  if (actions.has('add_air')) {
    eq.push({
      type: 'peak',
      freq: 5500,
      gain: polish(1.0 * scale.eqMul),
      q: 0.9,
      label: 'Presence air',
      reason: 'Lift dull highs gently',
    });
  }
  if (
    t.deEss &&
    (actions.has('boost_presence') ||
      actions.has('harsh') ||
      settings.genre === 'pop' ||
      settings.genre === 'podcast' ||
      settings.genre === 'rnb')
  ) {
    eq.push({
      type: 'highshelf',
      freq: t.deEss.f,
      gain: polish(t.deEss.g * scale.eqMul),
      label: 'De-ess shelf',
      reason: 'Control sibilance after presence work',
    });
  }

  if (
    Math.abs(settings.warmth || 0) > 0.5 &&
    !eq.some((e) => e.label === 'Low shelf' || e.label === 'Upper-bass weight')
  ) {
    eq.push({
      type: 'lowshelf',
      freq: 120,
      gain: polish(settings.warmth * 0.3),
      label: 'Warmth',
      reason: 'User warmth control',
    });
  }

  // Reference tone match (after diagnosis EQ — Matchering pull)
  if (refProfile) {
    const matchMoves = referenceMatchEq(diag.regions, refProfile, 0.32 * scale.eqMul);
    for (const m of matchMoves) {
      eq.push({ ...m, gain: polish(m.gain) });
    }
    if (matchMoves.length) {
      log.push({
        type: 'decision',
        text: `Decision: reference tone match — ${matchMoves.length} gentle bands toward analyzed similar track(s).`,
      });
    }
  }

  // Room translation EQ (car: pre-empt cabin boom / keep presence)
  if (room.translateEq?.length) {
    for (const b of room.translateEq) {
      eq.push({
        type: b.type === 'peak' ? 'peak' : b.type,
        freq: b.freq,
        gain: polish((b.gain || 0) * 0.9),
        q: b.q || 1,
        label: b.label || `Room ${room.label}`,
        reason: b.reason || room.desc,
      });
    }
    log.push({
      type: 'decision',
      text: `Decision: ${room.label} translation EQ — mix should read outside the studio.`,
    });
  }

  // Kick/bass separation
  let kickBass = null;
  if (actions.has('kick_bass_sep') && t.kickBassSep?.enabled) {
    const k = t.kickBassSep;
    const duckScale = protect ? 0.5 : 1;
    kickBass = {
      bandHz: k.bandHz,
      duckDb: k.duckDb * scale.duckMul * (0.5 + 0.4 * sev('kick_bass_sep')) * duckScale,
      attackMs: k.attackMs,
      releaseMs: k.releaseMs,
    };
    log.push({
      type: 'decision',
      text: `Decision: kick/bass space — duck ~${kickBass.duckDb.toFixed(1)} dB @ ${k.bandHz} Hz on sustain (not a full squash).`,
    });
  } else if (t.kickBassSep?.enabled && settings.dynamicsProfile === 'punchy') {
    kickBass = {
      ...t.kickBassSep,
      duckDb: t.kickBassSep.duckDb * 0.45 * scale.duckMul,
    };
    log.push({
      type: 'decision',
      text: 'Decision: light preventive kick/bass separation (Punch).',
    });
  } else {
    log.push({
      type: 'decision',
      text: 'Decision: leave kick/bass — no strong fight (or genre prefers natural lows).',
    });
  }

  // Stereo plan — prefer reference width when available
  let widthTarget = pb.checks.targetWidth;
  if (refProfile) {
    widthTarget = clamp(refProfile.width, 0.06, 0.28);
  }
  if (actions.has('widen')) widthTarget = Math.min(0.28, widthTarget * 1.2);
  if (actions.has('narrow') || actions.has('fix_phase')) {
    widthTarget = Math.min(widthTarget, 0.12);
  }
  widthTarget *= (settings.width || 100) / 100;
  widthTarget = clamp(widthTarget, 0.05, 0.3);

  const sideAir = t.airSide
    ? {
        freq: t.airSide.f,
        gain: polish(
          t.airSide.g * scale.eqMul * (actions.has('widen') ? 1.0 : 0.55)
        ),
      }
    : null;
  log.push({
    type: 'decision',
    text: `Decision: stereo width ~${(widthTarget * 100).toFixed(0)}% · bass mono below ${t.monoBassHz} Hz.`,
  });

  // Glue / sat — heavily restrained (user: Medium EDM was crushed)
  let glue = {
    ...t.glue,
    threshold: t.glue.threshold - (scale.glueMul < 0.35 ? 5 : 2),
    ratio: 1 + (t.glue.ratio - 1) * scale.glueMul,
  };
  let sat = clamp(t.sat * scale.satMul, 0, 0.12);
  if (protect) {
    glue = { ...glue, ratio: Math.min(glue.ratio, 1.15), threshold: glue.threshold - 3 };
    sat = Math.min(sat, 0.03);
    log.push({
      type: 'decision',
      text: 'Decision: already over-compressed — skip heavy glue/sat (tap, don’t slam).',
    });
  } else {
    log.push({
      type: 'decision',
      text: `Decision: Intensity ${scale.label} → glue ${glue.ratio.toFixed(2)}:1 @ ${glue.threshold} dB, sat ${(sat * 100).toFixed(0)}% (polish).`,
    });
  }

  // Peak chain
  const softClip =
    scale.softClip ||
    actions.has('peak_clip_limit') ||
    (isFinite(settings._truePeakDb) && settings._truePeakDb > -0.3);
  const targetLufs = refProfile
    ? clamp(refProfile.lufs, -18, -9)
    : settings.targetLufs;

  if (softClip) {
    log.push({
      type: 'decision',
      text: `Decision: peak polish — soft clip → limit @ ${scale.ceilingDb} dBTP (Aurora: clip then limit).`,
    });
  } else {
    log.push({
      type: 'decision',
      text: `Decision: limit polish @ ${scale.ceilingDb} dBTP · target ${targetLufs.toFixed(1)} LUFS.`,
    });
  }

  // Soft spectral refine only — never remould
  log.push({
    type: 'decision',
    text: `Decision: polish path — EQ capped ±${scale.polishCap} dB, light FR refine (${(scale.refineMul * 100).toFixed(0)}%).`,
  });

  return {
    role: pb.role,
    priorities: pb.priorities,
    room,
    refProfile,
    intensity: scale,
    eq,
    kickBass,
    widthTarget,
    monoBassHz: t.monoBassHz,
    sideAir,
    glue,
    sat,
    protectDynamics: protect,
    spectrumTarget: refProfile?.regions || pb.spectrum,
    refineMul: scale.refineMul,
    skipHeavyRemould: true,
    peak: {
      softClip,
      softClipDb: -0.5,
      ceilingDb: scale.ceilingDb,
      targetLufs,
    },
    log,
    findings: diag.findings,
  };
}
