import type { Metro, SubScores } from "../api";
import type { OverlayMetric } from "./MapView";
import { CLUSTER_COLOR, POI_COLOR, SUBSCORE_LABEL } from "../lib/score";

interface ControlPanelProps {
  metros: Metro[];
  metroId: string;
  onMetroChange: (id: string) => void;
  overlayMetric: OverlayMetric;
  onOverlayMetricChange: (m: OverlayMetric) => void;
  showOverlay: boolean;
  onToggleOverlay: () => void;
  showCompetitors: boolean;
  onToggleCompetitors: () => void;
  weights: SubScores;
  onWeightChange: (key: keyof SubScores, value: number) => void;
  onResetWeights: () => void;
}

const METRIC_OPTIONS: { id: OverlayMetric; label: string }[] = [
  { id: "weighted_score", label: "Site score (current weights)" },
  { id: "med_income", label: "Median household income" },
  { id: "pop_density", label: "Population density" },
  { id: "competitor_density", label: "Competitor density" },
  { id: "opportunity_score", label: "Opportunity score (regression)" },
];

export function ControlPanel(props: ControlPanelProps) {
  const {
    metros, metroId, onMetroChange, overlayMetric, onOverlayMetricChange,
    showOverlay, onToggleOverlay, showCompetitors, onToggleCompetitors,
    weights, onWeightChange, onResetWeights,
  } = props;

  return (
    <>
      <div className="panel-card">
        <div className="panel-card-title">Metro Market</div>
        <select className="select" value={metroId} onChange={(e) => onMetroChange(e.target.value)}>
          {metros.map((m) => (
            <option key={m.id} value={m.id}>{m.label} &middot; {m.zctas} ZCTAs</option>
          ))}
        </select>
      </div>

      <div className="panel-card">
        <div className="panel-card-title">Map Layers</div>
        <label className="toggle-row">
          <input type="checkbox" checked={showOverlay} onChange={onToggleOverlay} />
          Demographic overlay (ZCTA-centroid surface)
        </label>
        {showOverlay && (
          <select className="select" value={overlayMetric}
            onChange={(e) => onOverlayMetricChange(e.target.value as OverlayMetric)}>
            {METRIC_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        <label className="toggle-row">
          <input type="checkbox" checked={showCompetitors} onChange={onToggleCompetitors} />
          Competitor POIs (clustered)
        </label>
        {showCompetitors && (
          <div className="legend-row">
            {Object.entries(POI_COLOR).map(([k, c]) => (
              <span key={k} className="legend-chip">
                <i style={{ background: c }} />{k.replace("_", " ")}
              </span>
            ))}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 6 }}>
          Overlay is a graduated surface interpolated from ZCTA <em>centroids</em>, not true
          polygon boundaries — treat it as directional, not parcel-precise.
        </p>
      </div>

      <div className="panel-card">
        <div className="panel-card-title">Site-Score Weights</div>
        <p className="muted small" style={{ marginTop: -6 }}>
          Re-weighting instantly re-scores every visible site and the map overlay.
        </p>
        {(Object.keys(weights) as (keyof SubScores)[]).map((k) => (
          <div className="slider-row" key={k}>
            <div className="slider-label">
              <span>{SUBSCORE_LABEL[k]}</span>
              <b>{weights[k].toFixed(2)}</b>
            </div>
            <input type="range" min={0} max={0.4} step={0.01} value={weights[k]}
              onChange={(e) => onWeightChange(k, parseFloat(e.target.value))} />
          </div>
        ))}
        <button className="btn-ghost" onClick={onResetWeights}>Reset to defaults</button>
      </div>

      <div className="panel-card">
        <div className="panel-card-title">Submarket Segments</div>
        <div className="legend-row column">
          {Object.entries(CLUSTER_COLOR).map(([label, c]) => (
            <span key={label} className="legend-chip"><i style={{ background: c }} />{label}</span>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          K-means (k=5) over income, density, market size, age and log competitor density.
        </p>
      </div>
    </>
  );
}
