import { Navigate } from 'react-router';

export function SettingsPage() {
  return <Navigate to="/settings/api-keys" replace />;
}
