/**
 * Hero tidewave — dark layered waves that drift with the cursor
 * (pxpush cloud-style parallax). Strong left/right tracking.
 * Scrolls away (opacity + lift) as the page moves down.
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
const clamp01 = (v) => Math.min(1, Math.max(0, v));

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

  const layers = [...root.querySelectorAll('[data-tide-depth]')].map((el) => ({
    el,
    depth: parseFloat(el.getAttribute('data-tide-depth') || '1'),
  }));

  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let raf = 0;
  let active = true;
  let running = false;
  let hide = 0;
  let hideTarget = 0;

  const settled = () =>
    Math.abs(current.x - target.x) < 0.0008 &&
    Math.abs(current.y - target.y) < 0.0008 &&
    Math.abs(hide - hideTarget) < 0.002;

  const applyTransforms = () => {
    const lift = hide * 120;
    const opacity = 1 - hide;

    root.style.opacity = opacity.toFixed(3);
    root.style.transform = `translate3d(0, ${(-lift * 0.35).toFixed(2)}px, 0)`;
    root.style.pointerEvents = hide > 0.92 ? 'none' : '';

    if (wash) {
      const wx = current.x * 48 * (1 - hide * 0.5);
      wash.style.transform = `translate3d(${wx.toFixed(2)}px, ${(-lift * 0.25).toFixed(2)}px, 0)`;
    }

    for (const { el, depth } of layers) {
      const tx = current.x * depth * 118 * (1 - hide * 0.4);
      const ty = current.y * depth * 12 - lift * (0.45 + depth * 0.35);
      el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
      el.style.opacity = String(Math.max(0, 1 - hide * (0.55 + depth * 0.25)));
    }
  };

  const updateHideFromScroll = () => {
    if (!shell) {
      hideTarget = 0;
      return;
    }
    const rect = shell.getBoundingClientRect();
    // 0 while hero fills the top; → 1 as desk-top scrolls away
    const span = Math.max(180, rect.height * 0.55);
    hideTarget = clamp01((-rect.top) / span);
  };

  const tick = () => {
    if (!active || document.hidden) {
      running = false;
      raf = 0;
      return;
    }

    current.x = lerp(current.x, target.x, 0.14);
    current.y = lerp(current.y, target.y, 0.06);
    hide = lerp(hide, hideTarget, 0.12);
    applyTransforms();

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
    if (reduce || !fine) return;
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    kick();
  };

  const onScroll = () => {
    updateHideFromScroll();
    kick();
  };

  if (!reduce) {
    window.addEventListener('pointermove', onMove, { passive: true });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  updateHideFromScroll();
  applyTransforms();
  kick();

  if (shell && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        active = entry.isIntersecting || hideTarget < 0.98;
        if (active) kick();
        else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          running = false;
        }
      },
      { threshold: 0 }
    );
    io.observe(shell);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active) kick();
  });

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}
