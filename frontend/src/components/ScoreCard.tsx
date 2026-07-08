import type { ScoreResult } from "../api";
import { Radar } from "./Radar";
import { GRADE_COLOR } from "../lib/score";

interface ScoreCardProps {
  result: ScoreResult | null;
  loading: boolean;
}

function fmtMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export function ScoreCard({ result, loading }: ScoreCardProps) {
  if (loading) {
    return <div className="panel-card score-card"><p className="muted">Scoring location…</p></div>;
  }
  if (!result) {
    return (
      <div className="panel-card score-card">
        <p className="muted">Click anywhere on the map to score a candidate site.
          Features are spatially interpolated from the nearest surveyed ZCTAs.</p>
      </div>
    );
  }
  const f = result.interpolated_features;
  const g = result.gravity_trade_area;
  const r = result.regression;
  const opportunity = r.opportunity_gap > 0;

  return (
    <div className="panel-card score-card">
      <div className="score-head">
        <div className="score-badge" style={{ background: GRADE_COLOR[result.grade] }}>
          {result.grade}
        </div>
        <div>
          <div className="score-num">{result.site_score}<span className="score-max">/100</span></div>
          <div className="muted small">
            {result.lat.toFixed(4)}, {result.lng.toFixed(4)} &middot; segment: {result.segment}
          </div>
        </div>
      </div>

      <Radar subscores={result.subscores} color="#3987e5" />

      <div className="kv-grid">
        <div className="kv"><span>Median household income</span><b>{fmtMoney(f.median_income)}</b></div>
        <div className="kv"><span>Population density</span><b>{Math.round(f.pop_density).toLocaleString()}/sq mi</b></div>
        <div className="kv"><span>Households (nearby)</span><b>{f.households.toLocaleString()}</b></div>
        <div className="kv"><span>Median age</span><b>{f.median_age}</b></div>
        <div className="kv"><span>Competitor density</span><b>{f.competitor_density}/sq mi</b></div>
        <div className="kv"><span>Median home value</span><b>{fmtMoney(f.median_home_value)}</b></div>
        <div className="kv"><span>Nearest ZCTA</span><b>{f.nearest_zcta} ({f.nearest_dist_km} km)</b></div>
      </div>

      <div className={`callout ${opportunity ? "callout-good" : "callout-warn"}`}>
        <strong>{opportunity ? "Opportunity signal" : "Saturation signal"}</strong>
        <p>Regression predicts {r.predicted_competitor_density}/sq mi competitors given local
          demographics; actual is {r.actual_competitor_density}/sq mi
          ({r.opportunity_gap > 0 ? "+" : ""}{r.opportunity_gap} gap). {r.interpretation}.</p>
      </div>

      <div className="callout">
        <strong>Gravity trade-area estimate</strong>
        <p>Within a {g.trade_area_radius_km} km radius (Huff-style distance decay,
          &beta;={g.gravity_beta}): {g.reachable_population.toLocaleString()} reachable residents,
          {" "}{g.competitors_in_area} existing competitors. Estimated capture:{" "}
          <b>{g.estimated_captured_population.toLocaleString()} people</b> ({(g.capture_rate * 100).toFixed(1)}%
          of reachable population).</p>
      </div>
    </div>
  );
}
