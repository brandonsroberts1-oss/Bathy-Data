// Fetch a REAL elevation/depth grid from NOAA ArcGIS ImageServers.
//
// We call the standard ArcGIS `exportImage` operation asking for a 32-bit float
// GeoTIFF over the requested bbox. The returned raster IS the measured/modeled
// bathymetry (meters, negative below the water surface). We decode it with
// geotiff.js into a flat Float32 grid and hand it to the client, which does all
// contouring locally so the user can retune layers/intervals without re-hitting
// NOAA.
//
// If a source has no coverage for the requested area it returns all-nodata and
// we transparently fall through to the next source; if nothing has data we say
// so. We never synthesize values.

import { fromArrayBuffer } from 'geotiff';
import { sourcesForBbox, sourceById } from './datasources.js';

// Sentinels/limits used to reject nodata pixels (meters).
const MIN_VALID = -12000;
const MAX_VALID = 9000;

function pickGridSize(bbox, maxDim) {
  const [w, s, e, n] = bbox;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const groundW = Math.max(1e-9, (e - w) * Math.cos(midLat));
  const groundH = Math.max(1e-9, n - s);
  let width, height;
  if (groundW >= groundH) {
    width = maxDim;
    height = Math.max(16, Math.round((maxDim * groundH) / groundW));
  } else {
    height = maxDim;
    width = Math.max(16, Math.round((maxDim * groundW) / groundH));
  }
  return { width, height };
}

async function exportFromSource(source, bbox, size) {
  const params = new URLSearchParams({
    bbox: bbox.join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${size.width},${size.height}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    noDataInterpretation: 'esriNoDataMatchAny',
    f: 'image',
  });
  const url = `${source.url}/exportImage?${params}`;

  const res = await fetch(url, { headers: { Accept: 'image/tiff, application/json' } });
  const ctype = res.headers.get('content-type') || '';
  if (!res.ok || ctype.includes('application/json')) {
    // ArcGIS reports failures as JSON even on the image endpoint.
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.message || detail;
    } catch {
      /* not JSON */
    }
    throw new Error(`${source.id}: ${detail}`);
  }

  const buf = await res.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ samples: [0] });
  const band = rasters[0];
  const width = image.getWidth();
  const height = image.getHeight();
  const gdalNoData = image.getGDALNoData();

  // Read the actual extent back from the GeoTIFF (imageSR=4326), so the grid
  // and its bbox always agree even if ArcGIS nudged the requested extent.
  let actualBbox = bbox;
  try {
    const bb = image.getBoundingBox(); // [minX, minY, maxX, maxY] in lon/lat
    if (bb && bb.length === 4 && bb.every((n) => Number.isFinite(n))) {
      actualBbox = [bb[0], bb[1], bb[2], bb[3]];
    }
  } catch {
    /* keep requested bbox */
  }

  // Copy into a clean Float32Array, converting nodata -> NaN and counting
  // genuinely-valid samples so we can decide whether this source has coverage.
  const values = new Float32Array(width * height);
  let valid = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    let v = band[i];
    if (
      v === gdalNoData ||
      v == null ||
      Number.isNaN(v) ||
      v < MIN_VALID ||
      v > MAX_VALID
    ) {
      values[i] = NaN;
      continue;
    }
    values[i] = v;
    valid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return {
    width,
    height,
    bbox: actualBbox,
    values,
    valid,
    coverage: valid / values.length,
    min: valid ? min : null,
    max: valid ? max : null,
  };
}

// Returns a plain object ready to JSON-serialize. `values` is sent as a normal
// array with `null` for nodata cells.
export async function fetchBathymetryGrid(bbox, { maxDim = 480, sourceId } = {}) {
  const size = pickGridSize(bbox, maxDim);
  const candidates = sourceId ? [sourceById(sourceId)].filter(Boolean) : sourcesForBbox(bbox);

  if (candidates.length === 0) {
    return {
      hasData: false,
      reason: 'No configured bathymetry source covers this location.',
      bbox,
    };
  }

  const attempts = [];
  for (const source of candidates) {
    try {
      const grid = await exportFromSource(source, bbox, size);
      attempts.push({ source: source.id, coverage: grid.coverage });
      // Require a meaningful amount of real data (>2% of cells) to accept.
      if (grid.coverage > 0.02) {
        return {
          hasData: true,
          bbox: grid.bbox || bbox,
          width: grid.width,
          height: grid.height,
          // NaN -> null for JSON transport.
          values: Array.from(grid.values, (v) => (Number.isNaN(v) ? null : v)),
          min: grid.min,
          max: grid.max,
          coverage: grid.coverage,
          source: { id: source.id, label: source.label, resolutionMeters: source.approxResolutionMeters },
        };
      }
    } catch (err) {
      attempts.push({ source: source.id, error: String(err.message || err) });
    }
  }

  return {
    hasData: false,
    reason:
      'No real bathymetry was available here from any source (this is common for small inland lakes). ' +
      'Nothing was fabricated.',
    bbox,
    attempts,
  };
}
