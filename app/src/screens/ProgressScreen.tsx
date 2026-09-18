// Progress · this week — weekly trends, swipeable weeks, what's working / nudges.
import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Card, Pip } from '@/components/ui';
import { Body, Serif, SerifItalic, Eyebrow } from '@/components/Typography';
import { WeekPaginator } from '@/components/WeekPaginator';
import { ReflectCTA } from '@/components/ReflectCTA';
import { ExpandableMetric, Delta } from '@/components/ExpandableMetric';
import { Donut, WeeklyBars, PairedBarChart, TurnOffsetChart, LSMHistogram } from '@/components/charts';
import { FillerBars, OffsetZoneLegend } from '@/components/meters';
import { colors, fonts } from '@/theme/tokens';
import { DAY_LABELS, Week, toConvListItem } from '@/models/week';
import { useProgressSummary } from '@/hooks/useProgressSummary';
import { ProgressWeekSummary } from '@/models/debrief';

const comma = (n: number) => n.toLocaleString('en-US');

const EMPTY_WEEK: Week = {
  label: 'This week',
  short: 'This week',
  upcoming: true,
  title: ['No conversations yet,', 'patterns are waiting.'],
  convs: 0,
  mins: '0:00',
  daily: [0, 0, 0, 0, 0, 0, 0],
  talkListen: 0,
  talkTrend: [0],
  questions: 0,
  questionsTrend: [0],
  questionsDaily: { asked: [0, 0, 0, 0, 0, 0, 0], received: [0, 0, 0, 0, 0, 0, 0] },
  questionsOpenClosed: { asked: { open: 0, closed: 0 }, received: { open: 0, closed: 0 } },
  interrupts: 0,
  interruptsTrend: [0],
  turnOffsetAvg: 0,
  turnOffsetTrend: DAY_LABELS.map((label) => ({ t: label, ms: null })),
  energy: 0,
  energyAxes: [0, 0, 0, 0, 0],
  lsmAvg: 0,
  ttrAvg: 0,
  ttrCounts: { unique: 0, total: 0 },
  topFillers: [],
  lsmConvs: [],
  convsList: [],
};

function makeDeltas(prevW: Week | null) {
  const mk = (raw: number, fmt: (v: number) => string): Delta => {
    if (raw === 0) return { text: 'flat', arrow: '', neutral: true };
    return { arrow: raw > 0 ? '↑ ' : '↓ ', text: fmt(Math.abs(raw)), neutral: true };
  };
  if (!prevW) return null;
  return { mk };
}

function totalMinutesLabel(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}, ${mins} minutes.` : `${mins} minutes.`;
}

function toWeek(summary: ProgressWeekSummary): Week {
  const uniqueWords = summary.vocabularyUniqueWords;
  const totalWords = Math.max(uniqueWords, summary.vocabularyTotalWords);
  const energyAxes = [summary.energyAxes[0] ?? 0, summary.energyAxes[1] ?? 0, summary.energyAxes[2] ?? 0];

  return {
    label: summary.label,
    short: summary.label === 'This week' ? 'This week' : summary.label.split(' - ')[0],
    upcoming: summary.conversationCount === 0,
    title: [
      `${summary.conversationCount} ${summary.conversationCount === 1 ? 'conversation' : 'conversations'},`,
      totalMinutesLabel(summary.totalMinutes),
    ],
    convs: summary.conversationCount,
    mins: `${Math.floor(summary.totalMinutes / 60)}:${String(Math.round(summary.totalMinutes % 60)).padStart(2, '0')}`,
    daily: summary.dailyMinutes.map((value) => Math.round(value)),
    talkListen: summary.talkListenPercent,
    talkTrend: [summary.talkListenPercent],
    questions: summary.averageQuestions,
    questionsTrend: [summary.averageQuestions],
    questionsDaily: { asked: summary.dailyOpenQuestions, received: summary.dailyClosedQuestions },
    questionsOpenClosed: {
      asked: { open: summary.totalOpenQuestions, closed: summary.totalClosedQuestions },
      received: { open: 0, closed: 0 },
    },
    interrupts: summary.interruptionCount,
    interruptsTrend: [summary.interruptionCount],
    turnOffsetAvg: summary.averageTurnOffsetMs,
    turnOffsetTrend: DAY_LABELS.map((label, index) => ({
      t: label,
      ms: summary.dailyTurnOffsets[index] ?? null,
    })),
    energy: summary.energyScore,
    energyAxes,
    lsmAvg: summary.lsmAverage,
    ttrAvg: summary.vocabularyRichness || (totalWords > 0 ? uniqueWords / totalWords : 0),
    ttrCounts: { unique: uniqueWords, total: totalWords },
    topFillers: summary.topFillers,
    lsmConvs: summary.conversations.map((conversation) => ({ name: conversation.title, score: conversation.lsmScore })),
    convsList: summary.conversations.map(toConvListItem),
  };
}

export function ProgressScreen() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.min(300, Math.max(120, width - 96));
  const router = useRouter();
  const [weekIdx, setWeekIdx] = useState(1);
  const { progress, loading, error, refresh } = useProgressSummary();
  const backendWeeks = useMemo(() => progress?.weeks.map(toWeek) ?? [], [progress]);
  const weeks = backendWeeks.length > 0 ? backendWeeks : [EMPTY_WEEK];
  const usingBackendWeeks = backendWeeks.length > 0;

  useEffect(() => {
    if (progress?.weeks.length) setWeekIdx(progress.currentWeekIndex);
    else setWeekIdx(0);
  }, [progress?.currentWeekIndex, progress?.weeks.length]);

  const w = weeks[weekIdx] ?? weeks[0] ?? EMPTY_WEEK;
  const prevW = weekIdx > 0 ? weeks[weekIdx - 1] : null;
  const backendWeek = usingBackendWeeks ? progress?.weeks[weekIdx] : null;
  const d = makeDeltas(prevW);

  const activeDays = w.daily.filter((m) => m > 0);
  const totalMin = w.daily.reduce((a, b) => a + b, 0);
  const avgMin = activeDays.length ? Math.round(totalMin / activeDays.length) : 0;
  const prevTotal = prevW ? prevW.daily.reduce((a, b) => a + b, 0) : null;
  const totalDelta = prevTotal != null ? totalMin - prevTotal : null;

  const dTalkListen = d ? d.mk(w.talkListen - prevW!.talkListen, (v) => `${v.toFixed(0)}pp`) : null;
  const dQuestions = d ? d.mk(w.questions - prevW!.questions, (v) => v.toFixed(1)) : null;
  const dOffset = d ? d.mk(w.turnOffsetAvg - prevW!.turnOffsetAvg, (v) => `${v.toFixed(0)} ms`) : null;
  const dLsm = d ? d.mk(w.lsmAvg - prevW!.lsmAvg, (v) => v.toFixed(2)) : null;
  const visibleWins = backendWeek?.wins.length ? backendWeek.wins : [loading ? 'Loading...' : error || 'No saved observations this week.'];
  const visibleNudges = backendWeek?.nudges.length ? backendWeek.nudges : [loading ? 'Loading...' : error || 'No saved patterns this week.'];

  const intro = loading
    ? 'Loading...'
    : error
      ? 'Progress is unavailable right now.'
      : w.convs > 0
        ? `${w.convs} ${w.convs === 1 ? 'conversation' : 'conversations'} this week.`
        : 'Record a conversation to see patterns.';

  const todayIdx = w.label === 'This week' ? (new Date().getUTCDay() + 6) % 7 : null;
  const hasConversations = w.convs > 0;
  const reflectSubject = w.short.toLowerCase() === 'this week' ? 'this week' : `your ${w.short.toLowerCase()}`;

  return (
    <Screen topOffset={50} error={error} onRefresh={refresh} refreshing={loading}>
      <View style={{ paddingTop: 4 }}>
        <WeekPaginator weeks={weeks} idx={weekIdx} onChange={setWeekIdx} />
      </View>

      {/* Title + intro */}
      <View style={styles.titleBlock}>
        <Serif style={styles.bigTitle}>
          {w.title[0]}{'\n'}
          <SerifItalic style={styles.bigTitle}>{w.title[1]}</SerifItalic>
        </Serif>
        <Body style={styles.intro}>{intro}</Body>
        <ReflectCTA subject={reflectSubject} onPress={() => router.push('/reflect')} />
      </View>

      {/* Daily rhythm */}
      <View style={styles.section}>
        <Card>
          <View style={styles.dailyHead}>
            <View>
              <Eyebrow>Minutes recorded each day</Eyebrow>
              <View style={styles.dailyAvgRow}>
                <Serif style={styles.dailyAvg}>{avgMin}</Serif>
                <Body style={styles.dailyAvgUnit}>min avg / active day</Body>
              </View>
            </View>
            {totalDelta != null && (
              <View style={{ alignItems: 'flex-end' }}>
                <Body style={[styles.dailyDelta, { color: colors.muted }]}>
                  {totalDelta > 0 ? '↑' : totalDelta < 0 ? '↓' : ''} {Math.abs(totalDelta)} min
                </Body>
                <Body style={styles.dailyDeltaSub}>vs last week</Body>
              </View>
            )}
          </View>
          <WeeklyBars data={w.daily} labels={DAY_LABELS} width={chartWidth} height={120} color={colors.terracotta} todayIdx={todayIdx} />
        </Card>
      </View>

      {/* Patterns */}
      <View style={styles.patterns}>
        <View style={styles.patternsHead}>
          <Eyebrow>Patterns this week</Eyebrow>
          <Body style={styles.tapHint}>Tap to expand</Body>
        </View>

        {/* 1. Talk / Listen */}
        <ExpandableMetric
          key={`tl-${weekIdx}`}
          eyebrow="Speaking share" delta={dTalkListen}
          value={hasConversations ? `${w.talkListen} / ${100 - w.talkListen}` : 'Unavailable'} unit="you / others"
          summary={hasConversations ? 'Estimated from saved speech duration.' : 'Awaiting conversation data.'} accent={colors.terracotta} chartKind="donut" defaultOpen={weekIdx === 1}
          blurb={prevW ? `${w.talkListen}% this week, ${prevW.talkListen}% last week.` : `${w.talkListen}% of the time this week.`}
        >
          <View style={styles.rowCenter}>
            <Donut size={130} stroke={20} segments={[{ value: w.talkListen, color: colors.terracotta }, { value: 100 - w.talkListen, color: colors.sage }]} centerLabel={`${w.talkListen}%`} centerSub="you" />
            <View style={{ gap: 12, flex: 1 }}>
              <View>
                <Pip color={colors.terracotta}>You · {w.talkListen}%</Pip>
                {prevW && (() => {
                  const dd = w.talkListen - prevW.talkListen;
                  return (
                    <Body style={styles.pipNote}>
                      {dd === 0 ? 'No change' : `${dd > 0 ? '↑' : '↓'} ${Math.abs(dd)} pp from last week`}
                    </Body>
                  );
                })()}
              </View>
              <View>
                <Pip color={colors.sage}>Others · {100 - w.talkListen}%</Pip>
                <Body style={styles.pipNote}>No single ratio fits every conversation.</Body>
              </View>
            </View>
          </View>
        </ExpandableMetric>

        {/* 2. Questions per conversation */}
        <ExpandableMetric
          key={`q-${weekIdx}`}
          eyebrow="Questions per conversation" delta={dQuestions}
          value={w.questions} unit="avg" summary={hasConversations ? 'Question counts are rolling up.' : 'No questions detected yet.'} accent={colors.sage} chartKind="bar"
          blurb="Questions are counted from each saved transcript and grouped by open vs closed wording."
        >
          <PairedBarChart asked={w.questionsDaily.asked} received={w.questionsDaily.received} labels={DAY_LABELS} width={chartWidth} height={130} askedColor={colors.sage} receivedColor={colors.lavender} />
          <View style={styles.qFooter}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pip color={colors.sage}>Open · {w.questionsDaily.asked.reduce((a, b) => a + b, 0)}</Pip>
              <Pip color={colors.lavender}>Closed · {w.questionsDaily.received.reduce((a, b) => a + b, 0)}</Pip>
            </View>
            <Body style={styles.qAvg}>{w.questions} avg / conv</Body>
          </View>
        </ExpandableMetric>

        {/* 3. Turn-floor offset */}
        <ExpandableMetric
          key={`to-${weekIdx}`}
          eyebrow="Turn-taking" delta={dOffset}
          value={w.turnOffsetTrend.some(point => point.ms != null) ? `${w.turnOffsetAvg > 0 ? '+' : ''}${w.turnOffsetAvg}` : 'Unavailable'} unit="ms avg"
          summary={hasConversations ? 'Estimated from saved interruption signals.' : 'Awaiting turn-taking data.'} accent={colors.terracotta} chartKind="line"
          blurb="Average gap between speakers' turns each day this week. Days without conversations are blank."
        >
          <TurnOffsetChart data={w.turnOffsetTrend} width={chartWidth} height={170} />
          <OffsetZoneLegend />
        </ExpandableMetric>

        {/* Speaking pace */}
        <ExpandableMetric
          key={`e-${weekIdx}`}
          eyebrow="Speaking pace" value={backendWeek?.averageWpm ? Math.round(backendWeek.averageWpm) : 'Unavailable'} unit="words / min"
          summary="Your average estimated speaking pace." accent={colors.lavender} chartKind="line"
          blurb="Each conversation's estimate uses your words and detected speaking time. No single pace is right for every situation."
        >
          <Body style={styles.pipNote}>Open any conversation in Insights for its volume, pitch, pace, and vocal energy timeline.</Body>
        </ExpandableMetric>

        {/* 5. Linguistic style match */}
        <ExpandableMetric
          key={`lsm-${weekIdx}`}
          eyebrow="Language reference" delta={dLsm}
          value={hasConversations ? w.lsmAvg.toFixed(2) : 'Unavailable'} unit="avg index"
          summary="An experimental reference index, not a connection score." accent={colors.lavender} chartKind="bar"
          blurb="Uses a fixed function-word reference and acoustic similarity. This is not a comparison of your words with the other speakers."
        >
          <LSMHistogram convs={w.lsmConvs} width={chartWidth} height={150} />
        </ExpandableMetric>

        {/* 6. Vocabulary */}
        <ExpandableMetric
          key={`v-${weekIdx}`}
          eyebrow="Vocabulary" value={`${Math.round(w.ttrAvg * 100)}%`} unit="weekly avg"
          summary={`${comma(w.ttrCounts.total)} estimated words this week.`}
          accent={colors.sand} chartKind="bar"
        >
          <SerifItalic style={styles.vocabLine}>
            {comma(w.ttrCounts.unique)} unique-word counts summed across conversations, with {comma(w.ttrCounts.total)} words spoken. The same word can count once in each conversation.
          </SerifItalic>
          <View>
            <View style={styles.vocabHead}>
              <Eyebrow>Possible filler words this week</Eyebrow>
              <Body style={styles.vocabHeadMeta}>{w.topFillers.reduce((a, b) => a + b.count, 0)} total</Body>
            </View>
            <FillerBars items={w.topFillers} />
            <Body style={styles.pipNote}>Phrase matches need context. Repetition is not automatically a problem.</Body>
          </View>
        </ExpandableMetric>
      </View>

      {/* Strengths + nudges */}
      <View style={styles.insightsBlock}>
        <Card>
          <Eyebrow>From your recent debriefs</Eyebrow>
          <View style={{ gap: 12, marginTop: 12 }}>
            {visibleWins.map((line, i) => <InsightLine key={i} accent={colors.sage}>{line}</InsightLine>)}
          </View>
        </Card>
        <Card>
          <Eyebrow>Patterns to consider</Eyebrow>
          <View style={{ gap: 12, marginTop: 12 }}>
            {visibleNudges.map((line, i) => <InsightLine key={i} accent={colors.coral}>{line}</InsightLine>)}
          </View>
          <SerifItalic style={styles.nudgeClose}>Keep the conversation and your goal in mind.</SerifItalic>
        </Card>
      </View>
      <View style={{ height: 12 }} />
    </Screen>
  );
}

function InsightLine({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <View style={styles.lineRow}>
      <View style={[styles.lineBar, { backgroundColor: accent }]} />
      <Body style={styles.lineText}>{children}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: { paddingHorizontal: 22, paddingTop: 20 },
  bigTitle: { fontSize: 30, lineHeight: 32, color: colors.ink },
  intro: { fontSize: 13, color: colors.ink2, marginTop: 12, lineHeight: 20, maxWidth: 320 },
  section: { paddingHorizontal: 18, paddingTop: 18 },
  dailyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  dailyAvgRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  dailyAvg: { fontSize: 28, lineHeight: 28, color: colors.ink },
  dailyAvgUnit: { fontSize: 11, color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  dailyDelta: { fontSize: 13, fontFamily: fonts.bodySemibold },
  dailyDeltaSub: { fontSize: 10, color: colors.muted, letterSpacing: 0.3, marginTop: 2 },
  patterns: { paddingHorizontal: 18, paddingTop: 18 },
  patternsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  tapHint: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.6 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  pipNote: { fontSize: 11.5, color: colors.muted, marginTop: 3 },
  qFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 },
  qAvg: { fontSize: 11, color: colors.muted },
  vocabLine: { fontSize: 13.5, color: colors.ink2, lineHeight: 20, marginBottom: 16 },
  vocabHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  vocabHeadMeta: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.6 },
  insightsBlock: { paddingHorizontal: 22, paddingTop: 20, gap: 12 },
  lineRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  lineBar: { width: 4, borderRadius: 999, opacity: 0.75, marginVertical: 2 },
  lineText: { fontSize: 13.5, color: colors.ink, lineHeight: 20, flex: 1 },
  nudgeClose: { fontSize: 13, color: colors.ink2, marginTop: 14, lineHeight: 20, opacity: 0.85 },
});
