# Rutaton

Web para descubrir **rutas circulares por el campo**. Seleccionas una zona en el mapa de OpenStreetMap, eliges punto de salida y distancia, y te propone varias rutas que empiezan y terminan en el mismo sitio, priorizando pistas, caminos y senderos frente a carreteras.

## Cómo se usa

1. **Dibujar área**: haz clic en dos esquinas opuestas del mapa (o usa «Usar vista actual»). Máximo 400 km².
2. **Punto de salida**: haz clic en el mapa, arrastra el marcador o usa tu ubicación.
3. Elige la **distancia** y cuántas rutas quieres, y pulsa **Proponer rutas**.
4. Toca una ruta para verla y descárgala en **GPX** para llevarla en el móvil o el GPS.

## Cómo funciona

- Los caminos se descargan de la [API Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) (`highway=track|path|footway|bridleway|…`), descartando autovías, carreteras principales y vías privadas o prohibidas a pie.
- Se construye un grafo donde cada tramo tiene un coste según el tipo de vía y su firme: las pistas de tierra y senderos son "baratos" y el asfalto "caro".
- Para cada dirección de salida (12 rumbos) y forma (3, 4 o 5 puntos de paso) se dibuja un círculo que pasa por el inicio y se enlazan los puntos de paso con A*, penalizando los tramos ya recorridos para no ir y volver por el mismo camino. El radio se ajusta hasta acercarse a la distancia pedida.
- Se puntúan las candidatas (desvío de la distancia, % repetido, % asfaltado) y se eligen las mejores que sean distintas entre sí.

Todo el cálculo se hace en el navegador (en un Web Worker), así que no hace falta servidor: es una web estática.

## Desarrollo

```bash
npm start   # sirve la web en http://localhost:8080
npm test    # pruebas del algoritmo (Node 20+)
```

Hay que servirla por HTTP (no vale abrir `index.html` con doble clic) porque usa módulos ES y un Web Worker.

### Estructura

| Archivo | Qué hace |
| --- | --- |
| `index.html`, `css/style.css` | Interfaz |
| `js/app.js` | Mapa (Leaflet), selección de área, resultados |
| `js/overpass.js` | Descarga de caminos de OpenStreetMap |
| `js/graph.js` | Grafo de caminos y costes por tipo de vía |
| `js/routing.js` | A*, componentes conexas e índice espacial |
| `js/loops.js` | Generación y selección de rutas circulares |
| `js/worker.js` | Ejecuta el cálculo fuera del hilo principal |
| `js/gpx.js` | Exportación GPX |

## Publicar en GitHub Pages

En *Settings → Pages* elige la rama `main` y la carpeta `/ (root)`. La web quedará en `https://<usuario>.github.io/rutaton/`.

## Créditos

Mapas y datos © [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright). Mapa topográfico de [OpenTopoMap](https://opentopomap.org). Revisa siempre el terreno: los datos pueden estar desactualizados.
