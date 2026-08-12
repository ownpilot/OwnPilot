/**
 * Icon and colour mapping for ToolPicker rows.
 *
 * One switch per visual axis (glyph, foreground, background). Extracted from
 * ToolPicker.tsx — pure functions of the item/type, no component state.
 */

import {
  Wrench,
  Database,
  Table,
  Bookmark,
  Calendar,
  Users,
  FileText,
  ListChecks,
  BookOpen,
  Zap,
  Server,
  Layout,
  Clipboard,
} from '../icons';
import type { ResourceItem, ResourceType } from './types';

export function getItemIcon(item: ResourceItem) {
  if (item.type === 'builtin-data') {
    switch (item.name) {
      case 'tasks':
        return <ListChecks className="w-4 h-4" />;
      case 'bookmarks':
        return <Bookmark className="w-4 h-4" />;
      case 'notes':
        return <FileText className="w-4 h-4" />;
      case 'calendar':
        return <Calendar className="w-4 h-4" />;
      case 'contacts':
        return <Users className="w-4 h-4" />;
      case 'memories':
        return <Database className="w-4 h-4" />;
      case 'goals':
        return <Wrench className="w-4 h-4" />;
    }
  }
  if (item.type === 'custom-data') return <Table className="w-4 h-4" />;
  if (item.type === 'skill') return <BookOpen className="w-4 h-4" />;
  if (item.type === 'composio-action') return <Zap className="w-4 h-4" />;
  if (item.type === 'mcp-tool') return <Server className="w-4 h-4" />;
  if (item.type === 'artifact') return <Layout className="w-4 h-4" />;
  if (item.type === 'prompt') return <Clipboard className="w-4 h-4" />;
  return <Wrench className="w-4 h-4" />;
}

export function getIconColor(type: ResourceType): string {
  switch (type) {
    case 'tool':
      return 'text-blue-500';
    case 'custom-tool':
      return 'text-primary';
    case 'custom-data':
      return 'text-emerald-500';
    case 'builtin-data':
      return 'text-amber-500';
    case 'skill':
      return 'text-violet-500';
    case 'composio-action':
      return 'text-yellow-500';
    case 'mcp-tool':
      return 'text-cyan-500';
    case 'artifact':
      return 'text-pink-500';
    case 'prompt':
      return 'text-indigo-500';
    default:
      return 'text-text-muted';
  }
}

export function getIconBg(type: ResourceType): string {
  switch (type) {
    case 'tool':
      return 'bg-blue-500/10 group-hover:bg-blue-500/20';
    case 'custom-tool':
      return 'bg-primary/10 group-hover:bg-primary/20';
    case 'custom-data':
      return 'bg-emerald-500/10 group-hover:bg-emerald-500/20';
    case 'builtin-data':
      return 'bg-amber-500/10 group-hover:bg-amber-500/20';
    case 'skill':
      return 'bg-violet-500/10 group-hover:bg-violet-500/20';
    case 'composio-action':
      return 'bg-yellow-500/10 group-hover:bg-yellow-500/20';
    case 'mcp-tool':
      return 'bg-cyan-500/10 group-hover:bg-cyan-500/20';
    case 'artifact':
      return 'bg-pink-500/10 group-hover:bg-pink-500/20';
    case 'prompt':
      return 'bg-indigo-500/10 group-hover:bg-indigo-500/20';
    default:
      return 'bg-bg-secondary group-hover:bg-bg-tertiary';
  }
}
