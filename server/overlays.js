// Real map overlays (roads, state/province boundaries + names) from
// OpenStreetMap via the Overpass API. These are the engraved/scored decorations
// that turn depth contours into a finished framed map.
//
// Everything here is real OSM data — nothing is invented. If Overpass is
// unreachable the endpoint returns empty overlays and the map still renders.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Road classes by requested detail. Default is deliberately sparse (major
// highways only) so a big lake looks like clean retail lake art, not a street
// grid.
const ROAD_DETAIL = {
  major: 'motorway|trunk|primary',
  more: 'motorway|trunk|primary|secondary|tertiary',
  all: 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street',
};

function buildQuery(bbox, { roadDetail, cities }) {
  const [w, s, e, n] = bbox;
  const bb = `${s},${w},${n},${e}`; // Overpass order: south,west,north,east
  const roads = ROAD_DETAIL[roadDetail] || ROAD_DETAIL.major;
  let q = `[out:json][timeout:120];
(way["highway"~"^(${roads})$"](${bb}););
out geom;
(relation["boundary"="administrative"]["admin_level"="4"](${bb}););
out geom;`;
  if (cities) {
    q += `
(node["place"="city"](${bb}););
out;`;
  }
  return q;
}

async function runOverpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) { lastErr = new Error(`Overpass ${res.status} at ${host(url)}`); continue; }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

export async function fetchOverlays(bbox, opts = {}) {
  const roadDetail = ROAD_DETAIL[opts.roadDetail] ? opts.roadDetail : 'major';
  const cities = Boolean(opts.cities);
  const maxCities = opts.maxCities || 12;

  const json = await runOverpass(buildQuery(bbox, { roadDetail, cities }));
  const els = json.elements || [];

  const roads = [];
  const boundaries = [];
  const places = [];
  const seenWay = new Set(); // dedup shared boundary ways
  const seenState = new Set(); // dedup state names

  for (const el of els) {
    if (el.type === 'way' && el.tags?.highway && Array.isArray(el.geometry)) {
      roads.push({ kind: el.tags.highway, coords: el.geometry.map((g) => [g.lon, g.lat]) });
    } else if (el.type === 'relation' && Array.isArray(el.members) && el.tags?.name) {
      // State / province boundary + label.
      const segments = []; // all outer segments (unclipped) for point-in-polygon
      for (const mem of el.members) {
        if (mem.type !== 'way' || !Array.isArray(mem.geometry)) continue;
        if (mem.role && mem.role !== 'outer') continue; // skip inner/subarea/label
        const line = mem.geometry.map((g) => [g.lon, g.lat]);
        for (let i = 1; i < line.length; i++) segments.push([line[i - 1], line[i]]);
        // Draw each shared border way only once.
        if (mem.ref != null && !seenWay.has(mem.ref)) {
          seenWay.add(mem.ref);
          boundaries.push({ coords: line });
        }
      }
      // Place the name inside the state's VISIBLE area (not its far-off center).
      if (!seenState.has(el.tags.name)) {
        const pt = labelPointInside(segments, bbox);
        if (pt) {
          seenState.add(el.tags.name);
          places.push({ lon: pt[0], lat: pt[1], name: el.tags.name, kind: 'state' });
        }
      }
    } else if (cities && el.type === 'node' && el.tags?.place === 'city' && el.tags?.name) {
      places.push({
        lon: el.lon,
        lat: el.lat,
        name: el.tags.name,
        kind: 'city',
        pop: Number(el.tags.population) || 0,
      });
    }
  }

  // Keep only the biggest few cities so labels stay clean.
  const cityLabels = places.filter((p) => p.kind === 'city').sort((a, b) => b.pop - a.pop).slice(0, maxCities);
  const stateLabels = places.filter((p) => p.kind === 'state');

  return {
    bbox,
    counts: { roads: roads.length, boundaries: boundaries.length, states: stateLabels.length, cities: cityLabels.length },
    roads,
    boundaries,
    places: [...stateLabels, ...cityLabels],
  };
}

// Find a point inside the polygon (formed by `segments`) that also lies within
// the bbox — i.e. inside the state's *visible* land. Samples a grid, keeps the
// interior points, returns their centroid. Ray-casting works with an unordered
// set of edges as long as they close, so no way-stitching is needed.
function labelPointInside(segments, bbox) {
  if (!segments.length) return null;
  const [w, s, e, n] = bbox;
  const N = 26;
  let sx = 0, sy = 0, count = 0;
  for (let iy = 1; iy < N; iy++) {
    const py = s + ((n - s) * iy) / N;
    for (let ix = 1; ix < N; ix++) {
      const px = w + ((e - w) * ix) / N;
      if (pointInPolygon(px, py, segments)) { sx += px; sy += py; count++; }
    }
  }
  if (!count) return null;
  return [sx / count, sy / count];
}

function pointInPolygon(px, py, segments) {
  let inside = false;
  for (const [a, b] of segments) {
    const y1 = a[1], y2 = b[1];
    if (y1 > py !== y2 > py) {
      const xAt = a[0] + ((py - y1) / (y2 - y1)) * (b[0] - a[0]);
      if (px < xAt) inside = !inside;
    }
  }
  return inside;
}

function host(u) {
  try { return new URL(u).host; } catch { return u; }
}
