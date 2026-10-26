import { HIGHWAY_FACTORS } from './graph.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export function buildQuery([s, w, n, e]) {
  const types = Object.keys(HIGHWAY_FACTORS).join('|');
  return `[out:json][timeout:90];
way["highway"~"^(${types})$"](${s},${w},${n},${e});
out body;
>;
out skel qt;`;
}

// Descarga los caminos del bbox [sur, oeste, norte, este].
export async function fetchPaths(bbox, signal) {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  let lastError;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal });
      if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
      const json = await res.json();
      return json.elements;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
