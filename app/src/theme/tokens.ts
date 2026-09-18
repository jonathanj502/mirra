// Design tokens — Mirra "dawn" palette (soft aesthetic, cozy density).
// Foreground colors meet 4.5:1 contrast on each paper surface.

export const colors = {
  bg: '#ECE2D2',
  paper: '#F6EFE0',
  card: '#FBF6EA',
  card2: '#F3E9D5',
  ink: '#2A2520',
  ink2: '#4A4138',
  muted: '#6B6258',
  hairline: 'rgba(42,37,32,0.10)',
  hairline2: 'rgba(42,37,32,0.06)',

  terracotta: '#9B5139',
  terracottaSoft: '#E8B79E',
  sage: '#506343',
  sageSoft: '#C2CDB4',
  lavender: '#705582',
  lavenderSoft: '#D7CDE2',
  coral: '#A04738',
  sand: '#E0CCAA',

  // Chart helpers (from charts.jsx MirraColors)
  inkSoft: '#6B6258',
  hair: 'rgba(42,37,32,0.10)',
} as const;

// Font families — loaded in app/_layout.tsx via @expo-google-fonts.
export const fonts = {
  // Display serif (Instrument Serif). Maps to the .serif / .serif-i classes.
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  // Body sans (Inter stands in for Geist, the named fallback in tokens.css).
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyLight: 'Inter_300Light',
} as const;

// Soft drop shadow used by Card and floating elements.
// (RN: iOS uses shadow*, Android uses elevation.)
export const cardShadow = {
  shadowColor: '#2A2520',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.04,
  shadowRadius: 2,
  elevation: 1,
} as const;

export const floatShadow = {
  shadowColor: '#2A2520',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.1,
  shadowRadius: 24,
  elevation: 8,
} as const;
