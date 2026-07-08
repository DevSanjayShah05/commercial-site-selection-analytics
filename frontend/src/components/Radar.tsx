import type { SubScores } from "../api";
import { SUBSCORE_LABEL } from "../lib/score";

interface RadarProps {
  subscores: SubScores;
  size?: number;
  color?: string;
}

const ORDER: (keyof SubScores)[] = [
  "income", "density", "market_size", "age_fit", "underserved", "affluence",
];

/** Hand-rolled SVG radar (spider) chart — no charting dependency. */
export function Radar({ subscores, size = 220, color = "#3987e5" }: RadarProps) {
  const n = ORDER.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, frac: number) => {
    const a = angle(i);
    return [cx + r * frac * Math.cos(a), cy + r * frac * Math.sin(a)];
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPts = ORDER.map((k, i) => pt(i, Math.max(0.03, subscores[k])));
  const dataPath = dataPts.map((p) => p.join(",")).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label="Site score breakdown radar chart">
      {rings.map((frac) => {
        const ringPts = ORDER.map((_, i) => pt(i, frac).join(",")).join(" ");
        return (
          <polygon key={frac} points={ringPts} fill="none"
            stroke="var(--gridline)" strokeWidth={1} />
        );
      })}
      {ORDER.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y}
          stroke="var(--gridline)" strokeWidth={1} />;
      })}
      <polygon points={dataPath} fill={color} fillOpacity={0.22}
        stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill={color} />
      ))}
      {ORDER.map((k, i) => {
        const [lx, ly] = pt(i, 1.28);
        const a = angle(i);
        const anchor = Math.cos(a) > 0.2 ? "start" : Math.cos(a) < -0.2 ? "end" : "middle";
        return (
          <text key={k} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
            fontSize={10.5} fill="var(--text-secondary)">
            {SUBSCORE_LABEL[k]}
          </text>
        );
      })}
    </svg>
  );
}
