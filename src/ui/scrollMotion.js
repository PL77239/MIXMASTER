/**
 * pxpush-style scroll motion — native document flow (always scrollable
 * both ways). Sections shove previous content up by normal scrolling.
 * Effects: expand-on-enter, clip reveal, soft hero leave.
 * Marquees keep their constant CSS glide (no enter fade / no scroll drift).
 */

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/** Expand targets inside a section — never marquees (headers glide only). */
function expandables(root) {
  return [...root.querySelectorAll('[data-expand]')].filter(
    (n) => !n.classList.contains('band__marquee') && !n.closest('.band__marquee')
  );
}

export function initScrollMotion() {
  const bands = [...document.querySelectorAll('.band.reveal, .desk-top')];

  document.documentElement.classList.add('has-scroll-motion');

  // Hero content visible immediately
  document.querySelectorAll('.desk-top [data-expand], .hero [data-expand]').forEach((n) => {
    n.classList.add('is-in');
  });
  document.querySelector('.desk-top')?.classList.add('is-in');

  if (reduceMotion()) {
    document.querySelectorAll('.reveal, [data-expand]').forEach((n) => n.classList.add('is-in'));
    return () => document.documentElement.classList.remove('has-scroll-motion');
  }

  const seen = new WeakSet();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || seen.has(e.target)) continue;
        seen.add(e.target);
        const el = e.target;
        expandables(el).forEach((child, i) => {
          child.style.setProperty('--expand-delay', `${90 + i * 85}ms`);
        });
        requestAnimationFrame(() => {
          el.classList.add('is-in');
          expandables(el).forEach((child) => {
            child.classList.add('is-in');
          });
        });
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  );
  bands.forEach((b) => io.observe(b));

  // Soft parallax on leaving hero (opacity only — no layout-breaking scale)
  const hero = document.querySelector('.desk-top');
  let raf = 0;

  function tick() {
    raf = 0;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const leave = clamp(-r.top / Math.max(r.height * 0.65, 1), 0, 1);
    hero.style.setProperty('--hero-leave', leave.toFixed(3));
  }

  function onScroll() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  tick();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    io.disconnect();
    if (raf) cancelAnimationFrame(raf);
    document.documentElement.classList.remove('has-scroll-motion');
  };
}

export function scrollGoHome() {
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

export function scrollGoTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
}

export const initScrollStack = initScrollMotion;
export const refreshScrollStack = () => {};
export const scrollStackGoHome = scrollGoHome;
export const scrollStackGoTo = scrollGoTo;
