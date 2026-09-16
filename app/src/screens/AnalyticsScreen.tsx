// Insights · single conversation deep-dive.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Card, Pip } from '@/components/ui';
import { Body, Serif, SerifItalic, Eyebrow } from '@/components/Typography';
import { Icon } from '@/components/Icon';
import { FloatingTabBar, TabId } from '@/components/FloatingTabBar';
import { ExpandableMetric } from '@/components/ExpandableMetric';
import { ReflectCTA } from '@/components/ReflectCTA';
import { Donut, RadarChart, TurnOffsetChart, EnergyWave } from '@/components/charts';
import { FillerBars, OffsetZoneLegend } from '@/components/meters';
import { colors, fonts } from '@/theme/tokens';
import { useDebriefs, toConversationListItem } from '@/hooks/useDebriefs';
import { useAuth } from '@/auth/AuthContext';
import { deleteDebrief, fetchDebrief } from '@/api/client';
import { friendlyErrorMessage } from '@/api/http';
import { DebriefCard } from '@/models/debrief';
import { talkListenPercent } from '@/utils/talkListen';
import { coachingGoalLabel } from '@/data/coachingGoals';

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

// Questions card — vertical bar with count baked inside.
function QBar({ label, value, color, sub, max }: { label: string; value: number; color: string; sub: string; max: number }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={styles.qBarTrack}>
        <View style={[styles.qBarFill, { height: `${(value / max) * 100}%`, backgroundColor: color }]}>
        </View>
        <Serif style={[styles.qBarVal, { position: 'absolute', bottom: 8, alignSelf: 'center', color: value ? '#FBF6EA' : colors.ink }]}>{value}</Serif>
      </View>
      <Body style={styles.qBarLabel}>
        {label}{'\n'}<Body style={styles.qBarSub}>{sub}</Body>
      </Body>
    </View>
  );
}

export function AnalyticsScreen() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.min(300, Math.max(120, width - 96));
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { accessToken } = useAuth();
  const { debriefs, loading } = useDebriefs();
  const [remoteDebrief, setRemoteDebrief] = useState<DebriefCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInFlight = useRef(false);
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

  const selected = id
    ? localDebrief ?? (remoteDebrief?.id === id ? remoteDebrief : null)
    : debriefs[0] ?? null;

  async function removeConversation(conversationId: string) {
    if (deleteInFlight.current || !accessToken) return;
    deleteInFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDebrief(accessToken, conversationId);
      router.replace('/insights');
    } catch (err) {
      setDeleteError(friendlyErrorMessage(err, 'Could not delete conversation. Please try again.'));
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  }

  function confirmDelete() {
    if (!selected || deleting) return;
    const conversationId = selected.id;
    const message = 'Permanently delete this conversation, including its debrief and saved transcript? This cannot be undone.';
    if (Platform.OS === 'web') {
      if (window.confirm(message)) void removeConversation(conversationId);
    } else {
      Alert.alert('Delete conversation?', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void removeConversation(conversationId); } },
      ]);
    }
  }

  if (!selected) {
    return (
      <Screen topOffset={50}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Icon.back color={colors.muted} /></Pressable>
          <Eyebrow>Conversation</Eyebrow>
          <View style={{ width: 44 }} />
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
  const goalLabel = coachingGoalLabel(selected.stats.metadata.coaching_goal);
  const talkPct = talkListenPercent(selected.stats.talkListenRatio);
  const listenPct = 100 - talkPct;
  const questions = selected.stats.questionCount;
  const interruptions = selected.stats.interruptionCount;
  const durationMin = selected.stats.sessionDurationMinutes;
  const userSpeechMin = selected.stats.userSpeechDurationMinutes;
  const otherSpeechMin = selected.stats.otherSpeechDurationMinutes;
  const openQuestions = selected.stats.openQuestionCount;
  const closedQuestions = selected.stats.closedQuestionCount;
  const questionMax = Math.max(openQuestions, closedQuestions, 1) * 1.15;
  const uniqueWords = selected.stats.uniqueWordCount;
  const totalWords = selected.stats.totalWordCount;
  const repeatedWords = selected.stats.repeatedWords;
  const uniquePct = totalWords > 0 ? Math.round((uniqueWords / totalWords) * 100) : 0;
  const fillers = selected.stats.fillerCounts;
  const fillerTotal = fillers.reduce((sum, item) => sum + item.count, 0);
  const turnOffset = selected.stats.averageTurnOffsetMs;
  const turnOffsetData = selected.stats.turnOffsetSeries;
  const hasTurnOffset = turnOffsetData.length > 0;
  const hasEnergySignals = selected.stats.energySeriesUser.some(value => value > 0) && selected.stats.energySeriesUser.length > 1 && selected.stats.energySeriesOther.length > 1;
  const hasLsmSignals = selected.stats.lsmScore > 0;
  const lsmScore = selected.stats.lsmScore;
  const lsmUserValues = LSM_AXES.map((axis) => selected.stats.lsmDimensionsUser[axis.key] ?? 0);
  const lsmReferenceValues = LSM_AXES.map((axis) => selected.stats.lsmDimensionsReference[axis.key] ?? 0);
  const goTab = (id: TabId) => router.navigate(TAB_HREF[id]);

  return (
    <Screen topOffset={50} error={deleteError} tabBar={<FloatingTabBar active="insights" onPress={goTab} />}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Icon.back color={colors.muted} /></Pressable>
        <Eyebrow>Conversation</Eyebrow>
        <Pressable
          onPress={confirmDelete}
          disabled={deleting || !accessToken}
          accessibilityRole="button"
          accessibilityLabel="Delete conversation"
          aria-disabled={deleting || !accessToken} aria-busy={deleting}
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <Body style={{ color: colors.coral, fontSize: 13 }}>{deleting ? 'Deleting…' : 'Delete'}</Body>
        </Pressable>
      </View>

      <View style={styles.titleBlock}>
        <Serif style={styles.bigTitle}>
          {title}
        </Serif>
        <Body style={styles.meta}>{meta}</Body>
        <Body style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 }}>Estimates, not a judgment. Mirra assumes the loudest speaker is you; check that this matches your conversation.</Body>
      </View>

      {/* Warm reflection */}
      <View style={styles.reflectWrap}>
        <Card tone="card-2" style={{ padding: 18 }}>
          {goalLabel ? <Body style={{ color: colors.terracotta, fontSize: 12, marginBottom: 12 }}>For your goal: {goalLabel}</Body> : null}
          <Eyebrow style={{ marginBottom: 8 }}>A few things I noticed</Eyebrow>
          <Serif style={styles.reflectText}>
            {observation}
          </Serif>
          <Body style={{ color: colors.muted, marginTop: 12 }}>{pattern}</Body>
          <Eyebrow style={{ marginTop: 18, marginBottom: 6 }}>One thing to try</Eyebrow>
          <SerifItalic style={[styles.reflectText, { color: colors.terracotta }]}>{next}</SerifItalic>
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
          eyebrow="Speaking share" value={userSpeechMin + otherSpeechMin > 0 ? `${talkPct} / ${listenPct}` : 'Unavailable'} unit="you / others"
          summary="Estimated speaking time. No single ratio fits every conversation." accent={colors.terracotta} chartKind="donut" defaultOpen
        >
          <View style={styles.rowCenter}>
            <Donut size={130} stroke={20} segments={[{ value: talkPct, color: colors.terracotta }, { value: listenPct, color: colors.sage }]} centerLabel={`${talkPct}%`} centerSub="you" />
            <View style={{ gap: 10, flex: 1 }}>
              <View>
                <Pip color={colors.terracotta}>You · {Math.round(userSpeechMin)} min</Pip>
                <Body style={styles.pipNote}>Estimated from detected speech segments</Body>
              </View>
              <View>
                <Pip color={colors.sage}>Others · {Math.round(otherSpeechMin)} min</Pip>
                <Body style={styles.pipNote}>Speaking time does not measure listening.</Body>
              </View>
            </View>
          </View>
        </ExpandableMetric>

        {/* 2. Questions */}
        <ExpandableMetric
          eyebrow="Questions" value={String(questions)} unit="asked"
          summary={questions > 0 ? `${questions} questions detected.` : 'No questions detected.'} accent={colors.sage} chartKind="bar"
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
          eyebrow="Turn-taking" value={hasTurnOffset ? `${turnOffset > 0 ? '+' : ''}${turnOffset}` : 'Unavailable'} unit={hasTurnOffset ? 'ms avg' : ''}
          summary={hasTurnOffset ? `${interruptions} overlapping starts by you estimated across ${Math.round(durationMin)} minutes.` : 'Not enough saved speaker changes to estimate timing.'} accent={colors.terracotta} chartKind="line"
          blurb={hasTurnOffset ? 'Approximate turn timing based on detected speaker changes in this saved debrief.' : 'New recordings save turn timing from detected speaker changes.'}
        >
          {hasTurnOffset ? (
            <>
              <TurnOffsetChart data={turnOffsetData} width={chartWidth} height={170} />
              <OffsetZoneLegend />
            </>
          ) : (
            <Body style={styles.unavailableText}>Record or import a new conversation to see turn timing here.</Body>
          )}
        </ExpandableMetric>

        {/* Vocal measurements are descriptive, not a score of social success. */}
        <ExpandableMetric
          eyebrow="Vocal energy" value={selected.stats.estimatedWpm > 0 ? Math.round(selected.stats.estimatedWpm) : 'Unavailable'} unit={selected.stats.estimatedWpm > 0 ? 'your words / min' : ''}
          summary="Your recorded volume, pitch, and speaking pace." accent={colors.lavender} chartKind="line"
          blurb="Volume is the recorded signal level in dBFS, not room loudness. Microphone distance affects it. Pitch is estimated from sampled speech; pace uses detected speaking time. These are not targets."
        >
          {hasEnergySignals ? (
            <>
              <EnergyWave you={selected.stats.energySeriesUser} them={selected.stats.energySeriesOther} width={chartWidth} height={80} />
              <View style={styles.energyXAxis}>
                <Body style={styles.energyXLabel}>Start</Body>
                <Body style={styles.energyXLabel}>Relative variation</Body>
                <Body style={styles.energyXLabel}>End</Body>
              </View>
              <View style={styles.energyPips}>
                <Pip color={colors.terracotta}>You</Pip>
                <Pip color={colors.lavender}>Others</Pip>
              </View>
              <Body style={styles.pipNote}>Each line is scaled separately to show changes over the recording.</Body>
            </>
          ) : <Body style={styles.unavailableText}>No vocal energy timeline saved for this conversation.</Body>}
          <View style={styles.syncSection}>
            {[
              { label: 'Pace', unit: 'words/min', you: selected.stats.estimatedWpm || null, others: selected.stats.otherEstimatedWpm },
              { label: 'Recorded volume', unit: 'dBFS', you: selected.stats.userVolumeDbfs, others: selected.stats.otherVolumeDbfs },
              { label: 'Pitch', unit: 'Hz', you: selected.stats.userPitchHz, others: selected.stats.otherPitchHz },
            ].map(metric => (
              <View key={metric.label} style={{ marginBottom: 14 }}>
                <Body style={styles.syncHead}>{metric.label}</Body>
                <Body style={styles.pipNote}>You: {metric.you == null ? 'Unavailable' : `${metric.you} ${metric.unit}`}</Body>
                <Body style={styles.pipNote}>Others: {metric.others == null ? 'Unavailable' : `${metric.others} ${metric.unit}`}</Body>
              </View>
            ))}
          </View>
        </ExpandableMetric>

        {/* 5. Linguistic style match */}
        <ExpandableMetric
          eyebrow="Language reference" value={hasLsmSignals ? lsmScore.toFixed(2) : 'Unavailable'} unit={hasLsmSignals ? 'estimate' : ''}
          summary="Function-word use compared with a fixed reference." accent={colors.lavender} chartKind="radar"
          blurb="This experimental index uses a fixed reference and acoustic similarity. It does not compare your words with the other speakers or measure connection."
        >
          {hasLsmSignals ? (
            <>
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <RadarChart
                  size={Math.min(240, chartWidth)} rings={4}
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
                <Body style={styles.lsmLegendText}>Function-word patterns</Body>
              </View>
              <View style={styles.lsmScore}>
                <View style={styles.lsmScoreHead}>
                  <Body style={{ fontSize: 11, color: colors.ink }}>Reference index</Body>
                  <Serif style={{ fontSize: 16, color: colors.lavender }}>{lsmScore.toFixed(2)}</Serif>
                </View>
                <View style={styles.lsmTrack}>
                  <View style={[styles.lsmDot, { left: `${Math.round(lsmScore * 100)}%` }]} />
                </View>
                <View style={styles.lsmScaleRow}>
                  <Body style={styles.lsmScaleText}>0.0</Body>
                  <Body style={styles.lsmScaleText}>Not a target</Body>
                  <Body style={styles.lsmScaleText}>1.0</Body>
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
        >
          <SerifItalic style={styles.vocabLine}>{uniqueWords.toLocaleString('en-US')} unique words across {totalWords.toLocaleString('en-US')} spoken.</SerifItalic>
          <View>
            <View style={styles.vocabHead}>
              <Eyebrow>Most repeated words</Eyebrow>
            </View>
            {repeatedWords?.length ? <FillerBars items={repeatedWords} /> : (
              <Body style={styles.pipNote}>{repeatedWords == null ? 'Word frequencies were not saved for this conversation.' : 'No repeated words detected.'}</Body>
            )}
            <Body style={styles.pipNote}>Up to ten words from your estimated speech. Repetition can be useful; this is not a vocabulary score.</Body>
          </View>
        </ExpandableMetric>

        <ExpandableMetric
          eyebrow="Filler words" value={fillerTotal} unit="possible uses"
          summary="Words and phrases worth considering in context." accent={colors.sand} chartKind="bar"
          blurb="These are phrase matches, not a judgment. Words such as like and right often carry meaning."
        >
          {fillers.length ? <FillerBars items={fillers} /> : <Body style={styles.pipNote}>No possible filler phrases detected.</Body>}
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
  qRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' },
  qBars: { flexDirection: 'row', gap: 8, minWidth: 128, flex: 1 },
  qBarTrack: { height: 130, backgroundColor: 'rgba(42,37,32,0.04)', borderRadius: 10, overflow: 'hidden', justifyContent: 'flex-end' },
  qBarFill: { width: '100%', borderRadius: 10, alignItems: 'center', paddingTop: 8 },
  qBarVal: { fontSize: 22, color: '#FBF6EA', lineHeight: 24 },
  qBarLabel: { fontSize: 10, color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', lineHeight: 14 },
  qBarSub: { fontSize: 9, color: colors.muted },
  qAnalysis: { flex: 1, minWidth: 112, gap: 8, minHeight: 130 },
  miniCard: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, flex: 1, justifyContent: 'center' },
  miniLabel: { fontSize: 9.5, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  miniRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 3 },
  miniNum: { fontSize: 17, lineHeight: 18 },
  miniUnit: { fontSize: 10, color: colors.muted },
  miniBar: { height: 4, marginTop: 6, borderRadius: 999, backgroundColor: 'rgba(42,37,32,0.08)', overflow: 'hidden', flexDirection: 'row' },
  miniItalic: { fontSize: 11, color: colors.ink2, marginTop: 4, lineHeight: 14 },

  // Energy
  energyXAxis: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  energyXLabel: { fontSize: 9, color: colors.muted, letterSpacing: 0.4 },
  energyPips: { flexDirection: 'row', gap: 12, marginTop: 8 },
  syncSection: { paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline, borderStyle: 'dashed' },
  syncHead: { fontSize: 10.5, color: colors.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },

  // LSM
  lsmLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, marginTop: 4, alignItems: 'center' },
  lsmLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lsmSwatch: { width: 14, height: 10, borderRadius: 2, opacity: 0.55, borderWidth: 1.5 },
  lsmLegendText: { fontSize: 10.5, color: colors.muted, letterSpacing: 0.4 },
  lsmScore: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline, borderStyle: 'dashed' },
  lsmScoreHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  lsmTrack: { height: 10, backgroundColor: 'rgba(42,37,32,0.06)', borderRadius: 999, justifyContent: 'center' },
  lsmDot: { position: 'absolute', left: '83%', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.lavender },
  lsmScaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  lsmScaleText: { fontSize: 10, color: colors.muted, letterSpacing: 0.3 },

  // Vocabulary
  vocabLine: { fontSize: 13.5, color: colors.ink2, lineHeight: 20, marginBottom: 16 },
  unavailableText: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  vocabHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
});
