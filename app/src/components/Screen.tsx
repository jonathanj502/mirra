// Screen wrapper — paper background, scrollable body, bottom-tab clearance.
// `tabBar` is an optional node rendered above the scroll area (used by routes
// that live outside the Tabs navigator, e.g. the single-conversation screen).
import React from 'react';
import { View, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';
import { Body } from './Typography';

interface ScreenProps {
  children: React.ReactNode;
  topOffset?: number;
  tabBar?: React.ReactNode;
  error?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function Screen({ children, topOffset = 50, tabBar, error, onRefresh, refreshing = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.terracotta} /> : undefined}
        contentContainerStyle={{
          paddingTop: insets.top + Math.max(0, topOffset - 44),
          paddingBottom: 120 + insets.bottom,
        }}
      >
        {error ? (
          <View style={styles.error}>
            <Body accessibilityRole="alert" style={styles.errorText}>{error}</Body>
            {onRefresh ? (
              <Pressable accessibilityRole="button" onPress={onRefresh} disabled={refreshing} style={styles.retry}>
                <Body>{refreshing ? 'Retrying…' : 'Retry'}</Body>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
      {tabBar}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1 },
  error: { marginHorizontal: 24, marginBottom: 16, padding: 14, borderRadius: 14, backgroundColor: colors.card },
  errorText: { color: colors.coral, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
