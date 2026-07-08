"""
Storefront Score - FastAPI service
==================================

Serves the processed coverage data and the analytical engine (site scoring,
gravity trade-area, k-means submarket segmentation, opportunity regression).
"""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .model import DEFAULT_WEIGHTS, ENGINE

app = FastAPI(
    title="Storefront Score API",
    version="1.0.0",
    description="Commercial site-selection & market-expansion analytics for "
                "restaurant chains. Real US Census ACS + OpenStreetMap data.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------- models
class Weights(BaseModel):
    income: Optional[float] = None
    density: Optional[float] = None
    market_size: Optional[float] = None
    age_fit: Optional[float] = None
    underserved: Optional[float] = None
    affluence: Optional[float] = None


class ScoreRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    weights: Optional[Weights] = None


# ------------------------------------------------------------------ endpoints
@app.get("/api/health")
def health():
    return {"status": "ok", "zctas": len(ENGINE.zctas),
            "competitors": len(ENGINE.comps)}


@app.get("/api/meta")
def meta():
    return {
        **ENGINE.meta,
        "default_weights": DEFAULT_WEIGHTS,
        "regression": {
            "target": "competitor_density",
            "features": ["median_income", "log_pop_density",
                         "log_households", "median_age"],
            "r2": round(ENGINE._reg_r2, 3),
            "coefficients": ENGINE._reg_coef,
        },
        "clusters": ENGINE.cluster_summary,
    }


@app.get("/api/metros")
def metros():
    out = []
    for c in ENGINE.meta["coverage"]:
        s, w, n, e = c["bbox"]
        out.append({
            "id": c["metro"],
            "label": c["label"],
            "center": [(s + n) / 2, (w + e) / 2],
            "bbox": c["bbox"],
            "zctas": c["zctas"],
            "competitors": c["competitors_total"],
        })
    return out


def _filter(items, metro):
    if not metro:
        return items
    return [r for r in items if r["metro"] == metro]


@app.get("/api/zctas")
def zctas(metro: Optional[str] = None):
    """ZCTA records with demographics, sub-scores and composite site score."""
    rows = _filter(ENGINE.zctas, metro)
    return [{
        "zcta": r["zcta"], "metro": r["metro"], "lat": r["lat"], "lng": r["lng"],
        "population": r["population"], "med_income": r["med_income"],
        "med_age": r["med_age"], "households": r["households"],
        "med_home_value": r["med_home_value"], "pop_density": r["pop_density"],
        "competitors": r["competitors"], "competitor_density": r["competitor_density"],
        "site_score": r["site_score"], "subscores": r["subscores"],
        "opportunity_score": r["opportunity_score"], "cluster": r["cluster"],
        "cluster_label": r["cluster_label"],
    } for r in rows]


@app.get("/api/competitors")
def competitors(metro: Optional[str] = None):
    return _filter(ENGINE.comps, metro)


@app.get("/api/top-sites")
def top_sites(metro: Optional[str] = None, n: int = Query(10, ge=1, le=50)):
    """Ranked candidate submarkets with full score breakdown for radar charts."""
    rows = sorted(_filter(ENGINE.zctas, metro),
                  key=lambda r: r["site_score"], reverse=True)[:n]
    return [{
        "rank": i + 1, "zcta": r["zcta"], "metro": r["metro"],
        "lat": r["lat"], "lng": r["lng"], "site_score": r["site_score"],
        "subscores": r["subscores"], "cluster_label": r["cluster_label"],
        "opportunity_score": r["opportunity_score"],
        "med_income": r["med_income"], "population": r["population"],
        "competitors": r["competitors"],
    } for i, r in enumerate(rows)]


@app.get("/api/clusters")
def clusters(metro: Optional[str] = None):
    return {"summary": ENGINE.cluster_summary,
            "points": [{"zcta": r["zcta"], "metro": r["metro"],
                        "lat": r["lat"], "lng": r["lng"],
                        "cluster": r["cluster"], "label": r["cluster_label"]}
                       for r in _filter(ENGINE.zctas, metro)]}


@app.post("/api/score")
def score(req: ScoreRequest):
    weights = req.weights.model_dump() if req.weights else None
    try:
        return ENGINE.score_point(req.lat, req.lng, weights)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/score")
def score_get(lat: float, lng: float):
    return ENGINE.score_point(lat, lng, None)
