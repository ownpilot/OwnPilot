/**
 * Sidebar Data Section Registry — declarative configuration for all data sections.
 *
 * Each entry defines how a sidebar section fetches, renders, and navigates.
 * Used by SidebarDataSection component for generic accordion/flat rendering.
 * Recents is NOT in this registry — it has custom UI (search, filters, date groups).
 *
 * Adding a new data section:
 * 1. Add entry here with fetchItems, icon, route, group
 * 2. Add section ID to SidebarSectionId union in layout-config.ts
 * 3. Add to DEFAULT_SIDEBAR_SECTIONS + SIDEBAR_SECTION_LABELS
 * 4. Section auto-renders in sidebar via registry lookup
 */
import type { ComponentType, SVGProps } from 'react';
import {
  FolderOpen, GitBranch, Bot, Zap, Bell, Layers, FileCode,
  Wrench, Code, Puzzle, CheckCircle2, FileText, Target,
  ListChecks, Brain, Bookmark, Users, Repeat, Send, Wifi,
  Server, Cpu, Terminal,
  Search, Calendar, ChevronRight, MessageSquare,
} from '../components/icons';
import {
  fileWorkspacesApi, workflowsApi, agentsApi, clawsApi, triggersApi,
  fleetApi, artifactsApi, toolsApi, customToolsApi, extensionsApi,
  tasksApi, notesApi, goalsApi, plansApi, memoriesApi, bookmarksApi,
  contactsApi, channelsApi, edgeApi, mcpApi, modelsApi, codingAgentsApi,
} from '../api';
import { habitsApi } from '../api/endpoints/personal-data';
import { NAV_ITEM_MAP } from './nav-items';
import { SIDEBAR_SECTION_LABELS } from '../types/layout-config';

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

/** Generic sidebar item shape — all registry items normalize to this */
export interface SidebarItem {
  id: string;
  label: string;
  route: string;
}

/** Section group for visual grouping in ZoneEditor */
export type SidebarSectionGroup = 'core' | 'data' | 'ai' | 'tools' | 'personal' | 'system';

export interface SidebarDataSectionDef {
  id: string;
  icon: IconComponent;
  route: string;
  group: SidebarSectionGroup;
  maxItems: number;
  /** Fetch items from API — returns normalized SidebarItem[] */
  fetchItems: () => Promise<SidebarItem[]>;
  /** Whether to show the + button in accordion header (navigates to route) */
  showPlus: boolean;
}

/** Registry of all data sections — keyed by section ID */
export const SIDEBAR_DATA_SECTIONS: Record<string, SidebarDataSectionDef> = {
  workspaces: {
    id: 'workspaces',
    icon: FolderOpen,
    route: '/workspaces',
    group: 'data',
    maxItems: 5,
    showPlus: true,
    fetchItems: () =>
      fileWorkspacesApi.list().then((res) =>
        (res.workspaces ?? []).slice(0, 5).map((p) => ({
          id: p.id,
          label: p.name,
          route: `/workspaces?id=${p.id}`,
        }))
      ),
  },
  workflows: {
    id: 'workflows',
    icon: GitBranch,
    route: '/workflows',
    group: 'data',
    maxItems: 5,
    showPlus: true,
    fetchItems: () =>
      workflowsApi.list({ limit: '5' }).then((res) =>
        (res.workflows ?? []).map((wf) => ({
          id: wf.id,
          label: wf.name,
          route: `/workflows/${wf.id}`,
        }))
      ),
  },

  // ─── AI & Automation ───

  agents: {
    id: 'agents', icon: Bot, route: '/agents', group: 'ai', maxItems: 5, showPlus: true,
    fetchItems: () =>
      agentsApi.list().then((items: { id: string; name: string }[]) =>
        items.slice(0, 5).map((a) => ({ id: a.id, label: a.name, route: `/agents` }))
      ),
  },
  claws: {
    id: 'claws', icon: Zap, route: '/claws', group: 'ai', maxItems: 5, showPlus: true,
    fetchItems: () =>
      clawsApi.list().then((items: { id: string; name: string }[]) =>
        items.slice(0, 5).map((c) => ({ id: c.id, label: c.name, route: `/claws` }))
      ),
  },
  triggers: {
    id: 'triggers', icon: Bell, route: '/triggers', group: 'ai', maxItems: 5, showPlus: true,
    fetchItems: () =>
      triggersApi.list().then((res: { triggers?: { id: string; name: string }[] }) =>
        (res.triggers ?? []).slice(0, 5).map((t) => ({ id: t.id, label: t.name, route: `/triggers` }))
      ),
  },
  fleet: {
    id: 'fleet', icon: Layers, route: '/fleet', group: 'ai', maxItems: 5, showPlus: true,
    fetchItems: () =>
      fleetApi.list().then((items: { id: string; name: string }[]) =>
        items.slice(0, 5).map((f) => ({ id: f.id, label: f.name, route: `/fleet` }))
      ),
  },
  artifacts: {
    id: 'artifacts', icon: FileCode, route: '/artifacts', group: 'ai', maxItems: 5, showPlus: false,
    fetchItems: () =>
      artifactsApi.list().then((res: { artifacts?: { id: string; title: string }[] }) =>
        (res.artifacts ?? []).slice(0, 5).map((a) => ({ id: a.id, label: a.title, route: `/artifacts` }))
      ),
  },

  // ─── Tools & Extensions ───

  tools: {
    id: 'tools', icon: Wrench, route: '/tools', group: 'tools', maxItems: 5, showPlus: false,
    fetchItems: () =>
      toolsApi.list().then((items: { name: string }[]) =>
        items.slice(0, 5).map((t) => ({ id: t.name, label: t.name, route: `/tools` }))
      ),
  },
  'custom-tools': {
    id: 'custom-tools', icon: Code, route: '/custom-tools', group: 'tools', maxItems: 5, showPlus: true,
    fetchItems: () =>
      customToolsApi.list().then((res: { tools?: { id: string; name: string }[] }) =>
        (res.tools ?? []).slice(0, 5).map((t) => ({ id: t.id, label: t.name, route: `/custom-tools` }))
      ),
  },
  extensions: {
    id: 'extensions', icon: Puzzle, route: '/skills', group: 'tools', maxItems: 5, showPlus: false,
    fetchItems: () =>
      extensionsApi.list().then((items: { name: string; version?: string }[]) =>
        items.slice(0, 5).map((e) => ({ id: e.name, label: e.name, route: `/skills` }))
      ),
  },

  // ─── Personal Data ───

  tasks: {
    id: 'tasks', icon: CheckCircle2, route: '/tasks', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      tasksApi.list().then((items: { id: string; title?: string; name?: string }[]) =>
        items.slice(0, 5).map((t) => ({ id: t.id, label: t.title ?? t.name ?? t.id, route: `/tasks` }))
      ),
  },
  notes: {
    id: 'notes', icon: FileText, route: '/notes', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      notesApi.list().then((items: { id: string; title?: string; name?: string }[]) =>
        items.slice(0, 5).map((n) => ({ id: n.id, label: n.title ?? n.name ?? n.id, route: `/notes` }))
      ),
  },
  goals: {
    id: 'goals', icon: Target, route: '/goals', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      goalsApi.list().then((res: { goals?: { id: string; title?: string; name?: string }[] }) =>
        (res.goals ?? []).slice(0, 5).map((g) => ({ id: g.id, label: g.title ?? g.name ?? g.id, route: `/goals` }))
      ),
  },
  plans: {
    id: 'plans', icon: ListChecks, route: '/plans', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      plansApi.list().then((res: { plans?: { id: string; title?: string; name?: string }[] }) =>
        (res.plans ?? []).slice(0, 5).map((p) => ({ id: p.id, label: p.title ?? p.name ?? p.id, route: `/plans` }))
      ),
  },
  memories: {
    id: 'memories', icon: Brain, route: '/memories', group: 'personal', maxItems: 5, showPlus: false,
    fetchItems: () =>
      memoriesApi.list().then((res: { memories?: { id: string; content?: string; key?: string }[] }) =>
        (res.memories ?? []).slice(0, 5).map((m) => ({ id: m.id, label: m.key ?? m.content?.slice(0, 30) ?? m.id, route: `/memories` }))
      ),
  },
  bookmarks: {
    id: 'bookmarks', icon: Bookmark, route: '/bookmarks', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      bookmarksApi.list().then((items: { id: string; title?: string; url?: string }[]) =>
        items.slice(0, 5).map((b) => ({ id: b.id, label: b.title ?? b.url ?? b.id, route: `/bookmarks` }))
      ),
  },
  contacts: {
    id: 'contacts', icon: Users, route: '/contacts', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      contactsApi.list().then((items: { id: string; name?: string; email?: string }[]) =>
        items.slice(0, 5).map((c) => ({ id: c.id, label: c.name ?? c.email ?? c.id, route: `/contacts` }))
      ),
  },
  habits: {
    id: 'habits', icon: Repeat, route: '/habits', group: 'personal', maxItems: 5, showPlus: true,
    fetchItems: () =>
      habitsApi.list().then((res: { habits?: { id: string; name: string }[] }) =>
        (res.habits ?? []).slice(0, 5).map((h) => ({ id: h.id, label: h.name, route: `/habits` }))
      ),
  },

  // ─── System ───

  channels: {
    id: 'channels', icon: Send, route: '/channels', group: 'system', maxItems: 5, showPlus: true,
    fetchItems: () =>
      channelsApi.list().then((res: { channels?: { id: string; name: string }[] }) =>
        (res.channels ?? []).slice(0, 5).map((ch) => ({ id: ch.id, label: ch.name, route: `/channels` }))
      ),
  },
  'edge-devices': {
    id: 'edge-devices', icon: Wifi, route: '/edge-devices', group: 'system', maxItems: 5, showPlus: true,
    fetchItems: () =>
      edgeApi.list().then((res: { devices?: { id: string; name: string }[] }) =>
        (res.devices ?? []).slice(0, 5).map((d) => ({ id: d.id, label: d.name, route: `/edge-devices` }))
      ),
  },
  'mcp-servers': {
    id: 'mcp-servers', icon: Server, route: '/settings/mcp-servers', group: 'system', maxItems: 5, showPlus: true,
    fetchItems: () =>
      mcpApi.list().then((res: { servers?: { id: string; name: string }[] }) =>
        (res.servers ?? []).slice(0, 5).map((s) => ({ id: s.id, label: s.name, route: `/settings/mcp-servers` }))
      ),
  },
  'ai-models': {
    id: 'ai-models', icon: Cpu, route: '/settings/ai-models', group: 'system', maxItems: 5, showPlus: false,
    fetchItems: () =>
      modelsApi.list().then((res: { models?: { id: string; name: string }[]; merged?: { id: string; name: string }[] }) => {
        const items = res.merged ?? res.models ?? [];
        return items.slice(0, 5).map((m) => ({ id: m.id, label: m.name, route: `/settings/ai-models` }));
      }),
  },
  'coding-agents': {
    id: 'coding-agents', icon: Terminal, route: '/coding-agents', group: 'system', maxItems: 5, showPlus: true,
    fetchItems: () =>
      codingAgentsApi.listSessions().then((items: { id: string; displayName?: string; name?: string }[]) =>
        items.slice(0, 5).map((s) => ({ id: s.id, label: s.displayName ?? s.name ?? s.id, route: `/coding-agents` }))
      ),
  },
};

/** Group labels for ZoneEditor visual grouping */
export const SECTION_GROUP_LABELS: Record<SidebarSectionGroup, string> = {
  core: 'Core',
  data: 'Data',
  ai: 'AI & Automation',
  tools: 'Tools & Extensions',
  personal: 'Personal',
  system: 'System',
};

/** Which group each built-in static section belongs to */
export const STATIC_SECTION_GROUPS: Record<string, SidebarSectionGroup> = {
  search: 'core',
  scheduled: 'core',
  customize: 'core',
  recents: 'data',
};

/** Icons for static sections (not in the data registry) */
export const STATIC_SECTION_ICONS: Record<string, IconComponent> = {
  search: Search,
  scheduled: Calendar,
  customize: ChevronRight,
  recents: MessageSquare,
};

/** Check if a section ID is a route path (nav item) vs a named section */
export function isNavItemSection(sectionId: string): boolean {
  return sectionId.startsWith('/');
}

/** Check if a section ID is a registry-backed data section */
export function isDataSection(sectionId: string): boolean {
  return sectionId in SIDEBAR_DATA_SECTIONS;
}

/** Get the icon for any section — checks static, data registry, and NAV_ITEM_MAP */
export function getSectionIcon(sectionId: string): IconComponent | undefined {
  if (sectionId in STATIC_SECTION_ICONS) return STATIC_SECTION_ICONS[sectionId];
  const def = SIDEBAR_DATA_SECTIONS[sectionId];
  if (def) return def.icon;
  if (isNavItemSection(sectionId)) return NAV_ITEM_MAP.get(sectionId)?.icon;
  return undefined;
}

/** Get human label for any section */
export function getSectionLabel(sectionId: string): string {
  if (sectionId in SIDEBAR_SECTION_LABELS) return SIDEBAR_SECTION_LABELS[sectionId]!;
  if (isNavItemSection(sectionId)) return NAV_ITEM_MAP.get(sectionId)?.label ?? sectionId;
  return sectionId;
}

/** Get the group for any section (static, data, or nav item) */
export function getSectionGroup(sectionId: string): SidebarSectionGroup {
  if (sectionId in STATIC_SECTION_GROUPS) return STATIC_SECTION_GROUPS[sectionId]!;
  const def = SIDEBAR_DATA_SECTIONS[sectionId];
  if (def) return def.group;
  if (isNavItemSection(sectionId)) return 'core'; // nav items are core navigation
  return 'system'; // fallback for unknown sections
}
