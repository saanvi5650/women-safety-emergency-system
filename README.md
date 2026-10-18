# SheShield 🛡️

**Adaptive women safety platform:** one-tap SOS with live location tracking, layered alerts to trusted contacts,
and a community safety map with safest-route planning.

> In immediate danger, always call **112** (India national emergency) · Women helpline **1091**

## Features

| | |
|---|---|
| 🚨 **Adaptive SOS escalation** | Priority 1 contacts are alerted instantly; the next layers are added every minute until someone taps “I'm responding”. |
| 📍 **Live tracking link** | Contacts receive a private link (email + SMS) that shows your real-time location in any browser, with your medical notes. |
| 💬 **Works without a provider** | “Text from my phone” opens your SMS app pre-filled with the alert, even if the server is down. |
| 🗺️ **Community safety map** | Report harassment, stalking, poor lighting, deserted areas and more. Reports are anonymous and weighted by severity, recency, confirmations and time of day. |
| 🧭 **Safest route** | Compares walking/driving routes by how many unsafe reports lie along each one. |
| 🏥 **Nearby help** | Police stations and hospitals around you (OpenStreetMap), with one-tap routing to the nearest. |
| 📞 **Fake call & shake-to-SOS** | Escape uncomfortable situations; shake your phone to start an SOS while the app is open. |
| 📋 **Alert history** | Who was alerted, through which channel, and who responded. |

Maps use free OpenStreetMap services (CARTO tiles, Nominatim, Overpass, OSRM), so **no API keys are needed**.

## Quick start

Requirements: Node.js 18+ and MongoDB (local, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster).

```bash
cd backend
cp .env.example .env        # then set MONGO_URI and JWT_SECRET
npm install
npm run dev
```

Open **http://localhost:5000**. The backend serves the frontend, so there's nothing else to run.

Optional: add sample danger reports for a demo (they're labelled “Demo data” on the map):

```bash
npm run seed:demo                     # around Chennai
npm run seed:demo -- 28.6139 77.2090  # around any lat/lng
npm run seed:demo -- --clear          # remove them
```

Run the tests: `npm test`

## Setting up SOS email & SMS

See **[docs/SOS_SETUP.md](docs/SOS_SETUP.md)**: Gmail app password (free, 5 minutes), Twilio or Fast2SMS for SMS,
and how to make tracking links reachable from your contacts' phones.

## Project structure

```
backend/
  server.js              Express app; serves /api and the frontend
  middleware/auth.js     JWT authentication
  models/                User, Contact, Alert (SOS), Report (danger spots, 2dsphere index)
  routes/                auth, contacts, sos (+ public tracking), reports (map + safety score)
  services/notify.js     Email (Nodemailer) and SMS (Twilio / Fast2SMS)
  services/sos.js        Escalation engine and alert messages
  scripts/seed-demo.js   Demo data for the safety map
  test/                  node:test suites
frontend/
  *.html                 Pages (landing, auth, dashboard, map, contacts, sos, history, profile, track)
  js/app.js              Shared layout, API client, SOS flow, page logic
  js/map.js              Safety map (Leaflet)
  js/track.js            Public live-tracking page for contacts
docs/
  SOS_SETUP.md           Email/SMS/phone alert setup
  COMPETITOR_RESEARCH.md Market research and roadmap
```

## API overview

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/signup` · `/api/auth/login` | Returns a JWT |
| GET/PUT | `/api/auth/me` | Profile, medical notes, SOS settings |
| GET/POST/PUT/DELETE | `/api/contacts[/:id]` | Trusted contacts (scoped to the logged-in user) |
| POST | `/api/sos/trigger` | Start an SOS (sends layer 1) |
| POST | `/api/sos/:id/location` | Stream live location |
| POST | `/api/sos/:id/resolve` | “I'm safe” / false alarm |
| GET | `/api/sos/active` · `/api/sos/history` · `/api/sos/channels` | Alert state |
| GET | `/api/sos/track/:token` | **Public** tracking data for contacts |
| POST | `/api/sos/track/:token/ack` | **Public** “I'm responding” |
| GET/POST | `/api/reports` | Danger reports by `bbox` or `lat,lng,radius` |
| GET | `/api/reports/score` | 0–100 safety score for a location |
| POST/DELETE | `/api/reports/:id/confirm` · `/api/reports/:id` | Confirm / delete own report |

## Research

Feature choices are based on a review of bSafe, Noonlight, Life360, Google Personal Safety, Apple Check In,
Safetipin, Safecity, 112 India, Himmat Plus and Kavalan. See **[docs/COMPETITOR_RESEARCH.md](docs/COMPETITOR_RESEARCH.md)**.
