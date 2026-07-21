export const FT_PER_M = 3.280839895;
export const M_PER_FT = 0.3048;

export function metersToUnit(m, unit) {
  return unit === 'ft' ? m * FT_PER_M : m;
}
export function unitToMeters(v, unit) {
  return unit === 'ft' ? v * M_PER_FT : v;
}

export function formatDepth(m, unit) {
  const v = Math.round(metersToUnit(Math.abs(m), unit));
  return `${v} ${unit}`;
}

// Haversine distance in meters between [lon,lat] points.
export function haversineMeters(a, b) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pick a "nice" round bar length given a rough target distance, honoring
// metric vs imperial. Returns { meters, label }.
export function niceScaleLength(targetMeters, unit) {
  if (unit === 'ft') {
    const targetFt = targetMeters * FT_PER_M;
    const targetMi = targetFt / 5280;
    if (targetMi >= 0.5) {
      const mi = niceNumber(targetMi);
      return { meters: mi * 5280 * M_PER_FT, label: `${trim(mi)} mi` };
    }
    const ft = niceNumber(targetFt);
    return { meters: ft * M_PER_FT, label: `${trim(ft)} ft` };
  }
  if (targetMeters >= 1000) {
    const km = niceNumber(targetMeters / 1000);
    return { meters: km * 1000, label: `${trim(km)} km` };
  }
  const m = niceNumber(targetMeters);
  return { meters: m, label: `${trim(m)} m` };
}

function niceNumber(x) {
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / pow;
  let nice;
  if (f < 1.5) nice = 1;
  else if (f < 3.5) nice = 2;
  else if (f < 7.5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function trim(x) {
  return Number(x.toFixed(2)).toString();
}
