// Floating glass bottom tab bar — the custom bar from screens-shared.jsx.
// Presentational: pass the active tab id and an onPress(id) handler.
import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body } from './Typography';
import { Icon } from './Icon';
import { colors, fonts, floatShadow } from '@/theme/tokens';

export type TabId = 'home' | 'insights' | 'progress' | 'profile';

const TABS: { id: TabId; label: string; Glyph: typeof Icon.mic }[] = [
  { id: 'home', label: 'Record', Glyph: Icon.mic },
  { id: 'insights', label: 'Insights', Glyph: Icon.spark },
  { id: 'progress', label: 'Progress', Glyph: Icon.trend },
  { id: 'profile', label: 'You', Glyph: Icon.person },
];

const INACTIVE = colors.muted;

export function FloatingTabBar({
  active,
  onPress,
}: {
  active: TabId;
  onPress: (id: TabId) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === 'ios' ? Math.max(insets.bottom, 16) : 18;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <BlurView intensity={24} tint="light" style={styles.blur}>
        <View style={styles.inner}>
          {TABS.map((t) => {
            const isActive = t.id === active;
            const tint = isActive ? colors.terracotta : INACTIVE;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                aria-selected={isActive}
                onPress={() => onPress(t.id)}
                style={styles.tab}
                hitSlop={8}
              >
                <t.Glyph color={tint} size={22} />
                <Body
                  style={[
                    styles.label,
                    { color: tint, fontFamily: isActive ? fonts.bodySemibold : fonts.bodyMedium },
                  ]}
                >
                  {t.label}
                </Body>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 28,
    ...floatShadow,
  },
  blur: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  inner: {
    backgroundColor: 'rgba(251,246,234,0.82)',
    borderRadius: 28,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,37,32,0.06)',
  },
  tab: {
    alignItems: 'center',
    gap: 3,
    minWidth: 56,
    minHeight: 44,
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.4,
  },
});
