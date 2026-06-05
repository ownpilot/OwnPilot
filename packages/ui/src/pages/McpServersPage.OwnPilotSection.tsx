/**
 * OwnPilot's own MCP server status section — shown at the top of the MCP
 * Servers page. Self-contained (no props, own state). Extracted from
 * McpServersPage.tsx.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { EmptyState } from '../components/EmptyState';
import {
  Server,
  Globe,
  RefreshCw,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  BookOpen,
  Wrench,
} from '../components/icons';
import { mcpApi } from '../api';
import type { McpServerInfo } from '../api/endpoints/mcp';

export function OwnPilotServerSection() {
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    mcpApi
      .serverInfo()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(label);
        toast.success(`Copied ${label}`);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        toast.error('Failed to copy');
      }
    },
    [toast]
  );

  if (loading) {
    return (
      <div className="border border-border dark:border-dark-border rounded-xl bg-bg-primary dark:bg-dark-bg-primary p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-48" />
          <div className="h-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-96" />
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Failed to load MCP server info"
        description={error ?? 'Could not retrieve server information'}
        variant="card"
        iconBgColor="bg-red-500/10 dark:bg-red-500/20"
        iconColor="text-red-500"
        action={{
          label: 'Retry',
          onClick: () => {
            setLoading(true);
            setError(null);
            mcpApi
              .serverInfo()
              .then(setInfo)
              .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
              .finally(() => setLoading(false));
          },
          icon: RefreshCw,
        }}
      />
    );
  }

  return (
    <div className="border border-border dark:border-dark-border rounded-xl bg-bg-primary dark:bg-dark-bg-primary overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border dark:border-dark-border bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Server className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
                OwnPilot MCP Server
              </h2>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                Expose OwnPilot tools to external AI clients via MCP protocol
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-success/10 text-success font-medium">
              <Check className="w-3 h-3" />
              Active
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
              <Wrench className="w-3 h-3" />
              {info.tools.count} tools
            </span>
          </div>
        </div>
      </div>

      {/* Endpoint URL */}
      <div className="px-5 py-3 border-b border-border dark:border-dark-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1 block">
              Endpoint URL
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-1.5 text-sm font-mono rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary truncate">
                {info.server.endpoint}
              </code>
              <button
                onClick={() => copyToClipboard(info.server.endpoint, 'endpoint URL')}
                className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors shrink-0"
                title="Copy URL"
              >
                {copied === 'endpoint URL' ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <div className="text-right shrink-0">
            <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1 block">
              Protocol
            </label>
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary">
              <Globe className="w-3 h-3" />
              Streamable HTTP
            </span>
          </div>
        </div>
      </div>

      {/* Quick Setup Tabs */}
      <div className="px-5 py-3 border-b border-border dark:border-dark-border">
        <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 block">
          Quick Setup — Copy config for your AI client
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(info.configSnippets).map(([key, snippet]) => (
            <button
              key={key}
              onClick={() => setActiveSnippet(activeSnippet === key ? null : key)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                activeSnippet === key
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:border-primary/40 hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        {activeSnippet && info.configSnippets[activeSnippet] && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {info.configSnippets[activeSnippet]!.description}
            </p>
            <div className="relative">
              <pre className="px-3 py-2.5 text-xs font-mono rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary overflow-x-auto">
                {JSON.stringify(info.configSnippets[activeSnippet]!.config, null, 2)}
              </pre>
              <button
                onClick={() =>
                  copyToClipboard(
                    JSON.stringify(info.configSnippets[activeSnippet]!.config, null, 2),
                    `${info.configSnippets[activeSnippet]!.label} config`
                  )
                }
                className="absolute top-2 right-2 p-1.5 rounded-md bg-bg-tertiary/80 dark:bg-dark-bg-tertiary/80 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
                title="Copy config"
              >
                {copied === `${info.configSnippets[activeSnippet]!.label} config` ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Exposed Tools */}
      <div className="px-5 py-3">
        <button
          onClick={() => setShowTools(!showTools)}
          className="flex items-center gap-2 text-xs font-medium text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors w-full"
        >
          {showTools ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <Eye className="w-3.5 h-3.5" />
          View Exposed Tools ({info.tools.count})
        </button>
        {showTools && (
          <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
            {info.tools.items.map((tool) => (
              <div
                key={tool.qualifiedName}
                className="px-3 py-1.5 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-sm flex items-start gap-2"
              >
                <span className="font-medium text-text-primary dark:text-dark-text-primary whitespace-nowrap shrink-0">
                  {tool.name}
                </span>
                {tool.description && (
                  <span className="text-text-muted dark:text-dark-text-muted text-xs line-clamp-1">
                    {tool.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage Guide */}
      <details className="border-t border-border dark:border-dark-border">
        <summary className="px-5 py-3 flex items-center gap-2 text-xs font-medium text-text-muted dark:text-dark-text-muted cursor-pointer hover:text-text-primary dark:hover:text-dark-text-primary select-none">
          <BookOpen className="w-3.5 h-3.5" />
          Usage Guide
        </summary>
        <div className="px-5 pb-4 text-xs text-text-secondary dark:text-dark-text-secondary space-y-3">
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              What is MCP?
            </h4>
            <p>
              Model Context Protocol (MCP) is an open standard that lets AI applications discover
              and use tools from external servers. OwnPilot exposes all its tools via MCP, so any
              MCP-compatible AI client can use OwnPilot's capabilities (file management, web search,
              code execution, task management, etc).
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              How it works
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>OwnPilot runs a Streamable HTTP server at the endpoint URL shown above</li>
              <li>
                MCP clients connect and discover available tools via{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  tools/list
                </code>
              </li>
              <li>
                Clients call tools via{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  tools/call
                </code>{' '}
                with JSON arguments
              </li>
              <li>Results are returned as structured content (text, images, etc.)</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Claude Desktop Setup
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>Open Claude Desktop settings</li>
              <li>
                Go to <strong>Developer</strong> &rarr; <strong>Edit Config</strong>
              </li>
              <li>
                Add the OwnPilot config to the{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  mcpServers
                </code>{' '}
                section
              </li>
              <li>Restart Claude Desktop &mdash; OwnPilot tools will appear in the tool picker</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Cursor / Windsurf Setup
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>
                Create{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  .cursor/mcp.json
                </code>{' '}
                in your project root (or via Cursor settings)
              </li>
              <li>Add the OwnPilot config snippet</li>
              <li>Restart the editor &mdash; tools available in Composer</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Claude Code Setup
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>
                Create{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  .mcp.json
                </code>{' '}
                in your project root (per-project) or{' '}
                <code className="px-1 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  ~/.claude/mcp.json
                </code>{' '}
                (global)
              </li>
              <li>Add the OwnPilot config snippet</li>
              <li>Restart Claude Code &mdash; tools available automatically</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary mb-1">
              Security Notes
            </h4>
            <ul className="list-disc list-inside space-y-1 text-text-muted dark:text-dark-text-muted">
              <li>The MCP server runs on the same port as OwnPilot's API</li>
              <li>Tools execute with the same permissions as OwnPilot</li>
              <li>For remote access, use a reverse proxy with authentication</li>
              <li>
                The server is stateful per-session but ephemeral &mdash; no state persisted between
                restarts
              </li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
