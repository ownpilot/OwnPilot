/**
 * Telegram Channel Setup Wizard
 *
 * Steps: Introduction → BotFather Guide → Enter Token → Connect → Complete
 */

import { useState, useMemo } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { channelsApi } from '../../api';
import { Check, AlertTriangle, Telegram, ExternalLink } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'intro', label: 'Intro' },
  { id: 'botfather', label: 'BotFather' },
  { id: 'token', label: 'Token' },
  { id: 'connect', label: 'Connect' },
  { id: 'done', label: 'Complete' },
];

const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

export function TelegramWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [botToken, setBotToken] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; botUsername?: string; error?: string } | null>(null);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0: return true; // Intro
      case 1: return true; // BotFather guide
      case 2: return TOKEN_PATTERN.test(botToken.trim());
      case 3: return result?.ok === true;
      default: return false;
    }
  }, [step, botToken, result]);

  const handleNext = async () => {
    if (step === 2) {
      // Connect to Telegram
      setIsProcessing(true);
      setResult(null);
      try {
        const config: Record<string, unknown> = { bot_token: botToken.trim() };
        if (allowedUsers.trim()) {
          config.allowed_users = allowedUsers.trim();
        }
        const res = await channelsApi.setup('channel.telegram', config);
        setResult({
          ok: true,
          botUsername: (res as { botInfo?: { username?: string } }).botInfo?.username,
        });
        setStep(3);
      } catch (err) {
        setResult({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
        setStep(3);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    setStep(step + 1);
  };

  return (
    <WizardShell
      title="Telegram Channel Setup"
      description="Connect a Telegram bot for mobile AI access"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => { setStep(Math.max(0, step - 1)); if (step === 3) setResult(null); }}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Introduction */}
      {step === 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-sky-500/10">
              <Telegram className="w-8 h-8 text-sky-500" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Telegram Integration
            </h2>
          </div>

          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Connect your Telegram bot to access your AI assistant from anywhere on your phone.
          </p>

          <div className="space-y-2">
            {[
              'Chat with your AI assistant from Telegram',
              'All tools and capabilities work — same as web UI',
              'Send photos, documents, and voice messages for analysis',
              'Approve tool actions via inline buttons',
              'Switch AI models with /model command',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm text-text-secondary dark:text-dark-text-secondary">
                <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              <strong>What you'll need:</strong> A Telegram account and ~3 minutes to create a bot via @BotFather.
            </p>
          </div>
        </div>
      )}

      {/* Step 1: BotFather Guide */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Create a Bot via @BotFather
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Follow these steps in Telegram to create your bot and get a token.
          </p>

          <ol className="space-y-4">
            {[
              { title: 'Open Telegram', desc: 'Search for @BotFather and start a chat.' },
              { title: 'Create a new bot', desc: 'Send /newbot to BotFather.' },
              { title: 'Choose a name', desc: 'This is the display name (e.g., "My OwnPilot").' },
              { title: 'Choose a username', desc: 'Must end in "bot" (e.g., my_ownpilot_bot).' },
              { title: 'Copy the token', desc: 'BotFather will send you a token like 123456:ABC-DEF... Copy it!' },
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-white text-xs flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {s.title}
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                    {s.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-6 text-sm text-primary hover:underline"
          >
            Open @BotFather in Telegram
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Step 2: Enter Token */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Paste Your Bot Token
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Paste the token you received from @BotFather.
          </p>

          <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
            Bot Token
          </label>
          <input
            type="text"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456789:ABCdefGHI-jklMNO_pqrSTUvwxyz"
            className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            autoFocus
          />
          {botToken && !TOKEN_PATTERN.test(botToken.trim()) && (
            <p className="text-xs text-warning mt-1.5">
              Token should look like: 123456789:ABCdef...
            </p>
          )}

          {/* Advanced options */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="mt-4 text-xs text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced options
          </button>

          {showAdvanced && (
            <div className="mt-3 p-4 rounded-lg border border-border dark:border-dark-border space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Allowed User IDs (optional)
                </label>
                <input
                  type="text"
                  value={allowedUsers}
                  onChange={(e) => setAllowedUsers(e.target.value)}
                  placeholder="123456789, 987654321"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[11px] text-text-muted dark:text-dark-text-muted mt-1">
                  Comma-separated Telegram user IDs. Leave empty to allow anyone.
                  Find your ID by messaging{' '}
                  <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    @userinfobot
                  </a>.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Connect */}
      {step === 3 && (
        <div className="text-center py-8">
          {!result && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-sky-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Connecting to Telegram...</p>
            </div>
          )}

          {result?.ok && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                <Telegram className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Bot Connected!
              </h3>
              {result.botUsername && (
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  Your bot: <strong>@{result.botUsername}</strong>
                </p>
              )}
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
                onClick={() => { setStep(2); setResult(null); }}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
            <Telegram className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            Telegram is Ready!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            Open Telegram and send <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1.5 py-0.5 rounded text-xs">/start</code> to your bot to begin chatting.
          </p>

          <div className="space-y-2">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Available commands: /new, /model, /history, /status, /clear
            </p>
          </div>

          {result?.botUsername && (
            <a
              href={`https://t.me/${result.botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-sm rounded-lg bg-sky-500 text-white hover:bg-sky-600 transition-colors"
            >
              <Telegram className="w-4 h-4" />
              Open in Telegram
            </a>
          )}
        </div>
      )}
    </WizardShell>
  );
}
