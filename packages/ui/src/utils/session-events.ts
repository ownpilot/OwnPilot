export const SESSION_CHANGED_EVENT = 'ownpilot:session-changed';

export interface SessionChangedDetail {
  authenticated: boolean;
}

export function dispatchSessionChanged(authenticated: boolean): void {
  window.dispatchEvent(
    new CustomEvent<SessionChangedDetail>(SESSION_CHANGED_EVENT, {
      detail: { authenticated },
    })
  );
}

export function onSessionChanged(handler: (detail: SessionChangedDetail) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<SessionChangedDetail>).detail);
  };
  window.addEventListener(SESSION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SESSION_CHANGED_EVENT, listener);
}
