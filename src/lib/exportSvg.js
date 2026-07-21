import { depthColor } from './scene.js';
import { formatDepth } from './units.js';

// Build a layered SVG string from a scene. Used for BOTH the live preview and
// the downloaded file, so what you see is exactly what you cut.
//
// opts: {
//   mode: 'filled' | 'cut',   // filled = shaded art preview; cut = hairline outlines
//   showScale, showCompass,   // booleans
//   name, info,               // editable text
//   unit,                     // 'ft' | 'm'
//   strokeColor, strokeWidth, // cut styling
//   background,               // page background (null = transparent)
//   isSample,                 // stamp a SAMPLE watermark for synthetic data
// }
export function buildSvg(scene, opts = {}) {
  const {
    mode = 'filled',
    showScale = true,
    showCompass = true,
    name = '',
    info = '',
    unit = 'ft',
    strokeColor = '#111111',
    strokeWidth = null,
    background = null,
    isSample = false,
  } = opts;

  const { width: vw, height: vh, origin, levels } = scene;
  const [ox, oy] = origin;

  const hasTitle = Boolean(name || info);
  const marginTop = hasTitle ? vh * 0.14 : vh * 0.02;
  const marginBottom = showScale || showCompass ? vh * 0.12 : vh * 0.02;
  const pageX = ox - vw * 0.02;
  const pageY = oy - marginTop;
  const pageW = vw * 1.04;
  const pageH = vh + marginTop + marginBottom;
  const viewBox = `${f(pageX)} ${f(pageY)} ${f(pageW)} ${f(pageH)}`;
  const sw = strokeWidth ?? Math.max(0.3, vw * 0.0016);

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
      `viewBox="${viewBox}" width="${f(pageW)}" height="${f(pageH)}" data-generator="bathy-data">`,
  );

  if (background) {
    out.push(`<rect x="${f(pageX)}" y="${f(pageY)}" width="${f(pageW)}" height="${f(pageH)}" fill="${background}"/>`);
  }

  // --- Depth layers -------------------------------------------------------
  // Deepest drawn first so shallow bands sit on top (correct shading + stacking).
  const ordered = [...levels].sort((a, b) => b.k - a.k);
  for (const lvl of ordered) {
    const isShore = lvl.k === 0;
    const label = isShore
      ? 'Shoreline (waterline)'
      : `Depth ${formatDepth(lvl.depthMeters, unit)}`;
    const fill = mode === 'filled' ? depthColor(lvl.k, levels.length - 1) : 'none';
    const stroke = mode === 'cut' ? strokeColor : isShore ? '#0a3a5a' : 'none';
    const style =
      `fill:${fill};` +
      (stroke === 'none' ? 'stroke:none;' : `stroke:${stroke};stroke-width:${f(sw)};`) +
      'fill-rule:evenodd;';
    out.push(
      `<g inkscape:groupmode="layer" inkscape:label="${xml(label)}" id="layer-${lvl.k}" ` +
        `data-depth-${unit}="${lvl.depthUnitValue}" data-elevation-m="${f(lvl.thresholdElevation)}">` +
        `<path d="${lvl.pathData}" style="${style}"/></g>`,
    );
  }

  // --- Scale bar ----------------------------------------------------------
  if (showScale && scene.scaleBar) {
    out.push(scaleBarSvg(scene, { ox, oy, vw, vh, marginBottom, strokeColor }));
  }

  // --- Compass ------------------------------------------------------------
  if (showCompass) {
    out.push(compassSvg({ ox, oy, vw, vh, marginBottom, strokeColor }));
  }

  // --- Title / info -------------------------------------------------------
  if (hasTitle) {
    const titleSize = vw * 0.032;
    const infoSize = vw * 0.016;
    const tx = ox + vw * 0.02;
    let ty = oy - marginTop + titleSize;
    const parts = [`<g inkscape:groupmode="layer" inkscape:label="Title" id="layer-title">`];
    if (name) {
      parts.push(
        `<text x="${f(tx)}" y="${f(ty)}" font-family="Georgia, 'Times New Roman', serif" ` +
          `font-size="${f(titleSize)}" font-weight="700" fill="${strokeColor}">${xml(name)}</text>`,
      );
      ty += infoSize * 1.6;
    }
    if (info) {
      for (const line of wrapText(info, 60).slice(0, 4)) {
        parts.push(
          `<text x="${f(tx)}" y="${f(ty)}" font-family="Georgia, 'Times New Roman', serif" ` +
            `font-size="${f(infoSize)}" fill="${strokeColor}">${xml(line)}</text>`,
        );
        ty += infoSize * 1.4;
      }
    }
    parts.push('</g>');
    out.push(parts.join(''));
  }

  if (isSample) {
    out.push(
      `<g inkscape:groupmode="layer" inkscape:label="SAMPLE WATERMARK" id="layer-sample">` +
        `<text x="${f(ox + vw / 2)}" y="${f(oy + vh / 2)}" text-anchor="middle" ` +
        `font-family="Arial, sans-serif" font-size="${f(vw * 0.09)}" fill="#e11d48" ` +
        `opacity="0.28" transform="rotate(-24 ${f(ox + vw / 2)} ${f(oy + vh / 2)})">SAMPLE — SYNTHETIC</text></g>`,
    );
  }

  out.push('</svg>');
  return out.join('\n');
}

function scaleBarSvg(scene, { ox, oy, vw, vh, marginBottom, strokeColor }) {
  const bar = scene.scaleBar;
  const y = oy + vh + marginBottom * 0.55;
  const x = ox + vw * 0.03;
  const len = Math.min(bar.lengthPx, vw * 0.4);
  const tick = vh * 0.012;
  const fs = vw * 0.016;
  return (
    `<g inkscape:groupmode="layer" inkscape:label="Scale bar" id="layer-scale">` +
    `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + len)}" y2="${f(y)}" stroke="${strokeColor}" stroke-width="${f(vw * 0.002)}"/>` +
    `<line x1="${f(x)}" y1="${f(y - tick)}" x2="${f(x)}" y2="${f(y + tick)}" stroke="${strokeColor}" stroke-width="${f(vw * 0.002)}"/>` +
    `<line x1="${f(x + len)}" y1="${f(y - tick)}" x2="${f(x + len)}" y2="${f(y + tick)}" stroke="${strokeColor}" stroke-width="${f(vw * 0.002)}"/>` +
    `<text x="${f(x + len / 2)}" y="${f(y - tick - fs * 0.3)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${f(fs)}" fill="${strokeColor}">${xml(bar.label)}</text>` +
    `</g>`
  );
}

function compassSvg({ ox, oy, vw, vh, marginBottom, strokeColor }) {
  const r = Math.min(vw, vh) * 0.045;
  const cx = ox + vw - vw * 0.06;
  const cy = oy + vh + marginBottom * 0.5;
  const fs = r * 0.7;
  // North-up arrow (projections here are north-up).
  return (
    `<g inkscape:groupmode="layer" inkscape:label="Compass" id="layer-compass">` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${strokeColor}" stroke-width="${f(vw * 0.0018)}"/>` +
    `<path d="M${f(cx)},${f(cy - r * 0.8)} L${f(cx + r * 0.28)},${f(cy)} L${f(cx)},${f(cy - r * 0.2)} L${f(cx - r * 0.28)},${f(cy)} Z" fill="${strokeColor}"/>` +
    `<path d="M${f(cx)},${f(cy + r * 0.8)} L${f(cx + r * 0.28)},${f(cy)} L${f(cx)},${f(cy + r * 0.2)} L${f(cx - r * 0.28)},${f(cy)} Z" fill="none" stroke="${strokeColor}" stroke-width="${f(vw * 0.0015)}"/>` +
    `<text x="${f(cx)}" y="${f(cy - r - fs * 0.25)}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${f(fs)}" fill="${strokeColor}">N</text>` +
    `</g>`
  );
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const wd of words) {
    if ((cur + ' ' + wd).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = wd;
    } else {
      cur = (cur + ' ' + wd).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

function xml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function f(x) {
  return Math.round(x * 100) / 100;
}
