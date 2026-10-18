/* SheShield frontend: shared layout, API access, SOS flow and page logic. */

// The backend serves this frontend, so API calls go to the same origin.
// When the pages are opened from a dev server (e.g. VS Code Live Server) or
// straight from disk, fall back to the local backend.
const DEV_PORTS = ["5500", "5501", "5173", "3000", "8080"];
const API_BASE =
  window.SHESHIELD_API ??
  (location.protocol === "file:" || DEV_PORTS.includes(location.port) ? "http://localhost:5000" : "");
const APP_ORIGIN = API_BASE || location.origin;

/* ---------- Map config (shared by the Safety Map and the tracking page) ---------- */

// OpenStreetMap's own raster tiles: open data, free, no API key. Fine for a
// project of this size; see docs/MAPS.md before running at high traffic.
const MAP_TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  options: {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

// SheShield currently serves India only. Rough bounding box of India
// (the box also clips small parts of neighbouring countries).
const INDIA_BOUNDS = { south: 6.0, west: 67.5, north: 37.5, east: 98.0 };
const INDIA_CENTER = [22.5, 79.0];

const inIndia = (lat, lng) =>
  lat >= INDIA_BOUNDS.south && lat <= INDIA_BOUNDS.north && lng >= INDIA_BOUNDS.west && lng <= INDIA_BOUNDS.east;

function addBaseTiles(map) {
  return L.tileLayer(MAP_TILES.url, MAP_TILES.options).addTo(map);
}

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode) */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

let toastTimer = null;
function showToast(msg, type = "") {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

/* ---------- API ---------- */

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = store.get("token");
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && auth) {
    clearSession();
    location.href = "login.html";
    throw new Error(data.message || "Please log in again");
  }
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

/* ---------- Session ---------- */

const getUser = () => store.get("user");

function setSession(token, user) {
  store.set("token", token);
  store.set("user", user);
}

function clearSession() {
  ["token", "user", "contactsCache"].forEach((k) => store.remove(k));
}

function logout() {
  clearSession();
  location.href = "index.html";
}

function requireLogin() {
  if (!store.get("token") || !getUser()) {
    location.href = "login.html";
    return false;
  }
  return true;
}

/* ---------- Formatting ---------- */

const fullName = (u) => (u ? `${u.firstName} ${u.lastName}`.trim() : "");

function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const formatDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const formatTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ---------- Location ---------- */

const toPoint = (pos) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });

// Browsers only allow location on https:// or localhost. Code 4 is our own "insecure page" error.
function locationUnsupportedError() {
  if (!navigator.geolocation) return Object.assign(new Error("Geolocation is not supported on this device"), { code: 2 });
  if (!window.isSecureContext) return Object.assign(new Error("Location needs https:// or localhost"), { code: 4 });
  return null;
}

function requestPosition(highAccuracy, timeout) {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition((pos) => resolve(toPoint(pos)), reject, {
      enableHighAccuracy: highAccuracy,
      timeout,
      maximumAge: highAccuracy ? 30000 : 300000,
    })
  );
}

// Tries GPS first; laptops and desktops without GPS often fail or time out on a
// high-accuracy request, so fall back to Wi-Fi/network location.
async function getPosition(timeout = 10000) {
  const unsupported = locationUnsupportedError();
  if (unsupported) throw unsupported;
  try {
    return await requestPosition(true, timeout);
  } catch (err) {
    if (err.code === 1) throw err; // permission denied: retrying won't help
    return requestPosition(false, 15000);
  }
}

// Continuous version of getPosition with the same GPS -> network fallback.
// Returns a function that stops watching.
function watchLocation(onPoint, onError) {
  const unsupported = locationUnsupportedError();
  if (unsupported) {
    onError(unsupported);
    return () => {};
  }

  let id = null;
  let gotFix = false;
  let fellBack = false;
  const start = (highAccuracy) =>
    navigator.geolocation.watchPosition(
      (pos) => {
        gotFix = true;
        onPoint(toPoint(pos));
      },
      (err) => {
        if (err.code !== 1 && highAccuracy && !fellBack) {
          fellBack = true;
          navigator.geolocation.clearWatch(id);
          id = start(false);
          return;
        }
        if (!gotFix || err.code === 1) onError(err);
      },
      { enableHighAccuracy: highAccuracy, maximumAge: highAccuracy ? 5000 : 60000, timeout: highAccuracy ? 15000 : 30000 }
    );

  id = start(true);
  return () => navigator.geolocation.clearWatch(id);
}

const LOCATION_HELP = {
  1: ["Location access is blocked", "Click the icon left of the address bar → Site settings → Location → Allow, then reload."],
  2: ["Your device can't find its location", "On Windows: Settings → Privacy & security → Location → turn on Location services (and “Let apps access your location”). Connect to Wi-Fi if you're on a wired connection. On a phone, turn on GPS."],
  3: ["Finding your location took too long", "Check that Location services are on and you're connected to Wi-Fi, then reload."],
  4: ["Location needs a secure page", "Open the app at http://localhost:5000 on this computer, or use an https:// link (e.g. ngrok) on your phone."],
};

// Human-readable place name via OpenStreetMap Nominatim (cached per session).
async function reverseGeocode(lat, lng) {
  const key = `geo:${lat.toFixed(3)},${lng.toFixed(3)}`;
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) return cached;
  } catch {
    /* ignore */
  }

  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`,
    { headers: { "Accept-Language": navigator.language || "en" } }
  );
  if (!res.ok) throw new Error("Reverse geocoding failed");
  const data = await res.json();
  const a = data.address || {};
  const area = a.neighbourhood || a.suburb || a.quarter || a.village || a.road || "";
  const city = a.city || a.town || a.state_district || a.county || a.state || "";
  const label = [area, city].filter(Boolean).join(", ") || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  try {
    sessionStorage.setItem(key, label);
  } catch {
    /* ignore */
  }
  return label;
}

async function updateLocationPill() {
  const pill = $("#locationPill");
  if (!pill) return null;
  pill.textContent = "📍 Locating…";
  try {
    const pos = await getPosition();
    pill.textContent = `📍 ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} · Live`;
    reverseGeocode(pos.lat, pos.lng)
      .then((label) => (pill.textContent = `📍 ${label} · Live`))
      .catch(() => {});
    return pos;
  } catch (err) {
    const [title, help] = LOCATION_HELP[err.code] || LOCATION_HELP[2];
    pill.textContent = err.code === 1 ? "📍 Location blocked" : "📍 Location unavailable";
    pill.title = `${title}. ${help}`;
    return null;
  }
}

/* ---------- Layout ---------- */

const NAV = [
  ["dashboard", "dashboard.html", "🏠", "Dashboard"],
  ["map", "map.html", "🗺️", "Safety Map"],
  ["contacts", "contacts.html", "👥", "Trusted Contacts"],
  ["sos", "sos.html", "🆘", "SOS Emergency"],
  ["history", "history.html", "📋", "Alert History"],
];

function renderSidebar(active) {
  const aside = $("aside.sidebar");
  if (!aside) return;
  const user = getUser();
  const initial = (user?.firstName || "S").charAt(0).toUpperCase();

  aside.innerHTML = `
    <a class="logo" href="dashboard.html">She<span>Shield</span></a>
    <div class="profile-mini">
      <div class="avatar">${escapeHtml(initial)}</div>
      <div>
        <strong>${escapeHtml(fullName(user) || "Your account")}</strong>
        <small>${escapeHtml(user?.email || "")}</small>
        <div class="status-live" id="statusLive">SAFE · Active</div>
      </div>
    </div>
    <nav class="nav-group">
      <div class="nav-title">Main</div>
      ${NAV.map(
        ([key, href, icon, label]) =>
          `<a class="nav-item ${key === active ? "active" : ""}" href="${href}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span></a>`
      ).join("")}
    </nav>
    <nav class="nav-group">
      <div class="nav-title">Account</div>
      <a class="nav-item ${active === "profile" ? "active" : ""}" href="profile.html"><span class="nav-icon">👤</span><span class="nav-label">My Profile</span></a>
      <button class="nav-item" type="button" onclick="logout()"><span class="nav-icon">🚪</span><span class="nav-label">Sign Out</span></button>
    </nav>
    <div class="sidebar-footer">
      <button class="btn btn-primary btn-block" onclick="triggerSOS()">🚨 Emergency SOS</button>
      <a class="helpline-mini" href="tel:112">Emergency: <strong>112</strong></a>
    </div>`;
}

function renderSosOverlay() {
  if ($("#alertOverlay")) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <div class="alert-overlay" id="alertOverlay" role="alertdialog" aria-modal="true" aria-labelledby="sosTitle">
    <div class="overlay-panel" id="sosCountdown">
      <div class="overlay-icon">🚨</div>
      <h2 id="sosTitle">Sending SOS</h2>
      <p>Your trusted contacts will get your live location by email and SMS.</p>
      <div class="count-ring"><span class="count-num" id="countNum">10</span></div>
      <div class="overlay-actions">
        <button class="btn btn-light" onclick="cancelCountdown()">Cancel</button>
        <button class="btn btn-ghost-light" onclick="sendSOSNow()">Send now</button>
      </div>
    </div>

    <div class="overlay-panel" id="sosActive" hidden>
      <div class="overlay-icon pulse-icon">🚨</div>
      <h2>SOS Active</h2>
      <p id="sosActiveSub">Alerting your trusted contacts…</p>
      <div id="sosAck"></div>
      <div id="sosWarning"></div>
      <div class="sos-notify-list" id="sosNotifyList"></div>
      <div class="sos-location" id="sosLocationStatus"></div>
      <div class="overlay-actions">
        <a class="btn btn-light" href="tel:112">📞 Call 112</a>
        <button class="btn btn-ghost-light" onclick="textContactsDirectly()">💬 Text from my phone</button>
        <button class="btn btn-ghost-light" onclick="shareSosLink()">🔗 Share link</button>
      </div>
      <div class="overlay-actions">
        <button class="btn btn-safe" onclick="resolveSOS('resolved')">✅ I'm safe</button>
        <button class="btn btn-ghost-light" onclick="resolveSOS('cancelled')">False alarm</button>
        <button class="btn btn-ghost-light" onclick="minimizeSOS()">Minimize</button>
      </div>
    </div>
  </div>
  <button class="sos-banner" id="sosBanner" hidden onclick="showActiveOverlay()">
    🚨 SOS active · your contacts can see your live location · <u>Open</u>
  </button>
  <button class="fab-sos" onclick="triggerSOS()" aria-label="Trigger emergency SOS">SOS</button>`
  );
}

/* ---------- SOS ---------- */

const sos = {
  timer: null,
  alert: null,
  stopWatch: null,
  poll: null,
  lastSentAt: 0,
  lastPoint: null,
  positionPromise: null,
};

const contactsCache = () => store.get("contactsCache", []);

function triggerSOS() {
  renderSosOverlay();
  if (sos.alert) return showActiveOverlay();

  const overlay = $("#alertOverlay");
  const counter = $("#countNum");
  $("#sosCountdown").hidden = false;
  $("#sosActive").hidden = true;
  overlay.classList.add("show");

  let count = Number(getUser()?.settings?.countdownSeconds) || 10;
  counter.textContent = count;
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

  // Start acquiring GPS during the countdown so the alert goes out with a location.
  sos.positionPromise = getPosition(8000).catch(() => null);

  clearInterval(sos.timer);
  sos.timer = setInterval(() => {
    count -= 1;
    counter.textContent = count;
    if (count <= 0) sendSOSNow();
  }, 1000);
}

function cancelCountdown() {
  clearInterval(sos.timer);
  $("#alertOverlay")?.classList.remove("show");
  showToast("SOS cancelled. Nobody was alerted.");
}

async function sendSOSNow() {
  clearInterval(sos.timer);
  $("#sosCountdown").hidden = true;
  $("#sosActive").hidden = false;
  $("#sosActiveSub").textContent = "Sending your alert…";
  $("#sosNotifyList").innerHTML = "";
  $("#sosWarning").innerHTML = "";
  $("#sosAck").innerHTML = "";

  // Never hold the alert back for more than ~3s waiting on GPS.
  const point = await Promise.race([
    sos.positionPromise || Promise.resolve(null),
    new Promise((r) => setTimeout(() => r(null), 3000)),
  ]);
  if (point) sos.lastPoint = point;

  try {
    const data = await api("/api/sos/trigger", { method: "POST", body: point || {} });
    activateSOS(data.alert);
  } catch (error) {
    renderOfflineFallback(error);
  }
}

function activateSOS(alert) {
  sos.alert = alert;
  renderSosOverlay();
  renderActiveAlert(alert);
  setStatusLive(true);
  startLiveTracking();
  clearInterval(sos.poll);
  sos.poll = setInterval(refreshActiveAlert, 8000);
}

function channelChip(label, result) {
  const status = result?.status || "pending";
  const icon = { sent: "✓", failed: "✕", skipped: "–", pending: "…" }[status] || "…";
  return `<span class="chip chip-${status}" title="${escapeHtml(result?.detail || status)}">${label} ${icon}</span>`;
}

function renderActiveAlert(alert) {
  const list = $("#sosNotifyList");
  if (!list) return;
  const notes = alert.notifications || [];
  const delivered = notes.filter((n) => n.email?.status === "sent" || n.sms?.status === "sent").length;

  $("#sosActiveSub").textContent = notes.length
    ? `Escalation layer ${alert.layer} · ${delivered}/${notes.length} contacts reached · started ${timeAgo(alert.createdAt)}`
    : "You have no trusted contacts yet. Use the buttons below to reach help directly.";

  $("#sosAck").innerHTML = alert.acknowledgedBy
    ? `<div class="ack-box">💗 <strong>${escapeHtml(alert.acknowledgedBy)}</strong> is responding and can see your location.</div>`
    : "";

  const nothingSent = notes.length > 0 && delivered === 0 && notes.every((n) => n.email?.status !== "pending");
  $("#sosWarning").innerHTML = nothingSent
    ? `<div class="warn-box">Automatic email/SMS could not be delivered. Tap <strong>Text from my phone</strong> now.</div>`
    : "";

  list.innerHTML = notes
    .map(
      (n) => `
      <div class="sos-notify">
        <div><strong>${escapeHtml(n.name)}</strong><small>Layer ${n.layer}</small></div>
        <div class="chips">
          ${n.acknowledgedAt ? '<span class="chip chip-sent">Responding ✓</span>' : ""}
          ${channelChip("Email", n.email)}${channelChip("SMS", n.sms)}
        </div>
      </div>`
    )
    .join("");

  if ($("#sosBanner")) $("#sosBanner").hidden = $("#alertOverlay").classList.contains("show");
}

function renderOfflineFallback(error) {
  $("#sosActiveSub").textContent = "Could not reach the SheShield server.";
  $("#sosWarning").innerHTML = `
    <div class="warn-box">${escapeHtml(error.message)}<br>
    Call <strong>112</strong> or tap <strong>Text from my phone</strong> to message your contacts directly.</div>`;
}

async function refreshActiveAlert() {
  try {
    const { alert } = await api("/api/sos/active");
    if (!alert) return stopSOS();
    sos.alert = alert;
    renderActiveAlert(alert);
  } catch {
    /* keep the last known state while offline */
  }
}

function startLiveTracking() {
  if (sos.stopWatch) return;
  if (getUser()?.settings?.shareLiveLocation === false) {
    $("#sosLocationStatus").textContent = "Live location sharing is turned off in your profile.";
    return;
  }

  sos.stopWatch = watchLocation(
    (point) => {
      sos.lastPoint = point;
      $("#sosLocationStatus").textContent = `📍 Sharing live location (±${point.accuracy} m) · updated ${formatTime(new Date())}`;
      if (Date.now() - sos.lastSentAt < 10000 || !sos.alert) return;
      sos.lastSentAt = Date.now();
      api(`/api/sos/${sos.alert.id}/location`, { method: "POST", body: point }).catch(() => {});
    },
    (err) => {
      const [title, help] = LOCATION_HELP[err.code] || LOCATION_HELP[2];
      $("#sosLocationStatus").textContent = `⚠️ ${title}. ${help}`;
    }
  );
}

function stopSOS() {
  if (sos.stopWatch) sos.stopWatch();
  sos.stopWatch = null;
  clearInterval(sos.poll);
  sos.alert = null;
  $("#alertOverlay")?.classList.remove("show");
  if ($("#sosBanner")) $("#sosBanner").hidden = true;
  setStatusLive(false);
}

async function resolveSOS(outcome) {
  if (!sos.alert) return stopSOS();
  const question =
    outcome === "cancelled"
      ? "Mark this as a false alarm? Your contacts will be told you are okay."
      : "Confirm you are safe? Your contacts will be notified and tracking will stop.";
  if (!confirm(question)) return;

  try {
    await api(`/api/sos/${sos.alert.id}/resolve`, { method: "POST", body: { outcome } });
    stopSOS();
    showToast("Your contacts have been told you are safe 💗", "success");
    if (document.body.dataset.page === "history") initHistory();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function minimizeSOS() {
  $("#alertOverlay").classList.remove("show");
  $("#sosBanner").hidden = false;
}

function showActiveOverlay() {
  $("#alertOverlay").classList.add("show");
  $("#sosCountdown").hidden = true;
  $("#sosActive").hidden = false;
  $("#sosBanner").hidden = true;
}

function sosMessage() {
  const p = sos.lastPoint;
  const link = sos.alert ? `${APP_ORIGIN}/track.html?t=${sos.alert.shareToken}` : "";
  return [
    "SOS! I need help.",
    link && `Live location: ${link}`,
    p && `Map: https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`,
    "- sent via SheShield",
  ]
    .filter(Boolean)
    .join("\n");
}

// Opens the phone's own SMS app with the message pre-filled. Works without any SMS provider.
function textContactsDirectly() {
  const numbers = contactsCache().map((c) => c.phone.replace(/[^\d+]/g, "")).filter(Boolean);
  const body = encodeURIComponent(sosMessage());
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  location.href = `sms:${numbers.join(",")}${isIOS ? "&" : "?"}body=${body}`;
}

async function shareSosLink() {
  const text = sosMessage();
  if (navigator.share) {
    try {
      await navigator.share({ title: "SheShield SOS", text });
      return;
    } catch {
      /* cancelled, fall through to WhatsApp */
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function setStatusLive(active) {
  const el = $("#statusLive");
  if (!el) return;
  el.textContent = active ? "SOS ACTIVE" : "SAFE · Active";
  el.classList.toggle("danger", active);
}

async function resumeActiveAlert() {
  try {
    const { alert } = await api("/api/sos/active");
    if (alert) {
      renderSosOverlay();
      activateSOS(alert);
      $("#sosBanner").hidden = false;
    }
  } catch {
    /* ignore */
  }
}

/* ---------- Shake to SOS (works while the app is open) ---------- */

function enableShakeDetection() {
  if (store.get("shakeToSos") !== true || typeof DeviceMotionEvent === "undefined") return;
  let shakes = [];
  window.addEventListener("devicemotion", (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const force = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    if (force < 28) return;
    const now = Date.now();
    shakes = shakes.filter((t) => now - t < 1500);
    shakes.push(now);
    if (shakes.length >= 4 && !$("#alertOverlay")?.classList.contains("show")) {
      shakes = [];
      triggerSOS();
    }
  });
}

/* ---------- Fake call ---------- */

let fakeCallAudio = null;

function scheduleFakeCall() {
  const caller = $("#fakeCaller")?.value.trim() || "Mom";
  const delay = Number($("#fakeCallDelay")?.value || 10);
  showToast(`Fake call from ${caller} in ${delay} seconds`);
  setTimeout(() => startFakeCall(caller), delay * 1000);
}

function startFakeCall(caller) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="fake-call" id="fakeCall">
      <div class="fake-call-top"><small>Incoming call…</small><h2>${escapeHtml(caller)}</h2><small>mobile</small></div>
      <div class="avatar fake-call-avatar">${escapeHtml(caller.charAt(0).toUpperCase())}</div>
      <div class="fake-call-actions">
        <button class="call-btn decline" onclick="endFakeCall()" aria-label="Decline">✕</button>
        <button class="call-btn accept" onclick="answerFakeCall()" aria-label="Accept">📞</button>
      </div>
    </div>`
  );
  if (navigator.vibrate) navigator.vibrate([800, 400, 800, 400, 800, 400, 800]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0.15;
    gain.connect(ctx.destination);
    const ring = () => {
      [0, 0.4].forEach((offset) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = 440 + offset * 100;
        osc.connect(gain);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.3);
      });
    };
    ring();
    const interval = setInterval(ring, 2000);
    fakeCallAudio = { ctx, interval };
  } catch {
    /* audio not available */
  }
}

function stopFakeRing() {
  if (!fakeCallAudio) return;
  clearInterval(fakeCallAudio.interval);
  fakeCallAudio.ctx.close();
  fakeCallAudio = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

function answerFakeCall() {
  stopFakeRing();
  const el = $("#fakeCall");
  if (!el) return;
  let seconds = 0;
  el.querySelector(".fake-call-top small").textContent = "00:00";
  el.querySelector(".fake-call-actions").innerHTML = `<button class="call-btn decline" onclick="endFakeCall()" aria-label="End call">✕</button>`;
  el.dataset.timer = setInterval(() => {
    seconds += 1;
    const label = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    const small = el.querySelector(".fake-call-top small");
    if (small) small.textContent = label;
  }, 1000);
}

function endFakeCall() {
  stopFakeRing();
  const el = $("#fakeCall");
  if (el) {
    clearInterval(Number(el.dataset.timer));
    el.remove();
  }
}

/* ---------- Modals & small UI helpers ---------- */

function openModal(id) {
  document.getElementById(id)?.classList.add("show");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("show");
}

function updateStrength(val) {
  const bars = ["#sb1", "#sb2", "#sb3", "#sb4"].map((id) => $(id)).filter(Boolean);
  let score = 0;
  if (val.length >= 8) score++;
  if (val.length >= 12) score++;
  if (/[A-Z]/.test(val) && /[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  bars.forEach((bar, i) => {
    bar.className = "";
    if (i < score) bar.classList.add(score <= 1 ? "active" : score <= 2 ? "medium" : "strong");
  });
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || "Please wait…";
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
}

/* ---------- Auth pages ---------- */

async function handleSignup(event) {
  event.preventDefault();
  const button = event.submitter;

  const payload = {
    firstName: $("#firstName").value.trim(),
    lastName: $("#lastName").value.trim(),
    email: $("#email").value.trim(),
    phone: $("#phone").value.trim(),
    password: $("#signup-pass").value,
    quickContact: $("#quickContact")?.value.trim(),
  };

  if (payload.password.length < 8) return showToast("Password must be at least 8 characters", "error");

  setBusy(button, true, "Creating account…");
  try {
    const data = await api("/api/auth/signup", { method: "POST", body: payload, auth: false });
    setSession(data.token, data.user);
    showToast("Account created! Let's set up your safety network.", "success");
    setTimeout(() => (location.href = "contacts.html"), 900);
  } catch (error) {
    showToast(error.message, "error");
    setBusy(button, false);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.submitter;

  const emailOrPhone = $("#loginEmailOrPhone").value.trim();
  const password = $("#loginPassword").value;
  if (!emailOrPhone || !password) return showToast("Please fill all fields", "error");

  setBusy(button, true, "Signing in…");
  try {
    const data = await api("/api/auth/login", { method: "POST", body: { emailOrPhone, password }, auth: false });
    setSession(data.token, data.user);
    location.href = "dashboard.html";
  } catch (error) {
    showToast(error.message, "error");
    setBusy(button, false);
  }
}

/* ---------- Contacts ---------- */

let contactsState = [];

async function fetchContacts() {
  const contacts = await api("/api/contacts");
  contactsState = contacts;
  // Cached so "Text from my phone" works even when the server is unreachable.
  store.set("contactsCache", contacts.map((c) => ({ name: c.name, phone: c.phone })));
  return contacts;
}

function contactCard(c) {
  const tel = c.phone.replace(/[^\d+]/g, "");
  return `
    <article class="card contact-card">
      <div class="contact-row" style="padding-top:0">
        <div class="contact-avatar priority-${c.priority}">${escapeHtml(c.name.charAt(0).toUpperCase())}</div>
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <div class="muted">${escapeHtml(c.relationship)} · Priority ${c.priority}</div>
        </div>
      </div>
      <div class="contact-meta">
        <div>📱 ${escapeHtml(c.phone)}</div>
        <div>✉️ ${c.email ? escapeHtml(c.email) : '<span class="muted">No email: add one for email alerts</span>'}</div>
      </div>
      <div class="contact-actions">
        <a class="btn btn-primary btn-sm" href="tel:${escapeHtml(tel)}">Call</a>
        <button class="btn btn-outline btn-sm" onclick="editContact('${c._id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteContact('${c._id}')">Remove</button>
      </div>
    </article>`;
}

function renderContacts() {
  const container = $("#contactsContainer");
  if (!container) return;
  const q = ($("#contactSearch")?.value || "").toLowerCase();
  const list = contactsState.filter((c) =>
    [c.name, c.relationship, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q))
  );

  if (!contactsState.length) {
    container.innerHTML = `
      <div class="empty-state card">
        <div class="empty-icon">👥</div>
        <h3>Build your safety circle</h3>
        <p>Add 3–5 people you trust. Priority 1 contacts are alerted first; others are added if nobody responds.</p>
        <button class="btn btn-primary" onclick="openContactModal()">+ Add your first contact</button>
      </div>`;
    return;
  }

  container.innerHTML = list.length ? list.map(contactCard).join("") : `<p class="muted">No contacts match “${escapeHtml(q)}”.</p>`;
  const count = $("#contactCount");
  if (count) count.textContent = `${contactsState.length} trusted contact${contactsState.length === 1 ? "" : "s"}`;
}

async function loadContacts() {
  try {
    await fetchContacts();
    renderContacts();
  } catch (error) {
    $("#contactsContainer").innerHTML = `<p class="muted">Could not load contacts: ${escapeHtml(error.message)}</p>`;
  }
}

function openContactModal(contact = null) {
  $("#contactModalTitle").textContent = contact ? "Edit Trusted Contact" : "Add Trusted Contact";
  $("#contactId").value = contact?._id || "";
  $("#contactName").value = contact?.name || "";
  $("#contactRelationship").value = contact?.relationship || "Mother";
  $("#contactPhone").value = contact?.phone || "";
  $("#contactEmail").value = contact?.email || "";
  $("#contactPriority").value = contact?.priority || 1;
  $("#contactSubmit").textContent = contact ? "Save Changes" : "Add Contact";
  openModal("addContactModal");
}

function editContact(id) {
  const contact = contactsState.find((c) => c._id === id);
  if (contact) openContactModal(contact);
}

async function deleteContact(id) {
  const contact = contactsState.find((c) => c._id === id);
  if (!contact || !confirm(`Remove ${contact.name} from your trusted contacts?`)) return;
  try {
    await api(`/api/contacts/${id}`, { method: "DELETE" });
    showToast(`${contact.name} removed`);
    loadContacts();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function saveContact(event) {
  event.preventDefault();
  const id = $("#contactId").value;
  const body = {
    name: $("#contactName").value.trim(),
    relationship: $("#contactRelationship").value,
    phone: $("#contactPhone").value.trim(),
    email: $("#contactEmail").value.trim(),
    priority: Number($("#contactPriority").value),
  };

  if (!body.name || !body.phone) return showToast("Name and phone are required", "error");

  try {
    await api(id ? `/api/contacts/${id}` : "/api/contacts", { method: id ? "PUT" : "POST", body });
    showToast(id ? "Contact updated" : "Contact added 💗", "success");
    closeModal("addContactModal");
    loadContacts();
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* ---------- Dashboard ---------- */

async function initDashboard() {
  const user = getUser();
  $("#welcomeUser").textContent = `${greeting()}, ${user.firstName} 👋`;
  $("#todayDate").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const [contacts, history, channels, me] = await Promise.all([
    fetchContacts().catch(() => []),
    api("/api/sos/history").catch(() => []),
    api("/api/sos/channels").catch(() => ({})),
    api("/api/auth/me").catch(() => user),
  ]);
  store.set("user", me);

  $("#statContacts").textContent = contacts.length;
  $("#statAlerts").textContent = history.length;
  $("#statChannels").textContent = `${[channels.email, channels.sms].filter(Boolean).length}/2`;

  const box = $("#dashboardContactsContainer");
  box.innerHTML = contacts.length
    ? contacts
        .slice(0, 5)
        .map(
          (c) => `
        <div class="contact-row">
          <div class="contact-avatar priority-${c.priority}">${escapeHtml(c.name.charAt(0).toUpperCase())}</div>
          <div><strong>${escapeHtml(c.name)}</strong><div class="muted">${escapeHtml(c.relationship)} · ${escapeHtml(c.phone)}</div></div>
          <span class="priority-chip">Priority ${c.priority}</span>
        </div>`
        )
        .join("")
    : `<p class="muted">No trusted contacts yet. <a class="text-btn" href="contacts.html">Add your first →</a></p>`;

  const activity = $("#recentActivity");
  activity.innerHTML = history.length
    ? history
        .slice(0, 5)
        .map(
          (a) => `
        <div class="activity-row">
          <div class="activity-dot ${a.status}"></div>
          <div class="activity-body">
            <p>SOS ${a.status === "active" ? "in progress" : a.status === "cancelled" ? "marked false alarm" : "resolved"} · ${a.notifications.length} contact${a.notifications.length === 1 ? "" : "s"} alerted${a.acknowledgedBy ? ` · ${escapeHtml(a.acknowledgedBy)} responded` : ""}</p>
            <small>${formatDate(a.createdAt)}, ${formatTime(a.createdAt)}</small>
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted">No alerts yet. That's a good thing 💗</p>`;

  // Safety readiness checklist
  let locationGranted = false;
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" });
    locationGranted = perm?.state === "granted";
  } catch {
    /* permissions API not available */
  }

  const checks = [
    [contacts.length >= 2, "Add at least 2 trusted contacts", "contacts.html"],
    [contacts.some((c) => c.email), "Give a contact an email for instant email alerts", "contacts.html"],
    [locationGranted, "Allow location access for live tracking", "map.html"],
    [Boolean(me.medicalNotes), "Add medical notes (blood group, allergies)", "profile.html"],
    [channels.email || channels.sms, "Configure email or SMS alerts on the server", "profile.html#channels"],
  ];
  const done = checks.filter(([ok]) => ok).length;
  $("#readinessScore").textContent = `${Math.round((done / checks.length) * 100)}%`;
  $("#readinessBar").style.width = `${(done / checks.length) * 100}%`;
  $("#readinessList").innerHTML = checks
    .map(
      ([ok, label, href]) =>
        `<a class="check-item ${ok ? "done" : ""}" href="${href}"><span>${ok ? "✓" : "○"}</span>${label}</a>`
    )
    .join("");

  const pos = await updateLocationPill();
  if (pos) {
    try {
      const score = await api(`/api/reports/score?lat=${pos.lat}&lng=${pos.lng}&radius=700`);
      $("#statSafety").textContent = score.score;
      $("#statSafetyLabel").textContent =
        score.level === "safe" ? "Area safety · Generally safe" : score.level === "moderate" ? "Area safety · Stay alert" : "Area safety · Use caution";
    } catch {
      /* ignore */
    }
  }
}

/* ---------- SOS page ---------- */

async function initSosPage() {
  updateLocationPill().then((pos) => {
    $("#gpsStatus").textContent = pos ? `Ready · ±${pos.accuracy} m accuracy` : "Location blocked: allow it in browser settings";
  });

  const [contacts, channels] = await Promise.all([
    fetchContacts().catch(() => []),
    api("/api/sos/channels").catch(() => ({})),
  ]);

  $("#emailStatus").textContent = channels.email ? "On · sent automatically" : "Off · see setup guide";
  $("#smsStatus").textContent = channels.sms ? "On · sent automatically" : "Off · use “Text from my phone”";

  const interval = channels.escalationIntervalSeconds || 60;
  const groups = [...new Set(contacts.map((c) => c.priority))].sort((a, b) => a - b).map((p) => contacts.filter((c) => c.priority === p));
  const layers = $("#layerList");

  if (!groups.length) {
    layers.innerHTML = `<p class="muted">Add trusted contacts to build your escalation layers. <a class="text-btn" href="contacts.html">Add contacts →</a></p>`;
    return;
  }

  const rows = groups.map(
    (group, i) => `
    <div class="layer">
      <div class="layer-num">${i + 1}</div>
      <div><strong>Alert ${escapeHtml(group.map((c) => c.name).join(", "))}</strong><br>
      <small>${i === 0 ? "Notified the moment the SOS is sent." : "Notified if nobody has responded yet."}</small></div>
      <code>${i * interval}s</code>
    </div>`
  );
  rows.push(`
    <div class="layer">
      <div class="layer-num">${groups.length + 1}</div>
      <div><strong>Maximum emergency mode</strong><br><small>Everyone who hasn't responded is alerted again.</small></div>
      <code>${groups.length * interval}s</code>
    </div>`);
  layers.innerHTML = rows.join("");
}

/* ---------- History ---------- */

let historyState = [];

function renderHistory() {
  const body = $("#historyBody");
  const q = ($("#historySearch")?.value || "").toLowerCase();
  const rows = historyState.filter((a) =>
    `${formatDate(a.createdAt)} ${a.status} ${a.acknowledgedBy || ""} ${a.notifications.map((n) => n.name).join(" ")}`
      .toLowerCase()
      .includes(q)
  );

  if (!historyState.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:40px">No alerts yet. Your SOS history will appear here.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((a) => {
      const loc = a.startLocation || a.lastLocation;
      const statusLabel = { active: "Active", cancelled: "False alarm", resolved: "Resolved" }[a.status];
      const statusClass = { active: "sent", cancelled: "cancelled", resolved: "resolved" }[a.status];
      const dots = Array.from({ length: 4 }, (_, i) => `<i class="${i < a.layer ? "on" : ""}"></i>`).join("");
      return `
        <tr>
          <td><strong>${formatDate(a.createdAt)}</strong><br><small>${formatTime(a.createdAt)}</small></td>
          <td>${loc ? `<a class="text-btn" target="_blank" rel="noopener" href="https://maps.google.com/?q=${loc.lat},${loc.lng}">${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} ↗</a>` : '<span class="muted">Not shared</span>'}</td>
          <td>${a.notifications.length}</td>
          <td><div class="levels">${dots}</div></td>
          <td>${a.acknowledgedBy ? escapeHtml(a.acknowledgedBy) : '<span class="muted">-</span>'}</td>
          <td><span class="status ${statusClass}">${statusLabel}</span></td>
        </tr>`;
    })
    .join("");
}

async function initHistory() {
  updateLocationPill();
  try {
    historyState = await api("/api/sos/history");
    renderHistory();
  } catch (error) {
    $("#historyBody").innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

/* ---------- Profile ---------- */

async function initProfile() {
  updateLocationPill();
  const [me, channels] = await Promise.all([api("/api/auth/me"), api("/api/sos/channels").catch(() => ({}))]);
  store.set("user", me);

  $("#profileName").textContent = fullName(me);
  $("#profileSub").textContent = `${me.email} · ${me.phone}`;
  $("#profileAvatar").textContent = me.firstName.charAt(0).toUpperCase();
  $("#pfFirstName").value = me.firstName;
  $("#pfLastName").value = me.lastName;
  $("#pfEmail").value = me.email;
  $("#pfPhone").value = me.phone;
  $("#pfNotes").value = me.medicalNotes || "";
  $("#pfCountdown").value = String(me.settings?.countdownSeconds ?? 10);
  $("#pfShareLocation").checked = me.settings?.shareLiveLocation !== false;
  $("#pfShake").checked = store.get("shakeToSos") === true;

  $("#channelEmail").innerHTML = channels.email ? '<span class="status resolved">Connected</span>' : '<span class="status sent">Not configured</span>';
  $("#channelSms").innerHTML = channels.sms ? '<span class="status resolved">Connected</span>' : '<span class="status sent">Not configured</span>';
}

async function saveProfile(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Saving…");
  try {
    const { user } = await api("/api/auth/me", {
      method: "PUT",
      body: {
        firstName: $("#pfFirstName").value.trim(),
        lastName: $("#pfLastName").value.trim(),
        phone: $("#pfPhone").value.trim(),
        medicalNotes: $("#pfNotes").value.trim(),
        settings: {
          countdownSeconds: Number($("#pfCountdown").value),
          shareLiveLocation: $("#pfShareLocation").checked,
        },
      },
    });
    store.set("user", user);
    renderSidebar("profile");
    $("#profileName").textContent = fullName(user);
    $("#profileSub").textContent = `${user.email} · ${user.phone}`;
    showToast("Profile saved", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function toggleShake(input) {
  if (input.checked && typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== "granted") throw new Error();
    } catch {
      input.checked = false;
      return showToast("Motion access was not granted", "error");
    }
  }
  store.set("shakeToSos", input.checked);
  showToast(input.checked ? "Shake your phone firmly to start an SOS countdown" : "Shake to SOS turned off");
  if (input.checked) enableShakeDetection();
}

/* ---------- Boot ---------- */

const PAGE_INIT = {
  dashboard: initDashboard,
  contacts: loadContacts,
  sos: initSosPage,
  history: initHistory,
  profile: initProfile,
  map: () => window.initMap && window.initMap(),
};

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  // Authenticated app pages
  if (PAGE_INIT[page]) {
    if (!requireLogin()) return;
    renderSidebar(page);
    renderSosOverlay();
    resumeActiveAlert();
    enableShakeDetection();
    Promise.resolve(PAGE_INIT[page]()).catch((error) => showToast(error.message, "error"));
  }

  // Already logged in? Skip the auth screens.
  if ((page === "login" || page === "signup") && store.get("token")) location.href = "dashboard.html";

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $$(".modal-backdrop.show").forEach((m) => m.classList.remove("show"));
  });
});
