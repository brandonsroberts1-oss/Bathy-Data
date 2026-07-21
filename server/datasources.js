// Registry of REAL public bathymetry / topo-bathy elevation sources.
//
// Every source here is a genuine government/scientific dataset served through a
// standard ArcGIS ImageServer `exportImage` endpoint that returns actual
// measured/modeled elevation values in meters (positive up, negative below the
// water surface). NOTHING in this app fabricates depth values.
//
// Coverage notes (why there are several):
//   - Small inland ponds/lakes frequently have NO public bathymetry at all.
//     When that is the case the app reports "no real data" rather than inventing
//     any. That is by design.
//   - The Coastal Relief Model (CRM) and multibeam BAG mosaics are much higher
//     resolution but only cover U.S. coastal waters.
//   - The global mosaic (which folds in GEBCO + the best regional DEMs,
//     including Great Lakes bathymetry) is the broad fallback.
//
// Resolution is approximate native cell size; the ImageServer resamples to
// whatever pixel grid we request.

export const SOURCES = [
  {
    id: 'crm',
    label: 'NOAA Coastal Relief Model (U.S. coasts, ~90 m)',
    url: 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/CRM_mosaic/ImageServer',
    approxResolutionMeters: 90,
    // Rough U.S. coastal coverage bounds [west, south, east, north].
    coverage: [-180, 15, -60, 62],
    coastalOnly: true,
  },
  {
    id: 'global',
    label: 'NOAA/GEBCO Global topo-bathy mosaic (~450 m)',
    url: 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer',
    approxResolutionMeters: 450,
    coverage: [-180, -90, 180, 90],
    coastalOnly: false,
  },
];

// Given a geographic bbox, return the ordered list of sources to try
// (highest-resolution appropriate source first).
export function sourcesForBbox(bbox) {
  const [w, s, e, n] = bbox;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const inside = (cov) => cx >= cov[0] && cx <= cov[2] && cy >= cov[1] && cy <= cov[3];
  return SOURCES.filter((src) => inside(src.coverage));
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}
