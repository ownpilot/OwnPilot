import { useState } from 'react';
import type { ToolItem, TabId } from './types';
import { CATEGORY_NAMES } from './constants';
import { OverviewTab } from './tabs/OverviewTab';
import { SchemaTab } from './tabs/SchemaTab';
import { CodeTab } from './tabs/CodeTab';
import { TestTab } from './tabs/TestTab';

interface ToolDetailModalProps {
  tool: ToolItem;
  onClose: () => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'schema', label: 'Schema' },
  { id: 'code', label: 'Code' },
  { id: 'test', label: 'Test' },
];

export function ToolDetailModal({ tool, onClose }: ToolDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const tabClass = (tab: TabId) =>
    `px-4 py-2 text-sm rounded-lg transition-colors ${
      activeTab === tab
        ? 'bg-primary/10 text-primary'
        : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
    }`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {tool.name}
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 line-clamp-2">
                {tool.description}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {tool.category && (
                  <span className="px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded">
                    {CATEGORY_NAMES[tool.category] || tool.category}
                  </span>
                )}
                {tool.source && (
                  <span className="px-2 py-0.5 text-xs bg-primary/5 text-primary rounded">
                    {tool.source}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={tabClass(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && <OverviewTab tool={tool} />}
          {activeTab === 'schema' && <SchemaTab tool={tool} />}
          {activeTab === 'code' && <CodeTab tool={tool} />}
          {activeTab === 'test' && <TestTab tool={tool} />}
        </div>
      </div>
    </div>
  );
}
