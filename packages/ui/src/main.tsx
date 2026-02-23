import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { WebSocketProvider } from './hooks/useWebSocket';
import { ThemeProvider } from './hooks/useTheme';
import { ChatProvider } from './hooks/useChatStore';
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
                <DialogProvider>
                  <ToastProvider>
                    <App />
                  </ToastProvider>
                </DialogProvider>
              </ChatProvider>
            </WebSocketProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
