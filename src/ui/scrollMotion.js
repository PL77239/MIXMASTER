/**
 * pxpush-style scroll motion — native document flow (always scrollable
 * both ways). Sections shove previous content up by normal scrolling.
 * Effects: expand-on-enter / collapse-on-leave (works scrolling down and up).
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

function setExpandState(el, on) {
  const kids = expandables(el);
  if (on) {
    kids.forEach((child, i) => {
      child.style.setProperty('--expand-delay', `${90 + i * 85}ms`);
    });
  } else {
    // Reverse path: collapse together, no stagger
    kids.forEach((child) => {
      child.style.setProperty('--expand-delay', '0ms');
    });
  }
  requestAnimationFrame(() => {
    el.classList.toggle('is-in', on);
    kids.forEach((child) => child.classList.toggle('is-in', on));
  });
}

export function initScrollMotion() {
  const bands = [...document.querySelectorAll('.band.reveal')];
  const hero = document.querySelector('.desk-top');

  document.documentElement.classList.add('has-scroll-motion');

  // Hero content always visible
  document.querySelectorAll('.desk-top [data-expand], .hero [data-expand]').forEach((n) => {
    n.classList.add('is-in');
  });
  hero?.classList.add('is-in');

  if (reduceMotion()) {
    document.querySelectorAll('.reveal, [data-expand]').forEach((n) => n.classList.add('is-in'));
    return () => document.documentElement.classList.remove('has-scroll-motion');
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target;
        // Skip hero — it stays open
        if (el.classList.contains('desk-top')) continue;
        setExpandState(el, e.isIntersecting && e.intersectionRatio > 0.06);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: [0, 0.08, 0.16, 0.28] }
  );
  bands.forEach((b) => io.observe(b));

  // Soft parallax on leaving hero (opacity only — no layout-breaking scale)
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
