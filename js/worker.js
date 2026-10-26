import { buildGraph } from './graph.js';
import { generateLoops, snapStart } from './loops.js';

let graph = null;

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'load') {
      graph = buildGraph(data.elements);
      self.postMessage({ id: data.id, type: 'loaded', nodes: graph.lat.length, edges: graph.edges.length });
    } else if (data.type === 'routes') {
      if (!graph || !graph.edges.length) throw new Error('No hay caminos cargados en el área.');
      const start = snapStart(graph, data.start[0], data.start[1]);
      if (start < 0) throw new Error('No se encontró ningún camino cerca del punto de inicio.');
      const routes = generateLoops(graph, start, data.target, { count: data.count });
      self.postMessage({ id: data.id, type: 'routes', start: [graph.lat[start], graph.lon[start]], routes });
    }
  } catch (err) {
    self.postMessage({ id: data.id, type: 'error', message: err.message });
  }
};
