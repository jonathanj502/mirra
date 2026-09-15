// Layout-based "charts" that were plain divs in the prototype: horizontal
// filler bars, per-dimension sync dots, and the offset zone legend.
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

// ── Sync bars — you / them dots per energy dimension ───────────────────────
export function SyncBars({
  dims,
}: {
  dims: { label: string; you: number; them: number }[];
}) {
  return (
    <View style={{ gap: 14 }}>
      {dims.map((d, i) => {
        const match = Math.round((1 - Math.abs(d.you - d.them)) * 100);
        const matchColor = match >= 80 ? colors.sage : match >= 65 ? colors.lavender : colors.coral;
        return (
          <View key={i}>
            <View style={styles.syncHead}>
              <Body style={{ fontSize: 12, color: colors.ink }}>{d.label}</Body>
              <Body style={{ fontSize: 11, fontFamily: fonts.bodySemibold, color: matchColor }}>{match}% mirror</Body>
            </View>
            <View style={styles.syncTrack}>
              <View style={styles.syncMid} />
              <View style={[styles.dot, styles.dotYou, { left: `${d.you * 100}%` }]} />
              <View style={[styles.dot, styles.dotThem, { left: `${d.them * 100}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Offset zone legend ─────────────────────────────────────────────────────
export function OffsetZoneLegend() {
  const items = [
    { color: colors.lavender, range: '< 0 ms', label: 'high engagement / interrupting' },
    { color: colors.sage, range: '~+200 ms', label: 'ideal smooth turn-taking' },
    { color: colors.sand, range: '+500 ms +', label: 'listener formulating' },
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

  syncHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 },
  syncTrack: { height: 10, backgroundColor: 'rgba(42,37,32,0.06)', borderRadius: 999, justifyContent: 'center' },
  syncMid: { position: 'absolute', left: '50%', top: -1, bottom: -1, width: 1, backgroundColor: 'rgba(42,37,32,0.12)' },
  dot: { position: 'absolute', top: '50%', width: 14, height: 14, borderRadius: 7, marginLeft: -7, marginTop: -7 },
  dotYou: { backgroundColor: colors.terracotta },
  dotThem: { backgroundColor: colors.lavender },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSquare: { width: 10, height: 10, borderRadius: 2, opacity: 0.65 },
  legendRange: { fontSize: 10.5, fontFamily: fonts.bodySemibold, color: colors.muted, letterSpacing: 0.4, width: 64 },
  legendLabel: { flex: 1, fontSize: 11, color: colors.ink2, lineHeight: 14 },
});
