/**
 * Execution Security Panel
 *
 * Collapsible panel above chat input with master toggle, execution mode selector,
 * and per-category execution permissions.
 *
 * - Master toggle OFF → all execution blocked, controls disabled/greyed
 * - Mode = Local → Docker check skipped (no 5s timeout)
 * - Mode = Docker → Docker required, compile/packages unavailable
 * - Mode = Auto → Docker if available, else local fallback
 * - Each category: Blocked / Ask / Allow segmented control
 * - Changes auto-saved to backend
 */

import { useState, useEffect, useCallback } from 'react';
import { Shield, ChevronDown, ChevronUp, Terminal, Code } from './icons';
import { executionPermissionsApi } from '../api';
import type { ExecutionPermissions, ExecutionMode, PermissionMode } from '../api';

/** Only the 5 category keys (not enabled/mode) */
type CategoryKey =
  | 'execute_javascript'
  | 'execute_python'
  | 'execute_shell'
  | 'compile_code'
  | 'package_manager';

const CATEGORIES: {
  key: CategoryKey;
  label: string;
  icon: typeof Terminal;
  localOnly?: boolean;
}[] = [
  { key: 'execute_javascript', label: 'JavaScript', icon: Code },
  { key: 'execute_python', label: 'Python', icon: Code },
  { key: 'execute_shell', label: 'Shell', icon: Terminal },
  { key: 'compile_code', label: 'Compile', icon: Code, localOnly: true },
  { key: 'package_manager', label: 'Packages', icon: Terminal, localOnly: true },
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

const EXEC_MODES: { value: ExecutionMode; label: string }[] = [
  { value: 'local', label: 'Local' },
  { value: 'docker', label: 'Docker' },
  { value: 'auto', label: 'Auto' },
];

const DEFAULT_PERMISSIONS: ExecutionPermissions = {
  enabled: false,
  mode: 'local',
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
    executionPermissionsApi
      .get()
      .then((data) => {
        setPermissions({ ...DEFAULT_PERMISSIONS, ...data });
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  const handleToggle = useCallback(() => {
    setPermissions((prev) => {
      const updated = { ...prev, enabled: !prev.enabled };
      executionPermissionsApi
        .update({ enabled: updated.enabled } as Partial<ExecutionPermissions>)
        .catch(() => {
          setPermissions((p) => ({ ...p, enabled: !updated.enabled }));
        });
      return updated;
    });
  }, []);

  const handleModeSwitch = useCallback((mode: ExecutionMode) => {
    setPermissions((prev) => {
      const oldMode = prev.mode;
      executionPermissionsApi.update({ mode } as Partial<ExecutionPermissions>).catch(() => {
        setPermissions((p) => ({ ...p, mode: oldMode }));
      });
      return { ...prev, mode };
    });
  }, []);

  const handleModeChange = useCallback((key: CategoryKey, mode: PermissionMode) => {
    setPermissions((prev) => {
      const oldMode = prev[key];
      executionPermissionsApi.update({ [key]: mode }).catch(() => {
        setPermissions((p) => ({ ...p, [key]: oldMode }));
      });
      return { ...prev, [key]: mode };
    });
  }, []);

  const activeCount = permissions.enabled
    ? Object.entries(permissions).filter(
        ([k, v]) => k !== 'enabled' && k !== 'mode' && v !== 'blocked'
      ).length
    : 0;

  if (!isLoaded) return null;

  return (
    <div className="mb-2">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
      >
        <Shield className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted group-hover:text-primary transition-colors" />
        <span className="text-xs text-text-muted dark:text-dark-text-muted">Code Execution</span>

        {/* Master toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          className={`ml-1 relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            permissions.enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out ${
              permissions.enabled ? 'translate-x-3' : 'translate-x-0'
            }`}
          />
        </button>

        {permissions.enabled && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              permissions.mode === 'docker'
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : permissions.mode === 'auto'
                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                  : 'bg-gray-500/15 text-gray-600 dark:text-gray-400'
            }`}
          >
            {permissions.mode === 'docker'
              ? 'Docker'
              : permissions.mode === 'auto'
                ? 'Auto'
                : 'Local'}
          </span>
        )}
        {permissions.enabled && activeCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
            {activeCount}/5
          </span>
        )}
        {isExpanded ? (
          <ChevronUp className="w-3 h-3 text-text-muted dark:text-dark-text-muted ml-auto" />
        ) : (
          <ChevronDown className="w-3 h-3 text-text-muted dark:text-dark-text-muted ml-auto" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div
          className={`mt-1 px-2 py-2 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border space-y-2 ${
            !permissions.enabled ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          {/* Mode selector */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider font-medium w-[52px]">
              Mode
            </span>
            <div className="flex rounded-md overflow-hidden border border-border dark:border-dark-border">
              {EXEC_MODES.map(({ value, label }) => {
                const isActive = permissions.mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleModeSwitch(value)}
                    className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                      isActive
                        ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                        : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-border dark:border-dark-border" />

          {/* Category rows */}
          <div className="space-y-1.5">
            {CATEGORIES.map(({ key, label, icon: Icon, localOnly }) => {
              const isDisabledByMode = localOnly && permissions.mode === 'docker';
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between gap-2 ${isDisabledByMode ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-1.5 min-w-[90px]">
                    <Icon className="w-3 h-3 text-text-muted dark:text-dark-text-muted" />
                    <span className="text-xs text-text-secondary dark:text-dark-text-secondary">
                      {label}
                      {isDisabledByMode && (
                        <span className="text-[9px] text-text-muted dark:text-dark-text-muted ml-1">
                          (local only)
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    className={`flex rounded-md overflow-hidden border border-border dark:border-dark-border ${isDisabledByMode ? 'pointer-events-none' : ''}`}
                  >
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
              );
            })}
          </div>

          <p className="text-[10px] text-text-muted dark:text-dark-text-muted pt-1">
            Changes saved automatically.
          </p>
        </div>
      )}
    </div>
  );
}
