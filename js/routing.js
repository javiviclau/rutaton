import { haversine } from './geo.js';

class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, val) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  pop() {
    const { keys, vals } = this;
    const top = vals[0];
    const lastKey = keys.pop();
    const lastVal = vals.pop();
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return top;
  }
}

const other = (edge, node) => (edge.a === node ? edge.b : edge.a);

// A* entre dos nodos. `mult` escala el coste de cada arista (>= 1) para
// penalizar tramos ya recorridos. Devuelve [{edge, forward}] o null.
export function aStar(g, src, dst, mult) {
  if (src === dst) return [];
  const n = g.lat.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const tLat = g.lat[dst];
  const tLon = g.lon[dst];
  const h = (i) => haversine(g.lat[i], g.lon[i], tLat, tLon) * g.minFactor;
  const heap = new MinHeap();
  dist[src] = 0;
  heap.push(h(src), src);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    if (u === dst) break;
    done[u] = 1;
    for (const e of g.adj[u]) {
      const edge = g.edges[e];
      const v = other(edge, u);
      if (done[v]) continue;
      const nd = dist[u] + edge.cost * mult[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        via[v] = e;
        heap.push(nd + h(v), v);
      }
    }
  }
  if (dist[dst] === Infinity) return null;
  const path = [];
  for (let cur = dst; cur !== src; ) {
    const e = via[cur];
    const from = other(g.edges[e], cur);
    path.push({ edge: e, forward: g.edges[e].a === from });
    cur = from;
  }
  return path.reverse();
}

// Etiqueta cada nodo con su componente conexa y devuelve los tamaños.
export function components(g) {
  const n = g.lat.length;
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const e of g.adj[u]) {
        const v = other(g.edges[e], u);
        if (comp[v] === -1) {
          comp[v] = id;
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }
  return { comp, sizes };
}

// Rejilla para buscar el nodo más cercano a un punto.
export class SpatialIndex {
  constructor(g, accept = () => true, cell = 0.005) {
    this.g = g;
    this.cell = cell;
    this.cells = new Map();
    for (let i = 0; i < g.lat.length; i++) {
      if (!accept(i)) continue;
      const key = this.key(Math.floor(g.lat[i] / cell), Math.floor(g.lon[i] / cell));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
  }
  key(y, x) {
    return `${y},${x}`;
  }
  nearest(lat, lon, maxRing = 200) {
    const cy = Math.floor(lat / this.cell);
    const cx = Math.floor(lon / this.cell);
    let best = -1;
    let bestD = Infinity;
    let foundAt = -1;
    for (let r = 0; r <= maxRing; r++) {
      if (foundAt >= 0 && r > foundAt + 1) break;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const list = this.cells.get(this.key(cy + dy, cx + dx));
          if (!list) continue;
          for (const i of list) {
            const d = haversine(lat, lon, this.g.lat[i], this.g.lon[i]);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && foundAt < 0) foundAt = r;
    }
    return best;
  }
}
