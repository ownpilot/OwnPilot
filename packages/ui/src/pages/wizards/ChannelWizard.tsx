/**
 * Generic Channel Setup Wizard
 *
 * Steps: Choose Platform → Configure → Connect → Complete
 *
 * Covers Discord, Slack, WhatsApp, Email, SMS, Matrix, WebChat.
 * For Telegram, use the dedicated TelegramWizard.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import {
  WizardPasswordInput,
  WizardLoadingView,
  WizardErrorView,
  WizardCompleteView,
  useWizardKeyboard,
} from '../../components/wizard';
import { channelsApi } from '../../api';
import { Link as LinkIcon } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'platform', label: 'Platform' },
  { id: 'config', label: 'Configure' },
  { id: 'connect', label: 'Connect' },
  { id: 'done', label: 'Complete' },
];

interface Field {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'textarea';
  placeholder?: string;
  helper?: string;
  required?: boolean;
}

interface Platform {
  id: string; // channel ID like 'channel.discord'
  name: string;
  emoji: string;
  desc: string;
  fields: Field[];
  docsUrl?: string;
}

const PLATFORMS: Platform[] = [
  {
    id: 'channel.discord',
    name: 'Discord',
    emoji: '🎮',
    desc: 'Connect a Discord bot via DISCORD_BOT_TOKEN.',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot Token',
        type: 'password',
        placeholder: 'MTI...',
        required: true,
      },
    ],
    docsUrl: 'https://discord.com/developers/applications',
  },
  {
    id: 'channel.slack',
    name: 'Slack',
    emoji: '💬',
    desc: 'Connect a Slack bot via xoxb token.',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot User OAuth Token',
        type: 'password',
        placeholder: 'xoxb-1234567890-...',
        required: true,
      },
      {
        key: 'signing_secret',
        label: 'Signing Secret',
        type: 'password',
        placeholder: 'abc123...',
        helper: 'Request signing secret for webhook verification.',
        required: true,
      },
      {
        key: 'app_token',
        label: 'App-Level Token (optional)',
        type: 'password',
        placeholder: 'xapp-1-...',
        helper: 'For Socket Mode. Leave empty to use Events API webhooks.',
      },
    ],
    docsUrl: 'https://api.slack.com/apps',
  },
  {
    id: 'channel.whatsapp',
    name: 'WhatsApp',
    emoji: '📱',
    desc: 'WhatsApp via Baileys. You will scan a QR code after setup.',
    fields: [
      {
        key: 'my_phone',
        label: 'Your WhatsApp Phone Number',
        type: 'text',
        placeholder: '905551234567',
        helper: 'International format, no + or spaces.',
        required: true,
      },
    ],
  },
  {
    id: 'channel.email',
    name: 'Email',
    emoji: '📧',
    desc: 'IMAP/SMTP bridge — chat over email.',
    fields: [
      {
        key: 'smtp_host',
        label: 'SMTP Host',
        type: 'text',
        placeholder: 'smtp.gmail.com',
        required: true,
      },
      { key: 'smtp_port', label: 'SMTP Port', type: 'text', placeholder: '465', required: true },
      {
        key: 'smtp_user',
        label: 'SMTP Username',
        type: 'text',
        placeholder: 'you@example.com',
        required: true,
      },
      { key: 'smtp_pass', label: 'SMTP Password / App Password', type: 'password', required: true },
      {
        key: 'from_address',
        label: 'From Address',
        type: 'text',
        placeholder: 'you@example.com',
        required: true,
      },
      {
        key: 'imap_host',
        label: 'IMAP Host (optional)',
        type: 'text',
        placeholder: 'imap.gmail.com',
      },
      { key: 'imap_port', label: 'IMAP Port (optional)', type: 'text', placeholder: '993' },
      {
        key: 'imap_user',
        label: 'IMAP Username (optional)',
        type: 'text',
        placeholder: 'you@example.com',
      },
      { key: 'imap_pass', label: 'IMAP Password (optional)', type: 'password' },
    ],
  },
  {
    id: 'channel.sms',
    name: 'SMS (Twilio)',
    emoji: '✉️',
    desc: 'Send & receive SMS via a Twilio account.',
    fields: [
      { key: 'account_sid', label: 'Account SID', type: 'text', required: true },
      { key: 'auth_token', label: 'Auth Token', type: 'password', required: true },
      {
        key: 'from_number',
        label: 'From Number',
        type: 'text',
        placeholder: '+15551234567',
        required: true,
      },
    ],
    docsUrl: 'https://console.twilio.com',
  },
  {
    id: 'channel.matrix',
    name: 'Matrix',
    emoji: '🔷',
    desc: 'Connect to a Matrix homeserver.',
    fields: [
      {
        key: 'homeserver_url',
        label: 'Homeserver URL',
        type: 'url',
        placeholder: 'https://matrix.org',
        required: true,
      },
      {
        key: 'access_token',
        label: 'Access Token',
        type: 'password',
        placeholder: 'syt_...',
        required: true,
      },
      {
        key: 'user_id',
        label: 'User ID',
        type: 'text',
        placeholder: '@you:matrix.org',
        required: true,
      },
    ],
  },
  {
    id: 'channel.webchat',
    name: 'Web Chat',
    emoji: '🌐',
    desc: 'Embed an OwnPilot widget on your own website. No configuration required.',
    fields: [],
  },
];

export function ChannelWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    info?: string;
    error?: string;
  } | null>(null);

  const platform = useMemo(() => PLATFORMS.find((p) => p.id === platformId) ?? null, [platformId]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return !!platformId;
      case 1:
        if (!platform) return false;
        return platform.fields.every((f) => !f.required || (config[f.key] || '').trim().length > 0);
      case 2:
        return result?.ok === true;
      default:
        return false;
    }
  }, [step, platformId, platform, config, result]);

  const handleNext = async () => {
    if (step === 1 && platform) {
      setIsProcessing(true);
      setResult(null);
      try {
        // WebChat has no Config Center service — connect directly.
        if (platform.id === 'channel.webchat') {
          await channelsApi.connect(platform.id);
          setResult({ ok: true, info: 'Web Chat widget is now connected.' });
          setStep(2);
          return;
        }
        const payload: Record<string, unknown> = {};
        for (const f of platform.fields) {
          const v = (config[f.key] || '').trim();
          if (v) payload[f.key] = v;
        }
        const res = await channelsApi.setup(platform.id, payload);
        setResult({
          ok: true,
          info:
            (res as { botInfo?: { username?: string } }).botInfo?.username ||
            'Channel configured successfully.',
        });
        setStep(2);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Setup failed',
        });
        setStep(2);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  useWizardKeyboard({ canGoNext, onNext: handleNext, onCancel, isProcessing });

  return (
    <WizardShell
      title="Connect a Channel"
      description="Set up Discord, Slack, WhatsApp, Email, and more"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 3}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 2) setResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: Pick platform */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose a Platform
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            For Telegram, use the dedicated Telegram wizard.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatformId(p.id)}
                className={`text-left p-4 rounded-lg border transition-all ${
                  platformId === p.id
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{p.emoji}</span>
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {p.name}
                  </span>
                </div>
                <p className="text-xs text-text-muted line-clamp-2">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Configure */}
      {step === 1 && platform && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Configure {platform.name}
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">{platform.desc}</p>

          <div className="space-y-3">
            {platform.fields.map((f) => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  {f.label}
                  {f.required && <span className="text-error"> *</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={config[f.key] || ''}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                  />
                ) : f.type === 'password' ? (
                  <WizardPasswordInput
                    value={config[f.key] || ''}
                    onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <input
                    type={f.type}
                    value={config[f.key] || ''}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                  />
                )}
                {f.helper && <p className="text-[11px] text-text-muted mt-1">{f.helper}</p>}
              </div>
            ))}

            {platform.docsUrl && (
              <a
                href={platform.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-primary hover:underline"
              >
                Open {platform.name} dashboard →
              </a>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Connect */}
      {step === 2 && (
        <>
          {isProcessing && <WizardLoadingView label={`Connecting ${platform?.name}...`} />}
          {result?.ok && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <LinkIcon className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">
                {platform?.name} Connected!
              </h3>
              <p className="text-sm text-text-muted mt-1">{result.info}</p>
            </div>
          )}
          {result && !result.ok && (
            <WizardErrorView
              title="Setup Failed"
              message={result.error}
              onRetry={() => {
                setStep(1);
                setResult(null);
              }}
            />
          )}
        </>
      )}

      {/* Step 3: Done */}
      {step === 3 && platform && (
        <WizardCompleteView
          icon={LinkIcon}
          title="All Set!"
          subtitle={`${platform.name} is connected. Incoming messages will land in your Inbox.`}
          actions={[
            { label: 'Open Inbox', onClick: () => navigate('/inbox') },
            { label: 'Channel Settings', onClick: () => navigate('/settings/channels') },
          ]}
        />
      )}
    </WizardShell>
  );
}
