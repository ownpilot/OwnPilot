/**
 * Chat starter-menu data and helpers.
 *
 * Extracted from ChatPage.tsx — pure (no React): the example suggestion
 * prompts plus the localStorage-backed cache for personalized starters.
 */

const STARTER_MENU_CACHE_KEY = 'ownpilot:chat:starter-menu:v1';
export const STARTER_MENU_TTL_MS = 60 * 60 * 1000;

export interface StarterPrompt {
  icon: string;
  label: string;
  detail: string;
  prompt: string;
  source: 'personal' | 'example';
}

interface StarterMenuCache {
  createdAt: number;
  expiresAt: number;
  personalPrompts: StarterPrompt[];
}

export const EXAMPLE_STARTERS: StarterPrompt[] = [
  {
    icon: '🧭',
    label: 'Orient me',
    detail: 'Capabilities, tools, limits',
    source: 'example',
    prompt:
      'Give me a concise orientation to what you can do in OwnPilot. Include available tools, privacy boundaries, current model limits, and the best ways to work with you.',
  },
  {
    icon: '✅',
    label: 'Plan today',
    detail: 'Turn tasks into a schedule',
    source: 'example',
    prompt:
      'Help me plan today. First inspect my tasks, goals, calendar, and notes if available, then propose a realistic schedule with the top 3 priorities and one thing to defer.',
  },
  {
    icon: '📝',
    label: 'Capture a note',
    detail: 'Structure an idea',
    source: 'example',
    prompt:
      'Help me capture a note. Ask for the raw idea, then turn it into a clear title, summary, tags, and follow-up actions I can save.',
  },
  {
    icon: '🔎',
    label: 'Find context',
    detail: 'Search my saved data',
    source: 'example',
    prompt:
      'Search across my notes, memories, tasks, bookmarks, and recent conversations for context related to a topic. Ask me for the topic first, then summarize what you find.',
  },
  {
    icon: '💻',
    label: 'Run code',
    detail: 'Use code execution',
    source: 'example',
    prompt:
      'Show me a useful code execution workflow. Write and run a small script that analyzes a simple dataset, explains the result, and suggests how I could adapt it.',
  },
  {
    icon: '📊',
    label: 'Track something',
    detail: 'Create a data system',
    source: 'example',
    prompt:
      'Help me design a lightweight tracker for something I care about, such as expenses, workouts, books, habits, or projects. Ask what I want to track, then define fields and example entries.',
  },
];

export function getTextList(values: Array<string | undefined>, limit = 3): string {
  return values
    .filter((value): value is string => !!value?.trim())
    .slice(0, limit)
    .join(', ');
}

export function readStarterMenuCache(): StarterMenuCache | null {
  try {
    const raw = localStorage.getItem(STARTER_MENU_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StarterMenuCache;
    if (!parsed.expiresAt || Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStarterMenuCache(personalPrompts: StarterPrompt[]): void {
  try {
    const now = Date.now();
    localStorage.setItem(
      STARTER_MENU_CACHE_KEY,
      JSON.stringify({
        createdAt: now,
        expiresAt: now + STARTER_MENU_TTL_MS,
        personalPrompts,
      } satisfies StarterMenuCache)
    );
  } catch {
    /* localStorage unavailable */
  }
}
