/**
 * Page Layout Registry — static map of each page's internal layout structure.
 *
 * Used by LayoutConfigPage to visualize page component structure,
 * show section boundaries, and link to source code locations.
 *
 * Add new pages incrementally — unlisted pages show "Layout not mapped yet".
 */

export interface PageSubComponent {
  name: string;
  file: string;
  lines: number; // approximate total lines
}

export interface PageSection {
  id: string;
  label: string;
  lines: [number, number]; // [startLine, endLine] in main file
  file: string;            // relative to packages/ui/src/
  description: string;
  subComponents?: PageSubComponent[];
}

export interface PageLayout {
  path: string;        // route path (e.g. "/")
  label: string;       // display name (e.g. "Chat")
  file: string;        // main file relative to packages/ui/src/
  totalLines: number;
  sections: PageSection[];
}

// ─── ChatPage Layout ───────────────────────────────────────

const CHAT_PAGE: PageLayout = {
  path: '/',
  label: 'Chat',
  file: 'pages/ChatPage.tsx',
  totalLines: 1135,
  sections: [
    {
      id: 'header',
      label: 'Header',
      lines: [472, 633],
      file: 'pages/ChatPage.tsx',
      description: 'Title, model/workspace selectors, New Chat button',
      subComponents: [
        { name: 'WorkspaceSelector', file: 'components/WorkspaceSelector.tsx', lines: 120 },
      ],
    },
    {
      id: 'context-bar',
      label: 'Context Bar',
      lines: [636, 667],
      file: 'pages/ChatPage.tsx',
      description: 'Message count, token usage bar, new session button',
      subComponents: [
        { name: 'ContextBar', file: 'components/ContextBar.tsx', lines: 87 },
        { name: 'ContextDetailModal', file: 'components/ContextDetailModal.tsx', lines: 80 },
      ],
    },
    {
      id: 'messages',
      label: 'Messages',
      lines: [674, 1096],
      file: 'pages/ChatPage.tsx',
      description: 'Empty state, message list, streaming content, thinking, memories, suggestions',
      subComponents: [
        { name: 'MessageList', file: 'components/MessageList.tsx', lines: 331 },
        { name: 'SuggestionChips', file: 'components/SuggestionChips.tsx', lines: 30 },
        { name: 'MemoryCards', file: 'components/MemoryCards.tsx', lines: 91 },
        { name: 'ThinkingToggle', file: 'components/ThinkingToggle.tsx', lines: 45 },
      ],
    },
    {
      id: 'input',
      label: 'Input',
      lines: [1105, 1123],
      file: 'pages/ChatPage.tsx',
      description: 'Security panels, tool call limit, thinking toggle, chat input',
      subComponents: [
        { name: 'ChatInput', file: 'components/ChatInput.tsx', lines: 386 },
        { name: 'ExecutionSecurityPanel', file: 'components/ExecutionSecurityPanel.tsx', lines: 60 },
        { name: 'ToolCallLimitPanel', file: 'components/ToolCallLimitPanel.tsx', lines: 50 },
      ],
    },
    {
      id: 'modals',
      label: 'Modals',
      lines: [1126, 1135],
      file: 'pages/ChatPage.tsx',
      description: 'Execution approval dialog (lazy loaded)',
      subComponents: [
        { name: 'ExecutionApprovalDialog', file: 'components/ExecutionApprovalDialog.tsx', lines: 120 },
      ],
    },
  ],
};

// ─── Dashboard Layout ──────────────────────────────────────

const DASHBOARD_PAGE: PageLayout = {
  path: '/dashboard',
  label: 'Dashboard',
  file: 'pages/DashboardPage.tsx',
  totalLines: 563,
  sections: [
    {
      id: 'header',
      label: 'Header',
      lines: [1, 40],
      file: 'pages/DashboardPage.tsx',
      description: 'Title, refresh button, tab navigation (Overview/Agents/Automation/Extensions)',
    },
    {
      id: 'overview-tab',
      label: 'Overview Tab',
      lines: [41, 200],
      file: 'pages/DashboardPage.tsx',
      description: 'AI Briefing card, timeline view, pinned artifacts, system stats',
      subComponents: [
        { name: 'AIBriefingCard', file: 'components/AIBriefingCard.tsx', lines: 150 },
        { name: 'TimelineView', file: 'components/TimelineView.tsx', lines: 200 },
        { name: 'SystemStatsWidget', file: 'components/dashboard/SystemStatsWidget.tsx', lines: 100 },
      ],
    },
    {
      id: 'agents-tab',
      label: 'Agents Tab',
      lines: [201, 350],
      file: 'pages/DashboardPage.tsx',
      description: 'Soul agents, subagents, fleet overview',
      subComponents: [
        { name: 'SoulAgentsWidget', file: 'components/dashboard/SoulAgentsWidget.tsx', lines: 80 },
        { name: 'SubagentsWidget', file: 'components/dashboard/SubagentsWidget.tsx', lines: 80 },
        { name: 'FleetWidget', file: 'components/dashboard/FleetWidget.tsx', lines: 80 },
      ],
    },
    {
      id: 'automation-tab',
      label: 'Automation Tab',
      lines: [351, 450],
      file: 'pages/DashboardPage.tsx',
      description: 'Workflows, claws, heartbeat logs',
      subComponents: [
        { name: 'WorkflowsWidget', file: 'components/dashboard/WorkflowsWidget.tsx', lines: 80 },
        { name: 'ClawsWidget', file: 'components/dashboard/ClawsWidget.tsx', lines: 80 },
      ],
    },
    {
      id: 'extensions-tab',
      label: 'Extensions Tab',
      lines: [451, 563],
      file: 'pages/DashboardPage.tsx',
      description: 'Skills, crews',
      subComponents: [
        { name: 'SkillsWidget', file: 'components/dashboard/SkillsWidget.tsx', lines: 80 },
        { name: 'CrewsWidget', file: 'components/dashboard/CrewsWidget.tsx', lines: 80 },
      ],
    },
  ],
};

// ─── Registry ──────────────────────────────────────────────

/** Lookup: route path → PageLayout. Pages not in this map show "Layout not mapped yet". */
export const PAGE_LAYOUT_REGISTRY: Record<string, PageLayout> = {
  '/': CHAT_PAGE,
  '/dashboard': DASHBOARD_PAGE,
};
