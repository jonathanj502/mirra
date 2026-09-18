// Word frequency bars and the turn-timing legend.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Body, Serif } from './Typography';
import { colors, fonts } from '@/theme/tokens';

// ── Filler / lexical-padding bars (high → low) ─────────────────────────────
export function FillerBars({
  items, color = colors.sand,
}: {
  items: { phrase: string; count: number }[]; color?: string;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <View style={{ gap: 8 }}>
      {items.map((it, i) => {
        const w = (it.count / max) * 100;
        return (
          <View key={i} style={styles.row}>
            <Serif style={styles.fillerLabel}>"{it.phrase}"</Serif>
            <View style={styles.track8}>
              <View style={[styles.fill, { width: `${w}%`, backgroundColor: color }]} />
            </View>
            <Body style={styles.count}>{it.count}×</Body>
          </View>
        );
      })}
    </View>
  );
}

// ── Offset zone legend ─────────────────────────────────────────────────────
export function OffsetZoneLegend() {
  const items = [
    { color: colors.lavender, range: '< 0 ms', label: 'speakers overlap' },
    { color: colors.muted, range: '0 ms', label: 'estimated turn boundary' },
    { color: colors.sand, range: '> 0 ms', label: 'gap between speakers' },
  ];
  return (
    <View style={{ gap: 6, marginTop: 10 }}>
      {items.map((z, i) => (
        <View key={i} style={styles.legendRow}>
          <View style={[styles.legendSquare, { backgroundColor: z.color }]} />
          <Body style={styles.legendRange}>{z.range}</Body>
          <Body style={styles.legendLabel}>{z.label}</Body>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fillerLabel: { fontSize: 18, lineHeight: 26, color: colors.ink, width: 104 },
  track8: { flex: 1, height: 8, backgroundColor: 'rgba(42,37,32,0.06)', borderRadius: 999, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
  count: { fontSize: 11.5, fontFamily: fonts.bodySemibold, color: colors.muted, width: 32, textAlign: 'right' },


  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSquare: { width: 10, height: 10, borderRadius: 2, opacity: 0.65 },
  legendRange: { fontSize: 10.5, fontFamily: fonts.bodySemibold, color: colors.muted, letterSpacing: 0.4, width: 64 },
  legendLabel: { flex: 1, fontSize: 11, color: colors.ink2, lineHeight: 14 },
});
