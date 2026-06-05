import { useState } from 'react';
import { X, Layout, Zap, Brain, Database, Clock, Settings } from '../icons';

import { TEMPLATES, type WorkflowTemplate } from './workflow-templates';
export type { WorkflowTemplate } from './workflow-templates';

interface TemplateGalleryProps {
  onUseTemplate: (template: WorkflowTemplate) => void;
  onClose: () => void;
}

const CATEGORIES = ['All', 'AI', 'Scheduling', 'Integration', 'Data', 'Automation'];

const categoryIcons: Record<string, React.ReactElement> = {
  AI: <Brain className="w-3 h-3" />,
  Scheduling: <Clock className="w-3 h-3" />,
  Integration: <Zap className="w-3 h-3" />,
  Data: <Database className="w-3 h-3" />,
  Automation: <Settings className="w-3 h-3" />,
};

export function TemplateGallery({ onUseTemplate, onClose }: TemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const filteredTemplates =
    selectedCategory === 'All'
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === selectedCategory);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl shadow-2xl border border-border dark:border-dark-border max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-2">
            <Layout className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Workflow Templates
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-primary dark:hover:bg-dark-bg-primary rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border overflow-x-auto">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                selectedCategory === category
                  ? 'bg-primary text-white'
                  : 'bg-bg-primary dark:bg-dark-bg-primary text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Template Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="border border-border dark:border-dark-border rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => onUseTemplate(template)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
                    {template.name}
                  </h3>
                  <div className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary">
                    {categoryIcons[template.category]}
                    <span>{template.category}</span>
                  </div>
                </div>
                <p className="text-sm text-text-muted dark:text-dark-text-muted mb-3">
                  {template.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    {template.nodeCount} nodes
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUseTemplate(template);
                    }}
                    className="px-3 py-1 text-xs font-medium bg-primary text-white rounded hover:bg-primary/90 transition-colors"
                  >
                    Use Template
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-12 text-text-muted dark:text-dark-text-muted">
              No templates found in this category
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
