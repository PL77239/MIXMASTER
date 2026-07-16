/**
 * Hero tidewave — dark layered waves that drift with the cursor
 * (pxpush cloud-style parallax). Strong left/right tracking.
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
  const shell = document.querySelector('.desk-top');
  const wash = root?.querySelector('.tidewave__wash');
  if (!root) return;

  document.body.classList.add('has-tidewave');

  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) return;

  const layers = [...root.querySelectorAll('[data-tide-depth]')].map((el) => ({
    el,
    depth: parseFloat(el.getAttribute('data-tide-depth') || '1'),
  }));

  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let raf = 0;
  let active = true;
  let running = false;

  const settled = () =>
    Math.abs(current.x - target.x) < 0.0008 && Math.abs(current.y - target.y) < 0.0008;

  const tick = () => {
    if (!active || document.hidden) {
      running = false;
      raf = 0;
      return;
    }

    current.x = lerp(current.x, target.x, 0.14);
    current.y = lerp(current.y, target.y, 0.06);

    // Base wash drifts with cursor; layers amplify by depth
    if (wash) {
      const wx = current.x * 48;
      wash.style.transform = `translate3d(${wx.toFixed(2)}px, 0, 0)`;
    }

    for (const { el, depth } of layers) {
      const tx = current.x * depth * 118;
      const ty = current.y * depth * 12;
      el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
    }

    if (settled()) {
      running = false;
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const kick = () => {
    if (running || !active || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onMove = (e) => {
    // Normalize to -1..1; emphasize horizontal so L/R reads clearly
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    kick();
  };

  window.addEventListener('pointermove', onMove, { passive: true });

  if (shell && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        active = entry.isIntersecting;
        if (active) kick();
        else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          running = false;
        }
      },
      { threshold: 0.05 }
    );
    io.observe(shell);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active) kick();
  });

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
  };
}
