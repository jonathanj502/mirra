export interface ConversationStats {
  talkListenRatio: number;
  questionCount: number;
  openQuestionCount: number;
  closedQuestionCount: number;
  interruptionCount: number;
  averageTurnOffsetMs: number;
  turnOffsetSeries: { t: string; ms: number }[];
  sessionDurationMinutes: number;
  userSpeechDurationMinutes: number;
  otherSpeechDurationMinutes: number;
  estimatedWpm: number;
  energyScore: number;
  energyAxes: number[];
  energySeriesUser: number[];
  energySeriesOther: number[];
  lsmScore: number;
  lsmDimensionsUser: Record<string, number>;
  lsmDimensionsReference: Record<string, number>;
  totalWordCount: number;
  uniqueWordCount: number;
  vocabularyRichness: number;
  fillerCounts: FillerCount[];
  metadata: Record<string, unknown>;
}

export interface DebriefCard {
  id: string;
  sessionId: string;
  userId: string;
  createdAt: string;
  observation: string;
  patternToReduce: string;
  thingToTryNext: string;
  stats: ConversationStats;
  transcript?: string | null;
}

export interface UsageSummary {
  usedThisMonth: number;
  remaining: number;
  resetsAt: string;
}

export interface SessionResponse {
  debrief: DebriefCard;
  usedThisMonth: number;
  remaining: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  durationMinutes: number;
  talkListenPercent: number;
  questionCount: number;
  interruptionCount: number;
  energyScore: number;
  lsmScore: number;
  vocabularyRichness: number;
  tone: string;
  note: string;
}

export interface FillerCount {
  phrase: string;
  count: number;
}

export interface ProgressWeekSummary {
  weekKey: string;
  label: string;
  startsAt: string;
  endsAt: string;
  conversationCount: number;
  totalMinutes: number;
  dailyMinutes: number[];
  dailyQuestions: number[];
  dailyOpenQuestions: number[];
  dailyClosedQuestions: number[];
  dailyInterruptions: number[];
  averageSessionMinutes: number;
  talkListenPercent: number;
  averageQuestions: number;
  totalQuestions: number;
  totalOpenQuestions: number;
  totalClosedQuestions: number;
  interruptionCount: number;
  averageTurnOffsetMs: number;
  dailyTurnOffsets: (number | null)[];
  averageWpm: number;
  energyScore: number;
  energyAxes: number[];
  lsmAverage: number;
  vocabularyUniqueWords: number;
  vocabularyTotalWords: number;
  vocabularyRichness: number;
  topFillers: FillerCount[];
  wins: string[];
  nudges: string[];
  conversations: ConversationSummary[];
}

export interface ProgressSummary {
  generatedAt: string;
  currentWeekIndex: number;
  weeks: ProgressWeekSummary[];
}

export interface ProfileSummary {
  totalConversations: number;
  totalMinutes: number;
  averageQuestions: number;
  talkListenPercent: number;
  usedThisMonth: number;
  remaining: number;
  resetsAt: string;
}

export interface AccountExport {
  exportedAt: string;
  userId: string;
  profile: ProfileSummary;
  settings: UserSettings;
  debriefs: DebriefCard[];
}

export interface ReflectMessage {
  role: 'assistant' | 'user';
  content: string;
}

export type WeeklySummaryDay = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type WeeklySummaryTime = 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type CoachingTone = 'warm_reflective' | 'direct_practical' | 'curious_gentle';
export type CoachingDepth = 'quick' | 'balanced' | 'deep';

export interface UserSettings {
  notificationsEnabled: boolean;
  weeklySummaryDay: WeeklySummaryDay;
  weeklySummaryTime: WeeklySummaryTime;
  reflectionReminders: boolean;
  productUpdates: boolean;
  saveTranscripts: boolean;
  includeTranscriptInReflect: boolean;
  coachingTone: CoachingTone;
  coachingDepth: CoachingDepth;
}
