// Progressive-disclosure metric card with a chart-type glyph and a collapsible
// body. Ported from screen-analytics.jsx ExpandableMetric + ChartGlyph.
import React, { useState } from 'react';
import {
  View, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import Svg, { Circle, Rect, Path, Line, Polygon } from 'react-native-svg';
import { Card } from './ui';
import { Body, Serif, SerifItalic, Eyebrow } from './Typography';
import { Icon } from './Icon';
import { colors, fonts } from '@/theme/tokens';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type ChartKind = 'donut' | 'bar' | 'line' | 'dots' | 'radar';

export interface Delta {
  arrow: string;
  text: string;
  positive?: boolean;
  neutral?: boolean;
}

function ChartGlyph({ kind, color, size = 30 }: { kind?: ChartKind; color: string; size?: number }) {
  const inner = () => {
    switch (kind) {
      case 'donut':
        return (
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Circle cx={8} cy={8} r={6} fill="none" stroke={color} strokeWidth={3} opacity={0.3} />
            <Path d="M8 2 A6 6 0 0 1 13.2 11" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
          </Svg>
        );
      case 'bar':
        return (
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Rect x={2} y={9} width={2.5} height={5} rx={1} fill={color} opacity={0.45} />
            <Rect x={6.75} y={6} width={2.5} height={8} rx={1} fill={color} opacity={0.7} />
            <Rect x={11.5} y={3} width={2.5} height={11} rx={1} fill={color} />
          </Svg>
        );
      case 'line':
        return (
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M2 11 L5.5 8 L9 9.5 L13 4" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={13} cy={4} r={1.6} fill={color} />
          </Svg>
        );
      case 'dots':
        return (
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Line x1={1.5} y1={8} x2={14.5} y2={8} stroke={color} strokeWidth={1} opacity={0.3} />
            <Circle cx={3.5} cy={8} r={1.8} fill={color} />
            <Circle cx={7.5} cy={8} r={1.8} fill={color} />
            <Circle cx={12} cy={8} r={1.8} fill={color} />
          </Svg>
        );
      case 'radar':
        return (
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Polygon points="8,2 13,6 11,12 5,12 3,6" fill="none" stroke={color} strokeWidth={1.4} opacity={0.4} />
            <Polygon points="8,5 11,7 10,11 6,11 5,7" fill={color} opacity={0.55} />
          </Svg>
        );
      default:
        return null;
    }
  };
  return (
    <View style={[styles.glyph, { width: size, height: size, backgroundColor: color + '1A' }]}>
      {inner()}
    </View>
  );
}

interface ExpandableMetricProps {
  eyebrow: string;
  value: string | number;
  unit?: string;
  summary?: string;
  accent: string;
  chartKind?: ChartKind;
  defaultOpen?: boolean;
  blurb?: string;
  delta?: Delta | null;
  children?: React.ReactNode;
}

export function ExpandableMetric({
  eyebrow, value, unit, summary, accent, chartKind, defaultOpen = false, blurb, delta, children,
}: ExpandableMetricProps) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    setOpen((o) => !o);
  };
  const deltaColor = delta?.positive ? colors.sage : delta?.neutral ? colors.muted : colors.coral;

  return (
    <Card style={styles.card}>
      <Pressable accessibilityRole="button" aria-expanded={open} onPress={toggle} style={styles.header}>
        <ChartGlyph kind={chartKind} color={accent} />
        <View style={styles.headerMid}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <View style={styles.valueRow}>
            <Serif style={[styles.value, { color: accent }]}>{value}</Serif>
            {unit ? <Body style={styles.unit}>{unit}</Body> : null}
            {delta ? (
              <Body style={[styles.delta, { color: deltaColor }]}>
                {delta.arrow}{delta.text}
              </Body>
            ) : null}
          </View>
          {summary && !open ? <SerifItalic style={styles.summary}>{summary}</SerifItalic> : null}
        </View>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon.chevron color="rgba(42,37,32,0.4)" />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <View style={styles.bodyInner}>{children}</View>
          {blurb ? <SerifItalic style={styles.blurb}>{blurb}</SerifItalic> : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, padding: 0, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingHorizontal: 18 },
  glyph: { borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerMid: { flex: 1, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  value: { fontSize: 24, lineHeight: 26 },
  unit: { fontSize: 11, color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  delta: { fontSize: 11, fontFamily: fonts.bodySemibold, marginLeft: 'auto', letterSpacing: 0.2 },
  summary: { fontSize: 12.5, color: colors.ink2, marginTop: 4, lineHeight: 17 },
  body: { paddingHorizontal: 18, paddingBottom: 18, paddingTop: 4 },
  bodyInner: { borderTopWidth: 1, borderTopColor: colors.hairline, borderStyle: 'dashed', paddingTop: 14 },
  blurb: { fontSize: 13.5, color: colors.ink2, lineHeight: 20, marginTop: 14 },
});
