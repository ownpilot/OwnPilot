/**
 * Execution Security Panel
 *
 * Collapsible panel above chat input with per-category execution permissions.
 * Each category has a 3-state segmented control: Blocked / Ask / Allow.
 * Changes are auto-saved to the backend immediately.
 */

import { useState, useEffect, useCallback } from 'react';
import { Shield, ChevronDown, ChevronUp, Terminal, Code } from './icons';
import { executionPermissionsApi } from '../api';
import type { ExecutionPermissions, PermissionMode } from '../api';

type CategoryKey = keyof ExecutionPermissions;

const CATEGORIES: { key: CategoryKey; label: string; icon: typeof Terminal }[] = [
  { key: 'execute_javascript', label: 'JavaScript', icon: Code },
  { key: 'execute_python', label: 'Python', icon: Code },
  { key: 'execute_shell', label: 'Shell', icon: Terminal },
  { key: 'compile_code', label: 'Compile', icon: Code },
  { key: 'package_manager', label: 'Packages', icon: Terminal },
];

const MODE_CONFIG: Record<PermissionMode, { label: string; color: string; activeColor: string }> = {
  blocked: {
    label: 'Blocked',
    color: 'text-text-muted dark:text-dark-text-muted',
    activeColor: 'bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30',
  },
  prompt: {
    label: 'Ask',
    color: 'text-text-muted dark:text-dark-text-muted',
    activeColor: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30',
  },
  allowed: {
    label: 'Allow',
    color: 'text-text-muted dark:text-dark-text-muted',
    activeColor: 'bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/30',
  },
};

const DEFAULT_PERMISSIONS: ExecutionPermissions = {
  execute_javascript: 'blocked',
  execute_python: 'blocked',
  execute_shell: 'blocked',
  compile_code: 'blocked',
  package_manager: 'blocked',
};

export function ExecutionSecurityPanel() {
  const [permissions, setPermissions] = useState<ExecutionPermissions>(DEFAULT_PERMISSIONS);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    executionPermissionsApi.get()
      .then((data) => {
        setPermissions(data);
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  const handleModeChange = useCallback((key: CategoryKey, mode: PermissionMode) => {
    const updated = { ...permissions, [key]: mode };
    setPermissions(updated);
    executionPermissionsApi.update({ [key]: mode }).catch(() => {
      // Revert on failure
      setPermissions(permissions);
    });
  }, [permissions]);

  const activeCount = Object.values(permissions).filter((v) => v !== 'blocked').length;

  if (!isLoaded) return null;

  return (
    <div className="mb-2">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
      >
        <Shield className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted group-hover:text-primary transition-colors" />
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          Execution Security
        </span>
        {activeCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
            {activeCount}/5
          </span>
        )}
        {isExpanded
          ? <ChevronUp className="w-3 h-3 text-text-muted dark:text-dark-text-muted ml-auto" />
          : <ChevronDown className="w-3 h-3 text-text-muted dark:text-dark-text-muted ml-auto" />
        }
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-1 px-2 py-2 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border space-y-1.5">
          {CATEGORIES.map(({ key, label, icon: Icon }) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-[90px]">
                <Icon className="w-3 h-3 text-text-muted dark:text-dark-text-muted" />
                <span className="text-xs text-text-secondary dark:text-dark-text-secondary">{label}</span>
              </div>
              <div className="flex rounded-md overflow-hidden border border-border dark:border-dark-border">
                {(['blocked', 'prompt', 'allowed'] as PermissionMode[]).map((mode) => {
                  const isActive = permissions[key] === mode;
                  const config = MODE_CONFIG[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleModeChange(key, mode)}
                      className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        isActive
                          ? config.activeColor
                          : `${config.color} hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary`
                      }`}
                    >
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted pt-1">
            Changes saved automatically. Docker sandbox bypasses all checks.
          </p>
        </div>
      )}
    </div>
  );
}
