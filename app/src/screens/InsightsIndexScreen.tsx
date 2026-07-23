// Insights · week index — list of conversations for the selected week.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Serif, SerifItalic, Eyebrow } from '@/components/Typography';
import { Icon } from '@/components/Icon';
import { WeekPaginator } from '@/components/WeekPaginator';
import { colors } from '@/theme/tokens';
import { ConvListItem, fullDay, toConvListItem } from '@/models/week';
import { useProgressSummary } from '@/hooks/useProgressSummary';

function ConvRow({ item, isLast, onPress }: { item: ConvListItem; isLast: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={[styles.dot, { backgroundColor: colors[item.tone as keyof typeof colors] ?? colors.sage }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Serif style={styles.title}>{item.title}</Serif>
        <Body style={styles.meta}>
          {item.when} · {item.duration} · <SerifItalic style={styles.note}>{item.note}</SerifItalic>
        </Body>
      </View>
      <Icon.chevron color="rgba(42,37,32,0.35)" />
    </Pressable>
  );
}

export function InsightsIndexScreen() {
  const router = useRouter();
  const [weekIdx, setWeekIdx] = useState(0);
  const { progress, loading, error } = useProgressSummary();
  const weeks = progress?.weeks ?? [];
  const weekTabs = weeks.length > 0 ? weeks.map((week) => ({ label: week.label, upcoming: week.label === 'This week' })) : [{ label: 'This week' }];
  const selectedWeek = weeks[weekIdx] ?? weeks[0] ?? null;
  const convs = selectedWeek?.conversations.map(toConvListItem) ?? [];

  useEffect(() => {
    if (progress?.weeks.length) setWeekIdx(progress.currentWeekIndex);
  }, [progress?.currentWeekIndex, progress?.weeks.length]);

  const grouped = useMemo(() => {
    const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const map: Record<string, ConvListItem[]> = {};
    convs.forEach((c) => {
      const day = (c.when.split(' · ')[0] || '').trim();
      (map[day] = map[day] || []).push(c);
    });
    return order.filter((d) => map[d]).map((d) => ({ day: d, items: map[d] }));
  }, [convs]);

  const totalDuration = Math.round(selectedWeek?.totalMinutes ?? 0);
  const hours = Math.floor(totalDuration / 60);
  const mins = totalDuration % 60;

  return (
    <Screen topOffset={50}>
      <View style={{ paddingTop: 4 }}>
        <WeekPaginator weeks={weekTabs} idx={Math.min(weekIdx, weekTabs.length - 1)} onChange={setWeekIdx} />
      </View>

      <View style={styles.titleBlock}>
        <Eyebrow>Conversations</Eyebrow>
        <Serif style={styles.bigTitle}>
          {convs.length} {convs.length === 1 ? 'conversation' : 'conversations'},{'\n'}
          <SerifItalic style={styles.bigTitle}>
            {hours > 0 ? `${hours}h ` : ''}{mins} min total.
          </SerifItalic>
        </Serif>
        <Body style={styles.intro}>
          {loading
            ? 'Loading...'
            : selectedWeek?.conversationCount
              ? 'Tap a conversation to see its patterns.'
              : 'Record a conversation to get started.'}
        </Body>
      </View>

      <View style={styles.list}>
        {error && <Body style={styles.errorText}>{error}</Body>}
        {grouped.map((group, gi) => (
          <View key={group.day} style={{ marginBottom: gi === grouped.length - 1 ? 0 : 14 }}>
            <View style={styles.groupHead}>
              <Eyebrow style={{ fontSize: 10, letterSpacing: 1.4 }}>{fullDay(group.day)}</Eyebrow>
              <Body style={styles.groupCount}>
                {group.items.length} {group.items.length === 1 ? 'chat' : 'chats'}
              </Body>
            </View>
            {group.items.map((it, i) => (
              <ConvRow
                key={it.id}
                item={it}
                isLast={i === group.items.length - 1}
                onPress={() => router.push({ pathname: '/conversation', params: { id: it.id } })}
              />
            ))}
          </View>
        ))}

        {!loading && !error && convs.length === 0 && (
          <SerifItalic style={styles.empty}>No conversations yet this week.</SerifItalic>
        )}
      </View>
      <View style={{ height: 12 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: { paddingHorizontal: 22, paddingTop: 20 },
  bigTitle: { fontSize: 30, lineHeight: 32, color: colors.ink, marginTop: 8 },
  intro: { fontSize: 13, color: colors.ink2, marginTop: 12, lineHeight: 20, maxWidth: 320 },
  list: { paddingHorizontal: 24, paddingTop: 18 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.hairline2, paddingBottom: 4, marginBottom: 2 },
  groupCount: { fontSize: 10.5, color: colors.muted },
  errorText: { textAlign: 'center', paddingVertical: 30, color: colors.coral, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 18, lineHeight: 21, color: colors.ink },
  meta: { fontSize: 11.5, color: colors.muted, marginTop: 4, letterSpacing: 0.2 },
  note: { fontSize: 13, color: colors.muted },
  empty: { textAlign: 'center', paddingVertical: 40, color: colors.muted, fontSize: 13 },
});
