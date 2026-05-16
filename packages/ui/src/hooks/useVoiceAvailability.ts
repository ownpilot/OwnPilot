import { useEffect, useState } from 'react';
import { voiceApi, type VoiceConfig } from '../api/endpoints/voice';

type VoiceCapability = 'stt' | 'tts';

const STATUS_CACHE_TTL_MS = 30_000;

let cachedStatus: VoiceConfig | null = null;
let cachedAt = 0;
let pendingStatus: Promise<VoiceConfig> | null = null;

function getVoiceStatus(): Promise<VoiceConfig> {
  if (cachedStatus && Date.now() - cachedAt < STATUS_CACHE_TTL_MS) {
    return Promise.resolve(cachedStatus);
  }
  pendingStatus ??= voiceApi
    .getStatus()
    .then((status) => {
      cachedStatus = status;
      cachedAt = Date.now();
      return status;
    })
    .finally(() => {
      pendingStatus = null;
    });
  return pendingStatus;
}

function supportsCapability(status: VoiceConfig, capability: VoiceCapability): boolean {
  if (!status.available) return false;
  if (capability === 'stt') return status.sttAvailable || status.sttSupported;
  return status.ttsAvailable || status.ttsSupported;
}

export function useVoiceAvailability(capability: VoiceCapability): boolean | null {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(() =>
    cachedStatus ? supportsCapability(cachedStatus, capability) : null
  );

  useEffect(() => {
    let cancelled = false;
    getVoiceStatus()
      .then((status) => {
        if (!cancelled) setIsAvailable(supportsCapability(status, capability));
      })
      .catch(() => {
        if (!cancelled) setIsAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, [capability]);

  return isAvailable;
}
