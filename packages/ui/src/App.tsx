import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';

// Eagerly load the default route for instant first paint
import { ChatPage } from './pages/ChatPage';

// Lazy-load all other pages for code splitting
const InboxPage = lazy(() => import('./pages/InboxPage').then((m) => ({ default: m.InboxPage })));
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
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })));
const CustomToolsPage = lazy(() => import('./pages/CustomToolsPage').then((m) => ({ default: m.CustomToolsPage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const ConfigCenterPage = lazy(() => import('./pages/ConfigCenterPage').then((m) => ({ default: m.ConfigCenterPage })));
const ApiKeysPage = lazy(() => import('./pages/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then((m) => ({ default: m.ProvidersPage })));
const AIModelsPage = lazy(() => import('./pages/AIModelsPage').then((m) => ({ default: m.AIModelsPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })));
const MediaSettingsPage = lazy(() => import('./pages/MediaSettingsPage').then((m) => ({ default: m.MediaSettingsPage })));
const SystemPage = lazy(() => import('./pages/SystemPage').then((m) => ({ default: m.SystemPage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ChatPage />} />
        <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
        <Route path="memories" element={<Suspense fallback={<PageLoader />}><MemoriesPage /></Suspense>} />
        <Route path="goals" element={<Suspense fallback={<PageLoader />}><GoalsPage /></Suspense>} />
        <Route path="triggers" element={<Suspense fallback={<PageLoader />}><TriggersPage /></Suspense>} />
        <Route path="plans" element={<Suspense fallback={<PageLoader />}><PlansPage /></Suspense>} />
        <Route path="autonomy" element={<Suspense fallback={<PageLoader />}><AutonomyPage /></Suspense>} />
        <Route path="tasks" element={<Suspense fallback={<PageLoader />}><TasksPage /></Suspense>} />
        <Route path="notes" element={<Suspense fallback={<PageLoader />}><NotesPage /></Suspense>} />
        <Route path="calendar" element={<Suspense fallback={<PageLoader />}><CalendarPage /></Suspense>} />
        <Route path="contacts" element={<Suspense fallback={<PageLoader />}><ContactsPage /></Suspense>} />
        <Route path="bookmarks" element={<Suspense fallback={<PageLoader />}><BookmarksPage /></Suspense>} />
        <Route path="expenses" element={<Suspense fallback={<PageLoader />}><ExpensesPage /></Suspense>} />
        <Route path="custom-data" element={<Suspense fallback={<PageLoader />}><CustomDataPage /></Suspense>} />
        <Route path="data-browser" element={<Suspense fallback={<PageLoader />}><DataBrowserPage /></Suspense>} />
        <Route path="inbox" element={<Suspense fallback={<PageLoader />}><InboxPage /></Suspense>} />
        <Route path="agents" element={<Suspense fallback={<PageLoader />}><AgentsPage /></Suspense>} />
        <Route path="tools" element={<Suspense fallback={<PageLoader />}><ToolsPage /></Suspense>} />
        <Route path="custom-tools" element={<Suspense fallback={<PageLoader />}><CustomToolsPage /></Suspense>} />
        <Route path="plugins" element={<Suspense fallback={<PageLoader />}><PluginsPage /></Suspense>} />
        <Route path="workspaces" element={<Suspense fallback={<PageLoader />}><WorkspacesPage /></Suspense>} />
        <Route path="models" element={<Suspense fallback={<PageLoader />}><ModelsPage /></Suspense>} />
        <Route path="costs" element={<Suspense fallback={<PageLoader />}><CostsPage /></Suspense>} />
        <Route path="logs" element={<Suspense fallback={<PageLoader />}><LogsPage /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        <Route path="settings/config-center" element={<Suspense fallback={<PageLoader />}><ConfigCenterPage /></Suspense>} />
        <Route path="settings/api-keys" element={<Suspense fallback={<PageLoader />}><ApiKeysPage /></Suspense>} />
        <Route path="settings/providers" element={<Suspense fallback={<PageLoader />}><ProvidersPage /></Suspense>} />
        <Route path="settings/ai-models" element={<Suspense fallback={<PageLoader />}><AIModelsPage /></Suspense>} />
        <Route path="settings/integrations" element={<Suspense fallback={<PageLoader />}><IntegrationsPage /></Suspense>} />
        <Route path="settings/media" element={<Suspense fallback={<PageLoader />}><MediaSettingsPage /></Suspense>} />
        <Route path="settings/system" element={<Suspense fallback={<PageLoader />}><SystemPage /></Suspense>} />
        <Route path="about" element={<Suspense fallback={<PageLoader />}><AboutPage /></Suspense>} />
        <Route path="profile" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
        {/* Catch-all route - redirect unknown paths to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
