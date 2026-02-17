import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageErrorBoundary } from './components/PageErrorBoundary';

// Lazy-load ChatPage like all other pages — keeps main bundle under 500 KB
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));

// Lazy-load all other pages for code splitting
const InboxPage = lazy(() => import('./pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const ChatHistoryPage = lazy(() => import('./pages/ChatHistoryPage').then((m) => ({ default: m.ChatHistoryPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then((m) => ({ default: m.AgentsPage })));
const ToolsPage = lazy(() => import('./pages/tools').then((m) => ({ default: m.ToolsPage })));
const ModelsPage = lazy(() => import('./pages/ModelsPage').then((m) => ({ default: m.ModelsPage })));
const CostsPage = lazy(() => import('./pages/CostsPage').then((m) => ({ default: m.CostsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const ContactsPage = lazy(() => import('./pages/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage').then((m) => ({ default: m.BookmarksPage })));
const CustomDataPage = lazy(() => import('./pages/CustomDataPage').then((m) => ({ default: m.CustomDataPage })));
const DataBrowserPage = lazy(() => import('./pages/DataBrowserPage').then((m) => ({ default: m.DataBrowserPage })));
const MemoriesPage = lazy(() => import('./pages/MemoriesPage').then((m) => ({ default: m.MemoriesPage })));
const GoalsPage = lazy(() => import('./pages/GoalsPage').then((m) => ({ default: m.GoalsPage })));
const TriggersPage = lazy(() => import('./pages/TriggersPage').then((m) => ({ default: m.TriggersPage })));
const PlansPage = lazy(() => import('./pages/PlansPage').then((m) => ({ default: m.PlansPage })));
const AutonomyPage = lazy(() => import('./pages/AutonomyPage').then((m) => ({ default: m.AutonomyPage })));
const PluginsPage = lazy(() => import('./pages/PluginsPage').then((m) => ({ default: m.PluginsPage })));
const SkillPackagesPage = lazy(() => import('./pages/SkillPackagesPage').then((m) => ({ default: m.SkillPackagesPage })));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })));
const CustomToolsPage = lazy(() => import('./pages/CustomToolsPage').then((m) => ({ default: m.CustomToolsPage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const ConfigCenterPage = lazy(() => import('./pages/ConfigCenterPage').then((m) => ({ default: m.ConfigCenterPage })));
const ApiKeysPage = lazy(() => import('./pages/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then((m) => ({ default: m.ProvidersPage })));
const AIModelsPage = lazy(() => import('./pages/AIModelsPage').then((m) => ({ default: m.AIModelsPage })));
const ConnectedAppsPage = lazy(() => import('./pages/ConnectedAppsPage').then((m) => ({ default: m.ConnectedAppsPage })));
const McpServersPage = lazy(() => import('./pages/McpServersPage').then((m) => ({ default: m.McpServersPage })));

const SystemPage = lazy(() => import('./pages/SystemPage').then((m) => ({ default: m.SystemPage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/** Wraps a lazy page with Suspense + PageErrorBoundary */
function page(children: ReactNode) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={page(<ChatPage />)} />
        <Route path="dashboard" element={page(<DashboardPage />)} />
        <Route path="memories" element={page(<MemoriesPage />)} />
        <Route path="goals" element={page(<GoalsPage />)} />
        <Route path="triggers" element={page(<TriggersPage />)} />
        <Route path="plans" element={page(<PlansPage />)} />
        <Route path="autonomy" element={page(<AutonomyPage />)} />
        <Route path="tasks" element={page(<TasksPage />)} />
        <Route path="notes" element={page(<NotesPage />)} />
        <Route path="calendar" element={page(<CalendarPage />)} />
        <Route path="contacts" element={page(<ContactsPage />)} />
        <Route path="bookmarks" element={page(<BookmarksPage />)} />
        <Route path="expenses" element={page(<ExpensesPage />)} />
        <Route path="custom-data" element={page(<CustomDataPage />)} />
        <Route path="data-browser" element={page(<DataBrowserPage />)} />
        <Route path="inbox" element={page(<InboxPage />)} />
        <Route path="history" element={page(<ChatHistoryPage />)} />
        <Route path="agents" element={page(<AgentsPage />)} />
        <Route path="tools" element={page(<ToolsPage />)} />
        <Route path="custom-tools" element={page(<CustomToolsPage />)} />
        <Route path="plugins" element={page(<PluginsPage />)} />
        <Route path="skill-packages" element={page(<SkillPackagesPage />)} />
        <Route path="workspaces" element={page(<WorkspacesPage />)} />
        <Route path="models" element={page(<ModelsPage />)} />
        <Route path="costs" element={page(<CostsPage />)} />
        <Route path="logs" element={page(<LogsPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="settings/config-center" element={page(<ConfigCenterPage />)} />
        <Route path="settings/api-keys" element={page(<ApiKeysPage />)} />
        <Route path="settings/providers" element={page(<ProvidersPage />)} />
        <Route path="settings/ai-models" element={page(<AIModelsPage />)} />
        <Route path="settings/integrations" element={<Navigate to="/settings/connected-apps" replace />} />
        <Route path="settings/connected-apps" element={page(<ConnectedAppsPage />)} />
        <Route path="settings/mcp-servers" element={page(<McpServersPage />)} />

        <Route path="settings/system" element={page(<SystemPage />)} />
        <Route path="about" element={page(<AboutPage />)} />
        <Route path="profile" element={page(<ProfilePage />)} />
        {/* Catch-all route - redirect unknown paths to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
