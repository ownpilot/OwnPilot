/**
 * Security Banner
 *
 * Persistent warning banner shown when no UI password is configured.
 * Not dismissible — stays until a password is set.
 */

import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ShieldCheck } from './icons';

export function SecurityBanner() {
  const { passwordConfigured, isLoading } = useAuth();

  // Don't show during loading or if password is configured
  if (isLoading || passwordConfigured) return null;

  return (
    <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 flex items-center gap-2 text-sm">
      <ShieldCheck className="w-4 h-4 text-warning shrink-0" />
      <span className="text-text-primary dark:text-dark-text-primary">
        Your dashboard is not password protected.
      </span>
      <Link
        to="/settings/security"
        className="text-primary hover:underline font-medium ml-1"
      >
        Set Password
      </Link>
    </div>
  );
}
