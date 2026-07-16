/**
 * Engineer session planner — diagnose → decide → polish.
 *
 * Principles (iZotope Mixing Guide, Mixing/Mastering on the Box,
 * Digital Natural Sound tips, Maztr genre mastering, Aurora “BEAST”):
 * - Mastering = small polish, not a remould
 * - Tap compressors — don’t slam (especially Medium)
 * - Multiband + parallel (NY) for density; exciters for air — not remould EQ
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
import { findSimilar } from './refMemory.js';
import { protectsLowEnd, wantsWideSides } from './methodology.js';

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
      mbMul: 0.1,
      parallelMul: 0.08,
      exciterMul: 0.08,
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
      mbMul: 0.2,
      parallelMul: 0.15,
      exciterMul: 0.12,
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
      mbMul: 0.75,
      parallelMul: 0.7,
      exciterMul: 0.55,
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
    mbMul: 0.4,
    parallelMul: 0.35,
    exciterMul: 0.28,
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
    log.push({ type: 'finding', text: f.note, severity: f.severity });
  }

  // ── Analyze references FIRST (Matchering-style) ───────────────────
  let refProfile = null;
  let refFromMemory = null;
  let liveRefProfiles = null;
  const refBuffers = settings.referenceBuffers?.filter(Boolean) || [];
  if (refBuffers.length) {
    liveRefProfiles = refBuffers.map((b, i) =>
      analyzeReference(b, settings.referenceNames?.[i] || `Reference ${i + 1}`)
    );
    refProfile = averageReferences(liveRefProfiles);
    log.push({
      type: 'decision',
      text: `Analyzed ${liveRefProfiles.length} similar track(s) first — matching tone / loudness / width toward “${refProfile.name}”.`,
    });
    for (const p of liveRefProfiles) {
      log.push({
        type: 'finding',
        text: `${p.name}: ${p.lufs.toFixed(1)} LUFS · crest ${p.crest.toFixed(1)} dB · width ${(p.width * 100).toFixed(0)}%`,
      });
    }
  } else if (diag.regions) {
    // Soft pull from learned references when no live upload/paste this session
    const hit = findSimilar(
      {
        regions: diag.regions,
        lufs: diag.analysis?.lufs ?? settings.targetLufs,
        width: diag.stereo?.width ?? 0.15,
        crest: diag.analysis?.crest ?? 10,
      },
      settings.genre,
      0.62,
    );
    if (hit) {
      refFromMemory = hit;
      refProfile = hit.profile;
      log.push({
        type: 'decision',
        text: `Learned reference match (${Math.round(hit.score * 100)}%) — “${hit.memory.name}” from a past upload/paste, guiding tone / loudness / width.`,
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
  const lowEndProtected = Boolean(t.protectLowEnd) || protectsLowEnd(settings.genre);
  const wideSides = Boolean(t.preserveWidth) || wantsWideSides(settings.genre);

  log.push({
    type: 'decision',
    text: lowEndProtected
      ? 'Guideline: maximize low-end impact — carve kick/bass space, don’t scoop the foundation (Production Expert / MtM EDM).'
      : 'Guideline: subtractive EQ for clarity; balance bass/mids/treble (MasteringBOX frequency analysis).',
  });

  // Mud control — keep residual cuts even on bass desks (compression fills 250–500 Hz)
  const mudSev = sev('cut_mud');
  const wantsMudCut = actions.has('cut_mud') && t.mudCut;
  if (wantsMudCut) {
    // Was 0.45 on protect-low-end — too soft; compression refilled the haze
    const mudScale = lowEndProtected
      ? 0.72 + 0.35 * mudSev
      : 0.85 + 0.55 * mudSev;
    let g = t.mudCut.g * scale.eqMul * mudScale;
    // Learned refs that needed deeper mud cuts bias this session
    if (refFromMemory?.memory?.learned?.mudBias != null && refFromMemory.memory.learned.mudBias < -0.5) {
      g = Math.min(g, refFromMemory.memory.learned.mudBias * 0.55 * scale.eqMul);
    }
    eq.push({
      type: 'peak',
      freq: t.mudCut.f,
      gain: polish(g),
      q: t.mudCut.q,
      label: 'Mud cut',
      reason: 'Frequency masking in 250–500 Hz (subtractive EQ before density)',
    });
    if (t.boxCut && mudSev > 0.45) {
      eq.push({
        type: 'peak',
        freq: t.boxCut.f,
        gain: polish(t.boxCut.g * scale.eqMul * (lowEndProtected ? 0.75 : 1)),
        q: t.boxCut.q,
        label: 'Boxiness',
        reason: 'Clear low-mid box after compress risk',
      });
    }
    log.push({
      type: 'decision',
      text: 'Decision: carve mud before glue/parallel — density stages must not refill the haze.',
    });
  }

  // Sub trim — soft on protected low-end genres (EDM wants impact)
  if (actions.has('cut_sub')) {
    const trim = lowEndProtected
      ? -0.8 * sev('cut_sub') * scale.eqMul
      : -2.0 * sev('cut_sub') * scale.eqMul;
    eq.push({
      type: 'lowshelf',
      freq: 45,
      gain: polish(trim),
      label: 'Sub trim',
      reason: lowEndProtected
        ? 'Slight boom control only — keep EDM/club weight'
        : 'Sub overweight — keep punch, lose boom',
    });
  }

  // Cap low-end shelves when material is already peaky (stops bass boost → redline)
  const inputCrest = diag.analysis?.crest ?? settings._crest;
  const peakyInput =
    (isFinite(inputCrest) && inputCrest < 8.5) ||
    (isFinite(settings._truePeakDb) && settings._truePeakDb > -2.5);

  // Low shelf — for EDM always apply genre weight unless cutting sub hard
  if (actions.has('boost_upper_bass') || (t.upperBassShelf && !actions.has('cut_sub'))) {
    const shelf = t.upperBassShelf || t.lowShelf;
    if (shelf) {
      let g =
        (shelf.g || 0.6) *
        scale.eqMul *
        (actions.has('boost_upper_bass') ? 1.0 : lowEndProtected ? 0.85 : 0.45);
      if (peakyInput) g *= 0.35;
      if (Math.abs(g) > 0.15) {
        eq.push({
          type: 'lowshelf',
          freq: shelf.f,
          gain: polish(g),
          label: 'Upper-bass weight',
          reason: peakyInput
            ? 'Light low-end weight — input already peaky'
            : 'Low-end impact + small-speaker translation',
        });
      }
    }
  } else if (t.lowShelf && !actions.has('cut_sub')) {
    const baseMul = lowEndProtected ? 0.85 : 0.45;
    let g = t.lowShelf.g * baseMul * scale.eqMul + (settings.bass || 0) * 0.3;
    if (peakyInput) g *= 0.35;
    if (Math.abs(g) > 0.15) {
      eq.push({
        type: 'lowshelf',
        freq: t.lowShelf.f,
        gain: polish(g),
        label: 'Low shelf',
        reason: lowEndProtected
          ? 'Maximize low-end impact (genre signature)'
          : 'Genre low-end character',
      });
    }
  }

  // Never fill low-mids when mud is already the finding (avoids re-mud after compress)
  if (actions.has('fill_lowmid') && !actions.has('cut_mud')) {
    eq.push({
      type: 'peak',
      freq: 350,
      gain: polish(1.2 * scale.eqMul),
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
    const matchStrength = refFromMemory ? 0.22 * scale.eqMul : 0.32 * scale.eqMul;
    let matchMoves = referenceMatchEq(diag.regions, refProfile, matchStrength);
    // Don't let refs scoop EDM/club low end
    if (lowEndProtected) {
      matchMoves = matchMoves.map((m) => {
        if ((m.label === 'Match sub' || m.label === 'Match bass') && m.gain < 0) {
          return { ...m, gain: m.gain * 0.35 };
        }
        return m;
      });
    }
    // When muddy: allow Match lowMid cuts only — never boost haze back in
    if (actions.has('cut_mud')) {
      matchMoves = matchMoves.map((m) => {
        if (m.label === 'Match lowMid' && m.gain > 0) {
          return { ...m, gain: -Math.min(1.2, m.gain * 0.4 + 0.4) };
        }
        return m;
      });
    }
    matchMoves = matchMoves.filter((m) => Math.abs(m.gain) >= 0.3);
    for (const m of matchMoves) {
      eq.push({ ...m, gain: polish(m.gain) });
    }
    if (matchMoves.length) {
      log.push({
        type: 'decision',
        text: refFromMemory
          ? `Decision: learned-reference tone match — ${matchMoves.length} soft bands.`
          : `Decision: reference tone match — ${matchMoves.length} gentle bands toward analyzed similar track(s).`,
      });
    }
  }

  // Room translation EQ — car: presence/air OK; soft bass cuts on bass genres
  if (room.translateEq?.length) {
    const bassMul = lowEndProtected ? 0.35 : 0.9;
    for (const b of room.translateEq) {
      let g = (b.gain || 0) * 0.9;
      if (g < 0 && (b.freq || 0) < 250) g *= bassMul;
      eq.push({
        type: b.type === 'peak' ? 'peak' : b.type,
        freq: b.freq,
        gain: polish(g),
        q: b.q || 1,
        label: b.label || `Room ${room.label}`,
        reason: b.reason || room.desc,
      });
    }
    log.push({
      type: 'decision',
      text: lowEndProtected
        ? `Decision: ${room.label} translation — keep club weight, light cabin tweaks only.`
        : `Decision: ${room.label} translation EQ — mix should read outside the studio.`,
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

  // Stereo plan — MasteringBOX: center essentials; widen supports.
  // Never collapse width unless phase/correlation is bad (EDM felt “more mono”).
  const measuredW = diag.stereo?.width ?? 0.15;
  let widthTarget = pb.checks.targetWidth;
  if (refProfile) {
    widthTarget = clamp(refProfile.width, 0.08, 0.35);
  }

  let widthMode = 'preserve'; // preserve | widen | tighten
  if (actions.has('fix_phase') || actions.has('narrow')) {
    widthMode = 'tighten';
    widthTarget = Math.min(widthTarget, measuredW * 0.85, 0.14);
  } else if (wideSides || actions.has('widen')) {
    widthMode = 'widen';
    // Never pull below current image — only open sides for ear candy
    widthTarget = Math.max(measuredW, pb.checks.targetWidth);
    if (actions.has('widen') || wideSides) {
      widthTarget = Math.min(0.36, widthTarget * (actions.has('widen') ? 1.18 : 1.08));
    }
  } else {
    widthMode = 'preserve';
    widthTarget = Math.max(measuredW * 0.97, Math.min(widthTarget, measuredW * 1.05));
  }

  widthTarget *= (settings.width || 100) / 100;
  widthTarget = clamp(widthTarget, 0.06, 0.38);

  const sideAir = t.airSide
    ? {
        freq: t.airSide.f,
        gain: polish(
          t.airSide.g * scale.eqMul * (widthMode === 'widen' ? 1.05 : 0.55)
        ),
      }
    : null;
  log.push({
    type: 'decision',
    text: `Decision: stereo ${widthMode} → ~${(widthTarget * 100).toFixed(0)}% (was ${(measuredW * 100).toFixed(0)}%) · mono-safe below ${t.monoBassHz} Hz only — not a full mono collapse.`,
  });

  // Transient enhance (EDM kicks / synth stabs — MasteringBOX / Production Expert)
  let transient = null;
  if (t.transientEnhance?.enabled && !protect) {
    const crest = diag.analysis?.crest ?? settings._crest ?? 12;
    const tpHot = isFinite(settings._truePeakDb) && settings._truePeakDb > -3;
    const crestTight = crest < 8.5;
    let attackDb = (t.transientEnhance.attackDb || 1.2) * scale.eqMul * 0.85;
    if (lowEndProtected) attackDb *= 0.55;
    if (crestTight || tpHot) attackDb *= 0.4;
    if (attackDb > 0.25) {
      transient = {
        bandHz: t.transientEnhance.bandHz || 120,
        attackDb,
      };
      log.push({
        type: 'decision',
        text: `Decision: transient polish +${transient.attackDb.toFixed(1)} dB on low attack — punch without loudness race.`,
      });
    }
  }

  // Glue / sat — heavily restrained (user: Medium EDM was crushed)
  let glue = {
    ...t.glue,
    threshold: t.glue.threshold - (scale.glueMul < 0.35 ? 5 : 2),
    ratio: 1 + (t.glue.ratio - 1) * scale.glueMul,
  };
  let sat = clamp(t.sat * scale.satMul, 0, 0.12);

  // Bass / dembow desks: keep density stages light — peak chain must stay transparent
  // Extra pull-back when mud is present so compress doesn't refill 250–500 Hz
  const mudDensityMul = actions.has('cut_mud') ? clamp(1 - 0.35 * mudSev, 0.55, 0.85) : 1;
  const stageMul = (lowEndProtected ? 0.42 : 1) * mudDensityMul;

  // Multiband (Maztr rock/EDM, Digital Natural Sound) — gentle per-band control
  let multiband = null;
  const mbMul = scale.mbMul * stageMul;
  if (mbMul >= 0.18 && !protect) {
    const lowRatio = 1 + 0.55 * mbMul * (lowEndProtected ? 0.4 : 1);
    // Mid band owns the mud zone — control it harder, refill less
    const midRatio = 1 + 0.85 * mbMul * (actions.has('cut_mud') ? 1.15 : 1);
    const highRatio = 1 + 0.65 * mbMul;
    const midMakeup = 0.35 * mbMul * (actions.has('cut_mud') ? 0.25 : 1);
    multiband = {
      enabled: true,
      lowHz: lowEndProtected ? 150 : 190,
      highHz: 4200,
      low: {
        threshold: -24,
        ratio: clamp(lowRatio, 1.08, 1.6),
        attack: 0.03,
        release: 0.24,
        makeupDb: 0.25 * mbMul,
        knee: 12,
      },
      mid: {
        threshold: actions.has('cut_mud') ? -18.5 : -20,
        ratio: clamp(midRatio, 1.12, 2.05),
        attack: 0.02,
        release: 0.18,
        makeupDb: midMakeup,
        knee: 10,
      },
      high: {
        threshold: -18,
        ratio: clamp(highRatio, 1.08, 1.7),
        attack: 0.01,
        release: 0.14,
        makeupDb: 0.22 * mbMul,
        knee: 8,
      },
    };
    log.push({
      type: 'decision',
      text: `Decision: multiband compress — L ${multiband.low.ratio.toFixed(2)}:1 · M ${multiband.mid.ratio.toFixed(2)}:1 · H ${multiband.high.ratio.toFixed(2)}:1${actions.has('cut_mud') ? ' · mid makeup held (anti-mud)' : ''} (tap, don’t slam).`,
    });
  }

  // Parallel NY compression — light on protect-low-end; HPF wet when muddy
  let parallel = null;
  const parallelMix = clamp(
    0.2 * scale.parallelMul * stageMul,
    0,
    lowEndProtected ? 0.14 : actions.has('cut_mud') ? 0.28 : 0.42,
  );
  if (parallelMix >= 0.04 && !protect) {
    parallel = {
      mix: parallelMix,
      threshold: -30,
      ratio: 3.0 + scale.parallelMul * stageMul,
      attack: 0.004,
      release: 0.16,
      makeupDb: lowEndProtected ? 1.8 : actions.has('cut_mud') ? 2.4 : 3.5,
      // Keep NY density above the mud band so compress doesn't thicken 250–500 Hz
      wetHpHz: actions.has('cut_mud') ? 520 : lowEndProtected ? 280 : 0,
    };
    log.push({
      type: 'decision',
      text: `Decision: parallel (NY) compress — ${(parallel.mix * 100).toFixed(0)}% wet${parallel.wetHpHz ? ` · HPF @ ${parallel.wetHpHz} Hz (anti-mud)` : ''} under dry bus.`,
    });
  }

  // Harmonic exciter — skip / whisper on bass-forward desks (adds clip grit)
  let exciter = null;
  const excAmount = clamp(0.16 * scale.exciterMul * (lowEndProtected ? 0.35 : 1), 0, 0.22);
  if (excAmount >= 0.04 && !protect && !lowEndProtected) {
    exciter = {
      amount: excAmount,
      freq: settings.genre === 'acoustic' || settings.genre === 'classical' ? 4500 : 3200,
      mix: clamp(0.14 * scale.exciterMul, 0.05, 0.2),
    };
    log.push({
      type: 'decision',
      text: `Decision: harmonic exciter — high-band blend ${(exciter.mix * 100).toFixed(0)}% @ ${exciter.freq} Hz.`,
    });
  } else if (lowEndProtected) {
    log.push({
      type: 'decision',
      text: 'Decision: skip exciter — keep dembow / 808 edge clean into the limiter.',
    });
  }

  if (protect) {
    glue = { ...glue, ratio: Math.min(glue.ratio, 1.15), threshold: glue.threshold - 3 };
    sat = Math.min(sat, 0.03);
    log.push({
      type: 'decision',
      text: 'Decision: already over-compressed — skip heavy glue/sat/multiband (tap, don’t slam).',
    });
  } else {
    if (lowEndProtected) sat = Math.min(sat, 0.05);
    // Glue packs low-mids — ease ratio when mud is the complaint
    if (actions.has('cut_mud')) {
      glue = {
        ...glue,
        ratio: 1 + (glue.ratio - 1) * (0.7 - 0.15 * mudSev),
        threshold: glue.threshold - 1.5,
      };
      sat = Math.min(sat, lowEndProtected ? 0.035 : 0.07);
    }
    log.push({
      type: 'decision',
      text: `Decision: Intensity ${scale.label} → glue ${glue.ratio.toFixed(2)}:1 @ ${glue.threshold} dB, sat ${(sat * 100).toFixed(0)}% (polish).`,
    });
  }

  // Peak chain — per-genre style. Bass desks: transparent limit (no double soft-clip).
  const crest = diag.analysis?.crest ?? 12;
  const bassHeavy =
    lowEndProtected ||
    crest < 8.5 ||
    (isFinite(settings._truePeakDb) && settings._truePeakDb > -2.5);
  const peakStyle = t.peakStyle || (lowEndProtected ? 'transparent' : 'polish');

  let softClip = false;
  let softClipDb = -0.5;
  let softClipAmount = 0.35;
  let ceilingDb = scale.ceilingDb;
  let tpMarginDb = 1.15;

  if (peakStyle === 'transparent' || lowEndProtected) {
    // Reggaeton / hip-hop / EDM: look-ahead limit only — preserve dembow punch
    softClip = false;
    ceilingDb = Math.min(ceilingDb, -1.2);
    tpMarginDb = bassHeavy ? 1.45 : 1.25;
  } else if (peakStyle === 'open') {
    // Jazz / classical / acoustic — invisible peak path
    softClip = false;
    ceilingDb = Math.min(ceilingDb, -1.2);
    tpMarginDb = 1.05;
  } else if (peakStyle === 'firm') {
    softClip = true;
    softClipDb = -0.55;
    softClipAmount = 0.4;
    tpMarginDb = 1.35;
  } else {
    // polish — light soft clip, not a rack of clippers
    softClip =
      scale.softClip ||
      actions.has('peak_clip_limit') ||
      (isFinite(settings._truePeakDb) && settings._truePeakDb > -0.2);
    softClipDb = -0.45;
    softClipAmount = 0.32;
    tpMarginDb = 1.2;
  }

  if (scale.label === 'Punch' && bassHeavy) {
    ceilingDb = Math.min(ceilingDb, -1.3);
    tpMarginDb = Math.max(tpMarginDb, 1.55);
    // Still no soft-clip on protect-low-end — punch comes from transients, not grit
  }

  const targetLufs = refProfile
    ? clamp(refProfile.lufs, -18, -9)
    : settings.targetLufs;

  if (softClip) {
    log.push({
      type: 'decision',
      text: `Decision: peak polish — light soft clip → limit @ ${ceilingDb} dBTP (margin ${tpMarginDb.toFixed(1)} dB).`,
    });
  } else {
    log.push({
      type: 'decision',
      text: `Decision: transparent limit @ ${ceilingDb} dBTP (margin ${tpMarginDb.toFixed(1)} dB${bassHeavy ? ', bass / dembow safe' : ''}) · target ${targetLufs.toFixed(1)} LUFS.`,
    });
  }

  // Soft spectral refine only — never remould
  log.push({
    type: 'decision',
    text: `Decision: polish path — EQ capped ±${scale.polishCap} dB, light FR refine (${(scale.refineMul * 100).toFixed(0)}%).`,
  });

  // Lean spectrum target lowMid when muddy so residual polish doesn't re-boost haze
  let spectrumTarget = { ...(refProfile?.regions || pb.spectrum) };
  if (actions.has('cut_mud')) {
    spectrumTarget = {
      ...spectrumTarget,
      lowMid: spectrumTarget.lowMid * (0.82 - 0.1 * mudSev),
    };
    let sum = 0;
    for (const k of Object.keys(spectrumTarget)) sum += spectrumTarget[k];
    for (const k of Object.keys(spectrumTarget)) spectrumTarget[k] /= sum;
  }

  return {
    role: pb.role,
    priorities: pb.priorities,
    room,
    refProfile,
    refFromMemory: Boolean(refFromMemory),
    liveRefProfiles,
    intensity: scale,
    eq,
    kickBass,
    transient,
    widthTarget,
    widthMode,
    preserveWidth: widthMode !== 'tighten',
    monoBassHz: t.monoBassHz,
    sideAir,
    glue,
    sat,
    multiband,
    parallel,
    exciter,
    protectDynamics: protect,
    protectLowEnd: lowEndProtected,
    cutMud: actions.has('cut_mud'),
    mudSeverity: mudSev,
    spectrumTarget,
    refineMul: scale.refineMul * (lowEndProtected ? 0.7 : 1) * (actions.has('cut_mud') ? 0.85 : 1),
    skipHeavyRemould: true,
    peak: {
      softClip,
      softClipDb,
      softClipAmount,
      ceilingDb,
      tpMarginDb,
      targetLufs,
      style: peakStyle,
    },
    log,
    findings: diag.findings,
  };
}
