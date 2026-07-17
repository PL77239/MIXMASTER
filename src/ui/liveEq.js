/**
 * Live EQ / spectrum view during A/B preview.
 * Reads FFT bins from the player's dry AnalyserNode.
 */

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 140));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const F_MIN = 30;
const F_MAX = 16000;

function freqToX(f, w, pad) {
  const logMin = Math.log10(F_MIN);
  const logMax = Math.log10(F_MAX);
  const t = (Math.log10(Math.max(F_MIN, Math.min(F_MAX, f))) - logMin) / (logMax - logMin);
  return pad + t * (w - pad * 2);
}

export class LiveEQ {
  constructor({ canvas, getFreq, isPlaying }) {
    this.canvas = canvas;
    this.getFreq = getFreq;
    this.isPlaying = isPlaying;
    this._raf = 0;
    this._smooth = null;
  }

  start() {
    if (this._raf) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._paint();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  reset() {
    this._smooth = null;
    this._paintIdle();
  }

  _paintIdle() {
    if (!this.canvas) return;
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(18, 18, 18, 0.06)';
    ctx.fillRect(0, 0, w, h);
    this._grid(ctx, w, h);
    ctx.fillStyle = 'rgba(18, 18, 18, 0.35)';
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Live EQ — press play', 12, 18);
  }

  _grid(ctx, w, h) {
    const pad = 10;
    const marks = [50, 100, 250, 500, 1000, 2000, 5000, 10000];
    ctx.strokeStyle = 'rgba(18, 18, 18, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(18, 18, 18, 0.35)';
    ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const f of marks) {
      const x = freqToX(f, w, pad);
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, h - 16);
      ctx.stroke();
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      ctx.fillText(label, x, h - 4);
    }
  }

  _paint() {
    if (!this.canvas) return;
    const playing = this.isPlaying?.();
    const pack = this.getFreq?.();
    if (!playing || !pack?.data) {
      if (!this._smooth) this._paintIdle();
      return;
    }

    const { ctx, w, h } = fitCanvas(this.canvas);
    const { data, sampleRate, fftSize } = pack;
    const binHz = sampleRate / fftSize;
    const pad = 10;
    const plotH = h - 22;
    const bars = 64;
    const values = new Float32Array(bars);

    for (let i = 0; i < bars; i++) {
      const t0 = i / bars;
      const t1 = (i + 1) / bars;
      const f0 = F_MIN * Math.pow(F_MAX / F_MIN, t0);
      const f1 = F_MIN * Math.pow(F_MAX / F_MIN, t1);
      const b0 = Math.max(1, Math.floor(f0 / binHz));
      const b1 = Math.min(data.length - 1, Math.ceil(f1 / binHz));
      let sum = 0;
      let n = 0;
      for (let b = b0; b <= b1; b++) {
        sum += data[b];
        n++;
      }
      // FloatFrequencyData is dB, typically -100..0
      const db = n ? sum / n : -100;
      values[i] = Math.max(0, Math.min(1, (db + 90) / 70));
    }

    if (!this._smooth || this._smooth.length !== bars) {
      this._smooth = values.slice();
    } else {
      for (let i = 0; i < bars; i++) {
        this._smooth[i] = this._smooth[i] * 0.65 + values[i] * 0.35;
      }
    }

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(18, 18, 18, 0.04)';
    ctx.fillRect(0, 0, w, h);
    this._grid(ctx, w, h);

    const barW = (w - pad * 2) / bars;
    for (let i = 0; i < bars; i++) {
      const v = this._smooth[i];
      const bh = Math.max(1, v * plotH);
      const x = pad + i * barW;
      const y = 8 + (plotH - bh);
      const g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, 'rgba(10, 61, 145, 0.95)');
      g.addColorStop(1, 'rgba(158, 182, 255, 0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 0.5, y, Math.max(1, barW - 1), bh);
    }

    ctx.fillStyle = 'rgba(18, 18, 18, 0.45)';
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Live EQ', 12, 16);
  }
}
