// Polyfill: crypto.randomUUID is unavailable in non-secure contexts (HTTP without TLS).
// This enables OwnPilot to work over Tailscale, LAN, or any plain-HTTP access.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40; // version 4
    b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { WebSocketProvider } from './hooks/useWebSocket';
import { ThemeProvider } from './hooks/useTheme';
import { ChatProvider } from './hooks/useChatStore';
import { SidebarChatProvider } from './hooks/useSidebarChat';
import { AuthProvider } from './hooks/useAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DialogProvider } from './components/ConfirmDialog';
import { ToastProvider } from './components/ToastProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <WebSocketProvider>
              <ChatProvider>
                <SidebarChatProvider>
                  <DialogProvider>
                    <ToastProvider>
                      <App />
                    </ToastProvider>
                  </DialogProvider>
                </SidebarChatProvider>
              </ChatProvider>
            </WebSocketProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
