import type { SubScores, TopSite } from "../api";
import { composite, GRADE_COLOR, grade } from "../lib/score";

interface TopSitesListProps {
  sites: TopSite[];
  weights: SubScores;
  onSelect: (site: TopSite) => void;
  selectedZcta?: string;
}

export function TopSitesList({ sites, weights, onSelect, selectedZcta }: TopSitesListProps) {
  const ranked = [...sites]
    .map((s) => ({ ...s, liveScore: composite(s.subscores, weights) }))
    .sort((a, b) => b.liveScore - a.liveScore);

  return (
    <div className="panel-card">
      <div className="panel-card-title">Top Candidate Sites</div>
      <p className="muted small" style={{ marginTop: -6 }}>
        Ranked live from current weights &middot; click a site to inspect it on the map
      </p>
      <ol className="site-list">
        {ranked.map((s, i) => {
          const g = grade(s.liveScore);
          return (
            <li key={s.zcta} className={s.zcta === selectedZcta ? "site-row active" : "site-row"}
              onClick={() => onSelect(s)}>
              <span className="site-rank">{i + 1}</span>
              <div className="site-info">
                <div className="site-zcta">ZCTA {s.zcta} <span className="muted">&middot; {s.metro}</span></div>
                <div className="muted small">{s.cluster_label} &middot; pop {s.population.toLocaleString()}</div>
              </div>
              <span className="site-grade" style={{ background: GRADE_COLOR[g] }}>{g}</span>
              <span className="site-score">{s.liveScore}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
