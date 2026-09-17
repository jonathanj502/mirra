// Seed content for the Reflect AI chat screen.

export interface ChatMessage {
  from: 'ai' | 'you';
  text: string;
}

export const SEED_MESSAGES: ChatMessage[] = [
  { from: 'ai', text: 'I can help you reflect on a saved conversation or on a moment you remember. What would you like to look at first?' },
];

export const STARTER_PROMPTS: string[] = [
  'Why did I interrupt early?',
  'What did I do well?',
  'How can I ask better questions?',
  'Compare to last week',
];
