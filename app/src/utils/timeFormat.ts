export function formatConversationWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins >= 60) return `${Math.floor(mins / 60)} hr${mins % 60 ? ` ${mins % 60} min` : ''}`;
  return `${mins} min`;
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^/.]+$/, '').trim();
  return base || 'Imported recording';
}
