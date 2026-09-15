// Typography primitives. RN has no font cascade, so each variant sets its own
// fontFamily. Nest freely: <Body>plain <Serif>display</Serif> more</Body>.
import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

export function Body({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[styles.body, style]} />;
}

export function Serif({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[styles.serif, style]} />;
}

// Reserve italics for quotations or short, intentional emphasis.
export function SerifItalic({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[styles.serifItalic, style]} />;
}

export function Eyebrow({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[styles.eyebrow, style]} />;
}

const styles = StyleSheet.create({
  body: {
    fontFamily: fonts.body,
    color: colors.ink,
  },
  serif: {
    fontFamily: fonts.serif,
    color: colors.ink,
    letterSpacing: 0,
  },
  serifItalic: {
    fontFamily: fonts.serifItalic,
    color: colors.ink,
    letterSpacing: 0,
  },
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
});
