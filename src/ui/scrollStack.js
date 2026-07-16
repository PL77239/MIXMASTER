/**
 * Almost-static scroll stack: the viewport stays put while sections
 * shove the previous panel upward and slide the next into place.
 */

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function initScrollStack() {
  const root = document.getElementById('scrollStack');
  const stage = document.getElementById('scrollStage');
  const spacer = document.getElementById('scrollSpacer');
  if (!root || !stage || !spacer) return () => {};

  document.documentElement.classList.add('has-scroll-stack');

  let raf = 0;
  let panelCount = 0;

  const panels = () =>
    [...stage.querySelectorAll('[data-stack-panel]')].filter(
      (p) => !p.classList.contains('hidden')
    );

  function layout() {
    const list = panels();
    panelCount = Math.max(1, list.length);
    // One viewport of scroll travel per transition between panels
    const vh = window.innerHeight || 1;
    spacer.style.height = `${panelCount * 100}vh`;
    list.forEach((p, i) => {
      p.style.zIndex = String(20 + i);
      p.setAttribute('data-stack-index', String(i));
    });
    // Ensure inactive absolute panels don't steal focus scroll oddly
    void vh;
    tick();
  }

  function activateExpands(panel) {
    if (!panel) return;
    panel.classList.add('is-in');
    panel.querySelectorAll('[data-expand]').forEach((child, i) => {
      child.style.setProperty('--expand-delay', `${60 + i * 70}ms`);
      requestAnimationFrame(() => child.classList.add('is-in'));
    });
  }

  function tick() {
    raf = 0;
    const list = panels();
    if (!list.length) return;

    const vh = window.innerHeight || 1;
    const maxScroll = Math.max(1, (list.length - 1) * vh);
    const y = clamp(window.scrollY || window.pageYOffset || 0, 0, maxScroll + vh);
    // Progress in “panel units”
    const raw = reduceMotion()
      ? Math.round(clamp(y / vh, 0, list.length - 1))
      : clamp(y / vh, 0, list.length - 1);

    let active = 0;
    list.forEach((panel, i) => {
      const yPct = (i - raw) * 100;
      panel.style.transform = `translate3d(0, ${yPct}%, 0)`;
      panel.classList.toggle('is-stack-active', Math.abs(i - raw) < 0.55);
      panel.classList.toggle('is-stack-leaving', raw > i && raw < i + 1);
      if (Math.abs(i - raw) < 0.55) active = i;
    });

    activateExpands(list[active]);
    // Warm-expand the next panel slightly early
    if (list[active + 1] && raw > active + 0.35) activateExpands(list[active + 1]);

    root.dataset.activePanel = String(active);
    document.documentElement.dataset.activePanel = String(active);
  }

  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }

  function goHome() {
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function goToPanel(idOrEl) {
    const list = panels();
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    const idx = list.indexOf(el);
    if (idx < 0) return;
    const top = idx * (window.innerHeight || 1);
    window.scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function refresh() {
    layout();
  }

  // Intercept in-page anchors to stack panels (#dropCard etc.)
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href')?.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target || !target.hasAttribute('data-stack-panel')) return;
    e.preventDefault();
    goToPanel(target);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', layout);

  layout();
  // Hero content visible immediately
  activateExpands(panels()[0]);

  const api = { refresh, goHome, goToPanel, layout };
  window.__scrollStack = api;
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', layout);
    document.documentElement.classList.remove('has-scroll-stack');
    if (raf) cancelAnimationFrame(raf);
    delete window.__scrollStack;
  };
}

export function refreshScrollStack() {
  window.__scrollStack?.refresh?.();
}

export function scrollStackGoHome() {
  window.__scrollStack?.goHome?.() || window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function scrollStackGoTo(id) {
  window.__scrollStack?.goToPanel?.(id);
}
