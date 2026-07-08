import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Competitor, Meta, Metro, ScoreResult, SubScores, TopSite, Zcta } from "./api";
import { MapView, type OverlayMetric } from "./components/MapView";
import { ControlPanel } from "./components/ControlPanel";
import { ScoreCard } from "./components/ScoreCard";
import { TopSitesList } from "./components/TopSitesList";

const DEFAULT_WEIGHTS: SubScores = {
  income: 0.22, density: 0.18, market_size: 0.15,
  age_fit: 0.10, underserved: 0.22, affluence: 0.13,
};

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metros, setMetros] = useState<Metro[]>([]);
  const [metroId, setMetroId] = useState<string>("austin");
  const [zctas, setZctas] = useState<Zcta[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [topSites, setTopSites] = useState<TopSite[]>([]);

  const [overlayMetric, setOverlayMetric] = useState<OverlayMetric>("weighted_score");
  const [showOverlay, setShowOverlay] = useState(true);
  const [showCompetitors, setShowCompetitors] = useState(true);
  const [weights, setWeights] = useState<SubScores>(DEFAULT_WEIGHTS);

  const [selectedResult, setSelectedResult] = useState<ScoreResult | null>(null);
  const [selectedZcta, setSelectedZcta] = useState<string | undefined>(undefined);
  const [scoring, setScoring] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setError(String(e)));
    api.metros().then((ms) => {
      setMetros(ms);
      if (ms.length && !ms.find((m) => m.id === metroId)) setMetroId(ms[0].id);
    }).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!metroId) return;
    api.zctas(metroId).then(setZctas).catch((e) => setError(String(e)));
    api.competitors(metroId).then(setCompetitors).catch((e) => setError(String(e)));
    api.topSites(metroId, 12).then(setTopSites).catch((e) => setError(String(e)));
    setSelectedResult(null);
    setSelectedZcta(undefined);
  }, [metroId]);

  const currentMetro = useMemo(() => metros.find((m) => m.id === metroId) ?? null, [metros, metroId]);

  async function handleMapClick(lat: number, lng: number) {
    setScoring(true);
    setSelectedZcta(undefined);
    try {
      const result = await api.score(lat, lng, weights);
      setSelectedResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setScoring(false);
    }
  }

  function handleSelectTopSite(site: TopSite) {
    setSelectedZcta(site.zcta);
    handleMapClick(site.lat, site.lng);
  }

  function handleWeightChange(key: keyof SubScores, value: number) {
    setWeights((w) => ({ ...w, [key]: value }));
  }

  // re-score the pinned point whenever weights change (client formula is
  // authoritative for dataset ZCTAs; the arbitrary point is re-fetched since
  // its interpolated features live server-side)
  useEffect(() => {
    if (!selectedResult) return;
    api.score(selectedResult.lat, selectedResult.lng, weights).then(setSelectedResult).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">SS</span>
          <div>
            <div className="brand-title">Storefront Score</div>
            <div className="brand-sub">Commercial Site Selection &amp; Market Expansion Analytics</div>
          </div>
        </div>
        <div className="header-right">
          {meta && (
            <span className="muted small">
              {meta.total_zctas} ZCTAs &middot; {meta.coverage.length} metros &middot; {meta.release}
            </span>
          )}
          <button className="btn-ghost panel-toggle" onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? "Hide panel" : "Show panel"}
          </button>
        </div>
      </header>

      <aside className={panelOpen ? "sidebar" : "sidebar sidebar-collapsed"}>
        {error && <div className="callout callout-warn">{error}</div>}
        <ControlPanel
          metros={metros}
          metroId={metroId}
          onMetroChange={setMetroId}
          overlayMetric={overlayMetric}
          onOverlayMetricChange={setOverlayMetric}
          showOverlay={showOverlay}
          onToggleOverlay={() => setShowOverlay((v) => !v)}
          showCompetitors={showCompetitors}
          onToggleCompetitors={() => setShowCompetitors((v) => !v)}
          weights={weights}
          onWeightChange={handleWeightChange}
          onResetWeights={() => setWeights(DEFAULT_WEIGHTS)}
        />
        <ScoreCard result={selectedResult} loading={scoring} />
        <TopSitesList sites={topSites} weights={weights} onSelect={handleSelectTopSite}
          selectedZcta={selectedZcta} />
      </aside>

      <main className="map-pane">
        <MapView
          metro={currentMetro}
          zctas={zctas}
          competitors={competitors}
          weights={weights}
          overlayMetric={overlayMetric}
          showOverlay={showOverlay}
          showCompetitors={showCompetitors}
          topSites={topSites}
          selectedResult={selectedResult}
          onMapClick={handleMapClick}
        />
      </main>
    </div>
  );
}
