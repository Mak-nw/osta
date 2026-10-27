// How we work split (Services, Home Services): the step nearest the viewport centre is bright (.is-current), the others are dimmed.
// One rAF per scroll/resize; prefers-reduced-motion keeps all steps bright via CSS, the class toggling is harmless there.
export function initHowSplit() {
  const steps = [...document.querySelectorAll('.how-step')];
  if (!steps.length) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const mid = window.innerHeight / 2;
    let best = 0, dist = Infinity;
    steps.forEach((s, i) => { const r = s.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < dist) { dist = d; best = i; } });
    steps.forEach((s, i) => s.classList.toggle('is-current', i === best));
  };
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  document.fonts?.ready.then(request);
  update();
}
