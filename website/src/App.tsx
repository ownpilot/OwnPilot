import { HashRouter, Routes, Route } from 'react-router';
import { Suspense, lazy, useEffect } from 'react';
import { useThemeStore } from '@/hooks/useTheme';

// Pages
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Lazy-loaded pages
const ChangelogPage = lazy(() =>
  import('@/pages/ChangelogPage').then((m) => ({ default: m.ChangelogPage }))
);
const IntroductionPage = lazy(() =>
  import('@/pages/docs/IntroductionPage').then((m) => ({ default: m.IntroductionPage }))
);
const QuickStartPage = lazy(() =>
  import('@/pages/docs/QuickStartPage').then((m) => ({ default: m.QuickStartPage }))
);
const InstallationPage = lazy(() =>
  import('@/pages/docs/InstallationPage').then((m) => ({ default: m.InstallationPage }))
);
const ArchitecturePage = lazy(() =>
  import('@/pages/docs/ArchitecturePage').then((m) => ({ default: m.ArchitecturePage }))
);
const ProvidersPage = lazy(() =>
  import('@/pages/docs/ProvidersPage').then((m) => ({ default: m.ProvidersPage }))
);
const AgentsPage = lazy(() =>
  import('@/pages/docs/AgentsPage').then((m) => ({ default: m.AgentsPage }))
);
const ToolsPage = lazy(() =>
  import('@/pages/docs/ToolsPage').then((m) => ({ default: m.ToolsPage }))
);
const WorkflowsPage = lazy(() =>
  import('@/pages/docs/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage }))
);
const SecurityPage = lazy(() =>
  import('@/pages/docs/SecurityPage').then((m) => ({ default: m.SecurityPage }))
);
const ApiReferencePage = lazy(() =>
  import('@/pages/docs/ApiReferencePage').then((m) => ({ default: m.ApiReferencePage }))
);
const DeploymentPage = lazy(() =>
  import('@/pages/docs/DeploymentPage').then((m) => ({ default: m.DeploymentPage }))
);
const PersonalDataPage = lazy(() =>
  import('@/pages/docs/PersonalDataPage').then((m) => ({ default: m.PersonalDataPage }))
);
const ChannelsPage = lazy(() =>
  import('@/pages/docs/ChannelsPage').then((m) => ({ default: m.ChannelsPage }))
);
const McpPage = lazy(() => import('@/pages/docs/McpPage').then((m) => ({ default: m.McpPage })));
const CodingAgentsPage = lazy(() =>
  import('@/pages/docs/CodingAgentsPage').then((m) => ({ default: m.CodingAgentsPage }))
);
const EdgeDevicesPage = lazy(() =>
  import('@/pages/docs/EdgeDevicesPage').then((m) => ({ default: m.EdgeDevicesPage }))
);
const ConfigurationPage = lazy(() =>
  import('@/pages/docs/ConfigurationPage').then((m) => ({ default: m.ConfigurationPage }))
);

function PageLoader() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent animate-spin" />
        <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
      </div>
    </div>
  );
}

function ThemeInitializer() {
  const { theme, setTheme } = useThemeStore();

  useEffect(() => {
    // Re-apply theme on mount
    setTheme(theme);

    // Listen for system theme changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        setTheme('system');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, setTheme]);

  return null;
}

export default function App() {
  return (
    <HashRouter>
      <ThemeInitializer />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Home */}
          <Route path="/" element={<HomePage />} />

          {/* Docs */}
          <Route path="/docs" element={<IntroductionPage />} />
          <Route path="/docs/introduction" element={<IntroductionPage />} />
          <Route path="/docs/getting-started" element={<IntroductionPage />} />
          <Route path="/docs/quick-start" element={<QuickStartPage />} />
          <Route path="/docs/installation" element={<InstallationPage />} />
          <Route path="/docs/configuration" element={<ConfigurationPage />} />
          <Route path="/docs/architecture" element={<ArchitecturePage />} />
          <Route path="/docs/architecture/*" element={<ArchitecturePage />} />
          <Route path="/docs/providers" element={<ProvidersPage />} />
          <Route path="/docs/providers/*" element={<ProvidersPage />} />
          <Route path="/docs/agents" element={<AgentsPage />} />
          <Route path="/docs/agents/*" element={<AgentsPage />} />
          <Route path="/docs/tools" element={<ToolsPage />} />
          <Route path="/docs/tools/*" element={<ToolsPage />} />
          <Route path="/docs/personal-data" element={<PersonalDataPage />} />
          <Route path="/docs/personal-data/*" element={<PersonalDataPage />} />
          <Route path="/docs/channels" element={<ChannelsPage />} />
          <Route path="/docs/channels/*" element={<ChannelsPage />} />
          <Route path="/docs/mcp" element={<McpPage />} />
          <Route path="/docs/mcp/*" element={<McpPage />} />
          <Route path="/docs/coding-agents" element={<CodingAgentsPage />} />
          <Route path="/docs/coding-agents/*" element={<CodingAgentsPage />} />
          <Route path="/docs/edge-devices" element={<EdgeDevicesPage />} />
          <Route path="/docs/edge-devices/*" element={<EdgeDevicesPage />} />
          <Route path="/docs/automation/workflows" element={<WorkflowsPage />} />
          <Route path="/docs/automation/*" element={<WorkflowsPage />} />
          <Route path="/docs/security" element={<SecurityPage />} />
          <Route path="/docs/security/*" element={<SecurityPage />} />
          <Route path="/docs/api-reference" element={<ApiReferencePage />} />
          <Route path="/docs/api-reference/*" element={<ApiReferencePage />} />
          <Route path="/docs/deployment" element={<DeploymentPage />} />
          <Route path="/docs/deployment/*" element={<DeploymentPage />} />

          {/* Changelog */}
          <Route path="/changelog" element={<ChangelogPage />} />

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
