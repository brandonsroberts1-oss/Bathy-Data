import React, { useState } from 'react';
import { MapContainer, TileLayer, Rectangle, CircleMarker, useMap, useMapEvents } from 'react-leaflet';

// bbox is [west, south, east, north]. Leaflet bounds are [[s,w],[n,e]].
function toLeaflet(bbox) {
  if (!bbox) return null;
  const [w, s, e, n] = bbox;
  return [[s, w], [n, e]];
}

function FitToBbox({ bbox }) {
  const map = useMap();
  React.useEffect(() => {
    if (bbox) map.fitBounds(toLeaflet(bbox), { padding: [16, 16] });
  }, [bbox && bbox.join(','), map]);
  return null;
}

function DrawCapture({ drawing, corners, setCorners, onComplete }) {
  useMapEvents({
    click(e) {
      if (!drawing) return;
      const pt = [e.latlng.lng, e.latlng.lat]; // [lon,lat]
      if (corners.length === 0 || corners.length >= 2) {
        setCorners([pt]);
      } else {
        const [a] = corners;
        const b = pt;
        setCorners([a, b]);
        const w = Math.min(a[0], b[0]);
        const e2 = Math.max(a[0], b[0]);
        const s = Math.min(a[1], b[1]);
        const n = Math.max(a[1], b[1]);
        onComplete([w, s, e2, n]);
      }
    },
  });
  return null;
}

export default function MapPicker({ bbox, onPick }) {
  const [drawing, setDrawing] = useState(false);
  const [corners, setCorners] = useState([]);

  const rect = toLeaflet(bbox);
  const center = bbox
    ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]
    : [39.5, -98.35]; // center of the contiguous U.S.

  return (
    <div>
      <div className="mapbox">
        <MapContainer center={center} zoom={bbox ? 9 : 4} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {rect && <Rectangle bounds={rect} pathOptions={{ color: '#3aa0ff', weight: 2, fillOpacity: 0.08 }} />}
          {corners.map((c, i) => (
            <CircleMarker key={i} center={[c[1], c[0]]} radius={5} pathOptions={{ color: '#17c0a8' }} />
          ))}
          <FitToBbox bbox={drawing ? null : bbox} />
          <DrawCapture
            drawing={drawing}
            corners={corners}
            setCorners={setCorners}
            onComplete={(bb) => {
              setDrawing(false);
              setCorners([]);
              onPick(bb);
            }}
          />
          <ViewGrabber />
        </MapContainer>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className={drawing ? 'ghost' : 'secondary'}
          onClick={() => {
            setDrawing((d) => !d);
            setCorners([]);
          }}
        >
          {drawing ? 'Click two corners…' : 'Draw a box'}
        </button>
        <UseViewButton onPick={onPick} />
      </div>
      <div className="hint">
        Pan/zoom to frame the water body, then <b>Use current view</b> — or <b>Draw a box</b> for a precise area.
      </div>
    </div>
  );
}

// Exposes the current map instance so the "Use current view" button can read
// its bounds on click.
let mapRef = null;
function ViewGrabber() {
  const map = useMap();
  mapRef = map;
  return null;
}
function UseViewButton({ onPick }) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        if (!mapRef) return;
        const b = mapRef.getBounds();
        onPick([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      }}
    >
      Use current view
    </button>
  );
}
