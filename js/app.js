import { fetchPaths } from './overpass.js';
import { bboxAreaKm2 } from './geo.js';
import { downloadGPX } from './gpx.js';

const MAX_AREA_KM2 = 400;
const COLORS = ['#e4572e', '#2e6fd8', '#9b3fc4', '#e09f1f', '#16a39a'];
const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 1) => n.toLocaleString('es', { maximumFractionDigits: digits });

// --- Mapa ---------------------------------------------------------------

const map = L.map('map').setView([40.4, -3.7], 6);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: 'Mapa &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), datos &copy; OpenStreetMap',
});
L.control.layers({ OpenStreetMap: osm, Topográfico: topo }).addTo(map);

// --- Worker de cálculo ----------------------------------------------------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 1;
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  if (data.type === 'error') p.reject(new Error(data.message));
  else p.resolve(data);
};
worker.onerror = (e) => {
  for (const p of pending.values()) p.reject(new Error(e.message || 'Error en el cálculo de rutas.'));
  pending.clear();
};
const ask = (msg) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });

// --- Estado ---------------------------------------------------------------

let area = null;
let areaLoaded = false;
let loadController = null;
let busy = false;
let drawing = null;
let startMarker = null;
let routeLayers = [];

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
}

function updateButtons() {
  $('routes-btn').disabled = busy || !areaLoaded || !startMarker;
  $('draw-btn').disabled = busy;
  $('view-btn').disabled = busy;
}

// --- Área -----------------------------------------------------------------

function startDrawing() {
  cancelDrawing();
  drawing = { corner: null, preview: null };
  map.getContainer().classList.add('drawing');
  setStatus('Haz clic en una esquina del área.');
}

function cancelDrawing() {
  if (!drawing) return;
  drawing.preview?.remove();
  drawing = null;
  map.getContainer().classList.remove('drawing');
}

function setArea(bounds) {
  const bbox = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
  const km2 = bboxAreaKm2(bbox);
  if (km2 > MAX_AREA_KM2) {
    setStatus(`El área tiene ${fmt(km2, 0)} km² y el máximo es ${MAX_AREA_KM2} km². Acerca el mapa o dibuja una zona más pequeña.`, 'error');
    return;
  }
  if (km2 < 0.5) {
    setStatus('El área es demasiado pequeña. Dibuja una zona más grande.', 'error');
    return;
  }
  clearRoutes();
  area?.remove();
  area = L.rectangle(bounds, { color: '#1f7a4d', weight: 2, fillOpacity: 0.04, interactive: false }).addTo(map);
  $('area-info').textContent = `Área seleccionada: ${fmt(km2)} km².`;
  if (!startMarker || !bounds.contains(startMarker.getLatLng())) setStart(bounds.getCenter());
  map.fitBounds(bounds, { padding: [20, 20] });
  loadArea(bbox);
}

async function loadArea(bbox) {
  loadController?.abort();
  const controller = (loadController = new AbortController());
  areaLoaded = false;
  updateButtons();
  setStatus('Descargando caminos de OpenStreetMap…', 'busy');
  try {
    const elements = await fetchPaths(bbox, controller.signal);
    if (controller !== loadController) return;
    setStatus('Preparando la red de caminos…', 'busy');
    const info = await ask({ type: 'load', elements });
    if (controller !== loadController) return;
    if (!info.edges) throw new Error('no hay caminos en esta zona.');
    areaLoaded = true;
    setStatus(`${fmt(info.edges, 0)} tramos de camino cargados. Elige la distancia y pulsa «Proponer rutas».`);
  } catch (err) {
    if (controller.signal.aborted) return;
    setStatus(`No se pudieron cargar los caminos: ${err.message}`, 'error');
  }
  updateButtons();
}

// --- Punto de salida ------------------------------------------------------

function setStart(latlng) {
  if (!startMarker) {
    startMarker = L.marker(latlng, {
      draggable: true,
      title: 'Punto de salida',
      icon: L.divIcon({ className: 'start-icon', iconSize: [22, 22] }),
    }).addTo(map);
  } else {
    startMarker.setLatLng(latlng);
  }
  updateButtons();
}

map.on('click', (e) => {
  if (!drawing) {
    setStart(e.latlng);
    return;
  }
  if (!drawing.corner) {
    drawing.corner = e.latlng;
    drawing.preview = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
      color: '#1f7a4d',
      weight: 2,
      dashArray: '6 4',
      fill: false,
      interactive: false,
    }).addTo(map);
    setStatus('Ahora haz clic en la esquina opuesta.');
  } else {
    const bounds = L.latLngBounds(drawing.corner, e.latlng);
    cancelDrawing();
    setArea(bounds);
  }
});

map.on('mousemove', (e) => {
  if (drawing?.corner) drawing.preview.setBounds(L.latLngBounds(drawing.corner, e.latlng));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawing) {
    cancelDrawing();
    setStatus('');
  }
});

// --- Rutas ----------------------------------------------------------------

function clearRoutes() {
  routeLayers.forEach(({ group }) => group.remove());
  routeLayers = [];
  $('results').replaceChildren();
}

function selectRoute(index) {
  routeLayers.forEach(({ line, casing, item, group }, i) => {
    const active = i === index;
    line.setStyle({ weight: active ? 6 : 4.5, opacity: active ? 1 : 0.35 });
    casing.setStyle({ opacity: active ? 0.95 : 0.35 });
    item.classList.toggle('selected', active);
    if (active) group.bringToFront();
  });
  const sel = routeLayers[index];
  if (sel) map.fitBounds(sel.group.getBounds(), { padding: [30, 30] });
}

function showRoutes(routes) {
  const list = $('results');
  routes.forEach((route, i) => {
    const color = COLORS[i % COLORS.length];
    const name = `Ruta ${i + 1}`;
    const casing = L.polyline(route.coords, { color: '#ffffff', weight: 8, opacity: 0.95, bubblingMouseEvents: false });
    const line = L.polyline(route.coords, { color, weight: 4.5, opacity: 0.9, bubblingMouseEvents: false });
    const group = L.featureGroup([casing, line]).addTo(map);
    group.on('click', () => selectRoute(i));

    const item = document.createElement('li');
    item.className = 'route';
    item.style.setProperty('--route-color', color);
    item.innerHTML = `
      <button type="button" class="route-main">
        <span class="swatch"></span>
        <span>
          <strong>${name}</strong> · ${fmt(route.length / 1000)} km<br />
          <small>${fmt(route.unpavedFraction * 100, 0)} % sin asfaltar · ${fmt(route.overlap * 100, 0)} % repetido</small>
        </span>
      </button>
      <button type="button" class="gpx" title="Descargar GPX">GPX</button>`;
    item.querySelector('.route-main').addEventListener('click', () => selectRoute(i));
    item.querySelector('.gpx').addEventListener('click', () => downloadGPX(`Rutaton ${name} ${fmt(route.length / 1000)}km`, route.coords));
    list.append(item);

    routeLayers.push({ group, line, casing, item });
  });
  const all = L.featureGroup(routeLayers.map((r) => r.group));
  map.fitBounds(all.getBounds(), { padding: [30, 30] });
}

async function requestRoutes() {
  busy = true;
  updateButtons();
  clearRoutes();
  setStatus('Buscando rutas circulares…', 'busy');
  const { lat, lng } = startMarker.getLatLng();
  try {
    const res = await ask({
      type: 'routes',
      start: [lat, lng],
      target: Number($('dist').value) * 1000,
      count: Number($('count').value),
    });
    startMarker.setLatLng(res.start);
    if (!res.routes.length) {
      setStatus('No se encontraron rutas circulares desde aquí. Prueba otro punto de salida, otra distancia o un área mayor.', 'error');
    } else {
      showRoutes(res.routes);
      setStatus(`${res.routes.length} rutas propuestas. Toca una para verla y descárgala en GPX.`);
    }
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    busy = false;
    updateButtons();
  }
}

// --- Controles ------------------------------------------------------------

$('draw-btn').addEventListener('click', startDrawing);
$('view-btn').addEventListener('click', () => {
  cancelDrawing();
  setArea(map.getBounds().pad(-0.05));
});
$('routes-btn').addEventListener('click', requestRoutes);
$('dist').addEventListener('input', (e) => {
  $('dist-out').textContent = `${e.target.value} km`;
});
$('locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Tu navegador no permite obtener la ubicación.', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const here = L.latLng(coords.latitude, coords.longitude);
      setStart(here);
      if (!area) map.setView(here, 13);
    },
    () => setStatus('No se pudo obtener tu ubicación.', 'error'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

updateButtons();
