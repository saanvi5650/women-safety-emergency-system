/* SheShield Safety Map: live location, community danger reports, nearby help and safest routes.
   Uses free OpenStreetMap services, so no API keys are needed:
   - Tiles: OpenStreetMap
   - Places: Nominatim (search) and Overpass (police stations, hospitals)
   - Routing: FOSSGIS OSRM (routing.openstreetmap.de) */

const CATEGORY_META = {
  harassment: ["Harassment", "🗣️"],
  stalking: ["Stalking", "👣"],
  poor_lighting: ["Poor lighting", "💡"],
  deserted: ["Deserted area", "🌫️"],
  unsafe_transport: ["Unsafe transport", "🚌"],
  theft: ["Theft / snatching", "👜"],
  assault: ["Assault", "⚠️"],
  other: ["Other", "📍"],
};
const SEVERITY_COLOR = { 1: "#f59e0b", 2: "#f97316", 3: "#dc2626" };
const SEVERITY_LABEL = { 1: "Low", 2: "Medium", 3: "High" };
const POI_META = { police: ["🚓", "Police station"], hospital: ["🏥", "Hospital"] };
const ROUTE_BUFFER_M = 120;

const mapState = {
  map: null,
  me: null,
  meMarker: null,
  accuracyCircle: null,
  reports: [],
  reportLayer: null,
  heatLayer: null,
  poiLayer: null,
  pois: [],
  routeLayer: null,
  routes: [],
  destination: null,
  reportPoint: null,
  reportMode: false,
  centeredOnce: false,
};

const isNightHour = (date) => {
  const h = new Date(date).getHours();
  return h >= 19 || h < 6;
};

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- Setup ---------- */

window.initMap = function initMap() {
  if (typeof L === "undefined") {
    $("#map").innerHTML = '<p class="map-error">The map library could not load. Check your internet connection.</p>';
    return;
  }

  // Keep the map within India for now.
  const bounds = L.latLngBounds([INDIA_BOUNDS.south, INDIA_BOUNDS.west], [INDIA_BOUNDS.north, INDIA_BOUNDS.east]);
  const map = L.map("map", { zoomControl: false, maxBounds: bounds.pad(0.05), maxBoundsViscosity: 1, minZoom: 4 }).setView(INDIA_CENTER, 5);
  mapState.map = map;
  L.control.zoom({ position: "bottomright" }).addTo(map);
  addBaseTiles(map);

  mapState.reportLayer = L.layerGroup().addTo(map);
  mapState.poiLayer = L.layerGroup().addTo(map);
  mapState.routeLayer = L.layerGroup().addTo(map);

  map.on("moveend", debounce(onMapMoved, 500));
  map.on("click", onMapClick);

  $("#layerReports").addEventListener("change", renderReports);
  $("#layerHeat").addEventListener("change", renderReports);
  $("#layerPolice").addEventListener("change", renderPois);
  $("#layerHospital").addEventListener("change", renderPois);
  $$('input[name="mode"]').forEach((el) => el.addEventListener("change", () => mapState.destination && planRoutes()));

  updateLocationPill();
  startWatchingLocation();
  onMapMoved();
};

function startWatchingLocation() {
  if (!navigator.geolocation) {
    $("#scoreLabel").textContent = "Location not supported on this device";
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      if (!inIndia(pos.coords.latitude, pos.coords.longitude)) {
        $("#scoreLabel").textContent = "SheShield's map currently covers India only";
        $("#scoreSub").textContent = "Your location is outside India";
        return;
      }
      const first = !mapState.me;
      mapState.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      drawMe();
      if (first && !mapState.centeredOnce) {
        mapState.centeredOnce = true;
        mapState.map.setView([mapState.me.lat, mapState.me.lng], 15);
        updateAreaScore();
      }
    },
    (err) => {
      const help = {
        1: ["Location access is blocked", "Click the icon left of the address bar → Site settings → Location → Allow, then reload."],
        2: ["Your device can't find its location", "On Windows: Settings → Privacy & security → Location → turn on Location services. On a phone, turn on GPS."],
        3: ["Finding your location took too long", "Move near a window or check your connection, then reload."],
      }[err.code] || ["Turn on location to see your area's score", ""];
      $("#scoreLabel").textContent = help[0];
      $("#scoreSub").textContent = `${help[1]} You can still tap anywhere on the map to check a place.`;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

function drawMe() {
  const { lat, lng, accuracy } = mapState.me;
  if (!mapState.meMarker) {
    mapState.meMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: "me-marker", html: "<span></span>", iconSize: [22, 22] }),
      zIndexOffset: 1000,
    })
      .addTo(mapState.map)
      .bindTooltip("You are here");
    mapState.accuracyCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: "#3b82f6",
      weight: 1,
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(mapState.map);
  } else {
    mapState.meMarker.setLatLng([lat, lng]);
    mapState.accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
  }
}

function recenter() {
  if (mapState.me) mapState.map.setView([mapState.me.lat, mapState.me.lng], 16);
  else showToast("Waiting for your location…");
}

/* ---------- Safety score ---------- */

const SCORE_TEXT = { safe: "Generally safe", moderate: "Stay alert", caution: "Use caution" };

async function fetchScore(lat, lng) {
  return api(`/api/reports/score?lat=${lat}&lng=${lng}&radius=500`);
}

async function updateAreaScore() {
  if (!mapState.me) return;
  try {
    const s = await fetchScore(mapState.me.lat, mapState.me.lng);
    $("#scoreValue").textContent = s.score;
    $("#scoreRing").className = `score-ring ${s.level}`;
    $("#scoreRing").style.setProperty("--pct", s.score);
    $("#scoreLabel").textContent = `Your area: ${SCORE_TEXT[s.level]}`;
    $("#scoreSub").textContent = `${s.reports} community report${s.reports === 1 ? "" : "s"} within 500 m${isNightHour(new Date()) ? " · night-time weighting on" : ""}`;
  } catch {
    $("#scoreLabel").textContent = "Score unavailable";
  }
}

/* ---------- Reports ---------- */

async function onMapMoved() {
  const b = mapState.map.getBounds().pad(0.2);
  try {
    mapState.reports = await api(`/api/reports?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
    renderReports();
  } catch (error) {
    showToast(error.message, "error");
  }
  loadPois();
}

function reportPopup(r) {
  const [label, icon] = CATEGORY_META[r.category] || CATEGORY_META.other;
  const when = new Date(r.occurredAt);
  return `
    <div class="report-popup">
      <div class="report-popup-head"><span>${icon}</span><strong>${label}</strong>
        <em style="background:${SEVERITY_COLOR[r.severity]}">${SEVERITY_LABEL[r.severity]}</em></div>
      ${r.description ? `<p>${escapeHtml(r.description)}</p>` : ""}
      <small>${timeAgo(when)} · ${isNightHour(when) ? "🌙 at night" : "☀️ daytime"} · ${r.confirmations} confirmation${r.confirmations === 1 ? "" : "s"}</small>
      ${r.demo ? '<small class="demo-tag">Demo data</small>' : ""}
      <div class="report-popup-actions">
        ${
          r.mine
            ? `<button onclick="deleteReport('${r.id}')">Delete my report</button>`
            : `<button onclick="confirmReport('${r.id}')">${r.confirmedByMe ? "✓ You confirmed this" : "I've seen this too"}</button>`
        }
      </div>
    </div>`;
}

function renderReports() {
  mapState.reportLayer.clearLayers();
  if (mapState.heatLayer) {
    mapState.map.removeLayer(mapState.heatLayer);
    mapState.heatLayer = null;
  }

  if ($("#layerReports").checked) {
    for (const r of mapState.reports) {
      const icon = (CATEGORY_META[r.category] || CATEGORY_META.other)[1];
      L.marker([r.lat, r.lng], {
        icon: L.divIcon({
          className: "report-marker",
          html: `<span style="--c:${SEVERITY_COLOR[r.severity]}">${icon}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      })
        .bindPopup(reportPopup(r), { maxWidth: 260 })
        .addTo(mapState.reportLayer);
    }
  }

  if ($("#layerHeat").checked && typeof L.heatLayer === "function" && mapState.reports.length) {
    mapState.heatLayer = L.heatLayer(
      mapState.reports.map((r) => [r.lat, r.lng, 0.35 + r.severity * 0.2 + Math.min(r.confirmations, 5) * 0.05]),
      { radius: 30, blur: 24, maxZoom: 16, gradient: { 0.3: "#fde68a", 0.6: "#fb923c", 0.9: "#dc2626" } }
    ).addTo(mapState.map);
  }
}

async function confirmReport(id) {
  try {
    const { report } = await api(`/api/reports/${id}/confirm`, { method: "POST" });
    mapState.reports = mapState.reports.map((r) => (r.id === id ? report : r));
    renderReports();
    showToast(report.confirmedByMe ? "Thanks for confirming 💗" : "Confirmation removed");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteReport(id) {
  if (!confirm("Delete this report?")) return;
  try {
    await api(`/api/reports/${id}`, { method: "DELETE" });
    mapState.reports = mapState.reports.filter((r) => r.id !== id);
    renderReports();
    showToast("Report deleted");
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* ---------- Reporting flow ---------- */

function startReportMode() {
  mapState.reportMode = true;
  $("#mapHint").hidden = false;
  $("#map").classList.add("picking");
  if (mapState.me) {
    $("#mapHint").innerHTML = `Tap the map where it happened, or <button onclick="openReportForm(mapState.me.lat, mapState.me.lng)">use my location</button> · <button onclick="cancelReportMode()">Cancel</button>`;
  }
  document.querySelector(".map-stage").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelReportMode() {
  mapState.reportMode = false;
  $("#mapHint").hidden = true;
  $("#map").classList.remove("picking");
}

function openReportForm(lat, lng) {
  cancelReportMode();
  mapState.map.closePopup();
  mapState.reportPoint = { lat, lng };
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $("#reportWhen").value = now.toISOString().slice(0, 16);
  $("#reportWhen").max = now.toISOString().slice(0, 16);
  $("#reportDesc").value = "";
  $("#reportLocation").textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  reverseGeocode(lat, lng)
    .then((label) => ($("#reportLocation").textContent = `📍 ${label}`))
    .catch(() => {});
  openModal("reportModal");
}

async function submitReport(event) {
  event.preventDefault();
  const { lat, lng } = mapState.reportPoint;
  const whenValue = $("#reportWhen").value;
  try {
    await api("/api/reports", {
      method: "POST",
      body: {
        lat,
        lng,
        category: $("#reportCategory").value,
        severity: Number($('input[name="severity"]:checked').value),
        occurredAt: whenValue ? new Date(whenValue).toISOString() : undefined,
        description: $("#reportDesc").value.trim(),
      },
    });
    closeModal("reportModal");
    showToast("Report added. Thank you for keeping others safe 💗", "success");
    onMapMoved();
    updateAreaScore();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (!inIndia(lat, lng)) return showToast("SheShield currently covers India only");
  if (mapState.reportMode) return openReportForm(lat, lng);

  const popup = L.popup().setLatLng(e.latlng).setContent('<div class="score-popup">Checking safety…</div>').openOn(mapState.map);
  try {
    const s = await fetchScore(lat, lng);
    popup.setContent(`
      <div class="score-popup">
        <div class="score-popup-num ${s.level}">${s.score}</div>
        <div><strong>${SCORE_TEXT[s.level]}</strong><br><small>${s.reports} report${s.reports === 1 ? "" : "s"} within 500 m</small></div>
      </div>
      <div class="report-popup-actions">
        <button onclick="openReportForm(${lat}, ${lng})">⚠️ Report here</button>
        <button onclick="setDestination(${lat}, ${lng}, 'Dropped pin')">🧭 Route here</button>
      </div>`);
  } catch {
    popup.setContent('<div class="score-popup">Could not check this spot.</div>');
  }
}

/* ---------- Nearby help (Overpass API) ---------- */

const poiCache = new Map();

const loadPois = debounce(async () => {
  const wantPolice = $("#layerPolice").checked;
  const wantHospital = $("#layerHospital").checked;
  if (!wantPolice && !wantHospital) return renderPois();

  if (mapState.map.getZoom() < 12) {
    $("#poiStatus").textContent = "Zoom in to see police stations and hospitals.";
    mapState.pois = [];
    return renderPois();
  }

  const b = mapState.map.getBounds().pad(0.1);
  // Round the box so small pans reuse the cached result.
  const r = (n) => Math.round(n * 50) / 50;
  const box = [r(b.getSouth()) - 0.02, r(b.getWest()) - 0.02, r(b.getNorth()) + 0.02, r(b.getEast()) + 0.02];
  const key = box.join(",");

  if (!poiCache.has(key)) {
    $("#poiStatus").textContent = "Finding police stations and hospitals…";
    try {
      poiCache.set(key, await fetchPois(box));
    } catch {
      $("#poiStatus").textContent = "Nearby help is unavailable right now.";
      return;
    }
  }
  mapState.pois = poiCache.get(key);
  $("#poiStatus").textContent = `${mapState.pois.filter((p) => p.type === "police").length} police stations · ${mapState.pois.filter((p) => p.type === "hospital").length} hospitals in view`;
  renderPois();
}, 700);

async function fetchPois([s, w, n, e]) {
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:20];
    (nwr["amenity"="police"](${bbox});nwr["amenity"="hospital"](${bbox}););
    out center 300;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error("Overpass request failed");
  const data = await res.json();
  return data.elements
    .map((el) => ({
      type: el.tags?.amenity,
      name: el.tags?.name || el.tags?.["name:en"] || POI_META[el.tags?.amenity]?.[1],
      phone: el.tags?.phone || el.tags?.["contact:phone"] || "",
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
    }))
    .filter((p) => p.lat && p.lng && POI_META[p.type]);
}

function renderPois() {
  mapState.poiLayer.clearLayers();
  const show = { police: $("#layerPolice").checked, hospital: $("#layerHospital").checked };
  for (const p of mapState.pois) {
    if (!show[p.type]) continue;
    const [icon, label] = POI_META[p.type];
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: `poi-marker poi-${p.type}`, html: `<span>${icon}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    })
      .bindPopup(`
        <div class="report-popup">
          <div class="report-popup-head"><span>${icon}</span><strong>${escapeHtml(p.name)}</strong></div>
          <small>${label}${p.phone ? ` · <a href="tel:${escapeHtml(p.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(p.phone)}</a>` : ""}</small>
          <div class="report-popup-actions">
            <button onclick="setDestination(${p.lat}, ${p.lng}, ${escapeHtml(JSON.stringify(p.name))})">🧭 Safest route</button>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">Google Maps ↗</a>
          </div>
        </div>`)
      .addTo(mapState.poiLayer);
  }
}

async function routeToNearest(type) {
  if (!mapState.me) return showToast("Turn on location first", "error");
  const origin = mapState.me;
  let candidates = mapState.pois.filter((p) => p.type === type);

  if (!candidates.length) {
    showToast(`Searching for the nearest ${POI_META[type][1].toLowerCase()}…`);
    try {
      const d = 0.05; // ~5 km
      candidates = (await fetchPois([origin.lat - d, origin.lng - d, origin.lat + d, origin.lng + d])).filter((p) => p.type === type);
    } catch {
      return showToast("Could not search right now", "error");
    }
  }
  if (!candidates.length) return showToast(`No ${POI_META[type][1].toLowerCase()} found within 5 km`, "error");

  const nearest = candidates.reduce((best, p) =>
    distanceM(origin, p) < distanceM(origin, best) ? p : best
  );
  setDestination(nearest.lat, nearest.lng, nearest.name);
}

/* ---------- Safest route ---------- */

async function searchDestination(event) {
  event.preventDefault();
  const q = $("#destInput").value.trim();
  if (!q) return;
  const box = $("#destResults");
  box.innerHTML = '<p class="muted small">Searching…</p>';

  const c = mapState.me || mapState.map.getCenter();
  const d = 0.5;
  const viewbox = `${c.lng - d},${c.lat + d},${c.lng + d},${c.lat - d}`;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&q=${encodeURIComponent(q)}&viewbox=${viewbox}`,
      { headers: { "Accept-Language": navigator.language || "en" } }
    );
    const results = await res.json();
    if (!results.length) {
      box.innerHTML = '<p class="muted small">No places found in India. Try adding the area or city name.</p>';
      return;
    }
    box.innerHTML = results
      .map(
        (r) => `<button class="dest-item" onclick='setDestination(${Number(r.lat)}, ${Number(r.lon)}, ${escapeHtml(JSON.stringify(r.display_name.split(",").slice(0, 2).join(",")))})'>
          📍 <span>${escapeHtml(r.display_name)}</span></button>`
      )
      .join("");
  } catch {
    box.innerHTML = '<p class="muted small">Search is unavailable right now.</p>';
  }
}

function setDestination(lat, lng, name) {
  mapState.map.closePopup();
  mapState.destination = { lat, lng, name };
  $("#destResults").innerHTML = "";
  $("#destInput").value = name;
  planRoutes();
}

const distanceM = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Distance in metres from point p to segment a-b (local flat projection).
function pointToSegmentM(p, a, b) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function routeRisk(coords, reports) {
  const night = isNightHour(new Date());
  let risk = 0;
  const near = [];
  for (const r of reports) {
    let min = Infinity;
    for (let i = 1; i < coords.length && min > ROUTE_BUFFER_M; i++) {
      min = Math.min(min, pointToSegmentM(r, coords[i - 1], coords[i]));
    }
    if (min <= ROUTE_BUFFER_M) {
      const ageDays = (Date.now() - new Date(r.occurredAt)) / 86400000;
      const weight =
        r.severity *
        Math.pow(0.5, ageDays / 180) *
        (1 + Math.min(r.confirmations, 8) * 0.25) *
        (night && isNightHour(r.occurredAt) ? 1.5 : 1);
      risk += weight;
      near.push(r);
    }
  }
  return { risk, near };
}

function riskLabel(risk) {
  if (risk === 0) return ["No reports along route", "safe"];
  if (risk < 3) return ["Low risk", "safe"];
  if (risk < 8) return ["Moderate risk", "moderate"];
  return ["Higher risk", "caution"];
}

async function planRoutes() {
  const dest = mapState.destination;
  const origin = mapState.me || mapState.map.getCenter();
  if (!mapState.me) showToast("Location unavailable: routing from the map centre");

  if (!inIndia(origin.lat, origin.lng)) return showToast("Routing is available within India only", "error");
  const mode = $('input[name="mode"]:checked').value;
  const results = $("#routeResults");
  results.innerHTML = '<p class="muted small">Finding routes and checking them for reported dangers…</p>';
  mapState.routeLayer.clearLayers();

  try {
    const url = `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&alternatives=3`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("No route found");

    const routes = data.routes.map((r) => ({
      coords: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distance: r.distance,
      duration: r.duration,
    }));

    // Pull reports around all routes, then score each route.
    const lats = routes.flatMap((r) => r.coords.map((c) => c.lat));
    const lngs = routes.flatMap((r) => r.coords.map((c) => c.lng));
    const pad = 0.003;
    const reports = await api(
      `/api/reports?bbox=${Math.min(...lngs) - pad},${Math.min(...lats) - pad},${Math.max(...lngs) + pad},${Math.max(...lats) + pad}`
    );
    routes.forEach((r) => Object.assign(r, routeRisk(r.coords, reports)));

    const safest = routes.reduce((best, r) => (r.risk < best.risk || (r.risk === best.risk && r.duration < best.duration) ? r : best));
    const fastest = routes.reduce((best, r) => (r.duration < best.duration ? r : best));
    routes.sort((a, b) => (a === safest ? -1 : b === safest ? 1 : a.risk - b.risk));
    mapState.routes = routes;
    mapState.routes.safest = safest;
    mapState.routes.fastest = fastest;

    drawRoutes(0);
  } catch (error) {
    results.innerHTML = `<p class="muted small">Could not plan a route: ${escapeHtml(error.message)}.</p>`;
  }
}

function drawRoutes(selected) {
  const { routes } = mapState;
  mapState.routeLayer.clearLayers();

  routes.forEach((r, i) => {
    if (i === selected) return;
    L.polyline(r.coords, { color: "#9a8b95", weight: 5, opacity: 0.55, dashArray: "6 8" })
      .on("click", () => drawRoutes(i))
      .addTo(mapState.routeLayer);
  });

  const active = routes[selected];
  const [, level] = riskLabel(active.risk);
  const color = { safe: "#22b573", moderate: "#f59e0b", caution: "#e65278" }[level];
  L.polyline(active.coords, { color: "#fff", weight: 10, opacity: 0.9 }).addTo(mapState.routeLayer);
  const line = L.polyline(active.coords, { color, weight: 6 }).addTo(mapState.routeLayer);
  active.near.forEach((r) =>
    L.circle([r.lat, r.lng], { radius: 40, color: SEVERITY_COLOR[r.severity], weight: 2, fillOpacity: 0.15, interactive: false }).addTo(mapState.routeLayer)
  );

  const dest = mapState.destination;
  L.marker([dest.lat, dest.lng], {
    icon: L.divIcon({ className: "dest-marker", html: "<span>🏁</span>", iconSize: [30, 30], iconAnchor: [15, 28] }),
  })
    .bindTooltip(escapeHtml(dest.name))
    .addTo(mapState.routeLayer);

  mapState.map.fitBounds(line.getBounds(), { padding: [40, 40] });

  $("#routeResults").innerHTML = routes
    .map((r, i) => {
      const [label, lvl] = riskLabel(r.risk);
      const tags = [r === routes.safest && "Safest", r === routes.fastest && "Fastest"].filter(Boolean);
      return `
        <button class="route-card ${i === selected ? "selected" : ""}" onclick="drawRoutes(${i})">
          <div class="route-card-top">
            <strong>${(r.distance / 1000).toFixed(1)} km · ${Math.max(1, Math.round(r.duration / 60))} min</strong>
            ${tags.map((t) => `<span class="route-tag ${t.toLowerCase()}">${t}</span>`).join("")}
          </div>
          <span class="risk ${lvl}">${label}${r.near.length ? ` · ${r.near.length} report${r.near.length === 1 ? "" : "s"} nearby` : ""}</span>
        </button>`;
    })
    .join("") +
    `<a class="text-btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=${$('input[name="mode"]:checked').value === "foot" ? "walking" : "driving"}">Open turn-by-turn in Google Maps ↗</a>`;
}
