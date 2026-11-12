// Real GPS from the phone, with a "pretend location" mode for testing anywhere.
import { store } from './util.js';

export function createGeo(onUpdate) {
  const G = {
    gps: null,                        // {lat,lng,acc,at}
    status: 'off',                    // off | waiting | ok | denied | unavailable
    pretend: store('pretend') || null, // {lat,lng} when pretend mode is on
    get pos() { return this.pretend ? { ...this.pretend, acc: 0, pretend: true } : this.gps; }
  };
  let watch = null;
  G.start = () => {
    if (!('geolocation' in navigator)) { G.status = 'unavailable'; onUpdate(); return; }
    if (watch != null) return;
    G.status = G.gps ? 'ok' : 'waiting'; onUpdate();
    watch = navigator.geolocation.watchPosition(
      p => { G.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; G.status = 'ok'; store('gpsOn', true); onUpdate('gps'); },
      e => { G.status = e.code === 1 ? 'denied' : 'unavailable'; if (e.code === 1) { navigator.geolocation.clearWatch(watch); watch = null; } onUpdate(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  };
  G.setPretend = ll => { G.pretend = ll ? { lat: ll.lat, lng: ll.lng } : null; store('pretend', G.pretend); onUpdate('pretend'); };
  // Start automatically if the person already allowed location before
  G.autoStart = async () => {
    try {
      if (store('gpsOn')) return G.start();
      if (navigator.permissions) { const s = await navigator.permissions.query({ name: 'geolocation' }); if (s.state === 'granted') G.start(); }
    } catch (e) { }
  };
  return G;
}
