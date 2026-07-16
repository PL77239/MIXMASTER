/**
 * Hero tidewave — dark layered waves that drift with the cursor
 * (pxpush cloud-style parallax).
 *
 * EASY REMOVAL:
 *   1. Set ENABLE_TIDEWAVE = false below, OR
 *   2. Delete this file + its import in main.js, AND
 *   3. Remove the HTML block marked TIDEWAVE in index.dev.html, AND
 *   4. Remove the CSS block marked TIDEWAVE in style.css
 */

/** Flip to false to disable without deleting markup. */
export const ENABLE_TIDEWAVE = true;

const lerp = (a, b, t) => a + (b - a) * t;

export function initTidewave() {
  if (!ENABLE_TIDEWAVE) {
    document.getElementById('tidewave')?.setAttribute('hidden', '');
    document.body.classList.remove('has-tidewave');
    return;
  }

  const root = document.getElementById('tidewave');
  if (!root) return;

  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) {
    // Still show a static wave; no pointer tracking
    document.body.classList.add('has-tidewave');
    return;
  }

  document.body.classList.add('has-tidewave');
  const layers = [...root.querySelectorAll('[data-tide-depth]')];
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let raf = 0;

  const onMove = (e) => {
    const nx = (e.clientX / window.innerWidth - 0.5) * 2; // -1..1
    const ny = (e.clientY / window.innerHeight - 0.5) * 2;
    target.x = nx;
    target.y = ny;
  };

  const tick = () => {
    current.x = lerp(current.x, target.x, 0.06);
    current.y = lerp(current.y, target.y, 0.06);
    for (const layer of layers) {
      const depth = parseFloat(layer.getAttribute('data-tide-depth') || '1');
      const tx = current.x * depth * 28;
      const ty = current.y * depth * 14;
      const skew = current.x * depth * 1.2;
      layer.style.transform = `translate3d(${tx}px, ${ty}px, 0) skewX(${skew}deg)`;
    }
    raf = requestAnimationFrame(tick);
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
  };
}
