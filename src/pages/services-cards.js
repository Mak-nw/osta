// Service cards (.svc-cards, Services + About): lazy start of the shared 3D scenes (services-card-scenes.js) once the row is within ~1 screen; no WebGL = empty art zone.
const row = document.querySelector('.svc-cards');
if (row) {
  let loading = null;
  const load = () => (loading ||= import('./services-card-scenes.js').then((m) => m.initServicesCardScenes(row)).catch(() => null));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '100% 0px' });
    io.observe(row);
  } else load();
}
