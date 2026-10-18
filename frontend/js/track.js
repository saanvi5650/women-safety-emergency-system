/* Public live-tracking page opened by trusted contacts from the SOS email/SMS. */

const params = new URLSearchParams(location.search);
const shareToken = params.get("t");
const contactKey = params.get("c");

const track = { map: null, marker: null, path: null, fitted: false, timer: null };

async function loadTracking() {
  if (!shareToken) return showTrackError("This tracking link is incomplete.");

  try {
    const query = contactKey ? `?c=${encodeURIComponent(contactKey)}` : "";
    const data = await api(`/api/sos/track/${encodeURIComponent(shareToken)}${query}`, { auth: false });
    renderTracking(data);
  } catch (error) {
    showTrackError(error.message);
  }
}

function showTrackError(message) {
  $("#trackTitle").textContent = "Tracking unavailable";
  $("#trackSub").textContent = message;
  $("#trackLive").hidden = true;
  clearInterval(track.timer);
}

function renderTracking(data) {
  const person = data.person || { firstName: "Your contact", lastName: "" };
  const name = `${person.firstName} ${person.lastName}`.trim();
  const active = data.status === "active";
  document.title = `${active ? "SOS" : "Safe"}: ${name} — SheShield`;

  document.body.classList.toggle("is-safe", !active);
  $("#trackLive").textContent = active ? "● LIVE" : "ENDED";
  $("#trackTitle").textContent = active ? `${name} needs help` : `${name} is safe`;
  $("#trackSub").textContent = active
    ? `SOS started ${timeAgo(data.createdAt)}.${data.acknowledgedBy ? ` ${data.acknowledgedBy} is responding.` : " Nobody has responded yet."}`
    : `The alert ended ${timeAgo(data.endedAt)}. Thank you for being there.`;

  if (person.phone) {
    $("#callPerson").href = `tel:${person.phone.replace(/[^\d+]/g, "")}`;
    $("#callPerson").textContent = `📞 Call ${person.firstName}`;
  }

  if (person.medicalNotes) {
    $("#medicalCard").hidden = false;
    $("#medicalNotes").textContent = person.medicalNotes;
  }

  const ackCard = $("#ackCard");
  ackCard.hidden = !(active && data.viewer);
  if (data.viewer?.acknowledged) {
    $("#ackBtn").disabled = true;
    $("#ackBtn").textContent = "✓ You're marked as responding";
  }

  const loc = data.lastLocation;
  if (loc) {
    $("#openMaps").href = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
    $("#trackUpdated").textContent = `Last location update ${timeAgo(loc.at)} · accuracy ±${loc.accuracy ?? "?"} m`;
    drawLocation(loc, data.path || []);
  } else {
    $("#openMaps").hidden = true;
    $("#trackUpdated").textContent = active ? "Waiting for the first location fix…" : "Location is no longer shared.";
  }

  if (!active) clearInterval(track.timer);
}

function drawLocation(loc, path) {
  if (typeof L === "undefined") return;
  if (!track.map) {
    track.map = L.map("trackMap").setView([loc.lat, loc.lng], 16);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(track.map);
    track.path = L.polyline([], { color: "#e65278", weight: 4, opacity: 0.7 }).addTo(track.map);
    track.marker = L.marker([loc.lat, loc.lng], {
      icon: L.divIcon({ className: "sos-marker", html: "<span></span>", iconSize: [26, 26] }),
    }).addTo(track.map);
  }

  track.marker.setLatLng([loc.lat, loc.lng]);
  track.path.setLatLngs(path.length ? path : [[loc.lat, loc.lng]]);
  if (!track.fitted) {
    track.fitted = true;
    track.map.setView([loc.lat, loc.lng], 16);
  }
}

async function acknowledge() {
  const btn = $("#ackBtn");
  btn.disabled = true;
  try {
    const data = await api(`/api/sos/track/${encodeURIComponent(shareToken)}/ack`, {
      method: "POST",
      body: { key: contactKey },
      auth: false,
    });
    btn.textContent = "✓ You're marked as responding";
    showToast(data.message, "success");
    loadTracking();
  } catch (error) {
    btn.disabled = false;
    showToast(error.message, "error");
  }
}

loadTracking();
track.timer = setInterval(loadTracking, 8000);
