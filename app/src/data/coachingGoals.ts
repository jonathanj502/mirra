import { CoachingGoal } from '@/models/debrief';

export const COACHING_GOALS: { value: CoachingGoal; label: string; hint: string }[] = [
  { value: 'general', label: 'Everyday connection', hint: 'No specific focus. Find what helps in each conversation.' },
  { value: 'make_friends', label: 'Make more friends', hint: 'Show warmth, find common ground, and build connection.' },
  { value: 'confidence', label: 'Come across more confidently', hint: 'Share your thoughts with a clear, steady voice.' },
  { value: 'listening', label: 'Listen more closely', hint: 'Stay curious and give others room to be heard.' },
  { value: 'clarity', label: 'Communicate clearly', hint: 'Get your point across in a way people can follow.' },
  { value: 'assertiveness', label: 'Speak up for myself', hint: 'Express your needs and boundaries with respect.' },
];

export function coachingGoalLabel(value: unknown): string | undefined {
  return COACHING_GOALS.find(goal => goal.value === value)?.label;
}
