// API client for the Storefront Score backend.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface Metro {
  id: string;
  label: string;
  center: [number, number]; // [lat, lng]
  bbox: [number, number, number, number];
  zctas: number;
  competitors: number;
}

export interface SubScores {
  income: number;
  density: number;
  market_size: number;
  age_fit: number;
  underserved: number;
  affluence: number;
}

export interface Zcta {
  zcta: string;
  metro: string;
  lat: number;
  lng: number;
  population: number;
  med_income: number;
  med_age: number;
  households: number;
  med_home_value: number;
  pop_density: number;
  competitors: number;
  competitor_density: number;
  site_score: number;
  subscores: SubScores;
  opportunity_score: number;
  cluster: number;
  cluster_label: string;
}

export interface Competitor {
  metro: string;
  lat: number;
  lng: number;
  type: string;
  name: string;
}

export interface TopSite {
  rank: number;
  zcta: string;
  metro: string;
  lat: number;
  lng: number;
  site_score: number;
  subscores: SubScores;
  cluster_label: string;
  opportunity_score: number;
  med_income: number;
  population: number;
  competitors: number;
}

export interface ScoreResult {
  lat: number;
  lng: number;
  site_score: number;
  grade: string;
  weights: SubScores;
  subscores: SubScores;
  interpolated_features: {
    median_income: number;
    pop_density: number;
    households: number;
    median_age: number;
    competitor_density: number;
    median_home_value: number;
    nearest_zcta: string;
    nearest_metro: string;
    nearest_dist_km: number;
  };
  segment: string;
  regression: {
    predicted_competitor_density: number;
    actual_competitor_density: number;
    opportunity_gap: number;
    interpretation: string;
  };
  gravity_trade_area: {
    trade_area_radius_km: number;
    gravity_beta: number;
    reachable_population: number;
    competitors_in_area: number;
    estimated_captured_population: number;
    capture_rate: number;
  };
}

export interface ClusterSummary {
  cluster: number;
  label: string;
  n: number;
  avg_site_score: number;
  avg_income: number;
  avg_pop_density: number;
  avg_competitor_density: number;
  opportunity_index: number;
}

export interface Meta {
  release: string;
  demographics_source: string;
  competitor_source: string;
  geography: string;
  coverage: Array<{
    metro: string;
    label: string;
    zctas: number;
    competitors_total: number;
  }>;
  total_zctas: number;
  default_weights: SubScores;
  regression: {
    r2: number;
    features: string[];
    coefficients: Record<string, number>;
  };
  clusters: ClusterSummary[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  metros: () => get<Metro[]>("/api/metros"),
  zctas: (metro: string) => get<Zcta[]>(`/api/zctas?metro=${metro}`),
  competitors: (metro: string) => get<Competitor[]>(`/api/competitors?metro=${metro}`),
  topSites: (metro: string, n = 10) => get<TopSite[]>(`/api/top-sites?metro=${metro}&n=${n}`),
  score: async (lat: number, lng: number, weights?: Partial<SubScores>): Promise<ScoreResult> => {
    const r = await fetch(`${BASE}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat, lng, weights }),
    });
    if (!r.ok) throw new Error(`score -> ${r.status}`);
    return r.json();
  },
};
