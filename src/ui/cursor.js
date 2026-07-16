/**
 * Soft-follow cursor (pxpush-inspired glide).
 * Lerps a ring toward the pointer; expands on interactive hover.
 */

const lerp = (a, b, t) => a + (b - a) * t;

export function initCursor() {
  const root = document.getElementById('cursor');
  if (!root) return;

  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) {
    document.body.classList.add('is-touch');
    return;
  }

  const ring = root.querySelector('.cursor__ring');
  const mouse = { x: -100, y: -100 };
  const pos = { x: -100, y: -100 };
  let hovering = false;
  let down = false;
  let raf = 0;

  const onMove = (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    root.classList.add('is-on');
  };

  const tick = () => {
    // Ring glides; slightly slower than the pointer for organic lag
    pos.x = lerp(pos.x, mouse.x, 0.18);
    pos.y = lerp(pos.y, mouse.y, 0.18);
    root.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    raf = requestAnimationFrame(tick);
  };

  const isInteractive = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    return Boolean(
      el.closest(
        'a, button, .hover_effect, .genre, .room-btn, .ab__btn, .dropzone, .scrub, input, select, label, [role="button"], [role="tab"]'
      )
    );
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('mousemove', onMove, { passive: true });

  document.addEventListener(
    'pointerover',
    (e) => {
      hovering = isInteractive(e.target);
      root.classList.toggle('is-hover', hovering);
    },
    { passive: true }
  );

  window.addEventListener('pointerdown', () => {
    down = true;
    root.classList.add('is-down');
  });
  window.addEventListener('pointerup', () => {
    down = false;
    root.classList.remove('is-down');
  });
  window.addEventListener('mouseleave', () => root.classList.remove('is-on'));

  // Subtle magnetic nudge toward button centers
  document.querySelectorAll('.btn--primary, .brand, .hero__brand').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      mouse.x = lerp(e.clientX, cx, 0.12);
      mouse.y = lerp(e.clientY, cy, 0.12);
    });
  });

  raf = requestAnimationFrame(tick);

  // Hold-to-skim: accelerate marquee while primary button held on hero
  const marquee = document.querySelector('.hero__marquee-track');
  if (marquee) {
    let holding = false;
    const onHold = () => {
      holding = true;
      marquee.style.animationDuration = '8s';
    };
    const onRelease = () => {
      holding = false;
      marquee.style.animationDuration = '';
    };
    document.querySelector('.hero')?.addEventListener('pointerdown', onHold);
    window.addEventListener('pointerup', onRelease);
  }

  return () => cancelAnimationFrame(raf);
}

/** IntersectionObserver reveals for section entrances */
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
