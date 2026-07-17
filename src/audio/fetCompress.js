/**
 * FET compressor approximation (1176 / “fast grab” character) — sample domain.
 *
 * Not a circuit model of the 1176. Captures useful mastering traits:
 * - Very fast attack (sub-ms to a few ms)
 * - Faster single-stage release than optical
 * - Firmer knee / higher ratio feel (peak control before soft settle)
 * - Mild FET/transformer grit via soft saturation
 *
 * Used first in the classic 1176 → LA-2A bus chain.
 */

import { makeBuffer, getChannelArrays, dbToLin } from './dsp.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function linToDb(x) {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

/**
 * @param {AudioBuffer} inputBuffer
 * @param {object} spec
 * @param {number} [spec.inputDrive=0.4] 0..1 — 1176-style input / GR depth
 * @param {number} [spec.gain=0.15] makeup feel 0..1
 * @param {number} [spec.thresholdDb=-18]
 * @param {number} [spec.ratio=5]
 * @param {number} [spec.kneeDb=6]
 * @param {number} [spec.attackMs=1]
 * @param {number} [spec.releaseMs=80]
 * @param {number} [spec.sat=0.06]
 */
export function fetCompress(inputBuffer, spec = {}) {
  const inputDrive = clamp(spec.inputDrive ?? 0.4, 0, 1);
  if (inputDrive < 0.04) return inputBuffer;

  const thresholdDb = spec.thresholdDb ?? (-14 - inputDrive * 12);
  const ratio = spec.ratio ?? 5;
  const kneeDb = spec.kneeDb ?? 6;
  const makeupDb = (spec.gain ?? 0.15) * inputDrive * 5;
  const sat = clamp(spec.sat ?? 0.06, 0, 0.3);
  const atkSec = Math.max(0.0003, (spec.attackMs ?? 1) / 1000);
  const relSec = Math.max(0.02, (spec.releaseMs ?? 80) / 1000);

  const fs = inputBuffer.sampleRate;
  const chans = getChannelArrays(inputBuffer);
  const nCh = chans.length;
  const n = chans[0].length;

  const atkCoef = Math.exp(-1 / (atkSec * fs));
  const relCoef = Math.exp(-1 / (relSec * fs));

  // Pre-drive into the detector / gain cell (1176 “input”)
  const driveLin = dbToLin(inputDrive * 6);

  let env = 0;
  let grLin = 1;
  const out = chans.map(() => new Float32Array(n));
  const makeup = dbToLin(makeupDb);
  const kSat = sat * 2.8;
  const satNorm = Math.tanh(1 + kSat) || 1;

  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let c = 0; c < nCh; c++) {
      const a = Math.abs(chans[c][i] * driveLin);
      if (a > peak) peak = a;
    }

    if (peak > env) env = atkCoef * env + (1 - atkCoef) * peak;
    else env = relCoef * env + (1 - relCoef) * peak;

    const levelDb = linToDb(env);
    let grDb = 0;
    const over = levelDb - thresholdDb;
    if (over <= -kneeDb / 2) {
      grDb = 0;
    } else if (over >= kneeDb / 2) {
      grDb = over * (1 - 1 / ratio);
    } else {
      const x = over + kneeDb / 2;
      grDb = ((1 - 1 / ratio) * x * x) / (2 * kneeDb);
    }
    // Input drive scales GR depth (like turning up Input / Input Gain)
    grDb *= 0.4 + inputDrive * 0.95;

    const targetGr = dbToLin(-grDb);
    // Slightly snappier GR application than optical
    grLin = grLin * 0.78 + targetGr * 0.22;

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
