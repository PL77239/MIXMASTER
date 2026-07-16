/**
 * Almost-static scroll stack: sticky viewport; scrolling shoves the
 * previous panel up and slides the next into place.
 *
 * Structure: #scrollStack gets height = N * 100vh; #scrollStage is
 * position:sticky inside it (NOT a spacer sibling ahead of the stage —
 * that left the viewport blank).
 */

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function initScrollStack() {
  const root = document.getElementById('scrollStack');
  const stage = document.getElementById('scrollStage');
  if (!root || !stage) return () => {};

  // Remove legacy spacer if present
  document.getElementById('scrollSpacer')?.remove();

  document.documentElement.classList.add('has-scroll-stack');

  let raf = 0;

  const panels = () =>
    [...stage.querySelectorAll('[data-stack-panel]')].filter(
      (p) => !p.classList.contains('hidden')
    );

  function activateExpands(panel) {
    if (!panel) return;
    panel.classList.add('is-in');
    panel.querySelectorAll('[data-expand]').forEach((child, i) => {
      child.style.setProperty('--expand-delay', `${40 + i * 60}ms`);
      child.classList.add('is-in');
    });
  }

  function tick() {
    raf = 0;
    const list = panels();
    if (!list.length) return;

    const vh = window.innerHeight || 1;
    const maxIdx = Math.max(0, list.length - 1);
    const y = clamp(window.scrollY || window.pageYOffset || 0, 0, maxIdx * vh + 1);
    const raw = reduceMotion()
      ? Math.round(clamp(y / vh, 0, maxIdx))
      : clamp(y / vh, 0, maxIdx);

    let active = 0;
    list.forEach((panel, i) => {
      const yPct = (i - raw) * 100;
      panel.style.transform = `translate3d(0, ${yPct}%, 0)`;
      panel.style.zIndex = String(10 + i);
      const near = Math.abs(i - raw) < 0.6;
      panel.classList.toggle('is-stack-active', near);
      panel.style.pointerEvents = near ? 'auto' : 'none';
      panel.setAttribute('aria-hidden', near ? 'false' : 'true');
      if (near) active = i;
    });

    activateExpands(list[active]);
    if (list[active + 1] && raw > active + 0.25) activateExpands(list[active + 1]);

    root.dataset.activePanel = String(active);
    document.documentElement.dataset.activePanel = String(active);
  }

  function layout() {
    const list = panels();
    const n = Math.max(1, list.length);
    // Sticky stage is 100vh; parent must be n * 100vh so scroll spans 0 → n-1
    root.style.height = `${n * 100}vh`;
    list.forEach((p, i) => p.setAttribute('data-stack-index', String(i)));
    tick();
  }

  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }

  function goHome() {
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    requestAnimationFrame(tick);
  }

  function goToPanel(idOrEl) {
    const list = panels();
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    const idx = list.indexOf(el);
    if (idx < 0) return;
    window.scrollTo({
      top: idx * (window.innerHeight || 1),
      behavior: reduceMotion() ? 'auto' : 'smooth',
    });
  }

  function refresh() {
    layout();
  }

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

  // First paint: show home immediately (before any scroll)
  const first = panels()[0];
  if (first) {
    first.style.transform = 'translate3d(0, 0%, 0)';
    first.style.pointerEvents = 'auto';
    first.classList.add('is-stack-active');
    activateExpands(first);
  }
  layout();

  const api = { refresh, goHome, goToPanel, layout };
  window.__scrollStack = api;
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', layout);
    document.documentElement.classList.remove('has-scroll-stack');
    root.style.height = '';
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
