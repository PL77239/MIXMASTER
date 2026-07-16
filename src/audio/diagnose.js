// Genre-aware diagnostics — what an engineer would notice on first listen.
import { FFT, hann } from './fft.js';
import { measureRegions } from './analyzeTargets.js';
import { getPlaybook } from './playbooks.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function monoFrom(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][i];
    m[i] = s / channels.length;
  }
  return m;
}

function stereoMetrics(channels) {
  if (channels.length < 2) return { width: 0, correlation: 1 };
  const L = channels[0], R = channels[1];
  let sLR = 0, sLL = 0, sRR = 0, midE = 0, sideE = 0;
  const n = Math.min(L.length, R.length);
  for (let i = 0; i < n; i += 2) {
    const l = L[i], r = R[i];
    sLR += l * r; sLL += l * l; sRR += r * r;
    const mid = (l + r) * 0.5, sd = (l - r) * 0.5;
    midE += mid * mid; sideE += sd * sd;
  }
  return {
    width: midE + sideE > 0 ? sideE / (midE + sideE) : 0,
    correlation: sLL > 0 && sRR > 0 ? sLR / Math.sqrt(sLL * sRR) : 1,
  };
}

/** Presence-band energy share (≈2–5 kHz) — proxy for vocal / lead clarity. */
function presenceShare(mono, sampleRate) {
  const size = 2048;
  const hop = 1024;
  const fft = new FFT(size);
  const win = hann(size);
  const binHz = sampleRate / size;
  let pres = 0, total = 0;
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const nFrames = Math.floor((mono.length - size) / hop);
  const stride = Math.max(1, Math.floor(nFrames / 120));
  for (let fi = 0; fi < nFrames; fi += stride) {
    const off = fi * hop;
    for (let i = 0; i < size; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    fft.transform(re, im);
    for (let b = 1; b < size / 2; b++) {
      const e = re[b] * re[b] + im[b] * im[b];
      const f = b * binHz;
      total += e;
      if (f >= 2000 && f <= 5000) pres += e;
    }
  }
  return total > 0 ? pres / total : 0;
}

/**
 * Kick vs bass conflict heuristic:
 * Compare short-window (transient) vs long-window (sustain) energy in the sub/bass.
 * High sustain/transient ratio → bass masks kicks → needs separation.
 */
function kickBassConflict(mono, sampleRate) {
  const shortN = Math.round(0.02 * sampleRate);
  const longN = Math.round(0.2 * sampleRate);
  // Crude one-pole bandpass around 60–100 Hz via cascade HP+LP approximation
  // using simple difference of smoothed signals.
  const hp = Math.exp(-2 * Math.PI * 45 / sampleRate);
  const lp = Math.exp(-2 * Math.PI * 140 / sampleRate);
  let yHp = 0, yLp = 0, xPrev = 0;
  const band = new Float32Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    yHp = hp * (yHp + x - xPrev);
    xPrev = x;
    yLp = yLp + (1 - lp) * (yHp - yLp);
    band[i] = yLp;
  }

  let shortPeak = 0, longRmsAcc = 0, blocks = 0;
  for (let i = 0; i + longN < band.length; i += longN) {
    let sShort = 0, sLong = 0;
    for (let j = 0; j < longN; j++) {
      const v = band[i + j];
      const a = v * v;
      sLong += a;
      if (j < shortN) sShort += a;
    }
    const sp = Math.sqrt(sShort / shortN);
    const lr = Math.sqrt(sLong / longN);
    if (sp > shortPeak) shortPeak = sp;
    longRmsAcc += lr;
    blocks++;
  }
  const longRms = blocks ? longRmsAcc / blocks : 0;
  const ratio = shortPeak > 1e-6 ? longRms / shortPeak : 1;
  // ratio high → sustain dominates transients → conflict
  return {
    ratio,
    conflict: ratio > 0.55,
    severity: clamp((ratio - 0.4) / 0.5, 0, 1),
  };
}

/**
 * Diagnose a buffer as the selected genre's engineer would.
 * Returns findings the planner turns into processing decisions.
 */
export function diagnose(channels, sampleRate, analysis, genreKey) {
  const pb = getPlaybook(genreKey);
  const mono = monoFrom(channels);
  const regions = measureRegions(channels, sampleRate);
  const stereo = stereoMetrics(channels);
  const presence = presenceShare(mono, sampleRate);
  const kb = kickBassConflict(mono, sampleRate);

  const findings = [];

  // --- Spectrum vs genre engineer targets ---
  if (regions.sub > pb.checks.maxSub) {
    findings.push({
      id: 'sub_heavy',
      severity: clamp((regions.sub - pb.checks.maxSub) / 0.1, 0.3, 1),
      note: `Sub is heavy (${(regions.sub * 100).toFixed(0)}% vs ~${(pb.spectrum.sub * 100).toFixed(0)}% for ${pb.role.split(' ')[0]}). Risk of boom on small speakers.`,
      action: 'cut_sub',
    });
  }
  if (regions.bass < pb.checks.minBass) {
    findings.push({
      id: 'bass_thin',
      severity: clamp((pb.checks.minBass - regions.bass) / 0.1, 0.3, 1),
      note: `Upper bass feels thin (${(regions.bass * 100).toFixed(0)}%). ${pb.role.split('/')[0].trim()} records need weight around 80–150 Hz for earbuds.`,
      action: 'boost_upper_bass',
    });
  }
  if (regions.lowMid > pb.checks.maxLowMid) {
    findings.push({
      id: 'mud',
      severity: clamp((regions.lowMid - pb.checks.maxLowMid) / 0.1, 0.4, 1),
      note: `Low-mid haze at 250–500 Hz (${(regions.lowMid * 100).toFixed(0)}%). Classic masking zone — cut before boosting anything else.`,
      action: 'cut_mud',
    });
  } else if (regions.lowMid < pb.spectrum.lowMid * 0.55) {
    findings.push({
      id: 'lowmid_thin',
      severity: 0.4,
      note: `Low-mids are scooped (${(regions.lowMid * 100).toFixed(0)}%). Restoring a bit of body so the track doesn't sound hollow.`,
      action: 'fill_lowmid',
    });
  }
  if (presence < pb.checks.minPresence) {
    findings.push({
      id: 'presence_low',
      severity: clamp((pb.checks.minPresence - presence) / 0.08, 0.35, 1),
      note: `Presence band (2–5 kHz) is quiet (${(presence * 100).toFixed(0)}%). Lead / vocal won't cut through — opening a pocket.`,
      action: 'boost_presence',
    });
  }
  if (regions.high + regions.air < pb.spectrum.high + pb.spectrum.air - 0.06) {
    findings.push({
      id: 'dull',
      severity: 0.5,
      note: `Top end is dull relative to a ${pb.role.split(' ')[0]} reference. Adding controlled air on the sides.`,
      action: 'add_air',
    });
  } else if (regions.high + regions.air > (pb.spectrum.high + pb.spectrum.air) + 0.08) {
    findings.push({
      id: 'harsh',
      severity: 0.55,
      note: `Top end is hot — risk of fatigue / sibilance. Taming before the limiter.`,
      action: 'tame_air',
    });
  }

  // --- Dynamics ---
  if (analysis.crest < pb.checks.minCrest) {
    findings.push({
      id: 'overcompressed',
      severity: clamp((pb.checks.minCrest - analysis.crest) / 4, 0.4, 1),
      note: `Crest factor ${analysis.crest.toFixed(1)} dB — already smashed. Going light on compression so the groove survives.`,
      action: 'protect_dynamics',
    });
  }

  // --- Kick / bass ---
  if (pb.techniques.kickBassSep?.enabled && kb.conflict) {
    findings.push({
      id: 'kick_bass',
      severity: kb.severity,
      note: `Kick and bass are fighting in the sub (sustain/transient ratio ${kb.ratio.toFixed(2)}). Applying genre-typical separation so the kick punches through.`,
      action: 'kick_bass_sep',
    });
  }

  // --- Stereo ---
  if (stereo.width < pb.checks.targetWidth * 0.45 && channels.length >= 2) {
    findings.push({
      id: 'narrow',
      severity: 0.45,
      note: `Stereo image is narrow (width ${(stereo.width * 100).toFixed(0)}%). Widening highs/FX while keeping bass mono.`,
      action: 'widen',
    });
  } else if (stereo.width > 0.35) {
    findings.push({
      id: 'too_wide',
      severity: 0.4,
      note: `Very wide stereo (${(stereo.width * 100).toFixed(0)}%) — mono-check risk. Pulling sides back a touch.`,
      action: 'narrow',
    });
  }
  if (stereo.correlation < 0.1) {
    findings.push({
      id: 'phase',
      severity: 0.7,
      note: `Low stereo correlation (${stereo.correlation.toFixed(2)}) — phase issues. Favouring mid and monoing the low end harder.`,
      action: 'fix_phase',
    });
  }

  // Always at least one "session intent" finding
  if (!findings.length) {
    findings.push({
      id: 'polish',
      severity: 0.3,
      note: `Balance already sits close to a ${pb.role.split(' ')[0]} reference. Applying light genre polish only.`,
      action: 'polish',
    });
  }

  findings.sort((a, b) => b.severity - a.severity);

  return {
    playbook: pb,
    regions,
    stereo,
    presence,
    kickBass: kb,
    findings,
  };
}
