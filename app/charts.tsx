"use client";

import { useMemo, useState } from "react";

/**
 * Canopy chart palette. Validated via the dataviz skill's
 * validate_palette.js against the canopy-surface dark background,
 * --pairs all: lightness band, chroma floor, CVD separation (ΔE 8.4
 * deutan), normal-vision floor, contrast — all PASS. Two slots only;
 * don't add a third without re-validating (a 3rd series folds into a
 * neutral "other" instead, per the skill's categorical cap guidance).
 */
export const CHART_PINK = "#EA4C7E";
export const CHART_LIME = "#8AA02A";
const GRID = "#2a3324";
const AXIS_TEXT = "#5c6455";

// ---------------------------------------------------------------------------
// Outcome History — line chart. Real data only: cumulative $ actually paid
// vs. cumulative $ authorized, across resolved signals in settlement order.
// No fabricated day-of-week axis — we don't have that history, so we don't
// pretend to.
// ---------------------------------------------------------------------------
export interface OutcomePoint {
  label: string; // e.g. "#3" or a short id
  authorizedUsd: number;
  paidUsd: number;
}

export function OutcomeHistoryChart({ points }: { points: OutcomePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 200;
  const padL = 36;
  const padB = 20;
  const padT = 10;
  const padR = 10;

  if (points.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-canopy-muted">
        Resolve a few more signals to chart outcome history.
      </div>
    );
  }

  // Cumulative series — this is what "conditional settlement saved you $X"
  // looks like as a trend, not a per-signal bar.
  let runA = 0;
  let runP = 0;
  const cum = points.map((p) => {
    runA += p.authorizedUsd;
    runP += p.paidUsd;
    return { authorized: runA, paid: runP };
  });
  const maxV = Math.max(...cum.map((c) => c.authorized), 0.01);

  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxV) * (H - padT - padB);

  const pathFor = (key: "authorized" | "paid") =>
    cum.map((c, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(c[key]).toFixed(1)}`).join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => maxV * f);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[200px]"
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((v, i) => (
          <line
            key={i}
            x1={padL}
            x2={W - padR}
            y1={y(v)}
            y2={y(v)}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {gridLines.map((v, i) => (
          <text key={i} x={padL - 6} y={y(v) + 3} fontSize={9} fill={AXIS_TEXT} textAnchor="end">
            ${v.toFixed(0)}
          </text>
        ))}

        {/* authorized ceiling — neutral reference line, not a competing identity */}
        <path
          d={pathFor("authorized")}
          fill="none"
          stroke={AXIS_TEXT}
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
        {/* actually paid — the one real hue this chart encodes */}
        <path d={pathFor("paid")} fill="none" stroke={CHART_LIME} strokeWidth={2} strokeLinecap="round" />
        {cum.map((c, i) => (
          <circle key={i} cx={x(i)} cy={y(c.paid)} r={hover === i ? 4 : 2.5} fill={CHART_LIME} />
        ))}

        {/* hover targets */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W / points.length) / 2}
            y={0}
            width={W / points.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke={GRID} strokeWidth={1} />
        )}
      </svg>

      {hover !== null && (
        <div
          className="absolute top-1 rounded-md border border-canopy-border bg-canopy-surface-2 px-2.5 py-1.5 text-xs pointer-events-none shadow-lg"
          style={{ left: `min(${(x(hover) / W) * 100}%, calc(100% - 130px))` }}
        >
          <div className="text-canopy-ink font-medium">{points[hover].label}</div>
          <div className="text-canopy-lime">paid ${cum[hover].paid.toFixed(2)}</div>
          <div className="text-canopy-muted">ceiling ${cum[hover].authorized.toFixed(2)}</div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-2 text-xs text-canopy-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHART_LIME }} />
          Actually paid
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: AXIS_TEXT }} />
          Authorized ceiling
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market Share — donut. Real data: $ earned per seller. Two categorical
// slots (pink, lime) — a third seller would fold into a neutral "Other"
// slice rather than adding an unvalidated third hue.
// ---------------------------------------------------------------------------
export interface ShareSlice {
  name: string;
  valueUsd: number;
  color: string;
}

export function MarketShareDonut({ slices }: { slices: ShareSlice[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.valueUsd, 0);

  const R = 70;
  const CX = 90;
  const CY = 90;
  const STROKE = 26;
  const CIRC = 2 * Math.PI * R;

  const arcs = useMemo(() => {
    let acc = 0;
    return slices.map((s) => {
      const frac = total > 0 ? s.valueUsd / total : 0;
      const start = acc;
      acc += frac;
      return { ...s, frac, start };
    });
  }, [slices, total]);

  if (total <= 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-sm text-canopy-muted text-center px-4">
        No settled earnings yet — the split fills in as signals resolve.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-5">
      <svg width={180} height={180} viewBox="0 0 180 180" className="shrink-0">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-canopy-border)" strokeWidth={STROKE} />
        {arcs.map((a, i) => {
          const gap = 2; // px surface gap between segments, per skill's spacer rule
          const len = Math.max(0, a.frac * CIRC - gap);
          const offset = -a.start * CIRC;
          return (
            <circle
              key={a.name}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={hover === i ? STROKE + 4 : STROKE}
              strokeDasharray={`${len} ${CIRC - len}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${CX} ${CY})`}
              strokeLinecap="butt"
              style={{ transition: "stroke-width 120ms ease" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize={11} fill="var(--color-canopy-muted)">
          {hover !== null ? arcs[hover].name : "Capital"}
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle" fontSize={13} fill="var(--color-canopy-ink)" fontWeight={600}>
          {hover !== null
            ? `${(arcs[hover].frac * 100).toFixed(0)}%`
            : `$${total.toFixed(2)}`}
        </text>
      </svg>

      <ul className="text-sm space-y-2">
        {arcs.map((a, i) => (
          <li
            key={a.name}
            className="flex items-center gap-2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color }} />
            <span className="text-canopy-ink">{a.name}</span>
            <span className="text-canopy-muted text-xs">
              {(a.frac * 100).toFixed(0)}% · ${a.valueUsd.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
