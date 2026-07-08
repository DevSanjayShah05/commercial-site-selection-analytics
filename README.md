# Storefront Score

**Commercial Site Selection & Market Expansion Analytics for Restaurant Chains**

A geospatial analyst tool for scoring and ranking candidate real-estate markets
ahead of a restaurant chain's next round of unit expansion. It combines real
Census demographics with real competitor location data to produce a
transparent, tunable site-attractiveness score, a k-means submarket
segmentation, a gravity-model trade-area estimate, and an opportunity-gap
regression — the kind of toolkit a commercial performance / insights team
would build to prioritize where to open next.

> Built as one of a set of portfolio projects targeting Commercial Performance
> & Insights Analyst roles. The emphasis throughout is on **real, sourced
> data**, **documented methodology**, and **honest handling of data
> limitations** rather than a polished demo over synthetic numbers.

*(Screenshots: see [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md) for a
placeholder note — add captures of the running app: map-first GIS UI with
the demographic overlay, competitor clustering, and the site-score side
panel.)*

---

## What it does

- **Click-anywhere site scoring.** Click any point on the map and get an
  instant 0–100 site-attractiveness score (grade A–E), a six-axis radar
  breakdown, a Huff-style gravity trade-area capture estimate, and an
  opportunity-gap read (is this location under- or over-competed relative to
  what its demographics would predict?).
- **Tunable weighted scoring model.** Six factors — income, population
  density, market size, dining-age fit, competitive under-saturation, and
  affluence — combine into the composite score. Weight sliders re-score and
  re-rank every visible site **live, client-side**, using the same formula the
  backend uses for the initial fetch.
- **Submarket segmentation.** K-means (k=5) clusters every surveyed ZIP Code
  Tabulation Area (ZCTA) into named segments (e.g. *Underserved
  High-Potential*, *Saturated Core*) so an analyst can scan a metro for
  whole neighborhoods worth a closer look.
- **Opportunity regression.** An OLS model predicts local competitive
  intensity from demographic fundamentals (income, density, households, age);
  the residual (predicted − actual competition) is exposed as an
  "opportunity gap" — a simple, explainable market-potential proxy.
- **Demographic overlay + competitor clustering** on a full-bleed MapLibre GL
  map, with a ranked, live-reweighted list of top candidate ZCTAs per metro.

## Data sources & methodology

All data is real. Nothing in the processed dataset is synthetic or simulated.

| Source | What it provides | Access |
|---|---|---|
| **US Census Bureau ACS 5-year estimates**, via the [Census Reporter API](https://censusreporter.org) | Population, median household income, median age, households, median home value — **ACS 2020–2024 5-year release**, ZCTA geography | Public, keyless |
| **US Census Bureau 2022 ZCTA National Gazetteer** | ZCTA centroid lat/lng and land area (`ALAND_SQMI`), used to compute population density | Public, static file, keyless |
| **OpenStreetMap Overpass API** | Real restaurant / fast-food / cafe point-of-interest locations (`amenity=restaurant\|fast_food\|cafe`) per metro | Public, keyless |

### A note on the Census API

The task brief for this project assumed the direct Census API
(`api.census.gov/data/2022/acs/acs5`) could be queried keylessly. **That is no
longer true** — as of this build, every request without an API key returns an
HTTP 200 response containing an HTML "Missing Key" page rather than JSON
(status-code checks alone won't catch this). A free key can be requested at
the [Census key signup page](https://api.census.gov/data/key_signup.html),
but that requires email confirmation and isn't something an automated
pipeline can complete unattended.

To keep this project **fully reproducible with zero credentials**, the data
pipeline (`backend/data/fetch_data.py`) sources the *same underlying ACS
5-year estimates* through **Census Reporter's public API**, which wraps the
Census Bureau's data and remains keyless. If you have a Census API key, it
would be straightforward to swap `fetch_data.py`'s demographics calls back to
`api.census.gov` directly — the ACS variable IDs (B01003, B19013, B01002,
B11001, B25077) are documented in the script.

### Geographic coverage

Six growth-market metros, scoped by county FIPS and filtered to each metro's
urban-core bounding box:

| Metro | Counties | ZCTAs surveyed | Competitor POIs found | POIs mapped* |
|---|---|---|---|---|
| Austin, TX | Travis, Williamson | 49 | 1,686 | 1,200 |
| Denver, CO | Denver, Arapahoe, Jefferson, Adams | 64 | 3,408 | 1,200 |
| Nashville, TN | Davidson | 29 | 707 | 707 |
| Charlotte, NC | Mecklenburg | 30 | 1,192 | 1,192 |
| Phoenix, AZ | Maricopa | 71 | 2,559 | 1,200 |
| Tampa, FL | Hillsborough, Pinellas | 32 | 832 | 832 |
| **Total** | | **275 ZCTAs** | **10,384** | **6,331** |

\* Full competitor counts drive all density calculations; the map only
renders a capped, randomly-sampled subset per metro (≤1,200 points) to keep
the client-side GeoJSON payload small — this is a rendering optimization, not
a data-quality limitation.

### Known limitations (stated honestly)

- **Choropleth overlay is centroid-based, not polygon-based.** The Gazetteer
  file provides ZCTA *centroids* and land area, not polygon boundaries. The
  map's "demographic overlay" is a graduated heat-surface + point layer
  interpolated from those centroids — it communicates *directional* patterns
  well but is not parcel-precise, and the UI/legend say so explicitly.
- **Click-to-score uses spatial interpolation.** A point that isn't a ZCTA
  centroid gets its demographic/competitive features from an inverse-distance
  weighted blend of the 6 nearest surveyed ZCTAs. This is a reasonable proxy,
  not a survey value.
- **Regression fit is modest (R² ≈ 0.17–0.20).** Competitive density is a
  genuinely noisy function of four demographic features at ZCTA granularity —
  the model is presented as an explainable directional signal (an
  "opportunity gap"), not a high-precision predictor.
- **ACS 5-year estimates carry margins of error**, especially for smaller
  ZCTAs; these are not currently propagated into the score's confidence.
- **OSM competitor coverage is crowd-sourced** and, like any OSM extract, can
  under- or over-count POIs in areas with sparser mapping activity.
- Six metros / 275 ZCTAs is a deliberately tractable slice for a portfolio
  project, not a national dataset.

## Architecture

```
storefront-score/
├── backend/                  FastAPI service + analytics engine
│   ├── app/
│   │   ├── model.py           feature prep, weighted scoring, k-means,
│   │   │                      OLS opportunity regression, Huff gravity model
│   │   └── main.py            REST endpoints
│   ├── data/
│   │   ├── fetch_data.py      data acquisition pipeline (Census Reporter +
│   │   │                      Gazetteer + Overpass -> processed/*.json)
│   │   ├── raw/                gitignored raw caches (gazetteer, etc.)
│   │   └── processed/          committed, small (~730 KB) dataset the API
│   │                           reads at runtime
│   └── requirements.txt
└── frontend/                 React + TypeScript + Vite
    └── src/
        ├── components/
        │   ├── MapView.tsx     MapLibre GL map: basemap, demographic
        │   │                   heat/point overlay, clustered competitor
        │   │                   POIs, numbered top-site markers, click-score
        │   ├── ControlPanel.tsx  metro selector, layer toggles, weight sliders
        │   ├── ScoreCard.tsx    live score, radar, trade-area, opportunity gap
        │   ├── TopSitesList.tsx ranked candidate sites (live re-ranked)
        │   └── Radar.tsx        hand-rolled SVG radar chart
        ├── lib/score.ts        client-side mirror of the backend's weighted
        │                       composite formula (enables instant re-ranking)
        └── api.ts               typed REST client
```

### Analytical model, in brief

1. **Weighted multi-factor site score** — six 0–1 sub-scores (income,
   population density, market size, dining-age fit, competitive
   under-saturation, affluence), min-max normalized per feature, combined
   with documented default weights (`income .22, density .18, market_size
   .15, age_fit .10, underserved .22, affluence .13`, defined in
   `backend/app/model.py::DEFAULT_WEIGHTS`). Fully tunable at request time.
2. **Gravity (Huff) trade-area model** — estimates the population a
   prospective site would capture within a 5 km radius, with attractiveness
   decaying exponentially by distance (β = 0.6) and competing against nearby
   existing POIs.
3. **K-means submarket segmentation** — clusters ZCTAs on income, log
   population density, log households, median age, and log competitor
   density into 5 segments, ranked and labeled by an opportunity index
   (demand potential + under-saturation).
4. **Opportunity regression** — OLS of competitor density on demographic
   fundamentals; the signed residual at any point is reported as an
   "opportunity gap" (under-competed vs. saturated).

## Setup & run

### Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API reads the committed `data/processed/*.json` at startup — no data
fetch is required to run the app. To regenerate that dataset from live
sources:

```bash
cd backend/data
python3 fetch_data.py
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :8000
# or
npm run build         # production build to dist/
```

Set `VITE_API_URL` if the backend runs somewhere other than
`http://localhost:8000` for a production build.

### Quick smoke test

```bash
curl -s localhost:8000/api/health
curl -s -X POST localhost:8000/api/score \
  -H 'content-type: application/json' \
  -d '{"lat": 30.2672, "lng": -97.7431}'   # downtown Austin
```

## Tech stack

- **Backend:** Python, FastAPI, scikit-learn (KMeans, LinearRegression),
  NumPy
- **Frontend:** React 18, TypeScript, Vite, MapLibre GL JS
- **Map tiles:** free OpenStreetMap-derived raster tiles via CARTO (no
  Mapbox token required)
- **Data:** US Census ACS 5-year (via Census Reporter), US Census ZCTA
  Gazetteer, OpenStreetMap Overpass API
