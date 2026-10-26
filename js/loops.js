import { destination } from './geo.js';
import { aStar, components, SpatialIndex } from './routing.js';

const REUSE_PENALTY = 4;

// Nodo de inicio: el más cercano al punto pedido dentro de una red
// suficientemente grande (evita quedarse en un tramo aislado).
export function snapStart(g, lat, lon) {
  const { comp, sizes } = components(g);
  const largest = Math.max(0, ...sizes);
  const index = new SpatialIndex(g, (i) => sizes[comp[i]] >= largest * 0.2);
  return index.nearest(lat, lon);
}

function summarize(g, steps) {
  let length = 0;
  let unpaved = 0;
  const uses = new Map();
  const coords = [];
  for (const { edge, forward } of steps) {
    const e = g.edges[edge];
    length += e.len;
    if (e.unpaved) unpaved += e.len;
    uses.set(edge, (uses.get(edge) || 0) + 1);
    const geom = forward ? e.geom : [...e.geom].reverse();
    coords.push(...(coords.length ? geom.slice(1) : geom));
  }
  let repeated = 0;
  for (const [edge, n] of uses) repeated += g.edges[edge].len * (n - 1);
  return {
    coords,
    length,
    unpavedFraction: length ? unpaved / length : 0,
    overlap: length ? repeated / length : 0,
    edgeSet: new Set(uses.keys()),
  };
}

// Recorre start -> waypoints -> start penalizando lo ya andado.
function buildLoop(g, index, mult, start, heading, points, radius) {
  const center = destination(g.lat[start], g.lon[start], heading, radius);
  const seq = [start];
  for (let i = 1; i < points; i++) {
    const [la, lo] = destination(center[0], center[1], heading + 180 + (i * 360) / points, radius);
    const node = index.nearest(la, lo);
    if (node >= 0 && node !== seq[seq.length - 1]) seq.push(node);
  }
  seq.push(start);
  if (seq.length < 4) return null;

  mult.fill(1);
  const steps = [];
  for (let i = 0; i + 1 < seq.length; i++) {
    const leg = aStar(g, seq[i], seq[i + 1], mult);
    if (!leg) return null;
    for (const step of leg) {
      mult[step.edge] *= REUSE_PENALTY;
      const top = steps[steps.length - 1];
      // Ida y vuelta por la misma arista (punto de paso en un ramal): se recorta.
      if (top && top.edge === step.edge && top.forward !== step.forward) steps.pop();
      else steps.push(step);
    }
  }
  return steps.length ? summarize(g, steps) : null;
}

function score(route, target) {
  return (
    Math.abs(route.length / target - 1) * 2 +
    route.overlap * 2.5 +
    (1 - route.unpavedFraction) * 0.6
  );
}

function similarity(a, b) {
  let shared = 0;
  for (const e of a) if (b.has(e)) shared++;
  return shared / (a.size + b.size - shared);
}

// Propone hasta `count` rutas circulares distintas de unos `target` metros.
export function generateLoops(g, start, target, { count = 4, directions = 12 } = {}) {
  const { comp } = components(g);
  const index = new SpatialIndex(g, (i) => comp[i] === comp[start]);
  const mult = new Float64Array(g.edges.length);
  const candidates = [];

  for (let d = 0; d < directions; d++) {
    const heading = (d * 360) / directions;
    for (const points of [3, 4, 5]) {
      let k = 0.7;
      let best = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const route = buildLoop(g, index, mult, start, heading, points, (target * k) / (2 * Math.PI));
        if (!route) break;
        const ratio = route.length / target;
        if (!best || Math.abs(ratio - 1) < Math.abs(best.length / target - 1)) best = route;
        if (Math.abs(ratio - 1) < 0.08) break;
        k = Math.min(3, Math.max(0.1, k / ratio));
      }
      if (best) {
        best.score = score(best, target);
        best.heading = heading;
        candidates.push(best);
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const chosen = [];
  for (const c of candidates) {
    if (Math.abs(c.length / target - 1) > 0.5) continue;
    if (chosen.some((o) => similarity(o.edgeSet, c.edgeSet) > 0.5)) continue;
    chosen.push(c);
    if (chosen.length === count) break;
  }
  return chosen.map(({ edgeSet, ...rest }) => rest);
}
