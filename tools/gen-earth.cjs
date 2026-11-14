/**
 * gen-earth.cjs — generator of src/data/earth-land.json (run by hand: `node tools/gen-earth.cjs`; NOT part of the build, the site only reads the JSON).
 * Source: Natural Earth 1:110m "Land" (ne_110m_land), PUBLIC DOMAIN (https://www.naturalearthdata.com/about/terms-of-use/),
 *         fetched from https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson (fallback: world-atlas@2 land-110m.json via jsDelivr, TopoJSON).
 * Method: N points evenly spread over the sphere (Fibonacci lattice); keep only those that fall on LAND (own even-odd point-in-polygon over every ring => holes / lakes handled),
 *         lat / lon rounded to 2 decimals, packed as little-endian Int16 pairs (lat*100, lon*100) in base64 => compact JSON, no runtime download.
 * Output: { v, n, src, d } ; decode: Int16 pairs [lat*100, lon*100]. Node >= 18 (global fetch), no dependencies.
 */
const fs = require('fs'), path = require('path');
const N = 28000;
const URLS = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson',
  'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json',
];

const topoToPolys = (t) => {   // minimal TopoJSON (arcs, delta-encoded, optional transform) -> [[ring,...],...] polygons
  const { scale = [1, 1], translate = [0, 0] } = t.transform || {};
  const arcs = t.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
  const ring = (idx) => { const out = []; idx.forEach((i) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; out.push(...(out.length ? a.slice(1) : a)); }); return out; };
  const polys = [];
  const geoms = Object.values(t.objects)[0].geometries || [Object.values(t.objects)[0]];
  geoms.forEach((g) => { if (g.type === 'Polygon') polys.push(g.arcs.map(ring)); else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => polys.push(p.map(ring))); });
  return polys;
};
const geoToPolys = (g) => {
  const polys = [];
  (g.features || [g]).forEach((f) => { const gm = f.geometry || f; if (gm.type === 'Polygon') polys.push(gm.coordinates); else if (gm.type === 'MultiPolygon') gm.coordinates.forEach((p) => polys.push(p)); });
  return polys;
};

(async () => {
  let polys = null, src = '';
  for (const u of URLS) {
    try { const r = await fetch(u); if (!r.ok) continue; const j = await r.json(); polys = j.type === 'Topology' ? topoToPolys(j) : geoToPolys(j); src = u; break; } catch (e) { /* next */ }
  }
  if (!polys) throw new Error('no land source reachable');
  const P = polys.map((rings) => {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    rings[0].forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    return { rings, x0, x1, y0, y1 };
  });
  const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const onLand = (lon, lat) => P.some((p) => lon >= p.x0 && lon <= p.x1 && lat >= p.y0 && lat <= p.y1 && p.rings.reduce((acc, r) => acc ^ inRing(lon, lat, r), 0) === 1);

  const GA = Math.PI * (3 - Math.sqrt(5)), out = [];
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * i + 1) / N, lat = Math.asin(z) * 180 / Math.PI;
    let lon = ((i * GA) * 180 / Math.PI) % 360; if (lon > 180) lon -= 360;
    lat === lat && onLand(lon, lat) && out.push(Math.round(lat * 100), Math.round(lon * 100));
  }
  const buf = Buffer.alloc(out.length * 2); out.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  const file = path.join(__dirname, '..', 'src', 'data', 'earth-land.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, n: out.length / 2, src: 'Natural Earth 110m land (public domain)', d: buf.toString('base64') }));
  console.log(`land points: ${out.length / 2} of ${N}; polygons: ${P.length}; source: ${src}; ${fs.statSync(file).size} bytes`);
})();
