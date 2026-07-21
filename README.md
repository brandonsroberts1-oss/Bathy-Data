# 🌊 Bathy-Data

A web app that fetches **real** bathymetric (underwater depth) data for U.S.
waterways and bodies of water and exports a **layered SVG** you can cut/engrave
on **xTool Studio**, Glowforge, Inkscape, etc. — ideal for stacked-wood
topographic wall art.

- Search a body of water by name **or** enter coordinates.
- Editable **name** and **description** text that gets placed on the map.
- Editable **number of contour layers** and **depth per layer** (feet or meters).
- **Live preview** that re-renders as you tweak anything.
- Toggle a **true-scale bar** (geographically accurate for the selected area).
- Toggle a **north-up compass**.
- One SVG **layer/group per depth** (Inkscape/xTool-compatible) for easy
  material separation.

> **The depth data is real.** It comes from NOAA / NCEI topo-bathy elevation
> services. The app never fabricates depths. When no public bathymetry exists
> for an area (common for small inland lakes), it tells you so instead of making
> something up.

---

## Data sources (all real, all public)

| Source | Coverage | Native cell |
|---|---|---|
| [NOAA Coastal Relief Model (CRM)](https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/CRM_mosaic/ImageServer) | U.S. coastal waters | ~90 m |
| [NOAA / GEBCO global topo-bathy mosaic](https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer) | Worldwide (incl. oceans, Great Lakes) | ~450 m |

The backend calls each source's standard ArcGIS `exportImage` operation, asking
for a 32-bit-float GeoTIFF of the requested area. That raster **is** the
measured/modeled elevation (meters; negative below the water surface). It is
decoded and handed to the browser, which does all contouring locally so you can
retune layers and intervals instantly without re-hitting NOAA.

Place names / bounding boxes come from the free
[OpenStreetMap Nominatim](https://nominatim.org/) geocoder (name + extent only —
no depth data).

### A note on coverage (please read before selling anything)

- **Oceans, bays, and coasts:** excellent. The CRM is genuinely detailed.
- **Great Lakes:** good — the global mosaic includes their bathymetry.
- **Small inland lakes / ponds / reservoirs:** frequently have **no** public
  bathymetry at all. Many state agencies (e.g. state DNRs) survey individual
  lakes but do not expose them through an API. When nothing is available the app
  says so. If you need a specific small lake, you may have to source a survey
  from that state agency and import it manually.

Resolution and accuracy vary by location. **Always sanity-check against a
nautical chart before cutting a piece you intend to sell.**

---

## Run it

Requires Node 18+ (developed on Node 22).

```bash
npm install

# Dev: Vite frontend on :5173 + API on :8787 (Vite proxies /api → API)
npm run dev
# open http://localhost:5173

# Production: build the frontend, then serve everything from the API server
npm run build
npm start
# open http://localhost:8787
```

> **Network:** the server needs outbound HTTPS to `gis.ngdc.noaa.gov` and
> `nominatim.openstreetmap.org`. If you run it behind a restrictive proxy those
> hosts must be allowlisted. Use **Load sample (synthetic)** to try the UI
> offline — that data is clearly watermarked and is **not** real.

---

## How to use it

1. **Choose a body of water** — search by name, type coordinates, or pan/zoom the
   map and click **Use current view** (or **Draw a box**).
2. Confirm the **name** and add a **description**.
3. Set the **units**, **number of layers**, and **depth per layer**. Use
   **Auto-fit interval to full depth** to spread your layers across the whole
   basin.
4. Toggle the **scale bar** and **compass**.
5. Switch **Shaded art** ↔ **Cut lines** in the preview.
6. **Download SVG.**

## Preparing the SVG for laser cutting

- The export contains one `<g inkscape:groupmode="layer">` per depth, labelled
  `Depth 10 ft`, `Depth 20 ft`, … plus `Shoreline`, `Scale bar`, `Compass`, and
  `Title`. Every layer opens as a separate object/layer in xTool Studio and
  Inkscape so you can assign material, order, and process (cut vs. score vs.
  engrave) per depth.
- **Cut lines** mode outputs hairline outlines (no fill) — the usual starting
  point for vector cutting. **Shaded art** mode fills each band with a blue
  depth ramp — handy for previews or grayscale/photo engraving.
- Each layer's outline is a closed contour, so in a stacked build each layer is
  the piece you cut for that depth and glue on top of the one below it.

---

## Project layout

```
server/
  index.js         Express API + serves the built frontend in production
  datasources.js   Registry of the real NOAA sources + which to try per area
  geocode.js       Nominatim water-body search
  bathymetry.js    exportImage fetch + GeoTIFF decode → elevation grid
src/
  App.jsx          UI, state, live preview + export wiring
  components/
    MapPicker.jsx  Leaflet map area picker
  lib/
    scene.js       Grid + settings → projected contour layers (d3-contour/d3-geo)
    exportSvg.js    Scene → layered SVG string (used by preview AND export)
    units.js        Unit conversions, haversine, nice scale lengths
    sampleGrid.js   Synthetic offline test data (watermarked; NOT real)
```

## Honesty & licensing

- **No fabricated depths, ever.** The only synthetic data is the clearly-labelled
  offline **sample**, whose exports are watermarked `SAMPLE — SYNTHETIC`.
- NOAA/NCEI and GEBCO data are public. If you sell finished pieces, follow each
  provider's attribution/citation guidance and OpenStreetMap's
  [ODbL](https://www.openstreetmap.org/copyright) for any place data you display.
