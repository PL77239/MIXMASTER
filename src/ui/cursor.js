/**
 * PX Push–style tile cursor field.
 * Full-viewport grid; cells light under the pointer and fade (ttl).
 * Soft ring still glides as a secondary pointer.
 *
 * Tiles are muted over media / transport / form controls.
 */

const lerp = (a, b, t) => a + (b - a) * t;

/** Zones where tile paint must not appear */
const SKIP_SELECTOR = [
  '.logo3d',
  '.cursor_disabled',
  '.hover_effect',
  '.viz',
  '.viz-stack',
  '.transport',
  '.scrub',
  '.progress',
  '.progress-card',
  '.progress__bar',
  '.progress__stage',
  '.meters',
  '.meter',
  '.peaklive',
  '.peaklive-wrap',
  '.analysis',
  '.result-media',
  '.ab',
  '.ab__toggle',
  '.listen-room',
  '.filecard',
  '.sliders',
  '.ctl',
  'a',
  'button',
  'canvas',
  'input',
  'select',
  'textarea',
  'label',
  '.genre',
  '.room-btn',
  '.ab__btn',
  '.dropzone',
  '.btn',
  '#playBtn',
  '#waveCanvas',
  '#spectrumCanvas',
  '#scrubFill',
  '#progressBar',
  '[role="button"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="group"]',
].join(', ');

export function initCursor() {
  const root = document.getElementById('cursor');
  const inner = document.getElementById('cursorInner');
  const glide = document.getElementById('cursorGlide');
  if (!root || !inner) return;

  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) {
    document.body.classList.add('is-touch');
    return;
  }

  const ttl = parseFloat(root.getAttribute('data-ttl') || '0.18') * 1000;
  const mouse = { x: -999, y: -999 };
  const pos = { x: -999, y: -999 };
  let columns = 16;
  let cellSize = 0;
  let cells = [];
  let cachedIndex = -1;
  let raf = 0;
  let running = false;
  let muted = false;
  let resizeTimer = 0;
  let layoutPending = false;
  const fadeTimers = new WeakMap();

  const isSkipTarget = (node) => Boolean(node?.closest?.(SKIP_SELECTOR));

  const clearLit = () => {
    for (const el of cells) {
      if (el.classList.contains('is-lit')) el.classList.remove('is-lit');
      const t = fadeTimers.get(el);
      if (t) {
        clearTimeout(t);
        fadeTimers.delete(el);
      }
    }
    cachedIndex = -1;
  };

  const setMuted = (next) => {
    if (muted === next) return;
    muted = next;
    root.classList.toggle('is-muted', muted);
    if (muted) clearLit();
  };

  const layout = () => {
    layoutPending = false;
    const w = window.innerWidth;
    columns = w < 900 ? 12 : w < 1200 ? 14 : 16;
    cellSize = w / columns;
    const rows = Math.ceil(window.innerHeight / cellSize) + 1;
    const total = rows * columns;
    root.style.setProperty('--columns', String(columns));
    root.style.setProperty('--size', `${cellSize}px`);

    if (cells.length === total) return;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const box = document.createElement('div');
      box.className = 'cursor__inner-box';
      frag.appendChild(box);
    }
    inner.innerHTML = '';
    inner.appendChild(frag);
    cells = inner.children;
    cachedIndex = -1;
  };

  const scheduleLayout = () => {
    if (layoutPending) return;
    layoutPending = true;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 140);
  };

  const cellAt = (x, y) => {
    if (cellSize <= 0) return null;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    const idx = row * columns + col;
    if (idx < 0 || idx >= cells.length) return null;
    return { el: cells[idx], idx };
  };

  const paint = (el) => {
    if (!el || muted) return;
    el.classList.add('is-lit');
    const prev = fadeTimers.get(el);
    if (prev) clearTimeout(prev);
    fadeTimers.set(
      el,
      setTimeout(() => {
        el.classList.remove('is-lit');
        fadeTimers.delete(el);
      }, ttl)
    );
  };

  const kickGlide = () => {
    if (running || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onMove = (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    root.classList.add('is-on');
    glide?.classList.add('is-on');
    kickGlide();

    let overSkip = isSkipTarget(e.target);
    if (!overSkip) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      overSkip = isSkipTarget(under);
    }

    setMuted(overSkip);
    glide?.classList.toggle('is-hover', overSkip);

    if (overSkip) return;

    const hit = cellAt(e.clientX, e.clientY);
    if (!hit || hit.idx === cachedIndex) return;
    cachedIndex = hit.idx;
    paint(hit.el);
  };

  const tick = () => {
    if (document.hidden) {
      running = false;
      raf = 0;
      return;
    }

    pos.x = lerp(pos.x, mouse.x, 0.22);
    pos.y = lerp(pos.y, mouse.y, 0.22);
    if (glide) {
      glide.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    }

    const dx = Math.abs(pos.x - mouse.x);
    const dy = Math.abs(pos.y - mouse.y);
    if (dx < 0.15 && dy < 0.15) {
      running = false;
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  layout();
  window.addEventListener('resize', scheduleLayout, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', () => glide?.classList.add('is-down'));
  window.addEventListener('pointerup', () => glide?.classList.remove('is-down'));
  window.addEventListener('mouseleave', () => {
    root.classList.remove('is-on');
    glide?.classList.remove('is-on');
    clearLit();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearLit();
      if (raf) cancelAnimationFrame(raf);
      running = false;
      raf = 0;
    }
  });

  // Hold-to-skim marquee (hero only)
  const marquee = document.querySelector('.hero__marquee-track');
  if (marquee) {
    const hero = document.querySelector('.hero');
    hero?.addEventListener('pointerdown', () => {
      marquee.style.animationDuration = '8s';
    });
    window.addEventListener('pointerup', () => {
      marquee.style.animationDuration = '';
    });
  }

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', scheduleLayout);
    window.removeEventListener('pointermove', onMove);
  };
}

export function initReveals() {
  const nodes = document.querySelectorAll('.reveal');
  if (!nodes.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodes.forEach((n) => n.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        if (el.classList.contains('band')) {
          el.querySelectorAll('[data-expand]').forEach((child, i) => {
            child.style.setProperty('--expand-delay', `${90 + i * 90}ms`);
          });
        }
        // next frame so delays apply before transition starts
        requestAnimationFrame(() => {
          el.classList.add('is-in');
          if (el.classList.contains('band')) {
            el.querySelectorAll('[data-expand]').forEach((child) => {
              child.classList.add('is-in');
            });
          }
        });
        io.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.14 }
  );
  nodes.forEach((n) => io.observe(n));
}
