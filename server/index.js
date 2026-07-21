import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { searchWaterBody } from './geocode.js';
import { fetchBathymetryGrid } from './bathymetry.js';
import { SOURCES } from './datasources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8787;

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// --- API ------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, sources: SOURCES.map((s) => ({ id: s.id, label: s.label })) });
});

// Search for a body of water by name.
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing ?q=' });
  try {
    const results = await searchWaterBody(q);
    res.json({ query: q, results });
  } catch (err) {
    res.status(502).json({ error: `Search failed: ${err.message}` });
  }
});

// Fetch a real elevation/depth grid for a bbox.
// Query: ?bbox=west,south,east,north  [&maxDim=480] [&source=crm|global]
app.get('/api/bathymetry', async (req, res) => {
  const raw = (req.query.bbox || '').toString();
  const bbox = raw.split(',').map(Number);
  if (bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: 'bbox must be "west,south,east,north"' });
  }
  const [w, s, e, n] = bbox;
  if (w >= e || s >= n) {
    return res.status(400).json({ error: 'bbox must have west<east and south<north' });
  }
  // Guard against absurdly large requests (keeps us a good NOAA citizen).
  if (e - w > 12 || n - s > 12) {
    return res.status(400).json({ error: 'bbox is too large; select a smaller area (<= ~12 degrees).' });
  }

  const maxDim = Math.min(Math.max(Number(req.query.maxDim) || 480, 64), 1024);
  const sourceId = req.query.source ? req.query.source.toString() : undefined;

  try {
    const grid = await fetchBathymetryGrid(bbox, { maxDim, sourceId });
    res.json(grid);
  } catch (err) {
    res.status(502).json({ error: `Bathymetry fetch failed: ${err.message}` });
  }
});

// --- Static frontend (production build) -----------------------------------

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[bathy-data] API listening on http://localhost:${PORT}`);
  if (!fs.existsSync(dist)) {
    console.log('[bathy-data] (dev) run `npm run dev` and open the Vite URL, or `npm run build` first.');
  }
});
