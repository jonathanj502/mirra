// Swipeable week paginator — horizontally scrollable pills that snap to center,
// with prev/next chevrons and edge fades. Ported from screen-progress.jsx.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, ScrollView, Pressable, StyleSheet,
  NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Body } from './Typography';
import { colors, fonts, cardShadow } from '@/theme/tokens';

function Chevron({ dir, disabled }: { dir: 'left' | 'right'; disabled: boolean }) {
  const color = disabled ? 'rgba(42,37,32,0.2)' : colors.muted;
  return (
    <Svg viewBox="0 0 16 16" width={14} height={14}>
      <Path d={dir === 'left' ? 'M10 3l-5 5 5 5' : 'M6 3l5 5-5 5'} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function WeekPaginator({ weeks, idx, onChange }: { weeks: { label: string; upcoming?: boolean }[]; idx: number; onChange: (i: number) => void }) {
  const count = weeks.length;
  const scrollRef = useRef<ScrollView>(null);
  const layouts = useRef<{ x: number; w: number }[]>([]);
  const scrollX = useRef(0);
  const programmatic = useRef(false);
  const [containerW, setContainerW] = useState(0);

  const scrollToIdx = (i: number) => {
    const l = layouts.current[i];
    if (!l || !containerW) return;
    const target = Math.max(0, l.x + l.w / 2 - containerW / 2);
    programmatic.current = true;
    scrollRef.current?.scrollTo({ x: target, animated: true });
    setTimeout(() => { programmatic.current = false; }, 450);
  };

  useEffect(() => { scrollToIdx(idx); }, [idx, containerW]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmatic.current) return;
    const center = e.nativeEvent.contentOffset.x + containerW / 2;
    let best = idx, bestD = Infinity;
    layouts.current.forEach((l, i) => {
      if (!l) return;
      const c = l.x + l.w / 2;
      const d = Math.abs(c - center);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== idx) onChange(best);
  };

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setContainerW(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollX.current = e.nativeEvent.contentOffset.x; }}
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={{ paddingHorizontal: containerW ? containerW / 2 - 8 : 50, alignItems: 'center', gap: 10 }}
      >
        {weeks.map((w, i) => {
          const isActive = i === idx;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              aria-selected={isActive}
              onPress={() => onChange(i)}
              onLayout={(e) => {
                layouts.current[i] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
                if (i === idx) scrollToIdx(i);
              }}
              style={[styles.pill, isActive && styles.pillActive]}
            >
              <Body
                style={[
                  styles.pillText,
                  { color: isActive ? colors.ink : colors.muted, fontFamily: isActive ? fonts.bodySemibold : fonts.bodyMedium },
                ]}
              >
                {w.label}{w.upcoming && isActive ? ' · live' : ''}
              </Body>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* edge fades */}
      <LinearGradient colors={[colors.paper, 'rgba(246,239,224,0)'] as const} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fade, { left: 0 }]} pointerEvents="none" />
      <LinearGradient colors={['rgba(246,239,224,0)', colors.paper] as const} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fade, { right: 0 }]} pointerEvents="none" />

      {/* prev / next */}
      <Pressable accessibilityRole="button" accessibilityLabel="Previous week" disabled={idx === 0} onPress={() => onChange(Math.max(0, idx - 1))} style={[styles.chev, { left: 0 }]} hitSlop={6}>
        <Chevron dir="left" disabled={idx === 0} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Next week" disabled={idx === count - 1} onPress={() => onChange(Math.min(count - 1, idx + 1))} style={[styles.chev, { right: 0 }]} hitSlop={6}>
        <Chevron dir="right" disabled={idx === count - 1} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', paddingVertical: 4, justifyContent: 'center' },
  pill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'transparent',
  },
  pillActive: { backgroundColor: colors.card, ...cardShadow },
  pillText: { fontSize: 13, letterSpacing: 0.3 },
  fade: { position: 'absolute', top: 0, bottom: 0, width: 28, zIndex: 2 },
  chev: { position: 'absolute', top: 0, bottom: 0, paddingHorizontal: 8, justifyContent: 'center', zIndex: 3 },
});
