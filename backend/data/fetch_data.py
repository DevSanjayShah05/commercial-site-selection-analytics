"""
Storefront Score - Data acquisition pipeline
============================================

Pulls REAL data from two public, no-auth sources and builds the compact
processed dataset the API reads at runtime:

  1. Demographics  -> Census Reporter API (wraps US Census ACS 2020-2024
                      5-year estimates).  Keyless.
                      https://api.censusreporter.org
                      Tables: B01003 (population), B19013 (median household
                      income), B01002 (median age), B11001 (households),
                      B25077 (median home value), at ZCTA (ZIP) geography.

  2. ZCTA centroids -> US Census Bureau 2022 National ZCTA Gazetteer file
                      (static download, keyless).  Supplies INTPTLAT /
                      INTPTLONG centroid and ALAND land area used for
                      population-density calculations.

  3. Competitors   -> OpenStreetMap Overpass API (keyless).
                      amenity in {restaurant, fast_food, cafe} within each
                      metro core bounding box.
                      https://overpass-api.de/api/interpreter

NOTE ON THE CENSUS API
----------------------
The direct Census API (api.census.gov/data/2022/acs/acs5) now rejects
un-keyed requests with an HTML "Missing Key" page.  A free key can be
requested at https://api.census.gov/data/key_signup.html and, if present in
the environment variable CENSUS_API_KEY, would be usable directly.  To keep
this project fully reproducible with zero credentials we source the same
underlying ACS estimates through the keyless Census Reporter API instead.

Outputs (committed, small):
  data/processed/metros.json       - per-ZCTA demographics + centroid + density
  data/processed/competitors.json  - sampled competitor POIs for the map
  data/processed/meta.json         - provenance / coverage summary

Raw caches land in data/raw/ (gitignored) so re-runs are cheap.
"""

import json
import math
import os
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

random.seed(42)

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
PROC = HERE / "processed"
RAW.mkdir(parents=True, exist_ok=True)
PROC.mkdir(parents=True, exist_ok=True)

GAZ_FILE = RAW / "gaz_zcta_national.txt"

# ---------------------------------------------------------------------------
# Target metros.  Each has a core bounding box (S, W, N, E) and the county
# FIPS codes whose ZCTAs we pull.  ZCTAs are then filtered to those whose
# centroid falls inside the bbox, keeping demographics and competitor data
# scoped to the same urban core.
# ---------------------------------------------------------------------------
METROS = {
    "austin": {
        "label": "Austin, TX",
        "bbox": [30.10, -97.95, 30.55, -97.55],
        "counties": ["48453", "48491"],  # Travis, Williamson
    },
    "denver": {
        "label": "Denver, CO",
        "bbox": [39.58, -105.18, 39.92, -104.75],
        "counties": ["08031", "08005", "08059", "08001"],  # Denver, Arapahoe, Jefferson, Adams
    },
    "nashville": {
        "label": "Nashville, TN",
        "bbox": [35.98, -87.00, 36.36, -86.58],
        "counties": ["47037"],  # Davidson
    },
    "charlotte": {
        "label": "Charlotte, NC",
        "bbox": [35.05, -81.05, 35.43, -80.62],
        "counties": ["37119"],  # Mecklenburg
    },
    "phoenix": {
        "label": "Phoenix, AZ",
        "bbox": [33.30, -112.32, 33.72, -111.85],
        "counties": ["04013"],  # Maricopa
    },
    "tampa": {
        "label": "Tampa, FL",
        "bbox": [27.82, -82.62, 28.12, -82.28],
        "counties": ["12057", "12103"],  # Hillsborough, Pinellas
    },
}

TABLES = ["B01003", "B19013", "B01002", "B11001", "B25077"]
COMP_SAMPLE_PER_METRO = 1200  # cap POIs kept for the map (full counts still used)
COMP_RADIUS_KM = 1.6  # local competitive-density radius around a ZCTA centroid

UA = {"User-Agent": "storefront-score/1.0 (portfolio project; contact via github)"}


def http_get(url, retries=8, backoff=3.0, timeout=90):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
            if body.lstrip().startswith(("<", "<!")):  # HTML error page
                raise ValueError("non-JSON (rate limit / error page)")
            return json.loads(body)
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"    retry {i+1}/{retries}: {e}")
            time.sleep(backoff * (i + 1))
    raise RuntimeError(f"GET failed after {retries} tries: {url}\n{last}")


def overpass(bbox, retries=6, backoff=8.0):
    s, w, n, e = bbox
    q = (
        f'[out:json][timeout:120];'
        f'(node["amenity"~"^(restaurant|fast_food|cafe)$"]({s},{w},{n},{e}););'
        f'out body;'
    )
    hosts = [
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    last = None
    for i in range(retries):
        host = hosts[i % len(hosts)]
        try:
            data = urllib.parse.urlencode({"data": q}).encode()
            req = urllib.request.Request(host, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read().decode("utf-8", "replace")
            obj = json.loads(body)
            return obj.get("elements", [])
        except Exception as ex:  # noqa: BLE001
            last = ex
            print(f"    overpass retry {i+1}/{retries} via {host}: {ex}")
            time.sleep(backoff * (i + 1))
    raise RuntimeError(f"overpass failed: {last}")


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_gazetteer():
    """GEOID -> (lat, lng, land_sqmi)"""
    out = {}
    with open(GAZ_FILE, encoding="latin-1") as f:
        header = f.readline().rstrip("\n").split("\t")
        idx = {h.strip(): i for i, h in enumerate(header)}
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < len(header):
                continue
            geoid = p[idx["GEOID"]].strip()
            try:
                lat = float(p[idx["INTPTLAT"]].strip())
                lng = float(p[idx["INTPTLONG"]].strip())
                land = float(p[idx["ALAND_SQMI"]].strip())
            except ValueError:
                continue
            out[geoid] = (lat, lng, land)
    return out


def fetch_demographics(county_fips):
    """All ZCTAs within a county via Census Reporter child-geo query."""
    parent = f"05000US{county_fips}"
    geo = f"860|{parent}"
    url = (
        "https://api.censusreporter.org/1.0/data/show/latest?"
        + urllib.parse.urlencode({"table_ids": ",".join(TABLES), "geo_ids": geo})
    )
    obj = http_get(url)
    return obj.get("data", {}), obj.get("release", {})


def est(rec, table, col):
    try:
        return rec[table]["estimate"][col]
    except (KeyError, TypeError):
        return None


def main():
    print("Loading ZCTA gazetteer (centroids + land area) ...")
    gaz = load_gazetteer()
    print(f"  {len(gaz):,} ZCTA centroids loaded")

    zctas_out = []
    comps_out = []
    release_name = ""
    coverage = []

    for key, m in METROS.items():
        print(f"\n=== {m['label']} ===")
        s, w, n, e = m["bbox"]

        # ---- demographics (union of counties, filtered to bbox) ----
        seen = set()
        metro_zctas = []
        for cf in m["counties"]:
            print(f"  Census Reporter: county {cf}")
            data, release = fetch_demographics(cf)
            if release:
                release_name = release.get("name", release_name)
            for geoid, rec in data.items():
                zcta = geoid.split("US")[-1]
                if zcta in seen or zcta not in gaz:
                    continue
                lat, lng, land = gaz[zcta]
                if not (s <= lat <= n and w <= lng <= e):
                    continue
                pop = est(rec, "B01003", "B01003001")
                if not pop or pop <= 0:
                    continue
                seen.add(zcta)
                land = max(land, 0.05)
                metro_zctas.append({
                    "zcta": zcta,
                    "metro": key,
                    "lat": round(lat, 5),
                    "lng": round(lng, 5),
                    "land_sqmi": round(land, 3),
                    "population": int(pop),
                    "med_income": _int(est(rec, "B19013", "B19013001")),
                    "med_age": _num(est(rec, "B01002", "B01002001")),
                    "households": _int(est(rec, "B11001", "B11001001")),
                    "med_home_value": _int(est(rec, "B25077", "B25077001")),
                    "pop_density": round(pop / land, 1),
                })
            time.sleep(1.0)
        print(f"  {len(metro_zctas)} ZCTAs in core bbox")

        # ---- competitors (Overpass) ----
        print("  Overpass: fetching restaurant/fast_food/cafe POIs ...")
        elements = overpass(m["bbox"])
        pts = []
        for el in elements:
            if "lat" not in el or "lon" not in el:
                continue
            tags = el.get("tags", {})
            pts.append({
                "lat": el["lat"],
                "lon": el["lon"],
                "amenity": tags.get("amenity", "restaurant"),
                "name": tags.get("name", ""),
            })
        print(f"  {len(pts)} competitor POIs")

        # ---- local competitive density per ZCTA ----
        for z in metro_zctas:
            c = 0
            for p in pts:
                if abs(p["lat"] - z["lat"]) > 0.03 or abs(p["lon"] - z["lng"]) > 0.03:
                    continue
                if haversine_km(z["lat"], z["lng"], p["lat"], p["lon"]) <= COMP_RADIUS_KM:
                    c += 1
            area = math.pi * (COMP_RADIUS_KM * 0.621371) ** 2  # sq mi
            z["competitors"] = c
            z["competitor_density"] = round(c / area, 2)
        zctas_out.extend(metro_zctas)

        # ---- keep a sample of POIs for the map ----
        sample = pts if len(pts) <= COMP_SAMPLE_PER_METRO else random.sample(pts, COMP_SAMPLE_PER_METRO)
        for p in sample:
            comps_out.append({
                "metro": key,
                "lat": round(p["lat"], 5),
                "lng": round(p["lon"], 5),
                "type": p["amenity"],
                "name": p["name"][:60],
            })

        coverage.append({
            "metro": key,
            "label": m["label"],
            "bbox": m["bbox"],
            "counties": m["counties"],
            "zctas": len(metro_zctas),
            "competitors_total": len(pts),
            "competitors_mapped": len(sample),
        })

    # ---- write ----
    (PROC / "metros.json").write_text(json.dumps(zctas_out))
    (PROC / "competitors.json").write_text(json.dumps(comps_out))
    (PROC / "meta.json").write_text(json.dumps({
        "release": release_name,
        "demographics_source": "US Census ACS 5-year via Census Reporter API",
        "competitor_source": "OpenStreetMap Overpass API",
        "geography": "ZIP Code Tabulation Areas (ZCTA)",
        "coverage": coverage,
        "total_zctas": len(zctas_out),
        "total_competitors_mapped": len(comps_out),
    }, indent=2))

    print("\nDONE")
    print(f"  ZCTAs: {len(zctas_out)}  |  Competitor POIs (mapped): {len(comps_out)}")
    for c in coverage:
        print(f"  {c['label']:<16} zctas={c['zctas']:<4} competitors={c['competitors_total']}")


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    main()
