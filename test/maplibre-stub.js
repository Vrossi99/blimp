class Ev { constructor(){ this.h={}; } on(n,f){ (this.h[n]=this.h[n]||[]).push(f); return this; } fire(n,a){ (this.h[n]||[]).forEach(f=>f(a)); } }
class Map extends Ev {
  constructor(o){ super(); this.c={lng:o.center[0],lat:o.center[1]}; this.z=o.zoom; this.src={}; this.layers=[]; this.touchZoomRotate={disableRotation(){}}; window.__map=this; setTimeout(()=>this.fire('load'),0); }
  getStyle(){ return {layers:[{id:'background',type:'background'},{id:'water',type:'fill','source-layer':'water'},{id:'road_minor',type:'line','source-layer':'transportation'}]}; }
  setPaintProperty(){} setLayoutProperty(){}
  addSource(id,s){ this.src[id]={data:s.data,setData:d=>{this.src[id].data=d;}}; } getSource(id){ return this.src[id]; } addLayer(l){ this.layers.push(l); }
  easeTo(o){ if(o.center)this.c={lng:o.center[0],lat:o.center[1]}; if(o.zoom!=null)this.z=o.zoom; } jumpTo(o){ this.easeTo(o); }
  getCenter(){ return this.c; } getZoom(){ return this.z; } resize(){}
}
class Marker { constructor(o){ this.el=o.element; } setLngLat(ll){ this.ll=ll; return this; } addTo(m){ (m.__mk=m.__mk||[]).push(this); document.body.appendChild(this.el); return this; } remove(){ this.el.remove(); } getElement(){ return this.el; } }
export default { Map, Marker };
