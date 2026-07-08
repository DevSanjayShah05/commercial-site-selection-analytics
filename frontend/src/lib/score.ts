import type { SubScores } from "../api";

/**
 * Client-side mirror of the backend's weighted composite formula
 * (app/model.py::Engine._composite). Every ZCTA and top-site record already
 * carries its six 0-1 sub-scores from the server, so re-weighting and
 * re-ranking can happen instantly in the browser as a user drags a weight
 * slider — no round-trip needed except for the arbitrary click-to-score
 * point, which is spatially interpolated server-side.
 */
export function composite(sub: SubScores, weights: SubScores): number {
  const keys = Object.keys(weights) as (keyof SubScores)[];
  const totalW = keys.reduce((s, k) => s + weights[k], 0) || 1;
  const num = keys.reduce((s, k) => s + weights[k] * sub[k], 0);
  return Math.round((100 * num / totalW) * 10) / 10;
}

export function grade(score: number): string {
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 55) return "C";
  if (score >= 45) return "D";
  return "E";
}

export const GRADE_COLOR: Record<string, string> = {
  A: "#0ca30c",
  B: "#8fae12",
  C: "#fab219",
  D: "#ec835a",
  E: "#d03b3b",
};

export const SUBSCORE_LABEL: Record<keyof SubScores, string> = {
  income: "Income",
  density: "Pop. Density",
  market_size: "Market Size",
  age_fit: "Dining-Age Fit",
  underserved: "Underserved",
  affluence: "Affluence",
};

export const CLUSTER_COLOR: Record<string, string> = {
  "Underserved High-Potential": "#9085e9", // violet
  "Emerging Growth": "#199e70", // aqua
  "Balanced Mainstream": "#3987e5", // blue
  "Saturated Core": "#e66767", // red
  "Low-Demand Fringe": "#898781", // muted
};

export const POI_COLOR: Record<string, string> = {
  restaurant: "#2a78d6",
  fast_food: "#eda100",
  cafe: "#1baf7a",
};
