import { endpoint, parseResponse } from '@/api/http';
import {
  AccountExport,
  BillingStatus,
  ConversationSummary,
  DebriefCard,
  FillerCount,
  ProfileSummary,
  ProgressSummary,
  ProgressWeekSummary,
  ReflectMessage,
  SessionResponse,
  UserSettings,
  UsageSummary,
} from '@/models/debrief';

type RawStats = {
  talk_listen_ratio: number;
  question_count: number;
  open_question_count?: number;
  closed_question_count?: number;
  interruption_count: number;
  average_turn_offset_ms?: number;
  turn_offset_series?: { t: string; ms: number }[];
  session_duration_minutes: number;
  user_speech_duration_minutes: number;
  other_speech_duration_minutes?: number;
  estimated_wpm: number;
  energy_score?: number;
  energy_axes?: number[];
  energy_series_user?: number[];
  energy_series_other?: number[];
  lsm_score?: number;
  lsm_dimensions_user?: Record<string, number>;
  lsm_dimensions_reference?: Record<string, number>;
  total_word_count?: number;
  unique_word_count?: number;
  vocabulary_richness?: number;
  filler_counts?: RawFillerCount[];
  metadata?: Record<string, unknown>;
};

type RawDebrief = {
  id: string;
  session_id: string;
  user_id: string;
  created_at: string;
  observation: string;
  pattern_to_reduce: string;
  thing_to_try_next: string;
  stats: RawStats;
  transcript?: string | null;
};

type RawUsage = {
  used_this_month: number;
  remaining: number;
  resets_at: string;
};

type RawConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  duration_minutes: number;
  talk_listen_percent: number;
  question_count: number;
  interruption_count: number;
  energy_score?: number;
  lsm_score?: number;
  vocabulary_richness?: number;
  tone: string;
  note: string;
};

type RawFillerCount = {
  phrase: string;
  count: number;
};

type RawProgressWeek = {
  week_key: string;
  label: string;
  starts_at: string;
  ends_at: string;
  conversation_count: number;
  total_minutes: number;
  daily_minutes: number[];
  daily_questions: number[];
  daily_open_questions?: number[];
  daily_closed_questions?: number[];
  daily_interruptions: number[];
  average_session_minutes: number;
  talk_listen_percent: number;
  average_questions: number;
  total_questions: number;
  total_open_questions?: number;
  total_closed_questions?: number;
  interruption_count: number;
  average_turn_offset_ms?: number;
  daily_turn_offsets?: (number | null)[];
  average_wpm: number;
  energy_score?: number;
  energy_axes?: number[];
  lsm_average?: number;
  vocabulary_unique_words?: number;
  vocabulary_total_words?: number;
  vocabulary_richness?: number;
  top_fillers: RawFillerCount[];
  wins: string[];
  nudges: string[];
  conversations: RawConversationSummary[];
};

type RawProgressSummary = {
  generated_at: string;
  current_week_index: number;
  weeks: RawProgressWeek[];
};

type RawProfileSummary = {
  total_conversations: number;
  total_minutes: number;
  average_questions: number;
  talk_listen_percent: number;
  used_this_month: number;
  remaining: number;
  resets_at: string;
};

type RawUserSettings = {
  notifications_enabled: boolean;
  weekly_summary_day: UserSettings['weeklySummaryDay'];
  weekly_summary_time: UserSettings['weeklySummaryTime'];
  reflection_reminders: boolean;
  product_updates: boolean;
  save_transcripts: boolean;
  include_transcript_in_reflect: boolean;
  coaching_tone: UserSettings['coachingTone'];
  coaching_depth: UserSettings['coachingDepth'];
};

type RawBillingStatus = {
  plan: BillingStatus['plan'];
  status: string;
  is_pro: boolean;
  free_conversations_remaining: number;
  current_period_end?: string | null;
  trial_end?: string | null;
  cancel_at_period_end: boolean;
  stripe_configured: boolean;
  checkout_available: boolean;
  portal_available: boolean;
};

type RawAccountExport = {
  exported_at: string;
  user_id: string;
  profile: RawProfileSummary;
  settings: RawUserSettings;
  billing: RawBillingStatus;
  debriefs: RawDebrief[];
};

function camelizeKeys<T>(raw: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return result as T;
}

function toStats(raw: RawStats) {
  return {
    talkListenRatio: raw.talk_listen_ratio,
    questionCount: raw.question_count,
    openQuestionCount: raw.open_question_count ?? 0,
    closedQuestionCount: raw.closed_question_count ?? 0,
    interruptionCount: raw.interruption_count,
    averageTurnOffsetMs: raw.average_turn_offset_ms ?? (raw.interruption_count > 0 ? 160 : 220),
    turnOffsetSeries: raw.turn_offset_series ?? [],
    sessionDurationMinutes: raw.session_duration_minutes,
    userSpeechDurationMinutes: raw.user_speech_duration_minutes,
    otherSpeechDurationMinutes: raw.other_speech_duration_minutes ?? Math.max(0, raw.session_duration_minutes - raw.user_speech_duration_minutes),
    estimatedWpm: raw.estimated_wpm,
    energyScore: raw.energy_score ?? 0,
    energyAxes: raw.energy_axes ?? [0, 0, 0],
    energySeriesUser: raw.energy_series_user ?? [],
    energySeriesOther: raw.energy_series_other ?? [],
    lsmScore: raw.lsm_score ?? 0,
    lsmDimensionsUser: raw.lsm_dimensions_user ?? {},
    lsmDimensionsReference: raw.lsm_dimensions_reference ?? {},
    totalWordCount: raw.total_word_count ?? 0,
    uniqueWordCount: raw.unique_word_count ?? 0,
    vocabularyRichness: raw.vocabulary_richness ?? 0,
    fillerCounts: raw.filler_counts?.map(toFillerCount) ?? [],
    metadata: raw.metadata ?? {},
  };
}

export function toDebrief(raw: RawDebrief): DebriefCard {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    userId: raw.user_id,
    createdAt: raw.created_at,
    observation: raw.observation,
    patternToReduce: raw.pattern_to_reduce,
    thingToTryNext: raw.thing_to_try_next,
    stats: toStats(raw.stats),
    transcript: raw.transcript,
  };
}

function toUsage(raw: RawUsage): UsageSummary {
  return camelizeKeys<UsageSummary>(raw);
}

function toConversationSummary(raw: RawConversationSummary): ConversationSummary {
  return {
    id: raw.id,
    title: raw.title,
    createdAt: raw.created_at,
    durationMinutes: raw.duration_minutes,
    talkListenPercent: raw.talk_listen_percent,
    questionCount: raw.question_count,
    interruptionCount: raw.interruption_count,
    energyScore: raw.energy_score ?? 0,
    lsmScore: raw.lsm_score ?? 0,
    vocabularyRichness: raw.vocabulary_richness ?? 0,
    tone: raw.tone,
    note: raw.note,
  };
}

function toFillerCount(raw: RawFillerCount): FillerCount {
  return camelizeKeys<FillerCount>(raw);
}

function toProgressWeek(raw: RawProgressWeek): ProgressWeekSummary {
  return {
    weekKey: raw.week_key,
    label: raw.label,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    conversationCount: raw.conversation_count,
    totalMinutes: raw.total_minutes,
    dailyMinutes: raw.daily_minutes,
    dailyQuestions: raw.daily_questions,
    dailyOpenQuestions: raw.daily_open_questions ?? raw.daily_questions.map(() => 0),
    dailyClosedQuestions: raw.daily_closed_questions ?? raw.daily_questions.map(() => 0),
    dailyInterruptions: raw.daily_interruptions,
    averageSessionMinutes: raw.average_session_minutes,
    talkListenPercent: raw.talk_listen_percent,
    averageQuestions: raw.average_questions,
    totalQuestions: raw.total_questions,
    totalOpenQuestions: raw.total_open_questions ?? 0,
    totalClosedQuestions: raw.total_closed_questions ?? 0,
    interruptionCount: raw.interruption_count,
    averageTurnOffsetMs: raw.average_turn_offset_ms ?? 0,
    dailyTurnOffsets: raw.daily_turn_offsets ?? [null, null, null, null, null, null, null],
    averageWpm: raw.average_wpm,
    energyScore: raw.energy_score ?? 0,
    energyAxes: raw.energy_axes ?? [0, 0, 0],
    lsmAverage: raw.lsm_average ?? 0,
    vocabularyUniqueWords: raw.vocabulary_unique_words ?? 0,
    vocabularyTotalWords: raw.vocabulary_total_words ?? 0,
    vocabularyRichness: raw.vocabulary_richness ?? 0,
    topFillers: raw.top_fillers.map(toFillerCount),
    wins: raw.wins,
    nudges: raw.nudges,
    conversations: raw.conversations.map(toConversationSummary),
  };
}

function toProgressSummary(raw: RawProgressSummary): ProgressSummary {
  return {
    generatedAt: raw.generated_at,
    currentWeekIndex: raw.current_week_index,
    weeks: raw.weeks.map(toProgressWeek),
  };
}

function toProfileSummary(raw: RawProfileSummary): ProfileSummary {
  return camelizeKeys<ProfileSummary>(raw);
}

function toUserSettings(raw: RawUserSettings): UserSettings {
  return camelizeKeys<UserSettings>(raw);
}

function toBillingStatus(raw: RawBillingStatus): BillingStatus {
  return camelizeKeys<BillingStatus>(raw);
}

function toAccountExport(raw: RawAccountExport): AccountExport {
  return {
    exportedAt: raw.exported_at,
    userId: raw.user_id,
    profile: toProfileSummary(raw.profile),
    settings: toUserSettings(raw.settings),
    billing: toBillingStatus(raw.billing),
    debriefs: raw.debriefs.map(toDebrief),
  };
}

function toRawUserSettingsPatch(patch: Partial<UserSettings>): Partial<RawUserSettings> {
  const raw: Partial<RawUserSettings> = {};
  if (patch.notificationsEnabled !== undefined) raw.notifications_enabled = patch.notificationsEnabled;
  if (patch.weeklySummaryDay !== undefined) raw.weekly_summary_day = patch.weeklySummaryDay;
  if (patch.weeklySummaryTime !== undefined) raw.weekly_summary_time = patch.weeklySummaryTime;
  if (patch.reflectionReminders !== undefined) raw.reflection_reminders = patch.reflectionReminders;
  if (patch.productUpdates !== undefined) raw.product_updates = patch.productUpdates;
  if (patch.saveTranscripts !== undefined) raw.save_transcripts = patch.saveTranscripts;
  if (patch.includeTranscriptInReflect !== undefined) raw.include_transcript_in_reflect = patch.includeTranscriptInReflect;
  if (patch.coachingTone !== undefined) raw.coaching_tone = patch.coachingTone;
  if (patch.coachingDepth !== undefined) raw.coaching_depth = patch.coachingDepth;
  return raw;
}

export async function fetchUsage(token: string): Promise<UsageSummary> {
  const raw = await fetch(endpoint('/usage'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawUsage>(r));
  return toUsage(raw);
}

export async function fetchDebriefs(token: string): Promise<DebriefCard[]> {
  const raw = await fetch(endpoint('/debriefs'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawDebrief[]>(r));
  return raw.map(toDebrief);
}

export async function fetchDebrief(token: string, id: string): Promise<DebriefCard> {
  const raw = await fetch(endpoint(`/debriefs/${encodeURIComponent(id)}`), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawDebrief>(r));
  return toDebrief(raw);
}

export async function fetchProgressSummary(token: string): Promise<ProgressSummary> {
  const raw = await fetch(endpoint('/analytics/progress'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawProgressSummary>(r));
  return toProgressSummary(raw);
}

export async function fetchProfileSummary(token: string): Promise<ProfileSummary> {
  const raw = await fetch(endpoint('/profile/summary'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawProfileSummary>(r));
  return toProfileSummary(raw);
}

export async function exportAccountData(token: string): Promise<AccountExport> {
  const raw = await fetch(endpoint('/account/export'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawAccountExport>(r));
  return toAccountExport(raw);
}

export async function fetchUserSettings(token: string): Promise<UserSettings> {
  const raw = await fetch(endpoint('/settings'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawUserSettings>(r));
  return toUserSettings(raw);
}

export async function fetchBillingStatus(token: string): Promise<BillingStatus> {
  const raw = await fetch(endpoint('/billing/status'), {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<RawBillingStatus>(r));
  return toBillingStatus(raw);
}

export async function createBillingCheckoutSession(token: string): Promise<string> {
  const raw = await fetch(endpoint('/billing/checkout'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<{ url: string }>(r));
  return raw.url;
}

export async function createBillingPortalSession(token: string): Promise<string> {
  const raw = await fetch(endpoint('/billing/portal'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => parseResponse<{ url: string }>(r));
  return raw.url;
}

export async function updateUserSettings(token: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const raw = await fetch(endpoint('/settings'), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toRawUserSettingsPatch(patch)),
  }).then((r) => parseResponse<RawUserSettings>(r));
  return toUserSettings(raw);
}

export async function sendReflection(
  token: string,
  payload: { conversationId?: string; prompt: string; messages: ReflectMessage[] }
): Promise<string> {
  const raw = await fetch(endpoint('/reflect'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: payload.conversationId,
      prompt: payload.prompt,
      messages: payload.messages,
    }),
  }).then((r) => parseResponse<{ reply: string; used_model: boolean }>(r));
  return raw.reply;
}

export async function uploadSession(
  token: string,
  audio: { uri: string; name: string; type: string },
  metadata: { title?: string; clientDurationSeconds?: number }
): Promise<SessionResponse> {
  const form = new FormData();
  if (audio.uri.startsWith('blob:') || audio.uri.startsWith('data:')) {
    const blob = await fetch(audio.uri).then((response) => response.blob());
    form.append('audio', blob, audio.name);
  } else {
    form.append('audio', audio as unknown as Blob);
  }
  form.append('started_at', new Date().toISOString());
  if (metadata.title) form.append('title', metadata.title);
  if (metadata.clientDurationSeconds != null) {
    form.append('client_duration_seconds', String(metadata.clientDurationSeconds));
  }

  // 2-retry on network-level failure only (mirrors the backend's claude.py convention);
  // HTTP error responses reach parseResponse unretried — a 4xx won't succeed on retry.
  let response!: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(endpoint('/sessions'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
  const raw = await parseResponse<{ debrief: RawDebrief; used_this_month: number; remaining: number }>(response);

  return {
    debrief: toDebrief(raw.debrief),
    usedThisMonth: raw.used_this_month,
    remaining: raw.remaining,
  };
}
