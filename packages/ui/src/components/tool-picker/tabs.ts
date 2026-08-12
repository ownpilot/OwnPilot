/**
 * Tab configuration for the ToolPicker panel.
 *
 * Data only — the ten resource tabs and their palette. Extracted from
 * ToolPicker.tsx so adding a resource kind is a one-file edit here plus the
 * loader in the component.
 */

import {
  Wrench,
  Table,
  Database,
  BookOpen,
  Upload,
  Link,
  Zap,
  Server,
  Layout,
  Clipboard,
} from '../icons';
import type { TabId } from './types';

export interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  activeBg: string;
}

export const TABS: TabConfig[] = [
  { id: 'tools', label: 'Tools', icon: Wrench, color: 'text-blue-500', activeBg: 'bg-blue-500/10' },
  {
    id: 'custom-data',
    label: 'Data',
    icon: Table,
    color: 'text-emerald-500',
    activeBg: 'bg-emerald-500/10',
  },
  {
    id: 'builtin-data',
    label: 'Built-in',
    icon: Database,
    color: 'text-amber-500',
    activeBg: 'bg-amber-500/10',
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: BookOpen,
    color: 'text-violet-500',
    activeBg: 'bg-violet-500/10',
  },
  {
    id: 'files',
    label: 'Files',
    icon: Upload,
    color: 'text-orange-500',
    activeBg: 'bg-orange-500/10',
  },
  { id: 'url', label: 'URL', icon: Link, color: 'text-sky-500', activeBg: 'bg-sky-500/10' },
  {
    id: 'composio',
    label: 'Apps',
    icon: Zap,
    color: 'text-yellow-500',
    activeBg: 'bg-yellow-500/10',
  },
  { id: 'mcp', label: 'MCP', icon: Server, color: 'text-cyan-500', activeBg: 'bg-cyan-500/10' },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: Layout,
    color: 'text-pink-500',
    activeBg: 'bg-pink-500/10',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: Clipboard,
    color: 'text-indigo-500',
    activeBg: 'bg-indigo-500/10',
  },
];

/** Tabs that render their own panel instead of the shared searchable item list. */
export const CUSTOM_PANEL_TABS: TabId[] = ['files', 'url', 'prompts'];
