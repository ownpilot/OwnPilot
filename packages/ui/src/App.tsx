import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ChatPage } from './pages/ChatPage';
import { InboxPage } from './pages/InboxPage';
import { AgentsPage } from './pages/AgentsPage';
import { ToolsPage } from './pages/tools';
import { ModelsPage } from './pages/ModelsPage';
import { CostsPage } from './pages/CostsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardPage } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';
import { NotesPage } from './pages/NotesPage';
import { CalendarPage } from './pages/CalendarPage';
import { ContactsPage } from './pages/ContactsPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { CustomDataPage } from './pages/CustomDataPage';
import { DataBrowserPage } from './pages/DataBrowserPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { GoalsPage } from './pages/GoalsPage';
import { TriggersPage } from './pages/TriggersPage';
import { PlansPage } from './pages/PlansPage';
import { AutonomyPage } from './pages/AutonomyPage';
import { PluginsPage } from './pages/PluginsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { LogsPage } from './pages/LogsPage';
import { CustomToolsPage } from './pages/CustomToolsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ConfigCenterPage } from './pages/ConfigCenterPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { AIModelsPage } from './pages/AIModelsPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { MediaSettingsPage } from './pages/MediaSettingsPage';
import { SystemPage } from './pages/SystemPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ChatPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="memories" element={<MemoriesPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="triggers" element={<TriggersPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="autonomy" element={<AutonomyPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="bookmarks" element={<BookmarksPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="custom-data" element={<CustomDataPage />} />
        <Route path="data-browser" element={<DataBrowserPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="custom-tools" element={<CustomToolsPage />} />
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="workspaces" element={<WorkspacesPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="costs" element={<CostsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/config-center" element={<ConfigCenterPage />} />
        <Route path="settings/api-keys" element={<ApiKeysPage />} />
        <Route path="settings/providers" element={<ProvidersPage />} />
        <Route path="settings/ai-models" element={<AIModelsPage />} />
        <Route path="settings/integrations" element={<IntegrationsPage />} />
        <Route path="settings/media" element={<MediaSettingsPage />} />
        <Route path="settings/system" element={<SystemPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* Catch-all route - redirect unknown paths to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
