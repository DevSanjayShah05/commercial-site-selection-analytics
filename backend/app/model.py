"""
Storefront Score - analytical engine
====================================

Loads the processed ZCTA + competitor dataset and builds, at import time:

  * a normalised feature space over every ZCTA in the coverage area,
  * a weighted multi-factor SITE-SCORING model (documented, tunable weights),
  * a k-means segmentation of submarkets that flags the underserved,
    high-potential cluster,
  * an OLS regression of competitive intensity on demographic fundamentals,
    whose residual is used as a "market-potential / opportunity gap" proxy.

The same primitives power the on-demand scoring of an arbitrary lat/lng point
(features spatially interpolated via inverse-distance weighting) and a
Huff-style gravity trade-area estimate.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
from sklearn.cluster import KMeans
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler

DATA = Path(__file__).resolve().parent.parent / "data" / "processed"

# ---------------------------------------------------------------------------
# Site-scoring model.  Six sub-scores, each mapped to 0-1 (higher = more
# attractive for a new restaurant), combined by the weights below.  Weights
# are the documented defaults and are overridable per request.
# ---------------------------------------------------------------------------
DEFAULT_WEIGHTS = {
    "income": 0.22,       # household spending power           (higher better)
    "density": 0.18,      # population density -> foot traffic  (higher better)
    "market_size": 0.15,  # number of households -> demand mass (higher better)
    "age_fit": 0.10,      # fit to prime dining demographic     (peak ~35)
    "underserved": 0.22,  # inverse competitor density          (lower comp better)
    "affluence": 0.13,    # median home value -> discretionary   (higher better)
}

PRIME_DINING_AGE = 35.0
AGE_SIGMA = 12.0
GRAVITY_BETA = 0.6          # distance-decay (per km) for the Huff model
TRADE_AREA_RADIUS_KM = 5.0  # search radius for gravity trade-area


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _age_fit(age: float) -> float:
    return math.exp(-((age - PRIME_DINING_AGE) ** 2) / (2 * AGE_SIGMA ** 2))


@dataclass
class Engine:
    zctas: list = field(default_factory=list)
    comps: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    # derived
    _lat: np.ndarray = None
    _lng: np.ndarray = None
    _scaler: StandardScaler = None
    _kmeans: KMeans = None
    _reg: LinearRegression = None
    _norm: dict = field(default_factory=dict)

    # ------------------------------------------------------------------ load
    @classmethod
    def load(cls) -> "Engine":
        zctas = json.loads((DATA / "metros.json").read_text())
        comps = json.loads((DATA / "competitors.json").read_text())
        meta = json.loads((DATA / "meta.json").read_text())
        eng = cls(zctas=zctas, comps=comps, meta=meta)
        eng._build()
        return eng

    # ----------------------------------------------------------- feature prep
    def _build(self):
        z = self.zctas
        # impute missing income / home value / age with metro medians
        for field_name in ("med_income", "med_home_value", "med_age"):
            by_metro: dict[str, list] = {}
            for r in z:
                if r[field_name] is not None:
                    by_metro.setdefault(r["metro"], []).append(r[field_name])
            med = {m: float(np.median(v)) for m, v in by_metro.items()}
            for r in z:
                if r[field_name] is None:
                    r[field_name] = med.get(r["metro"], 0.0)

        self._lat = np.array([r["lat"] for r in z])
        self._lng = np.array([r["lng"] for r in z])

        income = np.array([r["med_income"] for r in z], float)
        dens = np.log1p(np.array([r["pop_density"] for r in z], float))
        hh = np.log1p(np.array([r["households"] for r in z], float))
        age = np.array([r["med_age"] for r in z], float)
        compd = np.array([r["competitor_density"] for r in z], float)
        home = np.array([r["med_home_value"] for r in z], float)

        # min-max normalisation params (stored so a live point uses the same scale)
        self._norm = {
            "income": (income.min(), income.max()),
            "density": (dens.min(), dens.max()),
            "market_size": (hh.min(), hh.max()),
            "competitor_density": (compd.min(), compd.max()),
            "home": (home.min(), home.max()),
        }

        # attach sub-scores + composite to each ZCTA (default weights)
        for i, r in enumerate(z):
            sub = self._subscores(
                r["med_income"], r["pop_density"], r["households"],
                r["med_age"], r["competitor_density"], r["med_home_value"],
            )
            r["subscores"] = {k: round(v, 4) for k, v in sub.items()}
            r["site_score"] = round(self._composite(sub, DEFAULT_WEIGHTS), 1)

        # ---- k-means submarket segmentation ----
        # competitor density is heavily right-skewed (a few saturated cores),
        # so cluster on its log to keep segments balanced and interpretable.
        X = np.column_stack([income, dens, hh, age, np.log1p(compd)])
        self._scaler = StandardScaler().fit(X)
        Xs = self._scaler.transform(X)
        k = 5
        self._kmeans = KMeans(n_clusters=k, n_init=10, random_state=42).fit(Xs)
        labels = self._kmeans.labels_

        # demand vs competition per cluster -> label the opportunity cluster
        demand = np.array([r["subscores"]["density"] * 0.5
                           + r["subscores"]["market_size"] * 0.5 for r in z])
        underserved = np.array([r["subscores"]["underserved"] for r in z])
        opp = demand + underserved
        cluster_summary = {}
        for c in range(k):
            m = labels == c
            cluster_summary[c] = {
                "cluster": int(c),
                "n": int(m.sum()),
                "avg_site_score": round(float(np.mean([z[i]["site_score"]
                                        for i in range(len(z)) if m[i]])), 1),
                "avg_income": int(np.mean(income[m])),
                "avg_pop_density": int(np.mean([z[i]["pop_density"]
                                     for i in range(len(z)) if m[i]])),
                "avg_competitor_density": round(float(np.mean(compd[m])), 2),
                "opportunity_index": round(float(np.mean(opp[m])), 3),
            }
        ranked = sorted(cluster_summary.values(),
                        key=lambda d: d["opportunity_index"], reverse=True)
        # human labels by opportunity rank
        names = ["Underserved High-Potential", "Emerging Growth",
                 "Balanced Mainstream", "Saturated Core", "Low-Demand Fringe"]
        for rank, cs in enumerate(ranked):
            cs["label"] = names[rank] if rank < len(names) else f"Segment {rank}"
        label_map = {cs["cluster"]: cs["label"] for cs in ranked}
        for i, r in enumerate(z):
            r["cluster"] = int(labels[i])
            r["cluster_label"] = label_map[int(labels[i])]
        self.cluster_summary = ranked

        # ---- OLS: competitive intensity ~ demographic fundamentals ----
        # fitted value = competition the fundamentals "support"; positive
        # residual (predicted - actual) => under-competed => opportunity.
        Xr = np.column_stack([income, dens, hh, age])
        yr = compd
        self._reg = LinearRegression().fit(Xr, yr)
        pred = self._reg.predict(Xr)
        self._reg_r2 = float(self._reg.score(Xr, yr))
        gap = pred - yr
        # normalise gap to 0-100 opportunity score
        gmin, gmax = gap.min(), gap.max()
        for i, r in enumerate(z):
            r["predicted_competition"] = round(float(pred[i]), 2)
            r["opportunity_gap"] = round(float(gap[i]), 2)
            r["opportunity_score"] = round(
                100 * (gap[i] - gmin) / (gmax - gmin + 1e-9), 1)
        self._reg_coef = {
            "median_income": float(self._reg.coef_[0]),
            "log_pop_density": float(self._reg.coef_[1]),
            "log_households": float(self._reg.coef_[2]),
            "median_age": float(self._reg.coef_[3]),
            "intercept": float(self._reg.intercept_),
        }

    # --------------------------------------------------------------- scoring
    def _mm(self, key, val):
        lo, hi = self._norm[key]
        return float(np.clip((val - lo) / (hi - lo + 1e-9), 0, 1))

    def _subscores(self, income, pop_density, households, age, comp_density, home):
        return {
            "income": self._mm("income", income),
            "density": self._mm("density", math.log1p(pop_density)),
            "market_size": self._mm("market_size", math.log1p(households)),
            "age_fit": _age_fit(age),
            "underserved": 1.0 - self._mm("competitor_density", comp_density),
            "affluence": self._mm("home", home),
        }

    @staticmethod
    def _composite(sub, weights):
        tot = sum(weights.values()) or 1.0
        return 100.0 * sum(weights.get(k, 0) * sub[k] for k in sub) / tot

    # ------------------------------------------------ spatial interpolation
    def _nearest(self, lat, lng, k=6):
        d = np.array([_haversine_km(lat, lng, self._lat[i], self._lng[i])
                      for i in range(len(self.zctas))])
        idx = np.argsort(d)[:k]
        return idx, d[idx]

    def _interpolate(self, lat, lng):
        idx, dist = self._nearest(lat, lng, k=6)
        w = 1.0 / (dist ** 2 + 1e-6)
        w /= w.sum()
        fields = ["med_income", "pop_density", "households", "med_age",
                  "competitor_density", "med_home_value", "population"]
        out = {}
        for f in fields:
            out[f] = float(sum(w[j] * self.zctas[idx[j]][f] for j in range(len(idx))))
        out["nearest_zcta"] = self.zctas[idx[0]]["zcta"]
        out["nearest_metro"] = self.zctas[idx[0]]["metro"]
        out["nearest_dist_km"] = round(float(dist[0]), 2)
        out["cluster_label"] = self.zctas[idx[0]]["cluster_label"]
        return out

    # --------------------------------------------- Huff gravity trade area
    def gravity_trade_area(self, lat, lng):
        """
        Huff-style capture model.  A prospective store (attractiveness 1)
        competes with every existing POI within the trade-area radius; each
        surrounding ZCTA's population is probabilistically allocated by
        distance-decayed attractiveness.  Returns captured population and the
        competitive field.
        """
        # competitors within radius
        comp_d = []
        for c in self.comps:
            if abs(c["lat"] - lat) > 0.08 or abs(c["lng"] - lng) > 0.08:
                continue
            d = _haversine_km(lat, lng, c["lat"], c["lng"])
            if d <= TRADE_AREA_RADIUS_KM:
                comp_d.append(d)
        comp_d = np.array(comp_d)

        captured = 0.0
        reachable = 0.0
        for i in range(len(self.zctas)):
            d_site = _haversine_km(lat, lng, self._lat[i], self._lng[i])
            if d_site > TRADE_AREA_RADIUS_KM:
                continue
            pop = self.zctas[i]["population"]
            reachable += pop
            a_site = math.exp(-GRAVITY_BETA * d_site)
            # competitors' pull from this ZCTA (approx via distance to site)
            a_comp = 0.0
            for dc in comp_d:
                # distance from this ZCTA to competitor bounded by triangle ineq;
                # use decay on competitor's distance-to-site as a tractable proxy
                a_comp += math.exp(-GRAVITY_BETA * max(dc, 0.2))
            share = a_site / (a_site + a_comp + 1e-9)
            captured += pop * share

        return {
            "trade_area_radius_km": TRADE_AREA_RADIUS_KM,
            "gravity_beta": GRAVITY_BETA,
            "reachable_population": int(reachable),
            "competitors_in_area": int(len(comp_d)),
            "estimated_captured_population": int(captured),
            "capture_rate": round(captured / reachable, 3) if reachable else 0.0,
        }

    # ------------------------------------------------ on-demand point score
    def score_point(self, lat, lng, weights: Optional[dict] = None):
        w = DEFAULT_WEIGHTS.copy()
        if weights:
            for k, v in weights.items():
                if k in w and v is not None:
                    w[k] = float(v)
        feat = self._interpolate(lat, lng)
        sub = self._subscores(
            feat["med_income"], feat["pop_density"], feat["households"],
            feat["med_age"], feat["competitor_density"], feat["med_home_value"],
        )
        score = self._composite(sub, w)

        # regression opportunity gap at this point
        Xr = np.array([[feat["med_income"], math.log1p(feat["pop_density"]),
                        math.log1p(feat["households"]), feat["med_age"]]])
        pred = float(self._reg.predict(Xr)[0])
        gap = pred - feat["competitor_density"]

        gravity = self.gravity_trade_area(lat, lng)

        return {
            "lat": lat,
            "lng": lng,
            "site_score": round(score, 1),
            "grade": _grade(score),
            "weights": w,
            "subscores": {k: round(v, 3) for k, v in sub.items()},
            "interpolated_features": {
                "median_income": int(feat["med_income"]),
                "pop_density": round(feat["pop_density"], 1),
                "households": int(feat["households"]),
                "median_age": round(feat["med_age"], 1),
                "competitor_density": round(feat["competitor_density"], 2),
                "median_home_value": int(feat["med_home_value"]),
                "nearest_zcta": feat["nearest_zcta"],
                "nearest_metro": feat["nearest_metro"],
                "nearest_dist_km": feat["nearest_dist_km"],
            },
            "segment": feat["cluster_label"],
            "regression": {
                "predicted_competitor_density": round(pred, 2),
                "actual_competitor_density": round(feat["competitor_density"], 2),
                "opportunity_gap": round(gap, 2),
                "interpretation": ("under-competed vs. fundamentals (opportunity)"
                                   if gap > 0 else
                                   "at/above expected competition (saturated)"),
            },
            "gravity_trade_area": gravity,
        }


def _grade(score):
    if score >= 75:
        return "A"
    if score >= 65:
        return "B"
    if score >= 55:
        return "C"
    if score >= 45:
        return "D"
    return "E"


ENGINE = Engine.load()
