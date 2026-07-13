import { ConversationSummary } from '@/models/debrief';
import { formatConversationWhen, formatDuration } from '@/utils/timeFormat';

export interface ConvListItem {
  id: string;
  title: string;
  when: string;
  duration: string;
  tone: string;
  note: string;
}

export function toConvListItem(conversation: ConversationSummary): ConvListItem {
  return {
    id: conversation.id,
    title: conversation.title,
    when: formatConversationWhen(conversation.createdAt),
    duration: formatDuration(Math.round(conversation.durationMinutes * 60)),
    tone: conversation.tone,
    note: conversation.note,
  };
}

export interface OffsetPoint {
  t: string;
  ms: number | null;
}

export interface LsmConv {
  name: string;
  score: number;
}

export interface FillerItem {
  phrase: string;
  count: number;
}

export interface OpenClosed {
  open: number;
  closed: number;
}

export interface Week {
  label: string;
  short: string;
  upcoming?: boolean;
  title: [string, string];
  convs: number;
  mins: string;
  daily: number[];
  talkListen: number;
  talkTrend: number[];
  questions: number;
  questionsTrend: number[];
  questionsDaily: { asked: number[]; received: number[] };
  questionsOpenClosed: { asked: OpenClosed; received: OpenClosed };
  interrupts: number;
  interruptsTrend: number[];
  turnOffsetAvg: number;
  turnOffsetTrend: OffsetPoint[];
  energy: number;
  energyAxes: number[];
  lsmAvg: number;
  ttrAvg: number;
  ttrCounts: { unique: number; total: number };
  topFillers: FillerItem[];
  lsmConvs: LsmConv[];
  convsList: ConvListItem[];
}

export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function fullDay(short: string): string {
  return ({
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
    Sun: 'Sunday',
  } as Record<string, string>)[short] || short;
}
