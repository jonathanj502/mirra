// "Reflect with Mirra" pill — links into the AI chat screen.
import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Body, Serif } from './Typography';
import { Icon } from './Icon';
import { colors } from '@/theme/tokens';

export function ReflectCTA({
  subject = 'this conversation', onPress,
}: {
  subject?: string; onPress?: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Svg viewBox="0 0 20 20" width={16} height={16}>
          <Path d="M10 2.5 L11.6 7 L16 8 L11.6 10 L10 14.5 L8.4 10 L4 8 L8.4 7 Z" fill="#FBF6EA" />
        </Svg>
      </View>
      <View style={{ flex: 1 }}>
        <Serif style={styles.title}>
          Reflect with Mirra
        </Serif>
        <Body style={styles.sub}>Talk through {subject}</Body>
      </View>
      <Icon.chevron color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(208,136,102,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(208,136,102,0.25)',
    borderRadius: 14,
  },
  iconCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.terracotta,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 20, color: colors.ink, lineHeight: 28 },
  sub: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
});
