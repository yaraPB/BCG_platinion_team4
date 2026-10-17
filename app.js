const $ = (selector) => document.querySelector(selector);
const fmt = (n) => Number(n).toLocaleString('en-US');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel = {onplan:'On plan',rerouted:'Rerouted',fallback:'New supplier',isolated:'No open path'};
const colors = {onplan:'#087f62',rerouted:'#9bc46d',fallback:'#e5a34f',isolated:'#cc5b4d'};
const emptyFC = () => ({type:'FeatureCollection',features:[]});
const state = {network:null,plan:null,closed:new Set(),selected:'bor',scenario:'open',map:null,mapReady:false,playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,frame:null,lastFrame:0,phase:0,request:0};

function notify(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),3500)}
async function api(path, options){const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data}
const node = (id) => state.network.nodes.find((item)=>item.id===id);
const road = (id) => state.network.roads.find((item)=>item.id===id);
const point = (n) => [n.lon,n.lat];
function feature(geometry,properties={}){return {type:'Feature',geometry,properties}}

function setupScenarios(){
  const holder=$('#scenarioButtons');holder.replaceChildren();
  for(const scenario of state.network.scenarios){
    const button=document.createElement('button');button.type='button';button.textContent=scenario.label;button.dataset.scenario=scenario.id;
    button.addEventListener('click',()=>{state.scenario=scenario.id;state.closed=new Set(scenario.closed);updatePlan()});holder.append(button);
  }
  updateScenarioButtons();
}
function updateScenarioButtons(){document.querySelectorAll('[data-scenario]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.scenario===state.scenario)))}
async function updatePlan(){
  const current=++state.request;
  try{
    const plan=await api('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({closed:[...state.closed]})});
    if(current!==state.request)return;
    state.plan=plan;render();
  }catch(error){notify(error.message)}
}
function render(){
  if(!state.plan)return;
  const s=state.plan.summary;
  $('#peopleMetric').textContent=fmt(s.people_reachable);
  $('#peopleFoot').textContent=`Of ${fmt(s.total_people)} people in this model`;
  $('#tonnesMetric').textContent=`${fmt(s.tonnes_dispatched)} t`;
  $('#planMetric').textContent=`${s.onplan} / ${state.plan.deliveries.length}`;
  $('#planFoot').textContent=`${s.rerouted} rerouted · ${s.fallback} new supplier`;
  $('#actionMetric').textContent=String(s.rerouted+s.fallback+s.isolated);
  $('#actionFoot').textContent=s.isolated?`${s.isolated} destination${s.isolated===1?'':'s'} without a route`:'Destinations changed or cut off';
  const banner=$('#mapState');banner.textContent=state.closed.size?`${state.closed.size} corridor${state.closed.size===1?'':'s'} closed`:'All corridors open';banner.classList.toggle('alert',!!state.closed.size);
  $('#deliveryCount').textContent=`${state.plan.deliveries.length} routes`;
  updateScenarioButtons();renderDeliveries();renderDetail();renderCharts();updateMap();
}
function renderDeliveries(){
  $('#deliveries').innerHTML=state.plan.deliveries.map((d,index)=>`<button type="button" class="delivery ${d.id===state.selected?'active':''}" data-delivery="${esc(d.id)}" aria-pressed="${d.id===state.selected}"><span class="delivery-title"><span class="delivery-index">${String(index+1).padStart(2,'0')}</span>${esc(d.name)}</span><span class="delivery-status ${d.status}">${statusLabel[d.status]}</span><span class="delivery-meta">${fmt(d.people)} people · ${d.need} t</span><span class="delivery-sub">${d.supplier?`${esc(node(d.supplier).name)} → ${esc(d.name)} · ${d.hours.toFixed(0)} h estimated`:'No stocked hub has an open route'}</span></button>`).join('');
  document.querySelectorAll('[data-delivery]').forEach((button)=>button.addEventListener('click',()=>{state.selected=button.dataset.delivery;renderDeliveries();renderDetail();updateMap();}));
}
function renderDetail(){
  const d=state.plan.deliveries.find((item)=>item.id===state.selected)||state.plan.deliveries[0];
  if(!d)return;
  const source=d.supplier?node(d.supplier).name:'No available hub';
  const note=d.status==='onplan'?'Delivery follows its planned supplier and open corridor.':d.status==='rerouted'?'The planned supplier is still serving this community by a different path.':d.status==='fallback'?`The planned supplier cannot serve this route. ${source} now supplies it.`:'No stocked supplier can reach this community using the open corridors.';
  const through=d.nodes.slice(1,-1).map((id)=>node(id).name);
  $('#selectedDetail').innerHTML=`<div class="detail-name">${esc(d.name)}</div><div class="detail-sub">IPC phase ${d.ipc} · ${d.days} days of food remaining · ${fmt(d.people)} people</div><div class="journey"><div class="journey-stop"><i></i><strong>${esc(source)}</strong><span>SUPPLY HUB</span></div><div class="journey-line"></div><div class="journey-stop"><i></i><strong>${esc(d.name)}</strong><span>COMMUNITY</span></div></div><div class="detail-facts"><span>Food assigned<b>${d.supplier?`${d.need} tonnes`:'0 tonnes'}</b></span><span>Estimated travel<b>${d.hours==null?'—':`${d.hours.toFixed(0)} hours`}</b></span><span>Journey via<b>${esc(through.join(' → ')||'Direct corridor')}</b></span><span>Delivery state<b style="color:${colors[d.status]}">${statusLabel[d.status]}</b></span></div><div class="detail-note ${d.status==='isolated'?'bad':d.status==='onplan'?'':'warn'}">${esc(note)}</div>`;
}
function renderCharts(){
  const s=state.plan.summary,total=state.plan.deliveries.length;
  $('#outcomeChart').innerHTML=[['onplan',s.onplan],['rerouted',s.rerouted],['fallback',s.fallback],['isolated',s.isolated]].map(([key,value])=>`<div class="outcome-row"><div class="outcome-label"><span>${statusLabel[key]}</span><b>${value} / ${total}</b></div><div class="track"><div class="fill ${key}" style="width:${value/total*100}%"></div></div></div>`).join('');
  const risks=[...state.network.roads].sort((a,b)=>b.risk-a.risk).slice(0,5);
  $('#riskChart').innerHTML=risks.map((r)=>`<div class="risk-row ${state.closed.has(r.id)?'closed':''}"><span class="name" title="${esc(r.name)}">${esc(r.name)}</span><span class="risk-track"><i style="width:${r.risk*100/0.3}%"></i></span><b>${Math.round(r.risk*100)}%</b></div>`).join('');
}

function updateMap(){
  if(!state.network||!state.plan)return;
  if(!state.mapReady){renderFallback();return}
  const roads=state.network.roads.map((r)=>feature({type:'LineString',coordinates:[point(node(r.from_node)),point(node(r.to_node))]},{id:r.id,name:r.name,closed:state.closed.has(r.id)?1:0}));
  const nodes=state.network.nodes.map((n)=>feature({type:'Point',coordinates:point(n)},{id:n.id,name:n.name,kind:n.kind,selected:n.id===state.selected?1:0}));
  const routes=state.plan.deliveries.filter((d)=>d.supplier&&d.id!==state.selected).map((d)=>feature({type:'LineString',coordinates:d.coordinates},{id:d.id,status:d.status}));
  const selected=state.plan.deliveries.find((d)=>d.id===state.selected);
  const active=selected?.supplier?[feature({type:'LineString',coordinates:selected.coordinates},{status:selected.status})]:[];
  state.map.getSource('roads').setData({type:'FeatureCollection',features:roads});
  state.map.getSource('nodes').setData({type:'FeatureCollection',features:nodes});
  state.map.getSource('routes').setData({type:'FeatureCollection',features:routes});
  state.map.getSource('selected-route').setData({type:'FeatureCollection',features:active});
  renderFallback();
}
function createMap(){
  if(typeof maplibregl==='undefined'){showFallback();return}
  try{
    const map=new maplibregl.Map({container:'map',style:{version:8,sources:{basemap:{type:'raster',tiles:['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors © CARTO'}},layers:[{id:'basemap',type:'raster',source:'basemap',paint:{'raster-opacity':.84}}]},center:[30.4,8],zoom:5.3,minZoom:4,maxZoom:10,attributionControl:false});
    state.map=map;map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
    map.on('load',()=>{
      for(const id of ['roads','nodes','routes','selected-route','vehicles'])map.addSource(id,{type:'geojson',data:emptyFC()});
      map.addLayer({id:'road-lines',type:'line',source:'roads',paint:{'line-color':['case',['==',['get','closed'],1],'#d57567','#b5c6b9'],'line-width':['case',['==',['get','closed'],1],3,2],'line-dasharray':[2,1.5]}});
      map.addLayer({id:'other-routes',type:'line',source:'routes',paint:{'line-color':'#4da387','line-width':3,'line-opacity':.3}});
      map.addLayer({id:'selected-halo',type:'line',source:'selected-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#d4efd8','line-width':12,'line-opacity':.85}});
      map.addLayer({id:'selected-line',type:'line',source:'selected-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['case',['==',['get','status'],'fallback'],'#e2a24c','#087f62'],'line-width':5}});
      map.addLayer({id:'node-halos',type:'circle',source:'nodes',paint:{'circle-radius':['case',['==',['get','kind'],'hub'],13,10],'circle-color':'#fff','circle-stroke-color':'#fff','circle-stroke-width':1}});
      map.addLayer({id:'node-dots',type:'circle',source:'nodes',paint:{'circle-radius':['case',['==',['get','kind'],'hub'],8,['==',['get','selected'],1],7,5],'circle-color':['case',['==',['get','kind'],'hub'],'#087f62',['==',['get','kind'],'community'],'#e5a34f','#91aa9c'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
      map.addLayer({id:'vehicles',type:'circle',source:'vehicles',paint:{'circle-radius':6,'circle-color':'#fff','circle-stroke-color':'#087f62','circle-stroke-width':3}});
      map.addLayer({id:'node-labels',type:'symbol',source:'nodes',layout:{'text-field':['get','name'],'text-size':12,'text-font':['Open Sans Regular','Arial Unicode MS Regular'],'text-offset':[0,1.55],'text-anchor':'top'},paint:{'text-color':'#244b3b','text-halo-color':'#fff','text-halo-width':2}});
      map.on('click','node-dots',(event)=>{const id=event.features?.[0]?.properties?.id;if(node(id)?.kind==='community'){state.selected=id;renderDeliveries();renderDetail();updateMap()}});
      map.on('click','road-lines',(event)=>{const id=event.features?.[0]?.properties?.id;if(id)toggleRoad(id)});
      for(const layer of ['node-dots','road-lines']){map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='')}
      state.mapReady=true;updateMap();animate(performance.now());
    });
    map.on('error',()=>{if(!state.mapReady)showFallback()});
    setTimeout(()=>{if(!state.mapReady)showFallback()},10000);
  }catch(error){showFallback()}
}
function showFallback(){$('#map').hidden=true;$('#mapFallback').hidden=false;renderFallback()}
function renderFallback(){
  if($('#mapFallback').hidden||!state.network||!state.plan)return;
  const x=(lon)=>((lon-26.6)/(33.7-26.6))*900;
  const y=(lat)=>((12.5-lat)/(12.5-3.2))*560;
  const selected=state.plan.deliveries.find((d)=>d.id===state.selected);
  const roads=state.network.roads.map((r)=>{const a=node(r.from_node),b=node(r.to_node);return `<line x1="${x(a.lon)}" y1="${y(a.lat)}" x2="${x(b.lon)}" y2="${y(b.lat)}" stroke="${state.closed.has(r.id)?'#cc5b4d':'#a9c5b6'}" stroke-width="3" stroke-dasharray="${state.closed.has(r.id)?'6 4':'none'}" data-road="${r.id}"><title>${esc(r.name)} · click to ${state.closed.has(r.id)?'reopen':'close'}</title></line>`}).join('');
  const route=selected?.supplier?`<polyline points="${selected.coordinates.map(([lon,lat])=>`${x(lon)},${y(lat)}`).join(' ')}" fill="none" stroke="#087f62" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`:'';
  const nodes=state.network.nodes.map((n)=>`<g data-node="${n.id}"><circle cx="${x(n.lon)}" cy="${y(n.lat)}" r="${n.kind==='hub'?10:7}" fill="${n.kind==='hub'?'#087f62':n.kind==='community'?'#e5a34f':'#9eb1a3'}" stroke="white" stroke-width="3"/><text x="${x(n.lon)+10}" y="${y(n.lat)-10}" fill="#244b3b" font-size="13" font-weight="700">${esc(n.name)}</text></g>`).join('');
  $('#mapFallback').innerHTML=`<svg viewBox="0 0 900 560" role="img" aria-label="Schematic food corridor map"><rect width="900" height="560" fill="#eaf0e8"/><path d="M0 100H900M0 220H900M0 340H900M0 460H900M150 0V560M300 0V560M450 0V560M600 0V560M750 0V560" stroke="#dce8df" stroke-width="1"/>${roads}${route}${nodes}</svg>`;
  $('#mapFallback').querySelectorAll('[data-road]').forEach((el)=>el.addEventListener('click',()=>toggleRoad(el.dataset.road)));
  $('#mapFallback').querySelectorAll('[data-node]').forEach((el)=>el.addEventListener('click',()=>{if(node(el.dataset.node)?.kind==='community'){state.selected=el.dataset.node;render()}}));
}
function toggleRoad(id){if(state.closed.has(id))state.closed.delete(id);else state.closed.add(id);state.scenario='custom';updatePlan();notify(`${road(id).name} ${state.closed.has(id)?'closed':'reopened'}`)}
function interpolate(coordinates,t){if(coordinates.length<2)return coordinates[0];const lengths=[];let total=0;for(let i=1;i<coordinates.length;i++){const a=coordinates[i-1],b=coordinates[i];const length=Math.hypot((b[0]-a[0])*Math.cos(a[1]*Math.PI/180),b[1]-a[1]);lengths.push(length);total+=length}let remaining=t*total;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const a=coordinates[i],b=coordinates[i+1],f=lengths[i]?Math.min(1,remaining/lengths[i]):0;return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]}remaining-=lengths[i]}return coordinates.at(-1)}
function animate(now){state.frame=requestAnimationFrame(animate);if(!state.mapReady||!state.playing||!state.plan||now-state.lastFrame<70)return;state.lastFrame=now;state.phase=(state.phase+.0028)%1;const features=state.plan.deliveries.filter((d)=>d.supplier).map((d,i)=>feature({type:'Point',coordinates:interpolate(d.coordinates,(state.phase+i*.12)%1)},{id:d.id}));state.map.getSource('vehicles').setData({type:'FeatureCollection',features})}

async function init(){
  try{state.network=await api('/api/network');setupScenarios();const result=await api('/api/plan');state.plan=result;render();createMap()}
  catch(error){notify(`Could not load the demo: ${error.message}`);$('#deliveries').textContent='Start the local server to load the network.'}
  $('#resetButton').addEventListener('click',()=>{state.closed.clear();state.scenario='open';updatePlan()});
  $('#animateButton').addEventListener('click',()=>{state.playing=!state.playing;$('#animateButton').textContent=state.playing?'Ⅱ Pause flow':'▶ Play flow';$('#animateButton').setAttribute('aria-pressed',String(state.playing));if(!state.playing&&state.mapReady)state.map.getSource('vehicles').setData(emptyFC())});
  $('#animateButton').textContent=state.playing?'Ⅱ Pause flow':'▶ Play flow';$('#animateButton').setAttribute('aria-pressed',String(state.playing));
}
init();
