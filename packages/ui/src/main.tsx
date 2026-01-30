import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { WebSocketProvider } from './hooks/useWebSocket';
import { ThemeProvider } from './hooks/useTheme';
import { ChatProvider } from './hooks/useChatStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DialogProvider } from './components/ConfirmDialog';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <WebSocketProvider>
            <ChatProvider>
              <DialogProvider>
                <App />
              </DialogProvider>
            </ChatProvider>
          </WebSocketProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
