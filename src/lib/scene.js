import { contours as d3contours } from 'd3-contour';
import { geoMercator } from 'd3-geo';
import { haversineMeters, niceScaleLength, metersToUnit } from './units.js';

// Build a "scene" from a real elevation grid + settings. The scene is a pure
// data description (screen-space paths, viewBox, scale bar, compass, overlays)
// that both the React live preview and the SVG exporter render identically.
//
// grid: { width, height, bbox:[w,s,e,n], values:[...] (null = nodata), min, max }
// overlays (optional, lon/lat from OpenStreetMap): {
//   roads:[{ kind, coords:[[lon,lat]...] }],
//   boundaries:[{ coords:[[lon,lat]...] }],
//   places:[{ lon, lat, name, kind }],
// }
// settings: {
//   surfaceElevation, layers, intervalMeters, drawWidth, unit,
//   minFeatureAreaFrac,  // 0..1 despeckle: drop rings smaller than this * view area
// }
export function buildScene(grid, settings, overlays = null) {
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
  const projection = geoMercator().fitWidth(drawWidth, { type: 'MultiPoint', coordinates: corners });

  const projected = corners.map((c) => projection(c));
  const xs = projected.map((p) => p[0]);
  const ys = projected.map((p) => p[1]);
  const bx0 = Math.min(...xs);
  const bx1 = Math.max(...xs);
  const by0 = Math.min(...ys);
  const by1 = Math.max(...ys);
  const viewW = bx1 - bx0;
  const viewH = by1 - by0;
  const viewArea = viewW * viewH;

  // Map a d3-contour grid coordinate (gx in [0,gw], gy in [0,gh], y down /
  // row 0 = north) to screen coordinates.
  const gridToScreen = (gx, gy) => {
    const lon = w + (gx / gw) * (e - w);
    const lat = n - (gy / gh) * (n - s);
    return projection([lon, lat]);
  };

  // --- Prepare the value field (nodata -> treated as land at surface) -----
  // Also count "water" cells (below the surface) for a robust surface-area
  // stat that works even when the water touches the frame edge.
  const field = new Float64Array(gw * gh);
  let waterCells = 0;
  for (let i = 0; i < field.length; i++) {
    const v = grid.values[i];
    if (v == null || Number.isNaN(v)) {
      field[i] = surf;
    } else {
      field[i] = v;
      if (v < surf) waterCells++;
    }
  }

  // --- Thresholds: surface (k=0) down to the deepest requested layer ------
  const ascending = [];
  for (let k = layers; k >= 0; k--) ascending.push(surf - k * interval);

  const gen = d3contours().size([gw, gh]).thresholds(ascending).smooth(true);
  const polys = gen(field); // one GeoJSON MultiPolygon per threshold (area >= t)
  const byThreshold = new Map(polys.map((p) => [round6(p.value), p]));

  // Despeckle threshold in px².
  const minArea = Math.max(0, (settings.minFeatureAreaFrac || 0)) * viewArea;
  // Depth labels only go on reasonably-sized deep basins.
  const labelMinArea = Math.max(minArea, viewArea * 0.0022);

  // --- Build depth levels (k=0 shoreline ... k=layers deepest) ------------
  const levels = [];
  for (let k = 0; k <= layers; k++) {
    const t = surf - k * interval;
    const poly = byThreshold.get(round6(t));
    if (!poly) continue;
    const rings = projectRings(poly.coordinates, gridToScreen, minArea);
    if (!rings.length) continue;

    const pathData = rings.map((r) => r.d).join(' ');

    // Depth labels sit on the deep-basin contour lines, which are the HOLE
    // rings of this level (interior boundaries where it drops below t).
    let labelPoints = [];
    if (k >= 1) {
      labelPoints = rings
        .filter((r) => r.isHole && Math.abs(r.area) >= labelMinArea)
        .sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
        .slice(0, 4)
        .map((r) => r.topPoint);
    }

    levels.push({
      k,
      thresholdElevation: t,
      depthMeters: k * interval,
      depthUnitValue: Math.round(metersToUnit(k * interval, settings.unit)),
      pathData,
      labelPoints,
    });
  }

  // --- Scale bar: measure real ground distance per pixel at map center ----
  const cx = viewW / 2 + bx0;
  const cy = viewH / 2 + by0;
  const p0 = projection.invert([cx - 50, cy]);
  const p1 = projection.invert([cx + 50, cy]);
  const metersPerPx = haversineMeters(p0, p1) / 100;
  const target = niceScaleLength(metersPerPx * (viewW * 0.25), settings.unit);
  const scaleBar = {
    lengthPx: target.meters / metersPerPx,
    label: target.label,
    metersPerPx,
  };

  // --- Real stats ---------------------------------------------------------
  // Surface area from the fraction of cells below the waterline × the ground
  // area of the bbox (robust whether or not the water reaches the frame).
  const midLat = (s + n) / 2;
  const bboxWidthM = haversineMeters([w, midLat], [e, midLat]);
  const bboxHeightM = haversineMeters([w, s], [w, n]);
  const waterAreaM2 = (waterCells / (gw * gh)) * bboxWidthM * bboxHeightM;
  const maxDepthMeters = grid.min != null ? Math.max(0, surf - grid.min) : null;

  // --- Project overlays (roads / boundaries / place labels) ---------------
  // Overlay geometry (esp. state outlines) can extend far beyond the frame, so
  // clip every segment to the map rectangle in real coordinates — this keeps the
  // exported paths laser-safe without relying on SVG clip-paths (which some
  // laser tools ignore).
  const rect = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
  const projLine = (coords) => {
    const proj = [];
    for (const [lon, lat] of coords) {
      const p = projection([lon, lat]);
      proj.push(p && isFinite(p[0]) && isFinite(p[1]) ? p : null);
    }
    let d = '';
    for (let i = 1; i < proj.length; i++) {
      const a = proj[i - 1];
      const b = proj[i];
      if (!a || !b) continue;
      const seg = clipSegment(a, b, rect);
      if (seg) d += 'M' + fmt(seg[0][0]) + ',' + fmt(seg[0][1]) + 'L' + fmt(seg[1][0]) + ',' + fmt(seg[1][1]);
    }
    return d || null;
  };
  const inView = (x, y) => x >= bx0 - 2 && x <= bx1 + 2 && y >= by0 - 2 && y <= by1 + 2;

  let projectedOverlays = null;
  if (overlays) {
    const roads = (overlays.roads || [])
      .map((r) => ({ kind: r.kind, d: projLine(r.coords) }))
      .filter((r) => r.d);
    const boundaries = (overlays.boundaries || [])
      .map((b) => ({ d: projLine(b.coords) }))
      .filter((b) => b.d);
    const places = (overlays.places || [])
      .map((pl) => {
        const p = projection([pl.lon, pl.lat]);
        return p && inView(p[0], p[1]) ? { x: fmt(p[0]), y: fmt(p[1]), name: pl.name, kind: pl.kind } : null;
      })
      .filter(Boolean);
    projectedOverlays = { roads, boundaries, places };
  }

  return {
    viewBox: `${bx0} ${by0} ${viewW} ${viewH}`,
    origin: [bx0, by0],
    width: viewW,
    height: viewH,
    bbox,
    levels,
    scaleBar,
    overlays: projectedOverlays,
    stats: {
      waterAreaM2,
      maxDepthMeters,
      surface: surf,
      minMeters: grid.min,
      maxMeters: grid.max,
    },
  };
}

// Project a GeoJSON MultiPolygon into screen rings, dropping any ring whose
// absolute area is below `minArea` (despeckle). Ring index 0 of each polygon
// is the outer boundary; the rest are holes.
function projectRings(coords, toScreen, minArea) {
  const out = [];
  for (const polygon of coords) {
    for (let ri = 0; ri < polygon.length; ri++) {
      const ring = polygon[ri];
      if (ring.length < 3) continue;
      const pts = [];
      for (const [gx, gy] of ring) {
        const p = toScreen(gx, gy);
        if (p && isFinite(p[0]) && isFinite(p[1])) pts.push(p);
      }
      if (pts.length < 3) continue;
      const area = signedArea(pts);
      if (minArea > 0 && Math.abs(area) < minArea) continue;
      out.push({
        area,
        isHole: ri > 0,
        centroid: polygonCentroid(pts, area),
        topPoint: topVertex(pts), // where the depth number sits, on the contour
        d: pointsToPath(pts),
      });
    }
  }
  return out;
}

function pointsToPath(pts) {
  let d = 'M' + fmt(pts[0][0]) + ',' + fmt(pts[0][1]);
  for (let i = 1; i < pts.length; i++) d += 'L' + fmt(pts[i][0]) + ',' + fmt(pts[i][1]);
  return d + 'Z';
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return a / 2;
}

// Topmost vertex of a ring (min screen-y) — a stable spot to sit a depth
// number on the contour line itself, which spreads nested labels out.
function topVertex(pts) {
  let best = pts[0];
  for (const p of pts) if (p[1] < best[1]) best = p;
  return [fmt(best[0]), fmt(best[1])];
}

function polygonCentroid(pts, area) {
  if (Math.abs(area) < 1e-6) {
    // Degenerate: fall back to bbox center.
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    return [sx / pts.length, sy / pts.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    cx += (pts[j][0] + pts[i][0]) * cross;
    cy += (pts[j][1] + pts[i][1]) * cross;
  }
  const f = 1 / (6 * area);
  return [fmt(cx * f), fmt(cy * f)];
}

// Liang–Barsky clip of segment a->b to an axis-aligned rect. Returns the
// clipped [p0, p1] or null if fully outside.
function clipSegment(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
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
  const shallow = [222, 243, 252];
  const deep = [8, 48, 92];
  const c = shallow.map((a, i) => Math.round(a + (deep[i] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
