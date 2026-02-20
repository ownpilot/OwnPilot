/**
 * MCP Server Setup Wizard
 *
 * Steps: Choose Transport → Configure → Connect → Complete
 */

import { useState, useMemo } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { mcpApi, type CreateMcpServerInput } from '../../api';
import { Check, AlertTriangle, Wrench, Terminal, Globe } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'transport', label: 'Transport' },
  { id: 'config', label: 'Configure' },
  { id: 'connect', label: 'Connect' },
  { id: 'done', label: 'Complete' },
];

type Transport = 'stdio' | 'sse' | 'streamable-http';

const TRANSPORTS: { id: Transport; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: 'stdio', label: 'Stdio', icon: Terminal, desc: 'Local process — most common. Runs a command on your machine.' },
  { id: 'sse', label: 'SSE', icon: Globe, desc: 'Server-Sent Events — connect to a remote HTTP server.' },
  { id: 'streamable-http', label: 'Streamable HTTP', icon: Globe, desc: 'Bidirectional HTTP streaming — modern remote servers.' },
];

export function McpServerWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; toolCount?: number; serverName?: string; error?: string } | null>(null);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0: return !!transport;
      case 1: {
        if (!name.trim()) return false;
        if (transport === 'stdio') return !!command.trim();
        return !!url.trim();
      }
      case 2: return result?.ok === true;
      default: return false;
    }
  }, [step, transport, name, command, url, result]);

  const handleNext = async () => {
    if (step === 1) {
      // Create + connect
      setIsProcessing(true);
      setResult(null);
      try {
        const config: CreateMcpServerInput = {
          name: name.trim(),
          displayName: displayName.trim() || name.trim(),
          transport: transport!,
          enabled: true,
          autoConnect: true,
          ...(transport === 'stdio'
            ? {
                command: command.trim(),
                ...(args.trim() ? { args: args.split(',').map((a) => a.trim()).filter(Boolean) } : {}),
              }
            : { url: url.trim() }),
        };

        const server = await mcpApi.create(config);
        const connectResult = await mcpApi.connect(server.id);

        setResult({
          ok: true,
          toolCount: connectResult.toolCount,
          serverName: server.displayName || server.name,
        });
        setStep(2);
      } catch (err) {
        setResult({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
        setStep(2);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    setStep(step + 1);
  };

  return (
    <WizardShell
      title="MCP Server Setup"
      description="Add an MCP server to extend your AI with external tools"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 3}
      onNext={handleNext}
      onBack={() => { setStep(Math.max(0, step - 1)); if (step === 2) setResult(null); }}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Choose Transport */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose Transport Type
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            How does your MCP server communicate?
          </p>

          <div className="space-y-3">
            {TRANSPORTS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTransport(t.id)}
                  className={`w-full text-left p-4 rounded-lg border flex items-start gap-3 transition-all ${
                    transport === t.id
                      ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                      : 'border-border dark:border-dark-border hover:border-primary/40'
                  }`}
                >
                  <div className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex-shrink-0">
                    <Icon className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                      {t.label}
                    </span>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                      {t.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 1: Configure */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Configure Server
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            {transport === 'stdio'
              ? 'Enter the command to run your MCP server process.'
              : 'Enter the URL of your MCP server.'}
          </p>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_-]/gi, '-').toLowerCase())}
                placeholder="my-mcp-server"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              />
              <p className="text-[11px] text-text-muted dark:text-dark-text-muted mt-1">
                Lowercase letters, numbers, hyphens only.
              </p>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My MCP Server"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Transport-specific fields */}
            {transport === 'stdio' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                    Command <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                    Arguments
                  </label>
                  <input
                    type="text"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="-y, @modelcontextprotocol/server-filesystem, /home"
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                  />
                  <p className="text-[11px] text-text-muted dark:text-dark-text-muted mt-1">
                    Comma-separated. Example: -y, @modelcontextprotocol/server-filesystem, /path
                  </p>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Server URL <span className="text-error">*</span>
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={transport === 'sse' ? 'http://localhost:3000/sse' : 'http://localhost:3000/mcp'}
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Connect */}
      {step === 2 && (
        <div className="text-center py-8">
          {!result && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-purple-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Creating and connecting server...</p>
            </div>
          )}

          {result?.ok && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                <Wrench className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Server Connected!
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                {result.serverName} — {result.toolCount} tool{result.toolCount !== 1 ? 's' : ''} available.
              </p>
            </div>
          )}

          {result && !result.ok && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Connection Failed
              </h3>
              <p className="text-sm text-error max-w-md">{result.error}</p>
              <button
                onClick={() => { setStep(1); setResult(null); }}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Complete */}
      {step === 3 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
            <Check className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            MCP Server Ready!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            <strong>{result?.serverName}</strong> is connected with {result?.toolCount ?? 0} tools.
            These tools are now available to your AI assistant.
          </p>
          <a
            href="/settings/mcp-servers"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            View MCP Servers
          </a>
        </div>
      )}
    </WizardShell>
  );
}
