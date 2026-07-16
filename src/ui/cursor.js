/**
 * PX Push–style tile cursor field.
 * Full-viewport grid; cells light under the pointer and fade (ttl).
 * Soft ring still glides as a secondary pointer.
 */

const lerp = (a, b, t) => a + (b - a) * t;

const SKIP_SELECTOR =
  '.cursor_disabled, .hover_effect, a, button, .genre, .room-btn, .ab__btn, .dropzone, .scrub, input, select, label, [role="button"], [role="tab"]';

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

  const ttl = parseFloat(root.getAttribute('data-ttl') || '0.22') * 1000;
  const mouse = { x: -999, y: -999 };
  const pos = { x: -999, y: -999 };
  let columns = 20;
  let cellSize = 0;
  let cells = [];
  let cachedIndex = -1;
  let raf = 0;
  const fadeTimers = new WeakMap();

  const layout = () => {
    const colsAttr = getComputedStyle(root).getPropertyValue('--columns').trim();
    columns = Math.max(8, parseInt(colsAttr, 10) || 20);
    cellSize = window.innerWidth / columns;
    const rows = Math.ceil(window.innerHeight / cellSize) + 1;
    const total = rows * columns;
    root.style.setProperty('--columns', String(columns));
    root.style.setProperty('--size', `${cellSize}px`);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const box = document.createElement('div');
      box.className = 'cursor__inner-box';
      frag.appendChild(box);
    }
    inner.innerHTML = '';
    inner.appendChild(frag);
    cells = [...inner.children];
    cachedIndex = -1;
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
    if (!el) return;
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

  const onMove = (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    root.classList.add('is-on');
    if (glide) glide.classList.add('is-on');

    if (e.target?.closest?.(SKIP_SELECTOR)) {
      cachedIndex = -1;
      return;
    }
    const hit = cellAt(e.clientX, e.clientY);
    if (!hit || hit.idx === cachedIndex) return;
    cachedIndex = hit.idx;
    paint(hit.el);
  };

  const tick = () => {
    pos.x = lerp(pos.x, mouse.x, 0.2);
    pos.y = lerp(pos.y, mouse.y, 0.2);
    if (glide) {
      glide.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    }
    raf = requestAnimationFrame(tick);
  };

  const onOver = (e) => {
    const hovering = Boolean(e.target?.closest?.(SKIP_SELECTOR));
    glide?.classList.toggle('is-hover', hovering);
  };

  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  window.addEventListener('pointerdown', () => glide?.classList.add('is-down'));
  window.addEventListener('pointerup', () => glide?.classList.remove('is-down'));
  window.addEventListener('mouseleave', () => {
    root.classList.remove('is-on');
    glide?.classList.remove('is-on');
  });

  // Magnetic nudge on primary controls
  document.querySelectorAll('.btn--primary, .brand, .hero__brand').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      mouse.x = lerp(e.clientX, r.left + r.width / 2, 0.1);
      mouse.y = lerp(e.clientY, r.top + r.height / 2, 0.1);
    });
  });

  raf = requestAnimationFrame(tick);

  // Hold-to-skim marquee
  const marquee = document.querySelector('.hero__marquee-track');
  if (marquee) {
    document.querySelector('.hero')?.addEventListener('pointerdown', () => {
      marquee.style.animationDuration = '8s';
    });
    window.addEventListener('pointerup', () => {
      marquee.style.animationDuration = '';
    });
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', layout);
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
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
  );
  nodes.forEach((n) => io.observe(n));
}
