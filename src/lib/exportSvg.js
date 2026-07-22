import { depthColor } from './scene.js';
import { formatDepth, metersToUnit } from './units.js';

// Build a fully-composed, framed SVG "art piece" from a scene. Everything the
// user needs to import into xTool Studio and cut/engrave is in one file, on
// clearly-labelled layers grouped by laser process. The live preview and the
// download use this exact function, so what you see is what you cut.
//
// Layer/process colour convention (xTool separates work by colour + layer):
//   depth contours ............ cut     (black)
//   shoreline ................. cut     (dark teal)
//   roads ..................... engrave (brown)
//   state/prov. boundaries .... score   (grey, dotted)
//   state / city labels ....... engrave (dark grey)
//   depth numbers ............. engrave (deep blue)
//   title / subtitle / frame .. engrave (warm gold)

const COLORS = {
  cut: '#111111',
  shore: '#0a3a5a',
  road: '#9c5a24',
  boundary: '#6b7280',
  place: '#333333',
  state: '#4b4b4b',
  depthLabel: '#123a5e',
  art: '#8a6d2f',
};

export function buildSvg(scene, opts = {}) {
  const {
    mode = 'filled',
    unit = 'ft',
    name = '',
    info = '',
    showScale = true,
    showCompass = true,
    showDepthLabels = true,
    showFrame = true,
    showRoads = true,
    showPlaces = true,
    showBoundaries = true,
    showStats = true,
    background = null,
    strokeWidth = null,
    isSample = false,
    // Placement + sizing
    compassCorner = 'tl',
    compassScale = 1,
    titleCorner = 'br',
    titleScale = 1,
    scaleCorner = 'bl',
    scaleScale = 1,
    depthLabelScale = 1,
    placeLabelScale = 1,
  } = opts;

  const { width: vw, height: vh, origin, levels } = scene;
  const [ox, oy] = origin;
  const sw = strokeWidth ?? Math.max(0.3, vw * 0.0016);

  // Margins: a title band is added on whichever side the title sits.
  const hasTitle = Boolean(name || info);
  const m = Math.max(vw, vh) * 0.06;
  const titleAtBottom = hasTitle && titleCorner[0] === 'b';
  const titleAtTop = hasTitle && titleCorner[0] === 't';
  const band = hasTitle ? vw * 0.11 * titleScale : 0;
  const padTop = m + (titleAtTop ? band : 0);
  const padBottom = m + (titleAtBottom ? band : 0);

  const pageX = ox - m;
  const pageY = oy - padTop;
  const pageW = vw + 2 * m;
  const pageH = vh + padTop + padBottom;
  const viewBox = `${f(pageX)} ${f(pageY)} ${f(pageW)} ${f(pageH)}`;

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
      `viewBox="${viewBox}" width="${f(pageW)}" height="${f(pageH)}" data-generator="bathy-data">`,
  );
  if (background) {
    out.push(`<rect x="${f(pageX)}" y="${f(pageY)}" width="${f(pageW)}" height="${f(pageH)}" fill="${background}"/>`);
  }

  // --- Depth layers (deepest first so shallow bands / labels sit on top) ---
  const ordered = [...levels].sort((a, b) => b.k - a.k);
  const maxK = levels.length - 1;
  for (const lvl of ordered) {
    const isShore = lvl.k === 0;
    const label = isShore ? 'Shoreline (waterline)' : `Cut · Depth ${formatDepth(lvl.depthMeters, unit)}`;
    const fill = mode === 'filled' ? depthColor(lvl.k, maxK) : 'none';
    const stroke = mode === 'cut' ? COLORS.cut : isShore ? COLORS.shore : 'none';
    const style =
      `fill:${fill};` +
      (stroke === 'none' ? 'stroke:none;' : `stroke:${stroke};stroke-width:${f(sw)};`) +
      'fill-rule:evenodd;';
    out.push(
      layer(label, `layer-cut-${lvl.k}`, `<path d="${lvl.pathData}" style="${style}"/>`, {
        [`data-depth-${unit}`]: lvl.depthUnitValue,
        'data-elevation-m': f(lvl.thresholdElevation),
      }),
    );
  }

  // --- Roads (engrave) ----------------------------------------------------
  if (showRoads && scene.overlays?.roads?.length) {
    const paths = scene.overlays.roads
      .map((r) => `<path d="${r.d}" fill="none" stroke="${COLORS.road}" stroke-width="${f(roadWidth(r.kind, vw))}" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('');
    out.push(layer('Engrave · Roads', 'layer-roads', paths));
  }

  // --- State / province boundaries (dotted score) -------------------------
  if (showBoundaries && scene.overlays?.boundaries?.length) {
    const dash = `${f(vw * 0.008)},${f(vw * 0.006)}`;
    const paths = scene.overlays.boundaries
      .map((b) => `<path d="${b.d}" fill="none" stroke="${COLORS.boundary}" stroke-width="${f(vw * 0.0024)}" stroke-dasharray="${dash}" stroke-linecap="round"/>`)
      .join('');
    out.push(layer('Score · State boundaries', 'layer-boundaries', paths));
  }

  // --- Depth number labels (engrave) --------------------------------------
  if (showDepthLabels) {
    const fs = vw * 0.014 * depthLabelScale;
    const parts = [];
    for (const lvl of levels) {
      if (lvl.k === 0 || !lvl.labelPoints?.length) continue;
      const txt = String(lvl.depthUnitValue);
      for (const [x, y] of lvl.labelPoints) {
        parts.push(
          `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-family="Arial, sans-serif" font-size="${f(fs)}" fill="${COLORS.depthLabel}" ` +
            `paint-order="stroke" stroke="#ffffff" stroke-width="${f(fs * 0.14)}">${txt}</text>`,
        );
      }
    }
    if (parts.length) out.push(layer('Engrave · Depth labels', 'layer-depthlabels', parts.join('')));
  }

  // --- State / city place labels (engrave) --------------------------------
  if (showPlaces && scene.overlays?.places?.length) {
    const parts = scene.overlays.places.map((p) => placeLabel(p, vw, placeLabelScale)).filter(Boolean);
    if (parts.length) out.push(layer('Engrave · Place labels', 'layer-places', parts.join('')));
  }

  // --- Scale bar ----------------------------------------------------------
  if (showScale && scene.scaleBar) {
    out.push(scaleBarSvg(scene, { ox, oy, vw, vh, m, corner: scaleCorner, scale: scaleScale }));
  }

  // --- Compass rose -------------------------------------------------------
  if (showCompass) {
    out.push(compassRose({ ox, oy, vw, vh, corner: compassCorner, scale: compassScale }));
  }

  // --- Title + auto stats -------------------------------------------------
  if (hasTitle) {
    out.push(titleBlock({ name, info, scene, unit, showStats, ox, oy, vw, vh, m, band, corner: titleCorner, scale: titleScale }));
  }

  // --- Frame border -------------------------------------------------------
  if (showFrame) {
    const i1 = m * 0.32;
    const i2 = m * 0.55;
    out.push(
      layer(
        'Cut · Frame',
        'layer-frame',
        `<rect x="${f(pageX + i1)}" y="${f(pageY + i1)}" width="${f(pageW - 2 * i1)}" height="${f(pageH - 2 * i1)}" fill="none" stroke="${COLORS.art}" stroke-width="${f(vw * 0.004)}"/>` +
          `<rect x="${f(pageX + i2)}" y="${f(pageY + i2)}" width="${f(pageW - 2 * i2)}" height="${f(pageH - 2 * i2)}" fill="none" stroke="${COLORS.art}" stroke-width="${f(vw * 0.0016)}"/>`,
      ),
    );
  }

  if (isSample) {
    out.push(
      layer(
        'SAMPLE WATERMARK',
        'layer-sample',
        `<text x="${f(ox + vw / 2)}" y="${f(oy + vh / 2)}" text-anchor="middle" font-family="Arial, sans-serif" ` +
          `font-size="${f(vw * 0.09)}" fill="#e11d48" opacity="0.26" transform="rotate(-24 ${f(ox + vw / 2)} ${f(oy + vh / 2)})">SAMPLE — SYNTHETIC</text>`,
      ),
    );
  }

  out.push('</svg>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------

function layer(label, id, inner, dataAttrs = {}) {
  const attrs = Object.entries(dataAttrs).map(([k, v]) => ` ${k}="${xml(v)}"`).join('');
  return `<g inkscape:groupmode="layer" inkscape:label="${xml(label)}" id="${id}"${attrs}>${inner}</g>`;
}

// Horizontal anchor from a corner code ('tl','tr','bl','br','tc','bc').
function xAnchor(corner, ox, vw, m) {
  const side = corner[1];
  if (side === 'c') return { x: ox + vw / 2, anchor: 'middle' };
  if (side === 'r') return { x: ox + vw - m * 0.25, anchor: 'end' };
  return { x: ox + m * 0.25, anchor: 'start' };
}

function roadWidth(kind, vw) {
  const base = vw * 0.0012;
  if (kind === 'motorway' || kind === 'trunk') return base * 2.2;
  if (kind === 'primary') return base * 1.6;
  if (kind === 'secondary') return base * 1.2;
  return base;
}

function placeLabel(p, vw, scale) {
  const isState = p.kind === 'state' || p.kind === 'province' || p.kind === 'region';
  const fs = (isState ? vw * 0.024 : vw * 0.015) * scale;
  const color = isState ? COLORS.state : COLORS.place;
  const text = isState ? String(p.name).toUpperCase() : p.name;
  const spacing = isState ? `letter-spacing="${f(fs * 0.2)}"` : '';
  const weight = 'font-weight="700"';
  const dot = !isState ? `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(fs * 0.16)}" fill="${color}"/>` : '';
  const ty = isState ? p.y : p.y - fs * 0.5;
  return (
    dot +
    `<text x="${f(p.x)}" y="${f(ty)}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" ${weight} ${spacing} ` +
    `font-size="${f(fs)}" fill="${color}" paint-order="stroke" stroke="#ffffff" stroke-width="${f(fs * 0.1)}">${xml(text)}</text>`
  );
}

function scaleBarSvg(scene, { ox, oy, vw, vh, m, corner, scale }) {
  const bar = scene.scaleBar;
  const fs = vw * 0.016 * scale;
  const len = Math.min(bar.lengthPx, vw * 0.4);
  const tick = vh * 0.012 * scale;
  const c = COLORS.art;
  const lw = f(vw * 0.002);
  const atBottom = corner[0] === 'b';
  const atRight = corner[1] === 'r';
  const y = atBottom ? oy + vh + m * 0.5 : oy + vh * 0.05;
  const x = atRight ? ox + vw - len - m * 0.25 : ox + m * 0.25;
  return layer(
    'Engrave · Scale bar',
    'layer-scale',
    `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + len)}" y2="${f(y)}" stroke="${c}" stroke-width="${lw}"/>` +
      `<line x1="${f(x)}" y1="${f(y - tick)}" x2="${f(x)}" y2="${f(y + tick)}" stroke="${c}" stroke-width="${lw}"/>` +
      `<line x1="${f(x + len)}" y1="${f(y - tick)}" x2="${f(x + len)}" y2="${f(y + tick)}" stroke="${c}" stroke-width="${lw}"/>` +
      `<text x="${f(x + len / 2)}" y="${f(y - tick - fs * 0.3)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${f(fs)}" fill="${c}">${xml(bar.label)}</text>`,
  );
}

function compassRose({ ox, oy, vw, vh, corner, scale }) {
  const r = Math.min(vw, vh) * 0.06 * scale;
  const inset = r + vw * 0.03;
  const atBottom = corner[0] === 'b';
  const atRight = corner[1] === 'r';
  const cx = atRight ? ox + vw - inset : ox + inset;
  const cy = atBottom ? oy + vh - inset : oy + inset;
  const c = COLORS.art;
  const lw = f(r * 0.02);
  const star = (rad, wdt) => `M${f(cx)},${f(cy - rad)} L${f(cx + wdt)},${f(cy)} L${f(cx)},${f(cy + rad)} L${f(cx - wdt)},${f(cy)} Z`;
  const fs = r * 0.42;
  return layer(
    'Engrave · Compass',
    'layer-compass',
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${c}" stroke-width="${lw}"/>` +
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.72)}" fill="none" stroke="${c}" stroke-width="${f(r * 0.01)}"/>` +
      `<path d="${star(r * 0.95, r * 0.14)}" transform="rotate(45 ${f(cx)} ${f(cy)})" fill="none" stroke="${c}" stroke-width="${f(r * 0.01)}"/>` +
      `<path d="${star(r * 0.95, r * 0.22)}" fill="${c}" opacity="0.9"/>` +
      `<path d="M${f(cx - r * 0.95)},${f(cy)} L${f(cx)},${f(cy - r * 0.22)} L${f(cx + r * 0.95)},${f(cy)} L${f(cx)},${f(cy + r * 0.22)} Z" fill="none" stroke="${c}" stroke-width="${lw}"/>` +
      `<text x="${f(cx)}" y="${f(cy - r - fs * 0.3)}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${f(fs)}" fill="${c}">N</text>` +
      `<text x="${f(cx)}" y="${f(cy + r + fs)}" text-anchor="middle" font-family="Georgia, serif" font-size="${f(fs * 0.8)}" fill="${c}">S</text>` +
      `<text x="${f(cx + r + fs * 0.5)}" y="${f(cy + fs * 0.32)}" text-anchor="middle" font-family="Georgia, serif" font-size="${f(fs * 0.8)}" fill="${c}">E</text>` +
      `<text x="${f(cx - r - fs * 0.5)}" y="${f(cy + fs * 0.32)}" text-anchor="middle" font-family="Georgia, serif" font-size="${f(fs * 0.8)}" fill="${c}">W</text>`,
  );
}

function titleBlock({ name, info, scene, unit, showStats, ox, oy, vw, vh, m, band, corner, scale }) {
  const c = COLORS.art;
  const titleSize = vw * 0.055 * scale;
  const infoSize = vw * 0.016 * scale;
  const { x, anchor } = xAnchor(corner, ox, vw, m);
  const atBottom = corner[0] === 'b';
  // Baseline of the title line: in the bottom band (below the map) or the top
  // band (above the map), inside the frame either way.
  let y = atBottom
    ? oy + vh + m * 0.45 + titleSize * 0.85
    : oy - m - band + m * 0.6 + titleSize * 0.85;

  const parts = [];
  if (name) {
    parts.push(
      `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="'Snell Roundhand','Brush Script MT','Segoe Script',cursive" ` +
        `font-style="italic" font-size="${f(titleSize)}" fill="${c}">${xml(name)}</text>`,
    );
    y += infoSize * 1.7;
  }

  const statBits = [];
  if (showStats && scene.stats) {
    const area = areaLabel(scene.stats.waterAreaM2, unit);
    if (area) statBits.push(`Surface area: ${area}`);
    if (scene.stats.maxDepthMeters != null) {
      statBits.push(`Max. depth: ${Math.round(metersToUnit(scene.stats.maxDepthMeters, unit)).toLocaleString()} ${unit}`);
    }
  }
  const infoLines = [];
  if (statBits.length) infoLines.push(statBits.join('   ·   '));
  if (info) for (const line of wrapText(info, 52).slice(0, 3)) infoLines.push(line);

  for (const line of infoLines) {
    parts.push(
      `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="Georgia,'Times New Roman',serif" ` +
        `font-size="${f(infoSize)}" fill="${c}">${xml(line)}</text>`,
    );
    y += infoSize * 1.5;
  }

  return layer('Engrave · Title', 'layer-title', parts.join(''));
}

function areaLabel(m2, unit) {
  if (!m2 || m2 <= 0) return null;
  if (unit === 'ft') {
    const sqmi = m2 / 2_589_988.11;
    if (sqmi >= 1) return `${Math.round(sqmi).toLocaleString()} sq mi`;
    return `${Math.round(m2 / 4046.8564).toLocaleString()} acres`;
  }
  const km2 = m2 / 1_000_000;
  if (km2 >= 1) return `${Math.round(km2).toLocaleString()} sq km`;
  return `${Math.round(m2 / 10000).toLocaleString()} ha`;
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const wd of words) {
    if ((cur + ' ' + wd).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = wd;
    } else cur = (cur + ' ' + wd).trim();
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function f(x) {
  return Math.round(x * 100) / 100;
}
