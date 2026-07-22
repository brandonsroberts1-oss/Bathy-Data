// Real map overlays (roads, state/province boundaries, city & state labels)
// from OpenStreetMap via the Overpass API. These are the engraved/scored
// decorations that turn the depth contours into a finished framed map — the
// same kind of detail you see on retail laser-cut lake art.
//
// Everything here is real OSM data. Nothing is invented. If Overpass is
// unreachable or rate-limited the endpoint returns empty overlays and the map
// still renders from the (separately fetched) NOAA bathymetry.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Choose which road classes to pull based on how big the area is, so a big lake
// gets major highways (like the reference art) and a small lake can show more
// local streets — without dragging down an entire metro street grid.
function roadClassesFor(areaDeg2) {
  if (areaDeg2 > 4) return 'motorway|trunk|primary';
  if (areaDeg2 > 1) return 'motorway|trunk|primary|secondary';
  if (areaDeg2 > 0.15) return 'motorway|trunk|primary|secondary|tertiary';
  return 'motorway|trunk|primary|secondary|tertiary|residential|unclassified';
}

function buildQuery(bbox) {
  const [w, s, e, n] = bbox;
  const bb = `${s},${w},${n},${e}`; // Overpass order: south,west,north,east
  const roads = roadClassesFor((e - w) * (n - s));
  return `[out:json][timeout:90];
(way["highway"~"^(${roads})$"](${bb}););
out geom;
(relation["boundary"="administrative"]["admin_level"~"^(4)$"](${bb}););
out geom;
(node["place"~"^(city|town|village)$"](${bb}););
out;
(relation["boundary"="administrative"]["admin_level"~"^(4)$"](${bb}););
out center tags;
(relation["natural"="water"]["name"](${bb}););
out center tags;`;
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
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} at ${host(url)}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

export async function fetchOverlays(bbox, { maxRoads = 6000, maxBoundaryLines = 4000 } = {}) {
  const json = await runOverpass(buildQuery(bbox));
  const els = json.elements || [];

  const roads = [];
  const boundaries = [];
  const places = [];

  for (const el of els) {
    if (el.type === 'way' && el.tags?.highway && Array.isArray(el.geometry)) {
      if (roads.length < maxRoads) {
        roads.push({ kind: el.tags.highway, coords: el.geometry.map((g) => [g.lon, g.lat]) });
      }
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      // Boundary geometry: each member way carries its own geometry.
      for (const mem of el.members) {
        if (Array.isArray(mem.geometry) && boundaries.length < maxBoundaryLines) {
          boundaries.push({ coords: mem.geometry.map((g) => [g.lon, g.lat]) });
        }
      }
    } else if (el.type === 'relation' && el.center && el.tags?.name) {
      // `out center tags` result: an admin area (state/province) or a water body.
      const isWater = el.tags.natural === 'water' || el.tags.place === 'sea';
      places.push({
        lon: el.center.lon,
        lat: el.center.lat,
        name: el.tags.name,
        kind: isWater ? 'water' : 'state',
      });
    } else if (el.type === 'node' && el.tags?.place && el.tags?.name) {
      places.push({ lon: el.lon, lat: el.lat, name: el.tags.name, kind: el.tags.place });
    }
  }

  return {
    bbox,
    counts: { roads: roads.length, boundaries: boundaries.length, places: places.length },
    roads,
    boundaries,
    places,
  };
}

function host(u) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
