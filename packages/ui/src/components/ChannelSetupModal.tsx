/**
 * Channel Setup Modal
 *
 * Step-by-step modal for quickly adding a channel bot:
 * - Token-based (Telegram): platform → token → connecting → result
 * - QR-based (WhatsApp): platform → connecting → qr scan → result
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { channelsApi } from '../api';
import { useGateway } from '../hooks/useWebSocket';
import { useModalClose } from '../hooks';
import { Telegram, Discord, WhatsApp, SlackIcon, X, Check, AlertTriangle } from './icons';
import { LoadingSpinner } from './LoadingSpinner';
import { useToast } from './ToastProvider';

// ============================================================================
// Types
// ============================================================================

interface ChannelSetupModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'platform' | 'token' | 'connecting' | 'qr' | 'result';

interface PlatformInfo {
  id: string;
  pluginId: string;
  name: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  tokenHint: string;
  docsUrl: string;
  restrictLabel: string;
  restrictField: string;
  Icon: React.ComponentType<{ className?: string }>;
  validateToken: (v: string) => string | null;
  /** If true, uses QR code authentication instead of token input. */
  qrBased?: boolean;
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: 'telegram',
    pluginId: 'channel.telegram',
    name: 'Telegram',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: '123456789:ABCdefGHI...',
    tokenHint: 'Get a token from @BotFather on Telegram',
    docsUrl: 'https://core.telegram.org/bots#botfather',
    restrictLabel: 'Allowed User IDs (comma-separated, optional)',
    restrictField: 'allowed_users',
    Icon: Telegram,
    validateToken: (v) => (v.includes(':') ? null : 'Token should contain ":"'),
  },
  {
    id: 'whatsapp',
    pluginId: 'channel.whatsapp',
    name: 'WhatsApp',
    tokenLabel: '',
    tokenPlaceholder: '',
    tokenHint: 'Scan QR code with your WhatsApp app',
    docsUrl: 'https://github.com/WhiskeySockets/Baileys',
    restrictLabel: 'Allowed Phone Numbers (comma-separated, optional)',
    restrictField: 'allowed_users',
    Icon: WhatsApp,
    validateToken: () => null,
    qrBased: true,
  },
  {
    id: 'discord',
    pluginId: 'channel.discord',
    name: 'Discord',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'MTExMjM0NTY3ODkw...',
    tokenHint: 'Get a token from Discord Developer Portal',
    docsUrl: 'https://discord.com/developers/docs/intro',
    restrictLabel: 'Allowed Server IDs (comma-separated, optional)',
    restrictField: 'guild_ids',
    Icon: Discord,
    validateToken: (v) => (v.length > 50 ? null : 'Token seems too short'),
  },
  {
    id: 'slack',
    pluginId: 'channel.slack',
    name: 'Slack',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'xoxb-1234567890-...',
    tokenHint: 'Bot User OAuth Token from Slack App settings',
    docsUrl: 'https://api.slack.com/quickstart',
    restrictLabel: 'Allowed Channel IDs (comma-separated, optional)',
    restrictField: 'allowed_channels',
    Icon: SlackIcon,
    validateToken: (v) => (v.startsWith('xoxb-') ? null : 'Token should start with "xoxb-"'),
  },
];

// ============================================================================
// Component
// ============================================================================

export function ChannelSetupModal({ onClose, onSuccess }: ChannelSetupModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const { subscribe } = useGateway();
  const toast = useToast();

  const [step, setStep] = useState<Step>('platform');
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [token, setToken] = useState('');
  const [restrictIds, setRestrictIds] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    botInfo?: { username?: string; firstName?: string };
  } | null>(null);

  // Ref to track polling timer for QR
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (qrPollRef.current) clearInterval(qrPollRef.current);
    };
  }, []);

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  const selectPlatform = useCallback((p: PlatformInfo) => {
    setPlatform(p);
    if (p.qrBased) {
      // For QR-based platforms, show advanced options inline at platform step
      // then proceed directly to connecting
      setStep('token'); // Reuse token step for advanced options only
    } else {
      setStep('token');
    }
  }, []);

  /** Start QR-based setup: save config, connect, then wait for QR. */
  const startQrSetup = useCallback(async () => {
    if (!platform) return;

    setStep('connecting');

    try {
      const config: Record<string, string> = {};
      if (platform.qrBased) {
        config.connection_mode = 'baileys';
      }
      if (restrictIds.trim()) {
        config[platform.restrictField] = restrictIds.trim();
      }

      // Setup triggers connect — for Baileys this starts QR generation
      const data = await channelsApi.setup(platform.pluginId, config);

      if (data.status === 'connected') {
        // Already authenticated (existing session)
        setResult({
          success: true,
          message: 'Channel connected!',
          botInfo: data.botInfo,
        });
        setStep('result');
        toast.success(`${platform.name} connected`);
        return;
      }

      // Move to QR step — will receive QR via WebSocket or polling
      setStep('qr');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Setup failed';
      setResult({ success: false, message: msg });
      setStep('result');
      toast.error(`Setup failed: ${msg}`);
    }
  }, [platform, restrictIds, toast]);

  /** Token-based submit (Telegram, Discord, Slack). */
  const handleSubmit = useCallback(async () => {
    if (!platform) return;

    // For QR-based platforms, start QR setup instead
    if (platform.qrBased) {
      startQrSetup();
      return;
    }

    if (!token.trim()) return;

    const validationError = platform.validateToken(token.trim());
    if (validationError) {
      setTokenError(validationError);
      return;
    }

    setTokenError(null);
    setStep('connecting');

    try {
      const config: Record<string, string> = {
        bot_token: token.trim(),
      };
      if (restrictIds.trim()) {
        config[platform.restrictField] = restrictIds.trim();
      }

      const data = await channelsApi.setup(platform.pluginId, config);

      setResult({
        success: true,
        message: 'Channel connected!',
        botInfo: data.botInfo,
      });
      setStep('result');
      toast.success(`${platform.name} bot connected`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setResult({ success: false, message: msg });
      setStep('result');
      toast.error(`Setup failed: ${msg}`);
    }
  }, [platform, token, restrictIds, toast, startQrSetup]);

  // --- QR step: subscribe to WS events + poll for QR ---
  useEffect(() => {
    if (step !== 'qr' || !platform) return;

    // Subscribe to channel:qr for real-time QR updates
    const unsubQr = subscribe<{ channelId: string; qr: string }>(
      'channel:qr',
      async (data) => {
        if (data.channelId === platform.pluginId && data.qr) {
          try {
            const dataUrl = await QRCode.toDataURL(data.qr, {
              width: 280,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            setQrDataUrl(dataUrl);
          } catch {
            // QR generation failed
          }
        }
      }
    );

    // Subscribe to channel:status for connection success
    const unsubStatus = subscribe<{
      channelId: string;
      status: string;
      botInfo?: { username?: string; firstName?: string } | null;
    }>('channel:status', (data) => {
      if (data.channelId === platform.pluginId && data.status === 'connected') {
        setResult({
          success: true,
          message: 'Channel connected!',
          botInfo: data.botInfo ?? undefined,
        });
        setStep('result');
        toast.success(`${platform.name} connected`);
      }
    });

    // Also poll for QR in case WS event was missed
    const pollQr = async () => {
      try {
        const resp = await channelsApi.getQr(platform.pluginId);
        if (resp.status === 'connected') {
          setResult({
            success: true,
            message: 'Channel connected!',
            botInfo: resp.botInfo,
          });
          setStep('result');
          toast.success(`${platform.name} connected`);
          return;
        }
        if (resp.qr) {
          const dataUrl = await QRCode.toDataURL(resp.qr, {
            width: 280,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          setQrDataUrl(dataUrl);
        }
      } catch {
        // Poll failure is non-critical
      }
    };

    // Initial poll
    pollQr();
    qrPollRef.current = setInterval(pollQr, 3000);

    return () => {
      unsubQr();
      unsubStatus();
      if (qrPollRef.current) {
        clearInterval(qrPollRef.current);
        qrPollRef.current = null;
      }
    };
  }, [step, platform, subscribe, toast]);

  const handleRetry = useCallback(() => {
    setResult(null);
    setQrDataUrl(null);
    setStep('token');
  }, []);

  const handleBack = useCallback(() => {
    if (step === 'token') {
      setPlatform(null);
      setToken('');
      setRestrictIds('');
      setTokenError(null);
      setQrDataUrl(null);
      setStep('platform');
    } else if (step === 'qr') {
      setQrDataUrl(null);
      setStep('token');
    }
  }, [step]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-md bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            {step === 'platform' && 'Add Channel'}
            {step === 'token' && platform?.name}
            {step === 'connecting' && 'Connecting...'}
            {step === 'qr' && `Scan QR — ${platform?.name}`}
            {step === 'result' && (result?.success ? 'Connected' : 'Setup Failed')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {/* Step 1: Platform Selection */}
          {step === 'platform' && (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary mb-4">
                Select a platform to connect:
              </p>
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPlatform(p)}
                  className="w-full flex items-center gap-4 p-4 rounded-lg border border-border dark:border-dark-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                >
                  <p.Icon className="w-8 h-8 text-text-primary dark:text-dark-text-primary" />
                  <div>
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {p.name}
                    </span>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {p.tokenHint}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Token Input (or QR setup options for QR-based platforms) */}
          {step === 'token' && platform && (
            <div className="space-y-4">
              {/* Token input — only for token-based platforms */}
              {!platform.qrBased && (
                <div>
                  <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                    {platform.tokenLabel} <span className="text-error">*</span>
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setTokenError(null);
                    }}
                    placeholder={platform.tokenPlaceholder}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      tokenError ? 'border-error' : 'border-border dark:border-dark-border'
                    } bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary`}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmit();
                    }}
                  />
                  {tokenError && <p className="text-sm text-error mt-1">{tokenError}</p>}
                  <a
                    href={platform.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline mt-1 inline-block"
                  >
                    How to get a token?
                  </a>
                </div>
              )}

              {/* QR-based platforms: show explanation */}
              {platform.qrBased && (
                <div className="text-center py-2">
                  <platform.Icon className="w-10 h-10 mx-auto text-text-primary dark:text-dark-text-primary mb-2" />
                  <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
                    You will scan a QR code with your WhatsApp app to connect.
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                    No Meta Business account needed — uses your personal WhatsApp.
                  </p>
                </div>
              )}

              {/* Advanced toggle */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
              >
                {showAdvanced ? 'Hide' : 'Show'} advanced options
              </button>

              {showAdvanced && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    {platform.restrictLabel}
                  </label>
                  <input
                    type="text"
                    value={restrictIds}
                    onChange={(e) => setRestrictIds(e.target.value)}
                    placeholder="e.g. 123456789, 987654321"
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {/* Buttons */}
              <div className="flex justify-between pt-2">
                <button
                  onClick={handleBack}
                  className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:text-text-primary transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!platform.qrBased && !token.trim()}
                  className="px-6 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {platform.qrBased ? 'Start Setup' : 'Connect'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Connecting */}
          {step === 'connecting' && (
            <div className="flex flex-col items-center justify-center py-8">
              <LoadingSpinner />
              <p className="mt-4 text-text-secondary dark:text-dark-text-secondary">
                Connecting to {platform?.name}...
              </p>
            </div>
          )}

          {/* Step 3b: QR Code Scan */}
          {step === 'qr' && (
            <div className="flex flex-col items-center justify-center py-4">
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary mb-4 text-center">
                Open WhatsApp on your phone, go to{' '}
                <strong>Settings &gt; Linked Devices &gt; Link a Device</strong>, then scan this
                code:
              </p>

              {qrDataUrl ? (
                <div className="bg-white p-3 rounded-xl shadow-md">
                  <img
                    src={qrDataUrl}
                    alt="WhatsApp QR Code"
                    className="w-[280px] h-[280px]"
                  />
                </div>
              ) : (
                <div className="w-[280px] h-[280px] bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-xl flex items-center justify-center">
                  <LoadingSpinner />
                </div>
              )}

              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-4">
                Waiting for QR scan...
              </p>

              <button
                onClick={handleBack}
                className="mt-4 px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 'result' && result && (
            <div className="flex flex-col items-center justify-center py-6">
              {result.success ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
                    <Check className="w-6 h-6 text-success" />
                  </div>
                  <p className="text-lg font-medium text-text-primary dark:text-dark-text-primary">
                    {result.message}
                  </p>
                  {result.botInfo?.username && (
                    <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                      {platform?.qrBased ? `+${result.botInfo.username}` : `@${result.botInfo.username}`}
                    </p>
                  )}
                  {result.botInfo?.firstName && (
                    <p className="text-xs text-text-muted dark:text-dark-text-muted">
                      {result.botInfo.firstName}
                    </p>
                  )}
                  <button
                    onClick={() => {
                      onSuccess();
                      onClose();
                    }}
                    className="mt-6 px-6 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-6 h-6 text-error" />
                  </div>
                  <p className="text-lg font-medium text-text-primary dark:text-dark-text-primary">
                    Connection Failed
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 text-center max-w-xs">
                    {result.message}
                  </p>
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleRetry}
                      className="px-6 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={onClose}
                      className="px-6 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
