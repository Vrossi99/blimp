// Real map: MapLibre + free OpenFreeMap tiles, recolored into Blimp's look.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PAL, MARK, circlePolygon, HOME_CENTER, hash, COLORS, esc } from './util.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const C = { land: '#F1F0EB', water: '#CFE0FF', park: '#DCEBD8', building: '#E7E6E0', road: '#FFFFFF', casing: '#E2E1DA', label: '#6E6D68', waterLabel: '#3D63B8' };

function recolor(map) {
  const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch (e) { } };
  for (const l of map.getStyle().layers) {
    const src = l['source-layer'] || '', id = l.id;
    if (l.type === 'background') set(id, 'background-color', C.land);
    else if (l.type === 'fill') {
      if (src === 'water') set(id, 'fill-color', C.water);
      else if (src === 'park' || (src === 'landcover' && /grass|wood|park|wetland/.test(id))) set(id, 'fill-color', C.park);
      else if (src === 'building') { set(id, 'fill-color', C.building); set(id, 'fill-outline-color', '#DEDDD6'); }
      else if (src === 'landuse' || src === 'landcover' || src === 'aeroway') set(id, 'fill-color', '#ECEBE5');
    } else if (l.type === 'fill-extrusion') set(id, 'fill-extrusion-color', C.building);
    else if (l.type === 'line') {
      if (src === 'waterway') set(id, 'line-color', C.water);
      else if (src === 'transportation') set(id, 'line-color', /casing|outline/.test(id) ? C.casing : C.road);
    } else if (l.type === 'symbol') {
      const water = src === 'water_name' || src === 'waterway';
      set(id, 'text-color', water ? C.waterLabel : C.label);
      set(id, 'text-halo-color', C.land); set(id, 'text-halo-width', 1.4);
      if (src === 'poi') try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) { }
    }
  }
}

export function createMap(el, { onTap, onPick }) {
  const map = new maplibregl.Map({
    container: el, style: STYLE_URL, center: [HOME_CENTER.lng, HOME_CENTER.lat], zoom: 15.2,
    attributionControl: { compact: true }, pitchWithRotate: false, dragRotate: false
  });
  map.touchZoomRotate.disableRotation();
  const state = { drops: [], focus: null, sel: null, claims: [], me: null, ready: false, failed: false };
  const markers = new Map();
  let meMarker = null;

  map.on('error', e => { if (!state.ready && /style|fetch|load/i.test(String(e && e.error && e.error.message))) { state.failed = true; el.dataset.failed = '1'; } });
  map.on('load', () => {
    recolor(map);
    map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } });
    map.addLayer({ id: 'zone-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': ['get', 'lop'] } });
    map.addSource('claims', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'claim-dots', type: 'circle', source: 'claims', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.5 } });
    state.ready = true; draw();
  });
  map.on('click', e => onTap && onTap({ lat: e.lngLat.lat, lng: e.lngLat.lng }));

  function markerEl(d) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'mk'; el.setAttribute('aria-label', d.name);
    el.addEventListener('click', ev => { ev.stopPropagation(); onPick && onPick(d.id); });
    return el;
  }
  function paintMarker(el, d) {
    const big = state.sel === d.id || state.focus === d.id, dim = state.focus && state.focus !== d.id, col = PAL[d.color] || PAL.Green;
    el.className = 'mk' + (big ? ' big' : '') + (dim ? ' dim' : '') + (d.official ? ' off' : '');
    el.style.setProperty('--c', col);
    el.innerHTML = '<span class="pulse"></span><span class="tile"><svg viewBox="4 0 100 52" aria-hidden="true"><g fill="' + (d.official ? '#111111' : col) + '">' + MARK + '</g></svg></span>' + (big && !state.focus ? '<span class="lbl">' + esc(d.name) + '</span>' : '');
    el.setAttribute('aria-label', d.name);
  }
  function draw() {
    if (!state.ready) return;
    const hi = state.focus || state.sel;
    map.getSource('zones').setData({ type: 'FeatureCollection', features: state.drops.map(d => {
      const dim = state.focus && state.focus !== d.id;
      return { type: 'Feature', properties: { color: PAL[d.color] || PAL.Green, op: dim ? 0.05 : (hi === d.id ? 0.24 : 0.15), lop: dim ? 0.3 : 1 }, geometry: { type: 'Polygon', coordinates: [circlePolygon(d.lat, d.lng, d.r)] } };
    }) });
    map.getSource('claims').setData({ type: 'FeatureCollection', features: state.claims.filter(c => c.lat != null).map(c => ({ type: 'Feature', properties: { color: PAL[COLORS[hash(c.id) % 5]] }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) });
    const keep = new Set(state.drops.map(d => d.id));
    for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
    state.drops.forEach(d => {
      let m = markers.get(d.id);
      if (!m) { m = new maplibregl.Marker({ element: markerEl(d) }).setLngLat([d.lng, d.lat]).addTo(map); markers.set(d.id, m); }
      else m.setLngLat([d.lng, d.lat]);
      paintMarker(m.getElement(), d);
    });
    if (state.me) {
      if (!meMarker) { const e = document.createElement('div'); e.className = 'me'; meMarker = new maplibregl.Marker({ element: e }).setLngLat([state.me.lng, state.me.lat]).addTo(map); }
      else meMarker.setLngLat([state.me.lng, state.me.lat]);
      meMarker.getElement().classList.toggle('pretend', !!state.me.pretend);
    } else if (meMarker) { meMarker.remove(); meMarker = null; }
  }

  return {
    map,
    get failed() { return state.failed; },
    set(opts) { Object.assign(state, opts); draw(); },
    fly(lat, lng, zoom, offsetY) { map.easeTo({ center: [lng, lat], zoom: zoom ?? map.getZoom(), offset: [0, -(offsetY || 0)], duration: 600 }); },
    jump(lat, lng, zoom) { map.jumpTo({ center: [lng, lat], zoom: zoom ?? map.getZoom() }); },
    zoomBy(n) { map.easeTo({ zoom: map.getZoom() + n, duration: 250 }); },
    view() { const c = map.getCenter(); return { lat: c.lat, lng: c.lng, zoom: map.getZoom() }; },
    resize() { map.resize(); }
  };
}
