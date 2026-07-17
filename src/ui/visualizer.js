import { BANDS } from '../audio/analyze.js';

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function drawWaveform(canvas, audioBuffer, colorA = '#ff2d95', colorB = '#38e8ff') {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  ctx.fillStyle = grad;

  for (let x = 0; x < w; x++) {
    let min = 1;
    let max = -1;
    const start = x * step;
    for (let i = 0; i < step; i++) {
      const v = data[start + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = mid + min * mid * 0.95;
    const y2 = mid + max * mid * 0.95;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
}

// Draw a smooth spectral-balance curve for before (dim) and after (bright).
export function drawSpectrum(canvas, before, after) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const pad = 24;
  const plotW = w - pad * 2;
  const plotH = h - pad;

  // Map band dB values into 0..1 using a shared range.
  const all = [...before.bands.map((b) => b.db), ...after.bands.map((b) => b.db)]
    .filter((v) => isFinite(v));
  const maxDb = Math.max(...all);
  const minDb = Math.min(...all, maxDb - 40);
  const range = Math.max(6, maxDb - minDb);

  const xs = BANDS.map((_, i) => pad + (i / (BANDS.length - 1)) * plotW);
  const toY = (db) => pad / 2 + (1 - (db - minDb) / range) * plotH;

  // gridlines + labels
  ctx.fillStyle = 'rgba(199,182,230,0.5)';
  ctx.font = '10px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  BANDS.forEach((b, i) => {
    ctx.fillText(b.label, xs[i], h - 4);
  });

  const curve = (bands, color, fill, lineW) => {
    ctx.beginPath();
    bands.forEach((b, i) => {
      const x = xs[i];
      const y = toY(isFinite(b.db) ? b.db : minDb);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const px = xs[i - 1];
        const py = toY(isFinite(bands[i - 1].db) ? bands[i - 1].db : minDb);
        const cx = (px + x) / 2;
        ctx.bezierCurveTo(cx, py, cx, y, x, y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.stroke();
    if (fill) {
      ctx.lineTo(xs[xs.length - 1], h - pad / 2);
      ctx.lineTo(xs[0], h - pad / 2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
  };

  curve(before.bands, 'rgba(150,130,190,0.7)', null, 1.5);
  curve(after.bands, '#ffd25a', 'rgba(255,138,61,0.15)', 2.5);

  // legend
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150,130,190,0.9)';
  ctx.fillText('■ original', pad, 12);
  ctx.fillStyle = '#ffd25a';
  ctx.fillText('■ mastered', pad + 66, 12);
}
