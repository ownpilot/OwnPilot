/**
 * LayoutConfigPage — interactive layout configuration with visual wireframe.
 *
 * Route: /settings/layout
 *
 * Top: clickable mini layout wireframe (header zones + body areas)
 * Middle: zone-specific settings panel (display mode, entries, add/remove)
 * Bottom: global settings (theme, reset)
 *
 * Pattern: Soybean Admin layout thumbnails + Shopify Preview Inspector
 * Changes apply instantly via Context state → live preview.
 */
import { useState } from 'react';
import { LayoutWireframe, type WireframeZone } from '../components/LayoutWireframe';
import { ZoneEditor } from '../components/ZoneEditor';
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { useTheme } from '../hooks/useTheme';
import { ALL_NAV_ITEMS } from '../constants/nav-items';
import { DEFAULT_LAYOUT_CONFIG } from '../types/layout-config';
import { RotateCcw, Sun, Moon, Monitor, Palette, Plus, X } from '../components/icons';

type ThemeOption = 'system' | 'light' | 'dark' | 'claude';

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'claude', label: 'Claude', icon: Palette },
];

export function LayoutConfigPage() {
  const [selectedZone, setSelectedZone] = useState<WireframeZone | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupItems, setNewGroupItems] = useState<Set<string>>(new Set());
  const { config, setConfig, addCustomGroup, removeCustomGroup } = useLayoutConfig();
  const { theme, setTheme } = useTheme();

  const handleReset = () => {
    setConfig(DEFAULT_LAYOUT_CONFIG);
    setSelectedZone(null);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary">
          Layout Configuration
        </h1>
        <p className="mt-1 text-sm text-text-secondary dark:text-dark-text-secondary">
          Click a zone to configure it. Changes apply instantly.
        </p>
      </div>

      {/* Interactive wireframe */}
      <LayoutWireframe selectedZone={selectedZone} onZoneSelect={setSelectedZone} />

      {/* Zone editor (shown when a zone is selected) */}
      {selectedZone && <ZoneEditor zone={selectedZone} />}

      {/* Custom Groups section */}
      <section className="space-y-4 pt-2">
        <div className="flex items-center justify-between border-b border-border dark:border-dark-border pb-2">
          <h2 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Custom Groups
          </h2>
          <button
            onClick={() => { setShowCreateGroup(true); setNewGroupName(''); setNewGroupItems(new Set()); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="w-3 h-3" /> New Group
          </button>
        </div>

        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Create reusable groups from any items. Add them to header zones or sidebar.
        </p>

        {/* Existing custom groups */}
        {config.customGroups.length > 0 && (
          <div className="space-y-1">
            {config.customGroups.map((group) => (
              <div key={group.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-xs">
                <span className="font-medium text-text-primary dark:text-dark-text-primary flex-1">{group.label}</span>
                <span className="text-text-muted dark:text-dark-text-muted">{group.items.length} items</span>
                <button
                  onClick={() => removeCustomGroup(group.id)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-error/10 hover:text-error transition-colors text-text-muted dark:text-dark-text-muted"
                  title="Delete group"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {config.customGroups.length === 0 && !showCreateGroup && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted italic py-2">
            No custom groups yet. Click "New Group" to create one.
          </p>
        )}

        {/* Create group form */}
        {showCreateGroup && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
            <p className="text-xs font-medium text-primary">New Custom Group</p>
            <input
              type="text"
              placeholder="Group name..."
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
              className="w-full px-2.5 py-1.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary placeholder-text-muted dark:placeholder-dark-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
            <div className="max-h-[180px] overflow-y-auto space-y-0.5">
              {ALL_NAV_ITEMS.slice(0, 30).map((item) => {
                const Icon = item.icon;
                const checked = newGroupItems.has(item.to);
                return (
                  <label
                    key={item.to}
                    className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                      checked ? 'bg-primary/10 text-primary' : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setNewGroupItems((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.to)) next.delete(item.to); else next.add(item.to);
                          return next;
                        });
                      }}
                      className="w-3 h-3 rounded border-border accent-primary"
                    />
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCreateGroup(false)}
                className="px-2.5 py-1 text-xs rounded text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newGroupName.trim() && newGroupItems.size > 0) {
                    addCustomGroup(newGroupName.trim(), Array.from(newGroupItems));
                    setShowCreateGroup(false);
                  }
                }}
                disabled={!newGroupName.trim() || newGroupItems.size === 0}
                className="px-2.5 py-1 text-xs rounded font-medium bg-primary text-white hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Create ({newGroupItems.size})
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Global settings */}
      <section className="space-y-4 pt-2">
        <h2 className="text-sm font-medium text-text-primary dark:text-dark-text-primary border-b border-border dark:border-dark-border pb-2">
          Global Settings
        </h2>

        {/* Theme selector */}
        <div className="space-y-2">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Theme</p>
          <div className="flex gap-1">
            {THEME_OPTIONS.map(({ value, label, icon: ThemeIcon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  theme === value
                    ? 'bg-primary text-white'
                    : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 hover:text-primary'
                }`}
              >
                <ThemeIcon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Reset */}
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-text-muted dark:text-dark-text-muted hover:text-error hover:bg-error/10 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset Layout to Defaults
        </button>
      </section>

      {/* Info note */}
      <div className="text-xs text-text-muted dark:text-dark-text-muted bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg px-4 py-3">
        Layout settings are saved to this device. Header zones are only visible on desktop.
      </div>
    </div>
  );
}
