// SYNTHETIC sample grid — for OFFLINE UI TESTING ONLY.
//
// This is NOT real bathymetry. It exists so you can exercise the interface
// without network access. Anything produced from it is watermarked "SAMPLE"
// and the app labels it loudly. Never sell or represent this as real data.
export function makeSampleGrid() {
  const width = 200;
  const height = 150;
  const values = new Array(width * height);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxDepth = 40; // meters
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / (width * 0.42);
      const ny = (y - cy) / (height * 0.42);
      const r = Math.sqrt(nx * nx + ny * ny);
      // A lumpy basin: elevation 0 at shore, negative toward center.
      const lump =
        0.12 * Math.sin(nx * 6) * Math.cos(ny * 5) +
        0.08 * Math.sin(nx * 11 + 1.3);
      const basin = 1 - Math.min(1, r) ** 1.6 + lump;
      const elev = basin <= 0 ? 5 : -basin * maxDepth; // >0 = land outside
      values[y * width + x] = elev;
    }
  }
  return {
    hasData: true,
    isSample: true,
    bbox: [-121.98, 39.0, -121.9, 39.06], // arbitrary NorCal-ish extent
    width,
    height,
    values,
    min: -maxDepth,
    max: 5,
    coverage: 1,
    source: { id: 'sample', label: 'SAMPLE — synthetic (not real data)', resolutionMeters: 0 },
  };
}
