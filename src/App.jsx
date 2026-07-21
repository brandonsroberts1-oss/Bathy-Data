import React, { useMemo, useState, useCallback } from 'react';
import MapPicker from './components/MapPicker.jsx';
import { buildScene } from './lib/scene.js';
import { buildSvg } from './lib/exportSvg.js';
import { unitToMeters, metersToUnit } from './lib/units.js';
import { makeSampleGrid } from './lib/sampleGrid.js';

const DRAW_WIDTH = 960;

export default function App() {
  // Area / data
  const [mode, setMode] = useState('search'); // 'search' | 'coords'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [bbox, setBbox] = useState(null);
  const [grid, setGrid] = useState(null);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [error, setError] = useState(null);
  const [noData, setNoData] = useState(null);

  // Coordinate entry
  const [clat, setClat] = useState('');
  const [clon, setClon] = useState('');
  const [span, setSpan] = useState('3');

  // Editable map details
  const [name, setName] = useState('');
  const [info, setInfo] = useState('');

  // Contour controls
  const [unit, setUnit] = useState('ft'); // 'ft' | 'm'
  const [layers, setLayers] = useState(6);
  const [interval, setInterval] = useState(10); // in `unit`
  const [surface, setSurface] = useState(0); // meters

  // Display / extras
  const [renderMode, setRenderMode] = useState('filled'); // 'filled' | 'cut'
  const [showScale, setShowScale] = useState(true);
  const [showCompass, setShowCompass] = useState(true);
  const [background, setBackground] = useState('transparent');

  const isSample = grid?.isSample;

  // --- Search -------------------------------------------------------------
  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.results || []);
      if (!json.results?.length) setError('No matching places found.');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSearching(false);
    }
  }, [query]);

  // --- Fetch bathymetry for a bbox ---------------------------------------
  const loadBathymetry = useCallback(async (bb, label) => {
    setBbox(bb);
    setGrid(null);
    setNoData(null);
    setError(null);
    setLoadingGrid(true);
    try {
      const res = await fetch(`/api/bathymetry?bbox=${bb.map((x) => x.toFixed(6)).join(',')}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fetch failed');
      if (!json.hasData) {
        setNoData(json.reason || 'No real bathymetry available for this area.');
        return;
      }
      setGrid(json);
      applyAutoDefaults(json);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoadingGrid(false);
    }
  }, []);

  // Auto-detect a sensible surface elevation and a depth interval that spans
  // the basin, so the first render looks reasonable.
  function applyAutoDefaults(g) {
    const surf = autoSurface(g);
    setSurface(surf);
    const totalDepthM = Math.max(1, surf - (g.min ?? surf));
    const perLayerM = totalDepthM / (layers || 6);
    const perLayerUnit = Math.max(1, Math.round(metersToUnit(perLayerM, unit)));
    setInterval(perLayerUnit);
  }

  const pickResult = (r) => {
    setName(r.name || '');
    setResults([]);
    setQuery(r.name || query);
    loadBathymetry(r.bbox, r.name);
  };

  const submitCoords = () => {
    const lat = Number(clat);
    const lon = Number(clon);
    const sp = Number(span);
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(sp) || sp <= 0) {
      setError('Enter a valid latitude, longitude, and size.');
      return;
    }
    // span is in miles (imperial) or km (metric)
    const sizeMeters = unit === 'ft' ? sp * 1609.344 : sp * 1000;
    const half = sizeMeters / 2;
    const dLat = half / 111320;
    const dLon = half / (111320 * Math.cos((lat * Math.PI) / 180));
    const bb = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    loadBathymetry(bb, `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  };

  const loadSample = () => {
    const g = makeSampleGrid();
    setBbox(g.bbox);
    setGrid(g);
    setNoData(null);
    setError(null);
    setName(name || 'Sample Basin (SYNTHETIC)');
    applyAutoDefaults(g);
  };

  // --- Derived scene + SVG (live) ----------------------------------------
  const scene = useMemo(() => {
    if (!grid?.hasData) return null;
    try {
      return buildScene(grid, {
        surfaceElevation: surface,
        layers,
        intervalMeters: unitToMeters(interval, unit),
        drawWidth: DRAW_WIDTH,
        unit,
      });
    } catch (e) {
      console.error('scene build failed', e);
      return null;
    }
  }, [grid, surface, layers, interval, unit]);

  const svg = useMemo(() => {
    if (!scene) return '';
    return buildSvg(scene, {
      mode: renderMode,
      showScale,
      showCompass,
      name,
      info,
      unit,
      background: background === 'transparent' ? null : background,
      isSample,
    });
  }, [scene, renderMode, showScale, showCompass, name, info, unit, background, isSample]);

  const download = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (name || 'bathymetry').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    a.href = url;
    a.download = `${base || 'bathymetry'}${isSample ? '-SAMPLE' : ''}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const depthStats = grid?.hasData
    ? {
        minU: Math.round(metersToUnit(Math.abs((surface - grid.min)), unit)),
        surface: Math.round(surface * 10) / 10,
      }
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <span style={{ fontSize: 22 }}>🌊</span>
        <div>
          <h1>Bathy-Data</h1>
          <div className="sub">Real bathymetric contours → layered SVG for laser cutting</div>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={loadSample} title="Load synthetic data to test the UI offline">
          Load sample (synthetic)
        </button>
      </header>

      <aside className="sidebar">
        {/* AREA */}
        <div className="card">
          <h2>1 · Choose a body of water</h2>
          <div className="row">
            <button className={mode === 'search' ? '' : 'secondary'} onClick={() => setMode('search')}>Search</button>
            <button className={mode === 'coords' ? '' : 'secondary'} onClick={() => setMode('coords')}>Coordinates</button>
          </div>

          {mode === 'search' ? (
            <>
              <label>Search by name (lake, bay, reservoir, sea…)</label>
              <div className="row">
                <input
                  type="text"
                  placeholder="e.g. Lake Tahoe"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
                <button style={{ flex: '0 0 auto' }} onClick={runSearch} disabled={searching}>
                  {searching ? <span className="spinner" /> : 'Search'}
                </button>
              </div>
              {results.length > 0 && (
                <ul className="results">
                  {results.map((r, i) => (
                    <li key={i} onClick={() => pickResult(r)}>
                      <div className="name">
                        {r.name}
                        {r.isWater && <span className="badge">water</span>}
                      </div>
                      <div className="meta">{r.displayName}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="row">
                <div>
                  <label>Latitude</label>
                  <input type="number" step="0.0001" placeholder="39.0968" value={clat} onChange={(e) => setClat(e.target.value)} />
                </div>
                <div>
                  <label>Longitude</label>
                  <input type="number" step="0.0001" placeholder="-120.0324" value={clon} onChange={(e) => setClon(e.target.value)} />
                </div>
              </div>
              <label>Size across ({unit === 'ft' ? 'miles' : 'km'})</label>
              <input type="number" step="0.1" value={span} onChange={(e) => setSpan(e.target.value)} />
              <button style={{ marginTop: 10, width: '100%' }} onClick={submitCoords}>Fetch this area</button>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <MapPicker bbox={bbox} onPick={(bb) => loadBathymetry(bb)} />
          </div>
        </div>

        {/* DETAILS */}
        <div className="card">
          <h2>2 · Map details</h2>
          <label>Body of water name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lake Tahoe" />
          <label>Info / description (engraved on the map)</label>
          <textarea value={info} onChange={(e) => setInfo(e.target.value)} placeholder="Max depth 1,645 ft · Surface elevation 6,225 ft · Sierra Nevada, CA/NV" />
        </div>

        {/* CONTOURS */}
        <div className="card">
          <h2>3 · Contour layers</h2>
          <label>Units</label>
          <div className="row">
            <button className={unit === 'ft' ? '' : 'secondary'} onClick={() => setUnit('ft')}>Feet</button>
            <button className={unit === 'm' ? '' : 'secondary'} onClick={() => setUnit('m')}>Meters</button>
          </div>
          <div className="row">
            <div>
              <label>Number of layers</label>
              <input type="number" min="1" max="40" value={layers} onChange={(e) => setLayers(clampInt(e.target.value, 1, 40))} />
            </div>
            <div>
              <label>{unit === 'ft' ? 'Feet' : 'Meters'} per layer</label>
              <input type="number" min="1" value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <label>Water-surface elevation (m) — auto-detected, editable</label>
          <input type="number" step="0.1" value={surface} onChange={(e) => setSurface(Number(e.target.value) || 0)} />
          {grid?.hasData && (
            <button
              className="secondary"
              style={{ marginTop: 8, width: '100%' }}
              onClick={() => {
                const totalDepthM = Math.max(1, surface - (grid.min ?? surface));
                setInterval(Math.max(1, Math.round(metersToUnit(totalDepthM / layers, unit))));
              }}
            >
              Auto-fit interval to full depth
            </button>
          )}
          {depthStats && (
            <div className="hint">
              Detected depth range in this area: <b>0 – {depthStats.minU} {unit}</b> below the surface.
            </div>
          )}
        </div>

        {/* EXTRAS */}
        <div className="card">
          <h2>4 · Overlays & style</h2>
          <label className="toggle">
            <input type="checkbox" checked={showScale} onChange={(e) => setShowScale(e.target.checked)} />
            True-scale bar (accurate for this area)
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showCompass} onChange={(e) => setShowCompass(e.target.checked)} />
            Compass (north-up)
          </label>
          <label>Render mode</label>
          <div className="row">
            <button className={renderMode === 'filled' ? '' : 'secondary'} onClick={() => setRenderMode('filled')}>Shaded art</button>
            <button className={renderMode === 'cut' ? '' : 'secondary'} onClick={() => setRenderMode('cut')}>Cut lines</button>
          </div>
          <div className="hint">
            <b>Cut lines</b> = hairline outlines, one SVG layer per depth — ready for xTool Studio / Inkscape.
          </div>
          <label>Page background</label>
          <select value={background} onChange={(e) => setBackground(e.target.value)}>
            <option value="transparent">Transparent</option>
            <option value="#ffffff">White</option>
            <option value="#f4ead2">Parchment</option>
          </select>
        </div>

        {/* EXPORT */}
        <div className="card">
          <h2>5 · Export</h2>
          <button style={{ width: '100%' }} onClick={download} disabled={!svg}>⬇ Download SVG</button>
          {grid?.source && (
            <div className="statline" style={{ marginTop: 10 }}>
              <span>Source: <b>{grid.source.label}</b></span>
              {grid.source.resolutionMeters > 0 && <span>Native cell: <b>~{grid.source.resolutionMeters} m</b></span>}
              {typeof grid.coverage === 'number' && <span>Data coverage: <b>{Math.round(grid.coverage * 100)}%</b></span>}
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {error && <div className="notice err">⚠ {error}</div>}
        {isSample && (
          <div className="notice sample">
            <b>Synthetic sample loaded.</b> This is NOT real bathymetry — it is for testing the interface offline.
            Exports are watermarked “SAMPLE”. Search a real body of water to use genuine NOAA data.
          </div>
        )}
        {loadingGrid && (
          <div className="notice"><span className="spinner" /> Fetching real elevation data from NOAA…</div>
        )}
        {noData && (
          <div className="notice">
            <b>No real bathymetry found for this exact area.</b>
            <div className="small" style={{ marginTop: 4 }}>{noData}</div>
            <div className="small" style={{ marginTop: 6 }}>
              Try a larger area, a coastal/ocean location, or one of the Great Lakes. Small inland lakes often
              have no public bathymetry — the app will not invent depths.
            </div>
          </div>
        )}

        <div className={`previewWrap ${renderMode === 'cut' || background !== 'transparent' ? 'light' : ''}`}>
          {svg ? (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 30 }}>
              {loadingGrid ? 'Loading…' : 'Search for a body of water or enter coordinates to begin.'}
            </div>
          )}
        </div>

        {scene && (
          <div className="statline">
            <span>Contour layers rendered: <b>{scene.levels.length}</b></span>
            <span>Scale bar: <b>{scene.scaleBar?.label}</b></span>
            {bbox && (
              <span className="mono">
                bbox {bbox.map((x) => x.toFixed(3)).join(', ')}
              </span>
            )}
          </div>
        )}

        <div className="footer-note">
          Depth values are real, from NOAA/NCEI topo-bathy sources. Coverage and resolution vary by location. Always
          sanity-check against a nautical chart before cutting a piece you intend to sell.
        </div>
      </main>
    </div>
  );
}

// --- helpers --------------------------------------------------------------
function clampInt(v, lo, hi) {
  const n = Math.round(Number(v) || lo);
  return Math.min(hi, Math.max(lo, n));
}

function autoSurface(g) {
  const vals = g.values.filter((v) => v != null && !Number.isNaN(v));
  if (!vals.length) return 0;
  const min = g.min ?? Math.min(...vals);
  const max = g.max ?? Math.max(...vals);
  // Coastal / ocean: the field crosses sea level → surface is 0.
  if (min < -1 && max >= -0.5) return 0;
  // Inland: approximate the shoreline as a high percentile of elevations.
  const sorted = [...vals].sort((a, b) => a - b);
  const p = sorted[Math.floor(sorted.length * 0.9)];
  return Math.round(p * 10) / 10;
}
