/** Hand-rolled SVG charts — no chart deps. */
import type { SimulationResult } from '../lib/equity';

const W = 640;
const H = 300;
const PAD = { l: 56, r: 16, t: 16, b: 34 };

function path(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export function CurveChart({
  sim,
  quoteUsd,
  anchorUsd,
}: {
  sim: SimulationResult;
  quoteUsd: number;
  anchorUsd: number;
}) {
  const prices = sim.points.map((p) => p.priceQuote * quoteUsd);
  const xs = sim.points.map((p) => p.supplySoldPct);
  const minY = Math.min(...prices) * 0.995;
  const maxY = Math.max(...prices) * 1.005;
  const X = (v: number) => PAD.l + (v / 100) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (v - minY) / (maxY - minY)) * (H - PAD.t - PAD.b);
  const line = path(sim.points.map((_, i) => [X(xs[i]), Y(prices[i])]));
  const area = `${line} L${X(100).toFixed(1)},${Y(minY).toFixed(1)} L${X(0).toFixed(1)},${Y(minY).toFixed(1)} Z`;
  const ticks = [0, 25, 50, 75, 100];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X(t)} y1={PAD.t} x2={X(t)} y2={H - PAD.b} stroke="#1e2a3d" strokeWidth="1" />
          <text x={X(t)} y={H - 10} fill="#5a6a82" fontSize="11" textAnchor="middle">{t}% sold</text>
        </g>
      ))}
      {/* anchor line */}
      <line x1={PAD.l} y1={Y(anchorUsd)} x2={W - PAD.r} y2={Y(anchorUsd)} stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x={W - PAD.r} y={Y(anchorUsd) - 6} fill="#fbbf24" fontSize="11" textAnchor="end" fontWeight="700">
        fair value ${anchorUsd.toFixed(2)}
      </text>
      <path d={area} fill="url(#cg)" />
      <path d={line} fill="none" stroke="#34d399" strokeWidth="2.5" />
      <text x={12} y={20} fill="#8b98ad" fontSize="11">price ($)</text>
    </svg>
  );
}

export function FeeChart({ sim }: { sim: SimulationResult }) {
  const fees = sim.feeSchedule.map((f) => f.feeBps);
  const maxF = Math.max(...fees) * 1.05;
  const X = (i: number) => PAD.l + (i / (fees.length - 1)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - v / maxF) * (H - PAD.t - PAD.b);
  const line = path(fees.map((f, i) => [X(i), Y(f)]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={PAD.l} y1={Y(maxF * t)} x2={W - PAD.r} y2={Y(maxF * t)} stroke="#1e2a3d" strokeWidth="1" />
          <text x={PAD.l - 8} y={Y(maxF * t) + 4} fill="#5a6a82" fontSize="11" textAnchor="end">
            {Math.round(maxF * t)}bps
          </text>
        </g>
      ))}
      <path d={line} fill="none" stroke="#0ea5e9" strokeWidth="2.5" />
      <text x={W - PAD.r} y={H - 10} fill="#5a6a82" fontSize="11" textAnchor="end">fee schedule period →</text>
      <text x={12} y={20} fill="#8b98ad" fontSize="11">base fee</text>
    </svg>
  );
}
