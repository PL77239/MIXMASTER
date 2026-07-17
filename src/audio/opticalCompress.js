/**
 * Optical compressor approximation (LA-2A / CLA-2A character) — sample domain.
 *
 * Not a circuit model of the T4 cell. Captures the useful mastering traits:
 * - Soft knee, modest fixed-ish ratio (~3:1 Compress feel)
 * - Program-dependent dual-stage release (fast then slow “optical” settle)
 * - Mild tube-ish makeup saturation
 *
 * DynamicsCompressorNode cannot do dual-release; this envelope does.
 */

import { makeBuffer, getChannelArrays, dbToLin } from './dsp.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function linToDb(x) {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

/**
 * @param {AudioBuffer} inputBuffer
 * @param {object} spec
 * @param {number} [spec.peakReduction=0.35] 0..1 — “Peak Reduction” knob
 * @param {number} [spec.gain=0.2] makeup feel 0..1
 * @param {number} [spec.thresholdDb=-24]
 * @param {number} [spec.ratio=3.2]
 * @param {number} [spec.kneeDb=18]
 * @param {number} [spec.sat=0.08]
 */
export function opticalCompress(inputBuffer, spec = {}) {
  const peakReduction = clamp(spec.peakReduction ?? 0.35, 0, 1);
  if (peakReduction < 0.04) return inputBuffer;

  const thresholdDb = spec.thresholdDb ?? (-18 - peakReduction * 14); // more PR → lower thresh
  const ratio = spec.ratio ?? 3.2;
  const kneeDb = spec.kneeDb ?? 18;
  const makeupDb = (spec.gain ?? 0.25) * peakReduction * 6;
  const sat = clamp(spec.sat ?? 0.1, 0, 0.35);

  const fs = inputBuffer.sampleRate;
  const chans = getChannelArrays(inputBuffer);
  const nCh = chans.length;
  const n = chans[0].length;

  // Envelope timing (optical-ish): medium attack, dual release
  const atkSec = 0.01; // ~10 ms
  const relFastSec = 0.06; // quick photocell drop
  const relSlowSec = 0.55 + peakReduction * 0.6; // long tail
  const atkCoef = Math.exp(-1 / (atkSec * fs));
  const relFastCoef = Math.exp(-1 / (relFastSec * fs));
  const relSlowCoef = Math.exp(-1 / (relSlowSec * fs));

  let env = 0; // linear peak env
  let grLin = 1;
  const out = chans.map(() => new Float32Array(n));
  const makeup = dbToLin(makeupDb);
  const kSat = sat * 2.4;
  const satNorm = Math.tanh(1 + kSat) || 1;

  for (let i = 0; i < n; i++) {
    // Stereo peak detect
    let peak = 0;
    for (let c = 0; c < nCh; c++) {
      const a = Math.abs(chans[c][i]);
      if (a > peak) peak = a;
    }

    // Ballistics
    if (peak > env) env = atkCoef * env + (1 - atkCoef) * peak;
    else {
      // Dual release blend: mostly fast when far above, slow settle near rest
      const fast = relFastCoef * env + (1 - relFastCoef) * peak;
      const slow = relSlowCoef * env + (1 - relSlowCoef) * peak;
      const blend = clamp((env - peak) * 8, 0, 1);
      env = fast * (1 - 0.55 * blend) + slow * (0.55 * blend);
    }

    const levelDb = linToDb(env);
    let grDb = 0;
    const over = levelDb - thresholdDb;
    if (over <= -kneeDb / 2) {
      grDb = 0;
    } else if (over >= kneeDb / 2) {
      grDb = over * (1 - 1 / ratio);
    } else {
      // Soft knee quadratic region
      const x = over + kneeDb / 2;
      grDb = ((1 - 1 / ratio) * x * x) / (2 * kneeDb);
    }
    // Peak Reduction scales depth of GR
    grDb *= 0.35 + peakReduction * 0.9;

    const targetGr = dbToLin(-grDb);
    // Smooth GR application slightly (optical lag)
    grLin = grLin * 0.92 + targetGr * 0.08;

    for (let c = 0; c < nCh; c++) {
      let y = chans[c][i] * grLin * makeup;
      if (sat > 0.01) {
        y = Math.tanh((1 + kSat) * y) / satNorm;
      }
      out[c][i] = y;
    }
  }

  return makeBuffer(out, fs);
}
