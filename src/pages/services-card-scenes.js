// Services cards: thin wrapper that attaches the shared service scenes (service-scenes.js, the same as About) to the 4 art zones of the card row:
// ONE WebGL renderer (il-scene.js engine) + a 2D canvas per slot. Colours = local --il-* tokens on .svc-card__art (services.css). No WebGL -> returns null.
// Customer decision 2026-11-13: NO floor dot field on these cards, only the objects. The floor is the Points object that uses the floor dot material; it is removed here
// (the shared scenes stay untouched; Home Quality and Products keep their floor). Without the floor as an anchor each object is centred by its own bbox and scaled to a similar visible weight.
import { createIlScene, isoCamera } from '../utils/il-scene.js';
import { serviceScenes, serviceBeforeRender, SERVICE_PERIOD, SERVICE_SHRINK } from './service-scenes.js';

// iso view fitted by the slot WIDTH (not min side): the visible size of every object = the same share of the art-zone width on every breakpoint
const camera = isoCamera({ fill: 1.45, spanW: 400, spanH: 262 });
camera.fit = (c, it) => { const u = 1.45 * it.W / it.d / 400; const hw = it.W / it.d / (2 * u), hh = it.H / it.d / (2 * u); c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh; c.updateProjectionMatrix(); };
// per scene: uniform scale k (largest side of the object bbox = ~40% of the zone width, equal on all four) and world-y shift dy (centres the bbox in the zone); measured with an alpha-bbox
const FIT = { search: { k: 0.84, dy: -16 }, documents: { k: 0.49, dy: 3 }, samples: { k: 1.1, dy: -21 }, specs: { k: 0.58, dy: 5 } };

const noFloor = (key, factory) => (K, slot) => {
  const s = factory(K, slot);
  s.root.children.filter((o) => o.isPoints && o.material === K.dot.floor).forEach((o) => s.root.remove(o));
  const wrap = new K.Group(), f = FIT[key];
  wrap.scale.setScalar(f.k); wrap.position.y = f.dy; wrap.add(s.root);
  return { ...s, root: wrap };
};
const scenes = Object.fromEntries(Object.entries(serviceScenes).map(([k, f]) => [k, noFloor(k, f)]));

export function initServicesCardScenes(root) {
  const slots = [...root.querySelectorAll('.svc-card__art[data-scene]')].map((el) => ({ el, scene: el.dataset.scene }));
  if (!slots.length) return null;
  return createIlScene({
    host: slots[0].el, slots, scenes, canvasClass: 'svc-card__canvas', period: SERVICE_PERIOD, shrink: SERVICE_SHRINK,
    camera, beforeRender: serviceBeforeRender,
  });
}
