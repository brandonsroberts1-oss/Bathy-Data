// Body-of-water search via the free OpenStreetMap Nominatim geocoder.
//
// We ask Nominatim specifically for water features (lakes, reservoirs, bays,
// seas, etc.). It returns a bounding box for each match, which becomes the
// default area we pull bathymetry for. No depth data comes from here — only the
// name and geographic extent of the feature.
//
// Nominatim usage policy requires a descriptive User-Agent and <=1 req/sec.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Bathy-Data/0.1 (open-source bathymetric SVG generator)';

// Feature classes we consider "a body of water".
const WATER_CLASSES = new Set(['water', 'waterway', 'natural', 'place']);
const WATER_TYPES = new Set([
  'water', 'lake', 'reservoir', 'pond', 'bay', 'strait', 'sea', 'ocean',
  'river', 'canal', 'lagoon', 'wetland', 'basin', 'harbour', 'harbor',
]);

export async function searchWaterBody(query, { limit = 8 } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    extratags: '1',
    namedetails: '1',
    limit: String(Math.min(limit * 3, 30)),
    // Bias toward the United States, but do not hard-restrict (large
    // trans-border lakes/seas are still useful).
    countrycodes: 'us',
  });

  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
  });
  if (!res.ok) {
    throw new Error(`Geocoder returned ${res.status}`);
  }
  const rows = await res.json();

  const scored = rows
    .map((r) => normalizeResult(r))
    .filter(Boolean)
    // Prefer genuine water features, then larger/more prominent ones.
    .sort((a, b) => Number(b.isWater) - Number(a.isWater) || b.importance - a.importance);

  return scored.slice(0, limit);
}

function normalizeResult(r) {
  // boundingbox is [south, north, west, east] as strings.
  const bb = (r.boundingbox || []).map(Number);
  if (bb.length !== 4 || bb.some((n) => Number.isNaN(n))) return null;
  const [south, north, west, east] = bb;

  const isWater =
    WATER_CLASSES.has(r.category || r.class) &&
    (WATER_TYPES.has(r.type) || r.type === 'water');

  return {
    name: r.namedetails?.name || r.name || r.display_name?.split(',')[0] || 'Unnamed water',
    displayName: r.display_name,
    type: r.type,
    category: r.category || r.class,
    isWater: Boolean(isWater),
    importance: Number(r.importance) || 0,
    center: [Number(r.lon), Number(r.lat)],
    // Normalized to [west, south, east, north].
    bbox: [west, south, east, north],
  };
}
