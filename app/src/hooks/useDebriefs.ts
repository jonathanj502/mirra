import { useMemo } from 'react';
import { fetchDebriefs } from '@/api/client';
import { ConversationListItem } from '@/models/conversation';
import { DebriefCard } from '@/models/debrief';
import { formatConversationWhen, formatDuration } from '@/utils/timeFormat';
import { useAuthedFetch } from './useAuthedFetch';

export function titleForDebrief(debrief: DebriefCard) {
  const metadataTitle = debrief.stats.metadata.title;
  if (typeof metadataTitle === 'string' && metadataTitle.trim()) {
    return metadataTitle.trim();
  }
  return debrief.observation.split(/[.!?]/)[0]?.trim() || 'Conversation debrief';
}

function toneForDebrief(debrief: DebriefCard) {
  const ratio = debrief.stats.talkListenRatio;
  if (ratio > 0.65) return 'coral';
  if (debrief.stats.questionCount >= 8) return 'sage';
  if (debrief.stats.interruptionCount > 2) return 'terracotta';
  return 'lavender';
}

export function toConversationListItem(debrief: DebriefCard): ConversationListItem {
  return {
    id: debrief.id,
    title: titleForDebrief(debrief),
    when: formatConversationWhen(debrief.createdAt),
    duration: formatDuration(Math.round(debrief.stats.sessionDurationMinutes * 60)),
    tone: toneForDebrief(debrief),
    note: debrief.thingToTryNext,
  };
}

export function useDebriefs() {
  const { data: debriefs, setData: setDebriefs, loading, error, refresh } = useAuthedFetch<DebriefCard[]>(
    fetchDebriefs,
    [],
    'Could not load debriefs'
  );
  const listItems = useMemo(() => debriefs.map(toConversationListItem), [debriefs]);

  return { debriefs, listItems, loading, error, refresh, setDebriefs };
}
