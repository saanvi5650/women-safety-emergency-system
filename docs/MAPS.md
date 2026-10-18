# Maps & danger data

## Base map (tiles)

SheShield uses **Leaflet** (open source) with **OpenStreetMap's own tiles**: free, no API key, open data.
The tile URL lives in one place: `MAP_TILES` in `frontend/js/app.js`.

| Option | Key needed? | Cost | Notes |
|---|---|---|---|
| **OpenStreetMap tiles** (current) | No | Free | Must follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/): show attribution, light traffic only. Good for development and small deployments. |
| **OpenFreeMap** | No | Free, no request limits | Open source, can be self-hosted. Vector tiles only, so it needs MapLibre GL (or the `maplibre-gl-leaflet` plugin) instead of a plain Leaflet tile layer. Best free upgrade when traffic grows. <https://openfreemap.org> |
| **Self-hosted tiles** (OpenMapTiles / Protomaps PMTiles with an India extract) | No | Your server costs | Full control; you can render India's boundaries the way you need. |
| CARTO, MapTiler, Stadia | Yes | Free tier, then paid | CARTO basemaps now require an API key (that's why the map showed "API KEY REQUIRED"). |
| **Mappls (MapmyIndia)**, **Ola Maps** | Yes | Free tier, then paid | Indian providers that show India's official boundaries. |

### India's boundaries

OpenStreetMap's default tiles draw borders as they are on the ground, which differs from the Survey of India's official
depiction (Jammu & Kashmir, Arunachal Pradesh). That's fine for a student or prototype project. Before a public launch in
India, switch to an Indian provider (Mappls / Ola Maps) or self-host tiles that use the Survey of India boundaries, and
check the current legal requirements.

### India-only restriction

- The map can't be panned outside India (`INDIA_BOUNDS` in `frontend/js/app.js`).
- Place search only returns results in India (`countrycodes=in`).
- The API rejects danger reports outside India (`backend/config/region.js`).

Both bounds are a rough bounding box that also clips small parts of neighbouring countries. For exact borders, replace
the box check with a point-in-polygon test against an India boundary GeoJSON.

## Showing real danger areas

No single open dataset gives "dangerous streets in India". Real apps combine several sources. Recommended order:

### 1. Your own users' reports (already built)

Every report on the Safety Map is real data. This is how Safecity built tens of thousands of reports. To get it going:

- Launch in **one city or campus** first (e.g. your college and the surrounding area) so the map fills up quickly.
- Run a reporting drive with student groups, NSS/NCC, or women's cells, and ask people to log places they already avoid.
- Keep reports anonymous (already the case) and let others confirm them; confirmations raise their weight.

Before going public, add moderation: let users flag false reports, hide reports with many flags, and let old reports
fade (recency weighting is already built in).

### 2. NCRB "Crime in India" statistics (official, India-wide)

The National Crime Records Bureau publishes crimes against women by **state, metropolitan city, and police district**
every year.

- Download: <https://ncrb.gov.in> (Crime in India reports), or CSVs on [data.gov.in](https://data.gov.in/resource/district-wise-crimes-committed-against-women-during-2013) and the [India Data Portal](https://ckandev.indiadataportal.com/dataset/crime-statistics/resource/0f12840c-47cf-407f-b132-6410a3c331ee). Newer years are compiled on [Dataful](https://dataful.in/datasets/?q=rape).
- These are counts per district, **not street locations**. Show them as a shaded "district crime rate" layer
  (crimes per lakh population), joined to district boundaries (DataMeet / Survey of India GeoJSON).
- Label it clearly: it shows **reported** crime, and reporting rates vary a lot between districts.

### 3. Partner data

- **Safecity (Red Dot Foundation)**: has India's largest crowd-mapped harassment dataset and works with police and NGOs.
  There's no public API; contact them for a research or data partnership.
- **Safetipin**: does city safety audits (lighting, crowd, visibility) and shares data with city governments.
- **City police**: some police departments share hotspot data with research partners. An RTI request can get
  aggregate data, though rarely street-level.

### 4. Environmental signals from OpenStreetMap (free)

Safetipin's research shows that lighting, people around, and nearby help strongly affect how safe a place feels. You can
estimate some of this from OpenStreetMap with the Overpass API (already used for police stations):

- distance to the nearest police station or hospital,
- roads tagged `lit=no` (coverage in India is patchy),
- how many shops, restaurants, and transit stops are nearby, since "eyes on the street" make a place feel safer at night.

These are hints, not crime data. Use them to adjust the safety score, never to mark an area as dangerous on their own.

### What not to do

- Don't add made-up or scraped "danger" pins presented as real; they mislead people about their safety. The demo
  seed script labels its reports "Demo data" for this reason, and you should remove them (`npm run seed:demo -- --clear`)
  before real users join.
- Don't label whole neighbourhoods as dangerous from thin data. Show how many reports a score is based on (the app already
  does) and avoid stigmatising localities.
