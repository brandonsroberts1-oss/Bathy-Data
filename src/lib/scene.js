import { contours as d3contours } from 'd3-contour';
import { geoMercator } from 'd3-geo';
import { haversineMeters, niceScaleLength, metersToUnit } from './units.js';

// Build a "scene" from a real elevation grid + settings. The scene is a pure
// data description (screen-space paths, viewBox, scale bar, compass) that both
// the React live preview and the SVG exporter render identically.
//
// grid: { width, height, bbox:[w,s,e,n], values:[...] (null = nodata), min, max }
// settings: {
//   surfaceElevation,   // meters, the waterline reference (elevation of surface)
//   layers,             // integer count of depth layers below the surface
//   intervalMeters,     // meters of depth between layers
//   drawWidth,          // target px width of the drawing
//   unit,               // 'ft' | 'm' (labels/scale only)
// }
export function buildScene(grid, settings) {
  const { width: gw, height: gh, bbox } = grid;
  const [w, s, e, n] = bbox;
  const surf = settings.surfaceElevation;
  const interval = Math.max(1e-6, settings.intervalMeters);
  const layers = Math.max(1, Math.round(settings.layers));
  const drawWidth = settings.drawWidth || 900;

  // --- Projection fitted to the bbox -------------------------------------
  // Fit using the corner POINTS (a MultiPoint), not a filled Polygon: a
  // spherical polygon wound the "wrong" way is read by d3-geo as the whole
  // globe minus the patch, which makes fitWidth zoom out to world scale.
  const corners = [[w, s], [e, s], [e, n], [w, n]];
  const fitObject = { type: 'MultiPoint', coordinates: corners };
  const projection = geoMercator().fitWidth(drawWidth, fitObject);

  // Compute the drawing bounds by projecting the corners directly (avoids
  // geoPath pointRadius padding and any winding ambiguity).
  const projected = corners.map((c) => projection(c));
  const xs = projected.map((p) => p[0]);
  const ys = projected.map((p) => p[1]);
  const bx0 = Math.min(...xs);
  const bx1 = Math.max(...xs);
  const by0 = Math.min(...ys);
  const by1 = Math.max(...ys);
  const viewW = bx1 - bx0;
  const viewH = by1 - by0;

  // Map a d3-contour grid coordinate (gx in [0,gw], gy in [0,gh], y down /
  // row 0 = north) to screen coordinates.
  const gridToScreen = (gx, gy) => {
    const lon = w + (gx / gw) * (e - w);
    const lat = n - (gy / gh) * (n - s);
    return projection([lon, lat]);
  };

  // --- Prepare the value field (nodata -> treated as land at surface) -----
  const field = new Float64Array(gw * gh);
  for (let i = 0; i < field.length; i++) {
    const v = grid.values[i];
    field[i] = v == null || Number.isNaN(v) ? surf : v;
  }

  // --- Thresholds: surface (k=0) down to the deepest requested layer ------
  const thresholds = [];
  for (let k = 0; k <= layers; k++) thresholds.push(surf - k * interval);
  // d3-contour wants ascending thresholds.
  const ascending = [...thresholds].sort((a, b) => a - b);

  const gen = d3contours().size([gw, gh]).thresholds(ascending).smooth(true);
  const polys = gen(field); // one GeoJSON MultiPolygon per threshold (area >= t)
  const byThreshold = new Map(polys.map((p) => [round6(p.value), p]));

  // --- Build depth levels (k=0 shoreline ... k=layers deepest) ------------
  const levels = [];
  for (let k = 0; k <= layers; k++) {
    const t = surf - k * interval;
    const poly = byThreshold.get(round6(t));
    if (!poly) continue;
    const d = projectMultiPolygon(poly.coordinates, gridToScreen);
    if (!d) continue;
    levels.push({
      k,
      thresholdElevation: t,
      depthMeters: k * interval,
      depthUnitValue: Math.round(metersToUnit(k * interval, settings.unit)),
      pathData: d,
    });
  }

  // --- Scale bar: measure real ground distance per pixel at map center ----
  const cx = viewW / 2 + bx0;
  const cy = viewH / 2 + by0;
  const p0 = projection.invert([cx - 50, cy]);
  const p1 = projection.invert([cx + 50, cy]);
  const metersPer100px = haversineMeters(p0, p1);
  const metersPerPx = metersPer100px / 100;
  const target = niceScaleLength(metersPerPx * (viewW * 0.25), settings.unit);
  const scaleBar = {
    lengthPx: target.meters / metersPerPx,
    label: target.label,
    metersPerPx,
  };

  return {
    viewBox: `${bx0} ${by0} ${viewW} ${viewH}`,
    origin: [bx0, by0],
    width: viewW,
    height: viewH,
    bbox,
    levels,
    scaleBar,
    depthRange: {
      minMeters: grid.min,
      maxMeters: grid.max,
      surface: surf,
    },
  };
}

function projectMultiPolygon(coords, toScreen) {
  const parts = [];
  for (const polygon of coords) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      let d = '';
      for (let i = 0; i < ring.length; i++) {
        const p = toScreen(ring[i][0], ring[i][1]);
        if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
        d += (i === 0 ? 'M' : 'L') + fmt(p[0]) + ',' + fmt(p[1]);
      }
      if (d) parts.push(d + 'Z');
    }
  }
  return parts.length ? parts.join(' ') : null;
}

function fmt(x) {
  return Math.round(x * 100) / 100;
}
function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

// A perceptual blue depth ramp: shallow (light) -> deep (dark). k in [0..layers].
export function depthColor(k, layers) {
  const t = layers > 0 ? k / layers : 0;
  // Interpolate from a pale shallow blue to a deep navy.
  const shallow = [222, 243, 252];
  const deep = [8, 48, 92];
  const c = shallow.map((a, i) => Math.round(a + (deep[i] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
