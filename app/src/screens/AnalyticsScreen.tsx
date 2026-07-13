// Insights · single conversation deep-dive.
import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Card, Pip } from '@/components/ui';
import { Body, Serif, SerifItalic, Eyebrow } from '@/components/Typography';
import { Icon } from '@/components/Icon';
import { FloatingTabBar, TabId } from '@/components/FloatingTabBar';
import { ExpandableMetric } from '@/components/ExpandableMetric';
import { ReflectCTA } from '@/components/ReflectCTA';
import { Donut, RingMeter, RadarChart, TurnOffsetChart, EnergyWave } from '@/components/charts';
import { FillerBars, SyncBars, OffsetZoneLegend } from '@/components/meters';
import { colors, fonts } from '@/theme/tokens';
import { useDebriefs, toConversationListItem } from '@/hooks/useDebriefs';
import { useAuth } from '@/auth/AuthContext';
import { fetchDebrief } from '@/api/client';
import { DebriefCard } from '@/models/debrief';

const TAB_HREF: Record<TabId, '/' | '/insights' | '/progress' | '/profile'> = {
  home: '/', insights: '/insights', progress: '/progress', profile: '/profile',
};

const LSM_AXES = [
  { key: 'pronouns', label: 'Pronouns' },
  { key: 'articles', label: 'Articles' },
  { key: 'prepositions', label: 'Prepositions' },
  { key: 'conjunctions', label: 'Conjunctions' },
  { key: 'quantifiers', label: 'Quantifiers' },
  { key: 'aux_verbs', label: 'Aux. verbs' },
];

function talkPercent(raw: number) {
  if (raw <= 0) return 0;
  const share = raw <= 1 ? raw : raw / (1 + raw);
  return Math.max(0, Math.min(100, Math.round(share * 100)));
}

function words(text?: string | null) {
  return (text?.toLowerCase().match(/[a-z']+/g) ?? []).filter((word) => word.length > 1);
}

// Questions card — vertical bar with count baked inside.
function QBar({ label, value, color, sub, max }: { label: string; value: number; color: string; sub: string; max: number }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={styles.qBarTrack}>
        <View style={[styles.qBarFill, { height: `${(value / max) * 100}%`, backgroundColor: color }]}>
          <Serif style={styles.qBarVal}>{value}</Serif>
        </View>
      </View>
      <Body style={styles.qBarLabel}>
        {label}{'\n'}<Body style={styles.qBarSub}>{sub}</Body>
      </Body>
    </View>
  );
}

export function AnalyticsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { accessToken } = useAuth();
  const { debriefs, loading } = useDebriefs();
  const [remoteDebrief, setRemoteDebrief] = useState<DebriefCard | null>(null);
  const localDebrief = debriefs.find((d) => d.id === id) ?? null;

  useEffect(() => {
    let mounted = true;
    setRemoteDebrief(null);
    if (!id || localDebrief || !accessToken) return;

    fetchDebrief(accessToken, id)
      .then((debrief) => {
        if (mounted) setRemoteDebrief(debrief);
      })
      .catch(() => {
        if (mounted) setRemoteDebrief(null);
      });

    return () => {
      mounted = false;
    };
  }, [accessToken, id, localDebrief]);

  const selected = localDebrief ?? remoteDebrief ?? debriefs[0] ?? null;
  if (!selected) {
    return (
      <Screen topOffset={50}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Icon.back color={colors.muted} /></Pressable>
          <Eyebrow>Conversation</Eyebrow>
          <Icon.dots color={colors.muted} />
        </View>
        <View style={styles.emptyState}>
          <SerifItalic style={styles.emptyTitle}>{loading ? 'Loading conversation.' : 'No conversation selected.'}</SerifItalic>
          <Body style={styles.emptyBody}>
            {loading ? 'Mirra is checking your saved debriefs.' : 'Record or import a conversation, then open it from Insights.'}
          </Body>
        </View>
      </Screen>
    );
  }

  const selectedListItem = toConversationListItem(selected);
  const title = selectedListItem.title;
  const meta = `${selectedListItem.when} · ${selectedListItem.duration}`;
  const observation = selected.observation;
  const pattern = selected.patternToReduce;
  const next = selected.thingToTryNext;
  const talkPct = talkPercent(selected.stats.talkListenRatio);
  const listenPct = 100 - talkPct;
  const questions = selected.stats.questionCount;
  const interruptions = selected.stats.interruptionCount;
  const durationMin = selected.stats.sessionDurationMinutes;
  const userSpeechMin = selected.stats.userSpeechDurationMinutes;
  const otherSpeechMin = selected.stats.otherSpeechDurationMinutes || Math.max(0, durationMin - userSpeechMin);
  const openQuestions = selected.stats.openQuestionCount;
  const closedQuestions = selected.stats.closedQuestionCount;
  const questionMax = Math.max(openQuestions, closedQuestions, 1) * 1.15;
  const transcriptWords = words(selected.transcript);
  const uniqueWords = selected.stats.uniqueWordCount || new Set(transcriptWords).size;
  const totalWords = selected.stats.totalWordCount || transcriptWords.length || Math.max(0, Math.round(selected.stats.estimatedWpm * durationMin));
  const uniquePct = totalWords > 0 ? Math.round((uniqueWords / totalWords) * 100) : 0;
  const fillers = selected.stats.fillerCounts;
  const fillerTotal = fillers.reduce((sum, item) => sum + item.count, 0);
  const turnOffset = selected.stats.averageTurnOffsetMs;
  const turnOffsetData = selected.stats.turnOffsetSeries;
  const hasTurnOffset = turnOffsetData.length > 0;
  const hasEnergySignals = selected.stats.energyScore > 0 && selected.stats.energySeriesUser.length > 1 && selected.stats.energySeriesOther.length > 1;
  const energyScore = selected.stats.energyScore;
  const energyAxes = [selected.stats.energyAxes[0] ?? 0, selected.stats.energyAxes[1] ?? 0, selected.stats.energyAxes[2] ?? 0];
  const hasLsmSignals = selected.stats.lsmScore > 0;
  const lsmScore = selected.stats.lsmScore;
  const lsmUserValues = LSM_AXES.map((axis) => selected.stats.lsmDimensionsUser[axis.key] ?? 0);
  const lsmReferenceValues = LSM_AXES.map((axis) => selected.stats.lsmDimensionsReference[axis.key] ?? 0);
  const goTab = (id: TabId) => router.navigate(TAB_HREF[id]);

  return (
    <Screen topOffset={50} tabBar={<FloatingTabBar active="insights" onPress={goTab} />}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Icon.back color={colors.muted} /></Pressable>
        <Eyebrow>Conversation</Eyebrow>
        <Icon.dots color={colors.muted} />
      </View>

      <View style={styles.titleBlock}>
        <Serif style={styles.bigTitle}>
          {title}
        </Serif>
        <Body style={styles.meta}>{meta}</Body>
      </View>

      {/* Warm reflection */}
      <View style={styles.reflectWrap}>
        <Card tone="card-2" style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 8 }}>A few things I noticed</Eyebrow>
          <Serif style={styles.reflectText}>
            {observation} — {listenPct}% of the time was theirs. There were{' '}
            <SerifItalic style={[styles.reflectText, { color: colors.terracotta }]}>{pattern}</SerifItalic>
            {' '}to notice. {next}
          </Serif>
          <ReflectCTA subject={title.toLowerCase()} onPress={() => router.push({ pathname: '/reflect', params: selected ? { id: selected.id } : {} })} />
        </Card>
      </View>

      {/* Patterns */}
      <View style={styles.patterns}>
        <View style={styles.patternsHead}>
          <Eyebrow>Patterns</Eyebrow>
          <Body style={styles.tapHint}>Tap to expand</Body>
        </View>

        {/* 1. Talk / Listen */}
        <ExpandableMetric
          eyebrow="Talk / Listen" value={`${talkPct} / ${listenPct}`} unit="you / them"
          summary={talkPct >= 40 && talkPct <= 60 ? 'Within the balanced range.' : 'Outside the balanced range.'} accent={colors.terracotta} chartKind="donut" defaultOpen
          blurb="Estimated from detected speech duration in this saved debrief."
        >
          <View style={styles.rowCenter}>
            <Donut size={130} stroke={20} segments={[{ value: talkPct, color: colors.terracotta }, { value: listenPct, color: colors.sage }]} centerLabel={`${talkPct}%`} centerSub="you" />
            <View style={{ gap: 10, flex: 1 }}>
              <View>
                <Pip color={colors.terracotta}>You · {Math.round(userSpeechMin)} min</Pip>
                <Body style={styles.pipNote}>Estimated from detected speech segments</Body>
              </View>
              <View>
                <Pip color={colors.sage}>Them · {Math.round(otherSpeechMin)} min</Pip>
                <Body style={styles.pipNote}>Healthy range: 40–60% you</Body>
              </View>
            </View>
          </View>
        </ExpandableMetric>

        {/* 2. Questions */}
        <ExpandableMetric
          eyebrow="Questions" value={String(questions)} unit="asked"
          summary={questions > 0 ? `${questions} questions detected.` : 'No questions detected.'} accent={colors.sage} chartKind="bar"
          blurb="Question count comes from the saved transcript analysis."
        >
          <View style={styles.qRow}>
            <View style={styles.qBars}>
              <QBar label="Open" value={openQuestions} color={colors.sage} sub="questions" max={questionMax} />
              <QBar label="Closed" value={closedQuestions} color={colors.lavender} sub="questions" max={questionMax} />
            </View>
            <View style={styles.qAnalysis}>
              <View style={[styles.miniCard, { backgroundColor: 'rgba(151,168,135,0.10)' }]}>
                <Body style={styles.miniLabel}>Total asked</Body>
                <View style={styles.miniRow}>
                  <Serif style={[styles.miniNum, { color: colors.sage }]}>{questions}</Serif>
                  <Body style={styles.miniUnit}>questions</Body>
                </View>
                <View style={styles.miniBar}>
                  <View style={{ width: `${questions ? (openQuestions / questions) * 100 : 0}%`, backgroundColor: colors.sage }} />
                  <View style={{ flex: 1, backgroundColor: 'rgba(151,168,135,0.25)' }} />
                </View>
              </View>
              <View style={[styles.miniCard, { backgroundColor: 'rgba(208,136,102,0.08)' }]}>
                <Body style={styles.miniLabel}>Conversation rate</Body>
                <View style={styles.miniRow}>
                  <Serif style={[styles.miniNum, { color: colors.sage }]}>{(questions / Math.max(durationMin, 1)).toFixed(1)}</Serif>
                  <Body style={styles.miniUnit}>questions / min</Body>
                </View>
                <SerifItalic style={styles.miniItalic}>Based on this debrief's transcript.</SerifItalic>
              </View>
            </View>
          </View>
        </ExpandableMetric>

        {/* 3. Turn-floor offset */}
        <ExpandableMetric
          eyebrow="Turn-floor offset" value={hasTurnOffset ? `+${turnOffset}` : '—'} unit={hasTurnOffset ? 'ms avg' : 'not saved'}
          summary={hasTurnOffset ? `${interruptions} interruptions estimated across ${Math.round(durationMin)} minutes.` : 'Turn timing was not saved for this debrief.'} accent={colors.terracotta} chartKind="line"
          blurb={hasTurnOffset ? 'Approximate turn timing based on detected speaker changes in this saved debrief.' : 'New recordings save turn timing from detected speaker changes.'}
        >
          {hasTurnOffset ? (
            <>
              <TurnOffsetChart data={turnOffsetData} width={300} height={170} />
              <OffsetZoneLegend />
            </>
          ) : (
            <Body style={styles.unavailableText}>Record or import a new conversation to see turn timing here.</Body>
          )}
        </ExpandableMetric>

        {/* 4. Energy mirroring */}
        <ExpandableMetric
          eyebrow="Energy mirroring" value={hasEnergySignals ? `${energyScore}%` : '—'} unit={hasEnergySignals ? 'in tune' : 'not saved'}
          summary={hasEnergySignals ? 'Calculated from saved vocal energy, pitch, and pace signals.' : 'Energy signals were not saved for this debrief.'} accent={colors.lavender} chartKind="line"
          blurb={hasEnergySignals ? 'This is calculated from the audio saved for this debrief: volume convergence, pitch similarity, pace, and turn balance.' : 'New recordings save the vocal signals needed for this chart.'}
        >
          {hasEnergySignals ? (
            <>
              <View style={styles.energyRow}>
                <RingMeter value={energyScore} size={56} stroke={5} color={colors.lavender} label={String(energyScore)} />
                <View style={{ flex: 1 }}>
                  <View style={styles.energyChartRow}>
                    <View style={styles.energyYAxis}>
                      <Body style={styles.energyAxisLabel}>hi</Body>
                      <Body style={styles.energyAxisLabel}>lo</Body>
                    </View>
                    <View style={styles.energyChart}>
                      <EnergyWave you={selected.stats.energySeriesUser} them={selected.stats.energySeriesOther} width={180} height={62} />
                      <View style={styles.energyXAxis}>
                        <Body style={styles.energyXLabel}>0:00</Body>
                        <Body style={[styles.energyXLabel, { letterSpacing: 1, textTransform: 'uppercase' }]}>energy · time</Body>
                        <Body style={styles.energyXLabel}>{Math.round(durationMin)}:00</Body>
                      </View>
                    </View>
                  </View>
                  <View style={styles.energyPips}>
                    <Pip color={colors.terracotta}>You</Pip>
                    <Pip color={colors.lavender}>Them</Pip>
                  </View>
                </View>
              </View>
              <View style={styles.syncSection}>
                <Body style={styles.syncHead}>Match by dimension</Body>
                <SyncBars dims={[
                  { label: 'Volume convergence', you: energyAxes[0], them: 1 },
                  { label: 'Pitch', you: energyAxes[1], them: 1 },
                  { label: 'Speech rate', you: energyAxes[2], them: 1 },
                ]} />
              </View>
            </>
          ) : (
            <Body style={styles.unavailableText}>Record or import a new conversation to see vocal energy matching here.</Body>
          )}
        </ExpandableMetric>

        {/* 5. Linguistic style match */}
        <ExpandableMetric
          eyebrow="Linguistic style match" value={hasLsmSignals ? lsmScore.toFixed(2) : '—'} unit={hasLsmSignals ? 'LSM score' : 'not saved'}
          summary={hasLsmSignals ? (lsmScore >= 0.7 ? 'High style alignment.' : 'Alignment is still forming.') : 'Style-match signals were not saved for this debrief.'} accent={colors.lavender} chartKind="radar"
          blurb={hasLsmSignals ? 'Calculated from saved function-word patterns and vocal mirroring signals for this debrief, compared with a conversational reference profile.' : 'New recordings save the signals needed for style-match scoring.'}
        >
          {hasLsmSignals ? (
            <>
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <RadarChart
                  size={240} rings={4}
                  axes={LSM_AXES.map((axis) => ({ label: axis.label }))}
                  series={[
                    { values: lsmUserValues, color: colors.terracotta, fill: 0.32, strokeWidth: 1.8 },
                    { values: lsmReferenceValues, color: colors.lavender, fill: 0.32, strokeWidth: 1.8 },
                  ]}
                />
              </View>
              <View style={styles.lsmLegend}>
                <View style={styles.lsmLegendItem}>
                  <View style={[styles.lsmSwatch, { backgroundColor: colors.terracotta, borderColor: colors.terracotta }]} />
                  <Body style={styles.lsmLegendText}>you</Body>
                </View>
                <View style={styles.lsmLegendItem}>
                  <View style={[styles.lsmSwatch, { backgroundColor: colors.lavender, borderColor: colors.lavender }]} />
                  <Body style={styles.lsmLegendText}>reference</Body>
                </View>
                <Body style={styles.lsmLegendText}>overlap = alignment</Body>
              </View>
              <View style={styles.lsmScore}>
                <View style={styles.lsmScoreHead}>
                  <Body style={{ fontSize: 11, color: colors.ink }}>Overall LSM</Body>
                  <Serif style={{ fontSize: 16, color: colors.lavender }}>{lsmScore.toFixed(2)}</Serif>
                </View>
                <View style={styles.lsmTrack}>
                  <View style={styles.lsmBand} />
                  <View style={[styles.lsmDot, { left: `${Math.round(lsmScore * 100)}%` }]} />
                </View>
                <View style={styles.lsmScaleRow}>
                  <Body style={styles.lsmScaleText}>0.0 · no match</Body>
                  <Body style={[styles.lsmScaleText, { color: colors.sage, fontFamily: fonts.bodySemibold }]}>0.70+ high LSM</Body>
                  <Body style={styles.lsmScaleText}>1.0 · perfect</Body>
                </View>
              </View>
            </>
          ) : (
            <Body style={styles.unavailableText}>Record or import a new conversation to see style matching here.</Body>
          )}
        </ExpandableMetric>

        {/* 6. Vocabulary */}
        <ExpandableMetric
          eyebrow="Vocabulary" value={`${uniquePct}%`} unit="unique / spoken"
          summary={`${uniqueWords.toLocaleString('en-US')} unique across ${totalWords.toLocaleString('en-US')} words.`} accent={colors.sand} chartKind="bar"
          blurb="Vocabulary richness — how many distinct words you used vs how many you spoke. Below, the five most-used lexical paddings: fillers, hedges, and empty qualifiers that buy time without adding meaning."
        >
          <SerifItalic style={styles.vocabLine}>{uniqueWords.toLocaleString('en-US')} unique words across {totalWords.toLocaleString('en-US')} spoken.</SerifItalic>
          <View>
            <View style={styles.vocabHead}>
              <Eyebrow>Top lexical paddings</Eyebrow>
              <Body style={styles.vocabHeadMeta}>{fillerTotal} total</Body>
            </View>
            <FillerBars items={fillers} />
          </View>
        </ExpandableMetric>

        <View style={{ height: 8 }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 4 },
  emptyState: { paddingHorizontal: 26, paddingTop: 80, alignItems: 'center' },
  emptyTitle: { color: colors.ink, fontSize: 24, lineHeight: 28, textAlign: 'center' },
  emptyBody: { color: colors.muted, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 10, maxWidth: 280 },
  titleBlock: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 6 },
  bigTitle: { fontSize: 30, lineHeight: 32, color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 6, letterSpacing: 0.4 },
  reflectWrap: { paddingHorizontal: 18, paddingTop: 14 },
  reflectText: { fontSize: 17, lineHeight: 23, color: colors.ink },
  patterns: { paddingHorizontal: 18, paddingTop: 18 },
  patternsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  tapHint: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.6 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  pipNote: { fontSize: 11.5, color: colors.muted, marginTop: 2 },

  // Questions
  qRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  qBars: { flexDirection: 'row', gap: 8, width: 128 },
  qBarTrack: { height: 130, backgroundColor: 'rgba(42,37,32,0.04)', borderRadius: 10, overflow: 'hidden', justifyContent: 'flex-end' },
  qBarFill: { width: '100%', borderRadius: 10, alignItems: 'center', paddingTop: 8 },
  qBarVal: { fontSize: 22, color: '#FBF6EA', lineHeight: 24 },
  qBarLabel: { fontSize: 10, color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', lineHeight: 14 },
  qBarSub: { fontSize: 9, color: colors.muted, opacity: 0.7 },
  qAnalysis: { flex: 1, gap: 8, height: 130 },
  miniCard: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, flex: 1, justifyContent: 'center' },
  miniLabel: { fontSize: 9.5, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  miniRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 3 },
  miniNum: { fontSize: 17, lineHeight: 18 },
  miniUnit: { fontSize: 10, color: colors.muted },
  miniDotSep: { color: colors.hairline, marginHorizontal: 1 },
  miniBar: { height: 4, marginTop: 6, borderRadius: 999, backgroundColor: 'rgba(42,37,32,0.08)', overflow: 'hidden', flexDirection: 'row' },
  miniItalic: { fontSize: 11, color: colors.ink2, marginTop: 4, lineHeight: 14 },

  // Energy
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  energyChartRow: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  energyYAxis: { justifyContent: 'space-between', paddingVertical: 2 },
  energyAxisLabel: { fontSize: 8.5, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  energyChart: { flex: 1, borderLeftWidth: 1, borderLeftColor: 'rgba(42,37,32,0.12)', paddingLeft: 6 },
  energyXAxis: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  energyXLabel: { fontSize: 9, color: colors.muted, letterSpacing: 0.4 },
  energyPips: { flexDirection: 'row', gap: 12, marginTop: 8 },
  syncSection: { paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline, borderStyle: 'dashed' },
  syncHead: { fontSize: 10.5, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },

  // LSM
  lsmLegend: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 4, alignItems: 'center' },
  lsmLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lsmSwatch: { width: 14, height: 10, borderRadius: 2, opacity: 0.55, borderWidth: 1.5 },
  lsmLegendText: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.4 },
  lsmScore: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline, borderStyle: 'dashed' },
  lsmScoreHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  lsmTrack: { height: 10, backgroundColor: 'rgba(42,37,32,0.06)', borderRadius: 999, justifyContent: 'center' },
  lsmBand: { position: 'absolute', left: '70%', right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(151,168,135,0.2)', borderTopRightRadius: 999, borderBottomRightRadius: 999, borderWidth: 1, borderColor: 'rgba(151,168,135,0.33)' },
  lsmDot: { position: 'absolute', left: '83%', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.lavender },
  lsmScaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  lsmScaleText: { fontSize: 10, color: colors.muted, letterSpacing: 0.3 },

  // Vocabulary
  vocabLine: { fontSize: 13.5, color: colors.ink2, lineHeight: 20, marginBottom: 16 },
  unavailableText: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  vocabHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  vocabHeadMeta: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.6 },
});
