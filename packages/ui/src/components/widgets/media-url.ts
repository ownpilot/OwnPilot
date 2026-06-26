import { safeExternalHref } from '../../utils/safe-url';

const CTRL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const PROTOCOL_RELATIVE_RE = /^\/\//;
const ABSOLUTE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const IMAGE_DATA_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+$/;
const AUDIO_DATA_RE = /^data:audio\/(?:mpeg|mp3|wav|ogg|webm|mp4|aac|flac);base64,[A-Za-z0-9+/=]+$/;
const VIDEO_DATA_RE = /^data:video\/(?:mp4|webm|ogg|quicktime);base64,[A-Za-z0-9+/=]+$/;

function isCleanString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    !CTRL_CHAR_RE.test(value)
  );
}

function safeRemoteMediaSrc(src: unknown): string | undefined {
  if (!isCleanString(src)) return undefined;
  if (PROTOCOL_RELATIVE_RE.test(src)) return src;
  if (!ABSOLUTE_SCHEME_RE.test(src)) return undefined;
  return safeExternalHref(src);
}

function safeDataSrc(src: string, pattern: RegExp): string | undefined {
  return pattern.test(src) ? src : undefined;
}

export function safeImageSrc(src: unknown): string | undefined {
  const remote = safeRemoteMediaSrc(src);
  if (remote) return remote;
  return isCleanString(src) ? safeDataSrc(src, IMAGE_DATA_RE) : undefined;
}

export function safeAudioSrc(src: unknown): string | undefined {
  const remote = safeRemoteMediaSrc(src);
  if (remote) return remote;
  return isCleanString(src) ? safeDataSrc(src, AUDIO_DATA_RE) : undefined;
}

export function safeVideoSrc(src: unknown): string | undefined {
  const remote = safeRemoteMediaSrc(src);
  if (remote) return remote;
  return isCleanString(src) ? safeDataSrc(src, VIDEO_DATA_RE) : undefined;
}

export function safeEmbedSrc(src: unknown): string | undefined {
  const remote = safeRemoteMediaSrc(src);
  if (!remote) return undefined;

  try {
    const parsed = new URL(remote, 'https://ownpilot.local');
    const windowOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    if (windowOrigin && parsed.origin === windowOrigin) return undefined;
    return remote;
  } catch {
    return undefined;
  }
}
