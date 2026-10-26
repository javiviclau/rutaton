import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, isWalkable, isUnpaved } from '../js/graph.js';
import { aStar } from '../js/routing.js';
import { generateLoops, snapStart } from '../js/loops.js';
import { haversine } from '../js/geo.js';
import { toGPX } from '../js/gpx.js';

// Red de caminos en rejilla con algunas carreteras y algún tramo privado.
function gridElements(size = 40, step = 0.002, origin = [40, -3]) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const elements = [];
  const id = (r, c) => r * size + c + 1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      elements.push({
        type: 'node',
        id: id(r, c),
        lat: origin[0] + r * step + (rand() - 0.5) * step * 0.3,
        lon: origin[1] + c * step + (rand() - 0.5) * step * 0.3,
      });
    }
  }
  let wayId = 1;
  for (let r = 0; r < size; r++) {
    const highway = r % 10 === 0 ? 'tertiary' : 'track';
    elements.push({ type: 'way', id: wayId++, nodes: Array.from({ length: size }, (_, c) => id(r, c)), tags: { highway } });
  }
  for (let c = 0; c < size; c++) {
    const tags = c === 5 ? { highway: 'track', access: 'private' } : { highway: 'path' };
    elements.push({ type: 'way', id: wayId++, nodes: Array.from({ length: size }, (_, r) => id(r, c)), tags });
  }
  return elements;
}

test('filtra vías no transitables y detecta firme', () => {
  assert.equal(isWalkable({ highway: 'motorway' }), false);
  assert.equal(isWalkable({ highway: 'track', access: 'private' }), false);
  assert.equal(isWalkable({ highway: 'track', access: 'private', foot: 'yes' }), true);
  assert.equal(isUnpaved({ highway: 'track' }), true);
  assert.equal(isUnpaved({ highway: 'track', tracktype: 'grade1' }), false);
  assert.equal(isUnpaved({ highway: 'residential', surface: 'gravel' }), true);
});

test('el grafo solo tiene cruces como nodos', () => {
  const g = buildGraph(gridElements(5));
  // Rejilla 5x5 sin la columna privada: todos los nodos son cruces o extremos.
  assert.equal(g.lat.length, 25);
  assert.ok(g.edges.every((e) => e.len > 0 && e.geom.length >= 2));
});

test('A* encuentra el camino y respeta la geometría', () => {
  const g = buildGraph(gridElements(10));
  const mult = new Float64Array(g.edges.length).fill(1);
  const path = aStar(g, 0, g.lat.length - 1, mult);
  assert.ok(path && path.length > 0);
});

test('genera rutas circulares cerradas cerca de la distancia pedida', () => {
  const g = buildGraph(gridElements());
  const start = snapStart(g, 40.04, -2.96);
  assert.ok(start >= 0);
  const target = 8000;
  const routes = generateLoops(g, start, target, { count: 4 });
  assert.ok(routes.length >= 3, `solo ${routes.length} rutas`);
  for (const r of routes) {
    const first = r.coords[0];
    const last = r.coords[r.coords.length - 1];
    assert.ok(haversine(first[0], first[1], last[0], last[1]) < 1, 'la ruta debe cerrarse');
    assert.ok(Math.abs(r.length / target - 1) < 0.25, `longitud ${r.length}`);
    assert.ok(r.overlap < 0.2, `solapamiento ${r.overlap}`);
    assert.ok(r.unpavedFraction > 0.6, `sin asfaltar ${r.unpavedFraction}`);
  }
});

test('exporta GPX válido', () => {
  const gpx = toGPX('Ruta <1>', [[40, -3], [40.001, -3.001]]);
  assert.match(gpx, /<name>Ruta &lt;1&gt;<\/name>/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
});
