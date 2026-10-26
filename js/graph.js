import { haversine } from './geo.js';

// Coste relativo por tipo de vía: cuanto más bajo, más "de campo".
export const HIGHWAY_FACTORS = {
  track: 1,
  path: 1,
  bridleway: 1,
  footway: 1.15,
  cycleway: 1.25,
  steps: 2,
  unclassified: 1.7,
  service: 1.9,
  residential: 2.6,
  living_street: 2.6,
  tertiary: 3.5,
  secondary: 6,
};

const NATURAL = new Set(['track', 'path', 'bridleway', 'footway']);
const UNPAVED = new Set([
  'unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'grass', 'compacted',
  'sand', 'mud', 'pebblestone', 'rock', 'woodchips', 'grass_paver',
]);
const PAVED = new Set([
  'paved', 'asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett', 'cobblestone',
]);

export function isWalkable(tags) {
  if (!(tags.highway in HIGHWAY_FACTORS)) return false;
  if (tags.foot === 'no' || tags.area === 'yes') return false;
  const footAllowed = ['yes', 'designated', 'permissive'].includes(tags.foot);
  if (!footAllowed && (tags.access === 'private' || tags.access === 'no')) return false;
  return true;
}

export function isUnpaved(tags) {
  if (UNPAVED.has(tags.surface)) return true;
  if (PAVED.has(tags.surface)) return false;
  if (tags.tracktype === 'grade1') return false;
  return NATURAL.has(tags.highway);
}

export function edgeFactor(tags, unpaved) {
  let f = HIGHWAY_FACTORS[tags.highway];
  if (unpaved) f *= 0.9;
  else if (NATURAL.has(tags.highway)) f *= 1.2;
  if (/alpine|demanding/.test(tags.sac_scale || '')) f *= 3;
  return f;
}

// Construye un grafo compacto a partir de la respuesta de Overpass: solo los
// cruces y extremos son nodos; cada arista guarda la geometría intermedia.
export function buildGraph(elements) {
  const coords = new Map();
  const ways = [];
  for (const el of elements) {
    if (el.type === 'node') coords.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.tags && isWalkable(el.tags)) ways.push(el);
  }

  const usage = new Map();
  for (const w of ways) {
    w.nodes.forEach((id, i) => {
      const inc = i === 0 || i === w.nodes.length - 1 ? 2 : 1;
      usage.set(id, (usage.get(id) || 0) + inc);
    });
  }

  const index = new Map();
  const lat = [];
  const lon = [];
  const nodeIndex = (id) => {
    let i = index.get(id);
    if (i === undefined) {
      i = lat.length;
      index.set(id, i);
      const [la, lo] = coords.get(id);
      lat.push(la);
      lon.push(lo);
    }
    return i;
  };

  const edges = [];
  let minFactor = Infinity;
  for (const w of ways) {
    if (!w.nodes.every((id) => coords.has(id))) continue;
    const unpaved = isUnpaved(w.tags);
    const factor = edgeFactor(w.tags, unpaved);
    let start = w.nodes[0];
    let geom = [coords.get(start)];
    let len = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const id = w.nodes[i];
      const c = coords.get(id);
      const p = geom[geom.length - 1];
      len += haversine(p[0], p[1], c[0], c[1]);
      geom.push(c);
      if (usage.get(id) >= 2) {
        const a = nodeIndex(start);
        const b = nodeIndex(id);
        if (a !== b && len > 0) {
          edges.push({ a, b, len, cost: len * factor, geom, unpaved, highway: w.tags.highway });
          minFactor = Math.min(minFactor, factor);
        }
        start = id;
        geom = [c];
        len = 0;
      }
    }
  }

  const adj = Array.from({ length: lat.length }, () => []);
  edges.forEach((e, i) => {
    adj[e.a].push(i);
    adj[e.b].push(i);
  });

  return {
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    edges,
    adj,
    minFactor: Number.isFinite(minFactor) ? minFactor : 1,
  };
}
