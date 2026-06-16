import L from "leaflet";
import dayjs from "dayjs";

const STORAGE = {
  DRIVERS: "gualataxi_drivers_v1",
  PASSENGER: "gualataxi_passenger_v1",
  CURRENT_DRIVER_ID: "gualataxi_current_driver",
  CURRENT_PASSENGER_ID: "gualataxi_current_passenger",
  LAST_MSG_TIME: "gualataxi_last_msg_time" // stores ISO timestamp of last message seen by current passenger
};

const ui = {
  btnPassenger: document.getElementById("btnPassenger"),
  btnDriver: document.getElementById("btnDriver"),
  passengerForm: document.getElementById("passengerForm"),
  driverForm: document.getElementById("driverForm"),
  p_name: document.getElementById("p_name"),
  p_phone: document.getElementById("p_phone"),
  p_submit: document.getElementById("p_submit"),
  p_cancel: document.getElementById("p_cancel"),
  d_name: document.getElementById("d_name"),
  d_phone: document.getElementById("d_phone"),
  d_plate: document.getElementById("d_plate"),
  d_available: document.getElementById("d_available"),
  d_submit: document.getElementById("d_submit"),
  d_cancel: document.getElementById("d_cancel"),
  driverControls: document.getElementById("driverControls"),
  driverLabel: document.getElementById("driverLabel"),
  lastRequest: document.getElementById("lastRequest"),
  toggleAvailable: document.getElementById("toggleAvailable"),
  driverLogout: document.getElementById("driverLogout"),
  toast: document.getElementById("toast")
};

let map, driverMarkers = {}, watchId = null, drivers = loadDrivers();
// layer to draw simple route polyline
let routeLayer = null;

initMap();
renderAllMarkers();
attachEvents();
checkRestoreSession();

function showToast(msg, t=2000){
  ui.toast.textContent = msg;
  ui.toast.classList.remove("hidden");
  setTimeout(()=>ui.toast.classList.add("hidden"), t);
}

function saveDrivers(){ localStorage.setItem(STORAGE.DRIVERS, JSON.stringify(drivers)); }
function loadDrivers(){ return JSON.parse(localStorage.getItem(STORAGE.DRIVERS) || "{}"); }

function initMap(){
  map = L.map("map", {center:[-0.180653, -78.467834], zoom:13, zoomControl:true});
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, attribution:"© OpenStreetMap"}).addTo(map);
}

function attachEvents(){
  ui.btnPassenger.addEventListener("click", ()=>{ openPassengerForm(); });
  ui.btnDriver.addEventListener("click", ()=>{ openDriverForm(); });
  ui.p_cancel.addEventListener("click", ()=> closePassengerForm());
  ui.d_cancel.addEventListener("click", ()=> closeDriverForm());
  ui.p_submit.addEventListener("click", passengerSubmit);
  ui.d_submit.addEventListener("click", driverSubmit);
  ui.toggleAvailable.addEventListener("click", toggleAvailability);
  ui.driverLogout.addEventListener("click", driverLogout);
}

function openPassengerForm(){
  ui.passengerForm.classList.remove("hidden");
  ui.driverForm.classList.add("hidden");
}
function closePassengerForm(){
  ui.passengerForm.classList.add("hidden");
}
function openDriverForm(){
  ui.driverForm.classList.remove("hidden");
  ui.passengerForm.classList.add("hidden");
}
function closeDriverForm(){
  ui.driverForm.classList.add("hidden");
}

function passengerSubmit(){
  const name = ui.p_name.value.trim();
  const phone = ui.p_phone.value.trim();
  if(!name || !phone){ showToast("Nombre y teléfono obligatorios"); return; }
  const id = "p_"+Date.now();
  const p = {id,name,phone,created: dayjs().toISOString()};
  // try to capture and save passenger location so we can show nearby drivers
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      p.lat = pos.coords.latitude;
      p.lon = pos.coords.longitude;
      localStorage.setItem(STORAGE.PASSENGER, JSON.stringify(p));
      localStorage.setItem(STORAGE.CURRENT_PASSENGER_ID, id);
      // initialize last-message timestamp so new/old messages are not treated as new immediately
      localStorage.setItem(STORAGE.LAST_MSG_TIME, dayjs().toISOString());
      showToast("Pasajero ingresado");
      closePassengerForm();
      // center map to passenger and show all available units (no proximity filter)
      map.setView([p.lat, p.lon], 14);
      renderAllMarkers(/*onlyAvailable=*/true, {lat: p.lat, lon: p.lon});
    }, ()=> {
      // if geolocation fails, still save passenger without location and show all available
      localStorage.setItem(STORAGE.PASSENGER, JSON.stringify(p));
      localStorage.setItem(STORAGE.CURRENT_PASSENGER_ID, id);
      showToast("Pasajero ingresado");
      closePassengerForm();
      // show all available drivers when passenger enters (no proximity filter)
      renderAllMarkers(true, null);
    }, {enableHighAccuracy:true, timeout:8000, maximumAge:5000});
  } else {
    localStorage.setItem(STORAGE.PASSENGER, JSON.stringify(p));
    localStorage.setItem(STORAGE.CURRENT_PASSENGER_ID, id);
    showToast("Pasajero ingresado");
    closePassengerForm();
    renderAllMarkers(true);
  }
}

function driverSubmit(){
  const name = ui.d_name.value.trim();
  const phone = ui.d_phone.value.trim();
  const plate = ui.d_plate.value.trim();
  const available = ui.d_available.value === "yes";
  if(!name || !phone || !plate){ showToast("Nombre, teléfono y placa obligatorios"); return; }
  const id = "d_"+plate.replace(/\s+/g,"").toLowerCase();
  drivers[id] = drivers[id] || {};
  drivers[id] = {
    id,
    name, phone, plate,
    available,
    updated: dayjs().toISOString()
  };
  saveDrivers();
  localStorage.setItem(STORAGE.CURRENT_DRIVER_ID, id);
  showToast("Conductor ingresado");
  closeDriverForm();
  startDriverSession(id);
  renderAllMarkers();
}

function checkRestoreSession(){
  const did = localStorage.getItem(STORAGE.CURRENT_DRIVER_ID);
  const pid = localStorage.getItem(STORAGE.CURRENT_PASSENGER_ID);
  if(did && drivers[did]){
    startDriverSession(did);
  } else if(pid){
    // try to use stored passenger coordinates to show nearby available drivers
    const storedP = JSON.parse(localStorage.getItem(STORAGE.PASSENGER) || "null");
    if(storedP && storedP.lat && storedP.lon){
      renderAllMarkers(true, {lat: storedP.lat, lon: storedP.lon});
    } else {
      renderAllMarkers(true);
    }
  } else {
    renderAllMarkers();
  }
}

function startDriverSession(id){
  ui.driverControls.classList.remove("hidden");
  const d = drivers[id];
  ui.driverLabel.textContent = `${d.name} • ${d.plate} • ${d.available? "Disponible":"No disponible"}`;
  ui.toggleAvailable.textContent = d.available? "Marcar no disponible":"Marcar disponible";
  // show last request if any and create "En camino" button if needed
  displayLastRequestForDriver(id);

  // create or update a "Marcar leído / En camino" button inside driverControls
  let enCaminoBtn = document.getElementById("markAsReadBtn");
  if(!enCaminoBtn){
    enCaminoBtn = document.createElement("button");
    enCaminoBtn.id = "markAsReadBtn";
    enCaminoBtn.className = "small";
    enCaminoBtn.textContent = "Marcar leído";
    enCaminoBtn.style.marginLeft = "4px";
    enCaminoBtn.addEventListener("click", ()=> {
      markRequestRead(id);
    });
    // insert before logout
    ui.driverControls.querySelector(".row").insertBefore(enCaminoBtn, ui.driverControls.querySelector(".row").children[1]);
  }

  // attempt to get current position immediately to show driver on map right away
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      drivers[id].lat = lat;
      drivers[id].lon = lon;
      drivers[id].updated = dayjs().toISOString();
      saveDrivers();
      updateDriverMarker(drivers[id]);
      // center map on driver when they first login (small zoom)
      try{ map.setView([lat, lon], Math.max(map.getZoom(), 14)); } catch(e){}
    }, ()=> {
      // ignore immediate failure; watchPosition below will still run
    }, {enableHighAccuracy:true, maximumAge:5000, timeout:8000});

    // start geolocation watch for continuous updates
    if(watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(pos=>{
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      drivers[id].lat = lat; drivers[id].lon = lon;
      drivers[id].updated = dayjs().toISOString();
      saveDrivers();
      // create/update marker
      updateDriverMarker(drivers[id]);
    }, err=>{
      showToast("No se pudo obtener ubicación");
    }, {enableHighAccuracy:true, maximumAge:3000, timeout:10000});
  } else {
    showToast("Geolocalización no disponible");
  }
}

function driverLogout(){
  const id = localStorage.getItem(STORAGE.CURRENT_DRIVER_ID);
  if(id){
    // stop watch
    if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
    // do not delete driver data — just remove current session
    localStorage.removeItem(STORAGE.CURRENT_DRIVER_ID);
    ui.driverControls.classList.add("hidden");
    showToast("Sesión de conductor finalizada");
    renderAllMarkers();
  }
}

function toggleAvailability(){
  const id = localStorage.getItem(STORAGE.CURRENT_DRIVER_ID);
  if(!id) return;
  drivers[id].available = !drivers[id].available;
  drivers[id].updated = dayjs().toISOString();
  saveDrivers();
  ui.driverLabel.textContent = `${drivers[id].name} • ${drivers[id].plate} • ${drivers[id].available? "Disponible":"No disponible"}`;
  ui.toggleAvailable.textContent = drivers[id].available? "Marcar no disponible":"Marcar disponible";
  renderAllMarkers();
}

function renderAllMarkers(onlyAvailable, passengerLocation){
  // default: show available drivers when a passenger session exists
  if(typeof onlyAvailable === "undefined"){
    onlyAvailable = !!localStorage.getItem(STORAGE.CURRENT_PASSENGER_ID);
  }
  // Do not auto-use stored passenger coords: only apply proximity filtering when
  // an explicit passengerLocation is passed to this function.

  // radius in meters to consider "nearby" (300 km)
  const NEARBY_METERS = 300000;

  // remove existing markers
  Object.values(driverMarkers).forEach(m=>map.removeLayer(m));
  driverMarkers = {};
  // add each driver, optionally filtering by availability and proximity
  Object.values(drivers).forEach(d=>{
    if(onlyAvailable && !d.available) return;
    if(d.lat && d.lon){
      if(passengerLocation){
        const dist = haversine(passengerLocation.lat, passengerLocation.lon, d.lat, d.lon);
        if(dist > NEARBY_METERS) return; // skip drivers too far
      }
      updateDriverMarker(d);
    }
  });
}

function updateDriverMarker(d){
  // marker color: green if available, gray if not
  const color = d.available ? "green" : "gray";
  const el = document.createElement("button");
  el.className = "driver-btn";
  el.style.background = d.available ? "#2ecc71" : "#95a5a6";
  el.style.border = "none";
  el.style.width = "24px";
  el.style.height = "24px";
  el.style.borderRadius = "14px";
  el.title = `${d.name} • ${d.plate} • ${d.available? "Disponible":"No disponible"}`;
  // popup content with request button if available
  const popupContent = document.createElement("div");
  popupContent.style.minWidth = "160px";
  popupContent.innerHTML = `<strong>${escapeHtml(d.name)}</strong><br/>${escapeHtml(d.plate)}<br/><small>${d.phone || ""}</small><br/>`;
  if(d.available){
    const btn = document.createElement("button");
    btn.textContent = "Solicitar servicio";
    btn.style.marginTop = "6px";
    btn.style.padding = "8px";
    btn.style.width = "100%";
    btn.addEventListener("click", ()=>{
      requestDriver(d.id);
    });
    popupContent.appendChild(btn);
  } else {
    const txt = document.createElement("div"); txt.style.marginTop="6px"; txt.textContent="No disponible";
    popupContent.appendChild(txt);
  }

  // if already marker update position and popup content
  if(driverMarkers[d.id]){
    driverMarkers[d.id].setLatLng([d.lat,d.lon]);
    driverMarkers[d.id].setPopupContent(popupContent);
    // update icon
    const icon = L.divIcon({className:"", html:el.outerHTML, iconSize:[24,24]});
    driverMarkers[d.id].setIcon(icon);
  } else {
    const icon = L.divIcon({className:"", html:el.outerHTML, iconSize:[24,24]});
    const marker = L.marker([d.lat,d.lon], {icon}).addTo(map);
    marker.bindPopup(popupContent);
    driverMarkers[d.id] = marker;
  }
}

// simple haversine distance in meters
function haversine(aLat,aLon,bLat,bLon){
  function toRad(v){ return v*Math.PI/180; }
  const R = 6371000;
  const dLat = toRad(bLat-aLat);
  const dLon = toRad(bLon-aLon);
  const lat1 = toRad(aLat), lat2 = toRad(bLat);
  const sinDlat = Math.sin(dLat/2), sinDlon = Math.sin(dLon/2);
  const a = sinDlat*sinDlat + Math.cos(lat1)*Math.cos(lat2)*sinDlon*sinDlon;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

async function getNearestIntersection(lat, lon){
  try{
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`;
    const res = await fetch(url, {headers: {'Accept':'application/json'}});
    if(!res.ok) return null;
    const j = await res.json();
    // try to build a friendly intersection/road description
    const addr = j.address || {};
    const parts = [];
    if(addr.road) parts.push(addr.road);
    if(addr.pedestrian && addr.pedestrian!==addr.road) parts.push(addr.pedestrian);
    if(addr.suburb) parts.push(addr.suburb);
    if(parts.length) return parts.join(", ");
    if(j.display_name) return j.display_name.split(",")[0];
    return null;
  }catch(e){
    return null;
  }
}

async function requestDriver(driverId){
  const pJSON = localStorage.getItem(STORAGE.PASSENGER);
  if(!pJSON){ showToast("Primero ingresa como pasajero"); return; }
  const p = JSON.parse(pJSON);
  const d = drivers[driverId];
  if(!d || !d.available){ showToast("Conductor no disponible"); return; }

  // obtain passenger location (if available) then reverse-geocode nearest street/intersection
  let plat = null, plon = null, intersection = null;
  const gotPos = await new Promise(resolve=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(pos=>{
        plat = pos.coords.latitude; plon = pos.coords.longitude;
        resolve(true);
      }, ()=> resolve(false), {enableHighAccuracy:true, timeout:8000, maximumAge:5000});
    } else resolve(false);
  });
  if(gotPos && plat!=null){
    intersection = await getNearestIntersection(plat, plon);
  }

  // build message record
  const msg = {
    id: "msg_"+Date.now(),
    driverId,
    passenger: {id:p.id, name:p.name, phone:p.phone},
    passengerLocation: (plat!=null && plon!=null) ? {lat:plat, lon:plon} : null,
    intersection: intersection || null,
    created: dayjs().toISOString()
  };

  // save message for driver
  const key = "gualataxi_messages_v1";
  const all = JSON.parse(localStorage.getItem(key) || "[]");
  all.push(msg);
  localStorage.setItem(key, JSON.stringify(all));

  // simulate request: mark driver as busy (not available) until driver toggles again
  drivers[driverId].available = false;
  drivers[driverId].updated = dayjs().toISOString();
  saveDrivers();
  renderAllMarkers();

  showToast(`Solicitud enviada a ${d.name}`);

  // play an alert if the recipient driver is currently logged in
  try{
    const currentDriver = localStorage.getItem(STORAGE.CURRENT_DRIVER_ID);
    if(currentDriver === driverId){
      playAlert();
    }
  }catch(e){}

  // visual ping: if marker exists for this driver, briefly pulse and open popup so the driver sees the request
  if(driverMarkers[driverId]){
    try{
      const marker = driverMarkers[driverId];
      // open popup with latest content
      marker.openPopup();
      // add pulse class to the underlying button element inside the marker icon
      const iconEl = marker._icon;
      if(iconEl){
        const btn = iconEl.querySelector(".driver-btn");
        if(btn){
          btn.classList.add("pulse");
          // remove pulse after 10s
          setTimeout(()=> btn.classList.remove("pulse"), 10000);
        }
      }
    }catch(e){}
  }

  // if the driver currently logged in is the recipient, show details in UI
  const currentDriver = localStorage.getItem(STORAGE.CURRENT_DRIVER_ID);
  if(currentDriver === driverId){
    displayLastRequestForDriver(driverId);
  }
}

// when driver marks request as read / en camino
async function markRequestRead(driverId){
  try{
    const messagesKey = "gualataxi_messages_v1";
    const all = JSON.parse(localStorage.getItem(messagesKey) || "[]");
    const last = all.filter(m=>m.driverId===driverId).slice(-1)[0];
    if(!last){ showToast("No hay solicitudes"); return; }
    // ensure driver has location
    const driver = drivers[driverId];
    if(!driver || !driver.lat || !driver.lon){ showToast("No se conoce tu ubicación"); return; }

    // if passenger location exists, try to get a driving route (OSRM) and open map to show it
    if(last.passengerLocation){
      const plat = last.passengerLocation.lat, plon = last.passengerLocation.lon;

      // remove previous route
      if(routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }

      // attempt to fetch a driving route from public OSRM (fallback to straight line)
      let etaText = null;
      try{
        const url = `https://router.project-osrm.org/route/v1/driving/${driver.lon},${driver.lat};${plon},${plat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if(res.ok){
          const j = await res.json();
          if(j.routes && j.routes.length){
            const r = j.routes[0];
            // draw route geometry (GeoJSON coordinates are [lon,lat])
            const coords = r.geometry.coordinates.map(c=>[c[1], c[0]]);
            routeLayer = L.polyline(coords, {color:"#2ecc71", weight:4, opacity:0.95}).addTo(map);
            try{ map.fitBounds(routeLayer.getBounds().pad(0.15)); }catch(e){}
            // use duration from route (seconds) to build ETA
            const durationSec = Math.max(30, Math.round(r.duration || 30));
            const mins = Math.round(durationSec / 60);
            etaText = mins>0 ? `${mins} min` : `${durationSec} sec`;
          }
        }
      }catch(e){
        // ignore and fallback
      }

      // fallback: straight line if OSRM failed
      if(!routeLayer){
        routeLayer = L.polyline([[driver.lat, driver.lon], [plat, plon]], {color:"#2ecc71", weight:4, opacity:0.9, dashArray: "6 6"}).addTo(map);
        try{ map.fitBounds(routeLayer.getBounds().pad(0.25)); }catch(e){}
        // estimate ETA using simple speed (40 km/h)
        const dist = haversine(driver.lat, driver.lon, plat, plon); // meters
        const speedMps = 40 * 1000 / 3600; // 40 km/h
        const etaSec = Math.max(30, Math.round(dist / speedMps)); // at least 30s
        etaText = Math.round(etaSec/60) > 0 ? `${Math.round(etaSec/60)} min` : `${Math.round(etaSec)} sec`;
      }

      // mark driver unavailable
      drivers[driverId].available = false;
      drivers[driverId].updated = dayjs().toISOString();
      saveDrivers();
      renderAllMarkers();

      // send status message to passenger (in-app)
      const passengerMsg = {
        id: "msg_status_"+Date.now(),
        driverId,
        toPassengerId: last.passenger.id,
        type: "status",
        text: `Voy en camino • ETA aprox ${etaText}`,
        eta: etaText,
        created: dayjs().toISOString()
      };
      all.push(passengerMsg);
      localStorage.setItem(messagesKey, JSON.stringify(all));

      // if passenger currently logged in, show toast and draw a marker/popup for the message
      const currentPassengerId = localStorage.getItem(STORAGE.CURRENT_PASSENGER_ID);
      if(currentPassengerId === last.passenger.id){
        showToast(`Voy en camino • ETA ${etaText}`);
        // place a temporary popup at passenger location with "Marcar leído" button for passenger
        const tmp = L.marker([plat, plon]).addTo(map);
        const popupDiv = document.createElement("div");
        popupDiv.innerHTML = `<div>Conductor ${escapeHtml(drivers[driverId].name)} — Voy en camino • ETA ${escapeHtml(etaText)}</div>`;
        const btnRead = document.createElement("button");
        btnRead.textContent = "Marcar leído";
        btnRead.style.marginTop = "6px";
        btnRead.style.padding = "6px 8px";
        btnRead.addEventListener("click", ()=>{
          try{ map.removeLayer(tmp); }catch(e){}
          passengerMarkRead(); // go to inicio
        });
        popupDiv.appendChild(btnRead);
        tmp.bindPopup(popupDiv).openPopup();
        setTimeout(()=> { try{ if(map.hasLayer(tmp)) map.removeLayer(tmp); }catch(e){} }, 12000);

        // play stronger joyful alert in the passenger session
        try{ playStrongCheer(); }catch(e){}
      }

      // update driver's UI display
      displayLastRequestForDriver(driverId);
      return;
    } else {
      showToast("No se conoce ubicación del pasajero");
    }
  }catch(e){
    console.error(e);
    showToast("Error procesando la solicitud");
  }
}

// simple cheerful tone using Web Audio API
function playCheer(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 660;
    o.connect(g); g.connect(ctx.destination);
    g.gain.value = 0;
    const now = ctx.currentTime;
    g.gain.linearRampToValueAtTime(0.12, now+0.01);
    o.frequency.setValueAtTime(660, now+0.01);
    o.frequency.exponentialRampToValueAtTime(880, now+0.15);
    o.frequency.exponentialRampToValueAtTime(660, now+0.28);
    g.gain.exponentialRampToValueAtTime(0.001, now+0.6);
    o.start(now);
    o.stop(now+0.65);
  }catch(e){}
}

// short alert tone for incoming driver requests
function playAlert(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o1.type = "square"; o2.type = "sine";
    o1.frequency.value = 880;
    o2.frequency.value = 1320;
    o1.connect(g); o2.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.18, now+0.005);
    o1.start(now);
    o2.start(now);
    o1.frequency.exponentialRampToValueAtTime(660, now+0.12);
    o2.frequency.exponentialRampToValueAtTime(990, now+0.12);
    g.gain.exponentialRampToValueAtTime(0.001, now+0.45);
    o1.stop(now+0.46);
    o2.stop(now+0.46);
  }catch(e){}
}

// stronger cheerful alert combining tones and a short chime to be clearly audible for passenger
function playStrongCheer(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // bright chime
    const ch = ctx.createOscillator();
    const gch = ctx.createGain();
    ch.type = "triangle";
    ch.frequency.value = 880;
    ch.connect(gch); gch.connect(master);
    gch.gain.value = 0.0;

    // lower warm tone
    const t1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    t1.type = "sine"; t1.frequency.value = 660;
    t1.connect(g1); g1.connect(master);
    g1.gain.value = 0.0;

    // build envelope
    master.gain.linearRampToValueAtTime(0.25, now+0.01);
    gch.gain.linearRampToValueAtTime(0.18, now+0.01);
    g1.gain.linearRampToValueAtTime(0.12, now+0.01);

    ch.start(now); t1.start(now);
    ch.frequency.exponentialRampToValueAtTime(1320, now+0.18);
    t1.frequency.exponentialRampToValueAtTime(720, now+0.18);

    // fade out
    master.gain.exponentialRampToValueAtTime(0.001, now+0.9);
    ch.stop(now+0.95);
    t1.stop(now+0.95);
  }catch(e){}
}

function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function displayLastRequestForDriver(driverId){
  try{
    const all = JSON.parse(localStorage.getItem("gualataxi_messages_v1")||"[]");
    const last = all.filter(m=>m.driverId===driverId).slice(-1)[0];
    if(!last){ ui.lastRequest.textContent = ""; return; }
    const p = last.passenger;
    const loc = last.passengerLocation ? ` • Ubicación: ${last.passengerLocation.lat.toFixed(5)},${last.passengerLocation.lon.toFixed(5)}` : "";
    const inter = last.intersection ? ` • Intersección: ${last.intersection}` : "";
    ui.lastRequest.textContent = `Solicitud de ${p.name} (${p.phone})${loc}${inter}`;
  }catch(e){
    ui.lastRequest.textContent = "";
  }
}

// passenger action to mark status as read and go to "inicio"
function passengerMarkRead(){
  // clear current passenger session and any temporary route layer, then reset map view and markers
  localStorage.removeItem(STORAGE.CURRENT_PASSENGER_ID);
  // update last seen message timestamp to avoid replaying notifications after returning to home
  localStorage.setItem(STORAGE.LAST_MSG_TIME, dayjs().toISOString());
  // keep passenger stored record but consider user returned to home
  if(routeLayer){ try{ map.removeLayer(routeLayer); }catch(e){} routeLayer = null; }
  // try to reset map to default view
  try{ map.setView([-0.180653, -78.467834], 13); }catch(e){}
  showToast("Volviendo al inicio");
  // re-render to show all drivers (not only nearby)
  renderAllMarkers();
}

// periodic refresh every 5 seconds: reload drivers & messages from storage and update UI/markers
setInterval(()=>{
  // reload drivers object from storage, keep any active session info
  const stored = JSON.parse(localStorage.getItem(STORAGE.DRIVERS) || "{}");
  drivers = Object.assign({}, stored);
  // update UI if a driver is logged in
  const did = localStorage.getItem(STORAGE.CURRENT_DRIVER_ID);
  if(did && drivers[did]){
    ui.driverLabel.textContent = `${drivers[did].name} • ${drivers[did].plate} • ${drivers[did].available? "Disponible":"No disponible"}`;
    ui.toggleAvailable.textContent = drivers[did].available? "Marcar no disponible":"Marcar disponible";
    displayLastRequestForDriver(did);
  }

  // check for new status messages for the current passenger and play joyful alert if a new one arrived
  try{
    const currentPassengerId = localStorage.getItem(STORAGE.CURRENT_PASSENGER_ID);
    if(currentPassengerId){
      const lastSeen = localStorage.getItem(STORAGE.LAST_MSG_TIME) || 0;
      const allMsgs = JSON.parse(localStorage.getItem("gualataxi_messages_v1") || "[]");
      // find newest status message targeted to this passenger
      const newStatus = allMsgs
        .filter(m => m.type === "status" && m.toPassengerId === currentPassengerId)
        .sort((a,b)=> (a.created > b.created ? -1 : 1))[0];
      if(newStatus && new Date(newStatus.created) > new Date(lastSeen)){
        // mark as seen and notify (play strong cheer)
        localStorage.setItem(STORAGE.LAST_MSG_TIME, newStatus.created);
        try{ playStrongCheer(); }catch(e){}
        // also show a brief toast
        showToast(newStatus.text || "Tienes un nuevo mensaje");
      }
    }
  }catch(e){ /* ignore message-check errors */ }

  // re-render markers (respect current passenger filter) and pass passenger location if available
  const onlyAvailable = !!localStorage.getItem(STORAGE.CURRENT_PASSENGER_ID);
  let passengerLocation = null;
  if(onlyAvailable){
    const storedP = JSON.parse(localStorage.getItem(STORAGE.PASSENGER) || "null");
    if(storedP && storedP.lat && storedP.lon) passengerLocation = {lat: storedP.lat, lon: storedP.lon};
  }
  renderAllMarkers(onlyAvailable, passengerLocation);
}, 5000);

// ensure drivers from storage are shown with default simulated positions if none exist
(function seedIfEmpty(){
  if(Object.keys(drivers).length===0){
    // create two sample drivers with simulated positions near center
    const a = {id:"d_a1", name:"Juan", phone:"099000111", plate:"GUA-001", available:true, lat:-0.182, lon:-78.467, updated: dayjs().toISOString()};
    const b = {id:"d_b2", name:"María", phone:"099000222", plate:"GUA-002", available:false, lat:-0.176, lon:-78.475, updated: dayjs().toISOString()};
    drivers[a.id]=a; drivers[b.id]=b; saveDrivers();
    renderAllMarkers();
  }
})();