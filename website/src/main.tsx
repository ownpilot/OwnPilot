import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';

// Initialize theme before render to prevent flash
const stored = localStorage.getItem('ownpilot-theme');
let theme = 'system';
try {
  const parsed = JSON.parse(stored ?? '{}') as { state?: { theme?: string } };
  theme = parsed?.state?.theme ?? 'system';
} catch {
  // ignore
}
const resolved =
  theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : theme;
document.documentElement.classList.toggle('dark', resolved === 'dark');

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
