import type { NavigateFunction } from 'react-router-dom';

export interface PageCopilotConfig {
  pageType: string;
  resolveContext?: (params: { id?: string }) => Promise<PageContextData>;
  suggestions: string[];
  actions?: PageAction[];
  systemPromptHint?: string;
  preferBridge?: boolean; // true for path-based pages (workspace, coding-agent, claw)
}

export interface PageContextData {
  path?: string; // host-fs path (workspace, coding-agent, claw)
  definition?: unknown; // workflow JSON, agent config
  tools?: string[]; // available tool names
  metadata?: Record<string, unknown>;
}

export interface PageAction {
  id: string;
  label: string;
  icon: string; // lucide icon name
  extractFromResponse: (content: string) => unknown | null;
  handler: (data: unknown, navigate: NavigateFunction) => void;
}
