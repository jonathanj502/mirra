// SVG charts ported from charts.jsx → react-native-svg.
// "Bold" chart style is the design default: line strokes thicken to 2.6 and
// bar corners use rx 4.
import React from 'react';
import { View } from 'react-native';
import Svg, {
  Circle, Rect, Line, Path, Polygon, G, Text as SvgText,
} from 'react-native-svg';
import { Serif, Body } from './Typography';
import { colors, fonts } from '@/theme/tokens';

const FONT = fonts.body;
const STROKE_BOLD = 2.6; // [data-chart="bold"] .t-stroke
const BAR_RX = 4; // [data-chart="bold"] .t-bar

// ── Donut — parts of a whole ──────────────────────────────────────────────
export function Donut({
  segments, size = 140, stroke = 18, centerLabel, centerSub,
}: {
  segments: { value: number; color: string }[];
  size?: number; stroke?: number; centerLabel?: string; centerSub?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * c;
          const offset = -acc * c;
          acc += frac;
          return (
            <Circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              stroke={s.color} strokeWidth={stroke} fill="none"
              strokeDasharray={[dash, c - dash]}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              rotation={-90} originX={size / 2} originY={size / 2}
            />
          );
        })}
      </Svg>
      {(centerLabel || centerSub) && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          {centerLabel ? <Serif style={{ fontSize: size * 0.28, lineHeight: size * 0.3, color: colors.ink }}>{centerLabel}</Serif> : null}
          {centerSub ? <Body style={{ fontSize: 10, color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 }}>{centerSub}</Body> : null}
        </View>
      )}
    </View>
  );
}

// ── Ring meter (donut with single value) ──────────────────────────────────
export function RingMeter({
  value = 70, size = 64, stroke = 6, color = colors.sage, label,
}: {
  value?: number; size?: number; stroke?: number; color?: string; label?: string | number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.hair} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={[c, c]} strokeDashoffset={off}
          strokeLinecap="round"
          rotation={-90} originX={size / 2} originY={size / 2}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Serif style={{ fontSize: size * 0.36, color: colors.ink }}>{label ?? value}</Serif>
      </View>
    </View>
  );
}

// ── Radar — N-axis polygon ─────────────────────────────────────────────────
export interface RadarSeries {
  values: number[];
  color: string;
  fill?: number;
  strokeWidth?: number;
  dashed?: boolean;
}
export function RadarChart({
  axes, series, size = 220, rings = 3,
}: {
  axes: { label: string }[]; series: RadarSeries[]; size?: number; rings?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.36;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const toXY = (i: number, v: number): [number, number] => [
    cx + Math.cos(angle(i)) * radius * v,
    cy + Math.sin(angle(i)) * radius * v,
  ];
  return (
    <Svg width={size} height={size}>
      {Array.from({ length: rings }, (_, ri) => {
        const f = (ri + 1) / rings;
        const pts = axes.map((_, i) => toXY(i, f).join(',')).join(' ');
        return <Polygon key={`r${ri}`} points={pts} fill="none" stroke={colors.hair} strokeWidth={1} />;
      })}
      {axes.map((_, i) => {
        const [x, y] = toXY(i, 1);
        return <Line key={`s${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke={colors.hair} strokeWidth={1} />;
      })}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => toXY(i, v).join(',')).join(' ');
        return (
          <G key={`g${si}`}>
            <Polygon
              points={pts} fill={s.color} fillOpacity={s.fill ?? 0.18}
              stroke={s.color} strokeWidth={STROKE_BOLD}
              strokeDasharray={s.dashed ? [4, 3] : undefined}
            />
            {s.values.map((v, i) => {
              const [x, y] = toXY(i, v);
              return (
                <Circle
                  key={i} cx={x} cy={y} r={s.dashed ? 3 : 3.4}
                  fill={s.dashed ? colors.card : s.color}
                  stroke={s.color} strokeWidth={s.dashed ? 1.6 : 0}
                />
              );
            })}
          </G>
        );
      })}
      {axes.map((a, i) => {
        const [x, y] = toXY(i, 1.18);
        const cosv = Math.cos(angle(i));
        const anchor = Math.abs(cosv) < 0.2 ? 'middle' : cosv > 0 ? 'start' : 'end';
        return (
          <SvgText
            key={`l${i}`} x={x} y={y + 3} textAnchor={anchor}
            fontFamily={FONT} fontSize={10} fill={colors.inkSoft}
          >
            {a.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ── Weekly bars — minutes per day with a clean minute Y axis ──────────────
export function WeeklyBars({
  data, labels, width = 280, height = 110, color = colors.terracotta, target, todayIdx,
}: {
  data: number[]; labels: string[]; width?: number; height?: number;
  color?: string; target?: number; todayIdx?: number | null;
}) {
  const rawMax = Math.max(...data, target || 0);
  const nice = (n: number) => {
    if (n <= 10) return 10;
    if (n <= 20) return 20;
    if (n <= 30) return 30;
    if (n <= 45) return 45;
    if (n <= 60) return 60;
    return Math.ceil(n / 30) * 30;
  };
  const max = nice(rawMax);
  const gap = 8, padL = 28, padB = 18, padT = 4;
  const innerW = width - padL;
  const innerH = height - padB - padT;
  const bw = (innerW - gap * (data.length - 1)) / data.length;
  const yAt = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  return (
    <Svg width={width} height={height}>
      {ticks.map((v, i) => (
        <G key={`t${i}`}>
          <Line
            x1={padL} y1={yAt(v)} x2={width} y2={yAt(v)}
            stroke={colors.hair} strokeDasharray={v === 0 ? undefined : [1, 4]}
            opacity={v === 0 ? 1 : 0.55}
          />
          <SvgText x={padL - 6} y={yAt(v) + 3} textAnchor="end" fontFamily={FONT} fontSize={9} fill={colors.inkSoft}>
            {v === 0 ? '0' : `${Math.round(v)}m`}
          </SvgText>
        </G>
      ))}
      {data.map((v, i) => {
        const h = (v / max) * innerH;
        const x = padL + i * (bw + gap);
        const y = padT + innerH - h;
        const isToday = todayIdx === i;
        const isEmpty = v === 0;
        return (
          <G key={`b${i}`}>
            {isEmpty ? (
              <Circle cx={x + bw / 2} cy={yAt(0) - 4} r={1.6} fill={colors.inkSoft} opacity={0.4} />
            ) : (
              <Rect x={x} y={y} width={bw} height={h} rx={Math.min(bw / 2.4, 6)} fill={color} opacity={isToday ? 1 : 0.85} />
            )}
            <SvgText
              x={x + bw / 2} y={height - 4} textAnchor="middle" fontFamily={FONT}
              fontSize={isToday ? 10 : 9} fill={isToday ? colors.ink : colors.inkSoft}
            >
              {labels[i]}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ── Paired vertical bars — two series per bucket ───────────────────────────
export function PairedBarChart({
  asked, received, labels, width = 300, height = 130, askedColor, receivedColor, yAxis = true,
}: {
  asked: number[]; received: number[]; labels: string[];
  width?: number; height?: number; askedColor?: string; receivedColor?: string; yAxis?: boolean;
}) {
  const aColor = askedColor || colors.sage;
  const rColor = receivedColor || colors.lavender;
  const maxRaw = Math.max(...asked, ...received, 1);
  const max = maxRaw * 1.18;
  const padL = yAxis ? 18 : 4, padR = 4, padB = 18;
  const innerW = width - padL - padR;
  const innerH = height - padB;
  const groups = labels.length;
  const groupGap = 6, inGroupGap = 2;
  const groupW = (innerW - groupGap * (groups - 1)) / groups;
  const bw = (groupW - inGroupGap) / 2;
  return (
    <Svg width={width} height={height}>
      <Line x1={padL} y1={innerH} x2={width - padR} y2={innerH} stroke={colors.hair} />
      {yAxis && [0, max / 2, max].map((v, i) => (
        <G key={`y${i}`}>
          <Line
            x1={padL} y1={innerH - (v / max) * innerH} x2={width - padR} y2={innerH - (v / max) * innerH}
            stroke={colors.hair} strokeDasharray={i === 0 ? undefined : [1, 4]} opacity={i === 0 ? 1 : 0.6}
          />
          <SvgText x={padL - 4} y={innerH - (v / max) * innerH + 3} textAnchor="end" fontFamily={FONT} fontSize={9} fill={colors.inkSoft}>
            {Math.round(v)}
          </SvgText>
        </G>
      ))}
      {labels.map((lbl, i) => {
        const gx = padL + i * (groupW + groupGap);
        const aH = (asked[i] / max) * innerH;
        const rH = (received[i] / max) * innerH;
        return (
          <G key={`g${i}`}>
            <Rect x={gx} y={innerH - aH} width={bw} height={aH} rx={Math.min(3, bw / 2)} fill={aColor} opacity={0.95} />
            <Rect x={gx + bw + inGroupGap} y={innerH - rH} width={bw} height={rH} rx={Math.min(3, bw / 2)} fill={rColor} opacity={0.95} />
            <SvgText x={gx + groupW / 2} y={height - 4} textAnchor="middle" fontFamily={FONT} fontSize={9} fill={colors.inkSoft}>
              {lbl}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ── Turn-floor offset — line chart with zone bands ─────────────────────────
export interface OffsetPt { t: string; ms: number | null }
export function TurnOffsetChart({
  data, width = 300, height = 170, yMin = -300, yMax = 800, lineColor,
}: {
  data: OffsetPt[]; width?: number; height?: number; yMin?: number; yMax?: number; lineColor?: string;
}) {
  const padL = 36, padR = 10, padT = 8, padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xToPx = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yToPx = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const zones = [
    { from: yMin, to: 0, color: colors.lavender, opacity: 0.10 },
    { from: 0, to: 400, color: colors.sage, opacity: 0.16 },
    { from: 400, to: yMax, color: colors.sand, opacity: 0.28 },
  ];

  const points = data.map((d, i) => [xToPx(i), d.ms == null ? null : yToPx(d.ms)] as [number, number | null]);
  const present = points.filter((p) => p[1] != null) as [number, number][];
  const pathD = present.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const stroke = lineColor || colors.terracotta;
  const allShort = data.every((x) => String(x.t).length <= 2);

  return (
    <Svg width={width} height={height}>
      {zones.map((z, i) => {
        const top = yToPx(z.to);
        const bot = yToPx(z.from);
        const h = bot - top;
        if (h <= 0) return null;
        return <Rect key={`z${i}`} x={padL} y={top} width={plotW} height={h} fill={z.color} opacity={z.opacity} />;
      })}
      <Line x1={padL} x2={padL + plotW} y1={yToPx(0)} y2={yToPx(0)} stroke="rgba(42,37,32,0.32)" strokeWidth={1} />
      <Line x1={padL} x2={padL + plotW} y1={yToPx(200)} y2={yToPx(200)} stroke={colors.sage} strokeWidth={1.2} strokeDasharray={[4, 3]} opacity={0.85} />
      <SvgText x={padL + plotW - 2} y={yToPx(200) - 3} textAnchor="end" fontFamily={FONT} fontSize={9} fill={colors.sage}>target +200</SvgText>
      {[-200, 0, 200, 500].map((v) => (
        <SvgText key={`yt${v}`} x={padL - 4} y={yToPx(v) + 3} fontFamily={FONT} fontSize={9} fill={colors.muted} textAnchor="end">
          {v > 0 ? `+${v}` : v}
        </SvgText>
      ))}
      <SvgText x={4} y={padT + 5} fontFamily={FONT} fontSize={8} fill={colors.muted}>ms</SvgText>
      {data.map((d, i) => {
        const skip = !allShort && data.length > 6 && i % 2 !== 0 && i !== data.length - 1 && i !== 0;
        if (skip) return null;
        const anchor = allShort ? 'middle' : i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle';
        return (
          <SvgText
            key={`x${i}`} x={xToPx(i)} y={height - 4} textAnchor={anchor} fontFamily={FONT} fontSize={9}
            fill={colors.muted}
          >
            {d.t}
          </SvgText>
        );
      })}
      <Path d={pathD} fill="none" stroke={stroke} strokeWidth={STROKE_BOLD} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) =>
        p[1] == null ? null : (
          <Circle key={`d${i}`} cx={p[0]} cy={p[1] as number} r={2.8} fill={colors.card} stroke={stroke} strokeWidth={1.6} />
        )
      )}
    </Svg>
  );
}

// ── Energy wave — two smoothed lines ───────────────────────────────────────
function smoothPath(points: [number, number][]) {
  if (points.length < 2) return '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const cx = (x1 + x2) / 2;
    d += ` Q${cx},${y1} ${cx},${(y1 + y2) / 2} T${x2},${y2}`;
  }
  return d;
}
export function EnergyWave({
  you, them, width = 280, height = 70,
}: {
  you: number[]; them: number[]; width?: number; height?: number;
}) {
  const stepX = width / (you.length - 1);
  const all = [...you, ...them];
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const range = yMax - yMin || 1;
  const toPts = (arr: number[]): [number, number][] =>
    arr.map((v, i) => [i * stepX, height - 6 - ((v - yMin) / range) * (height - 12)]);
  return (
    <Svg width={width} height={height}>
      <Path d={smoothPath(toPts(them))} stroke={colors.lavender} strokeWidth={STROKE_BOLD} fill="none" strokeLinecap="round" />
      <Path d={smoothPath(toPts(you))} stroke={colors.terracotta} strokeWidth={STROKE_BOLD} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

// ── LSM histogram — conversations per 0.1 score bin ────────────────────────
export function LSMHistogram({
  convs, width = 300, height = 150,
}: {
  convs: { score: number }[]; width?: number; height?: number;
}) {
  const bins = Array(10).fill(0);
  convs.forEach((c) => {
    const idx = Math.min(9, Math.max(0, Math.floor(c.score * 10)));
    bins[idx]++;
  });
  const maxCount = Math.max(...bins, 1);
  const yMax = Math.max(maxCount, 2);
  const padL = 24, padR = 8, padT = 10, padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const bw = plotW / bins.length;
  const yToPx = (v: number) => padT + plotH - (v / yMax) * plotH;
  return (
    <Svg width={width} height={height}>
      {Array.from({ length: yMax + 1 }, (_, i) => i).map((v) => (
        <G key={`y${v}`}>
          <Line x1={padL} y1={yToPx(v)} x2={padL + plotW} y2={yToPx(v)} stroke={colors.hair} strokeDasharray={v === 0 ? undefined : [1, 4]} opacity={v === 0 ? 1 : 0.5} />
          <SvgText x={padL - 4} y={yToPx(v) + 3} textAnchor="end" fontFamily={FONT} fontSize={9} fill={colors.muted}>{v}</SvgText>
        </G>
      ))}
      {bins.map((count, i) => {
        if (count === 0) return null;
        const x = padL + i * bw + 2;
        const y = yToPx(count);
        const h = padT + plotH - y;
        return (
          <G key={`b${i}`}>
            <Rect x={x} y={y} width={bw - 4} height={h} fill={colors.lavender} opacity={0.92} rx={Math.min(3, (bw - 4) / 2)} />
            <SvgText x={x + (bw - 4) / 2} y={y - 4} textAnchor="middle" fontFamily={FONT} fontSize={9.5} fill={colors.lavender}>{count}</SvgText>
          </G>
        );
      })}
      {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
        <SvgText key={`x${v}`} x={padL + v * plotW} y={height - 4} textAnchor="middle" fontFamily={FONT} fontSize={9} fill={colors.muted}>
          {v.toFixed(1)}
        </SvgText>
      ))}
      <SvgText
        x={padL - 18} y={padT + plotH / 2} textAnchor="middle" fontFamily={FONT} fontSize={8} fill={colors.muted}
        rotation={-90} originX={padL - 18} originY={padT + plotH / 2}
      >
        convos
      </SvgText>
    </Svg>
  );
}
