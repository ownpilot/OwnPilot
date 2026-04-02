/**
 * PageHomeTab — Reusable landing/onboarding tab for feature pages.
 *
 * Follows the hero pattern from EdgeDevicesOnboarding + SkillsHub HomeTab.
 * Each page passes its own content via props.
 */

import type { ComponentType } from 'react';
import { Zap, CheckCircle2 } from './icons';

// =============================================================================
// Types
// =============================================================================

export interface HeroIcon {
  icon: ComponentType<{ className?: string }>;
  color: string; // e.g. 'text-primary bg-primary/10'
}

export interface FeatureCard {
  icon: ComponentType<{ className?: string }>;
  color: string; // icon wrapper classes e.g. 'text-violet-500 bg-violet-500/10'
  title: string;
  description: string;
}

export interface GettingStartedStep {
  title: string;
  detail: string;
}

export interface QuickAction {
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  color?: string; // border color classes
  onClick: () => void;
}

export interface InfoBox {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  color: 'blue' | 'amber' | 'green' | 'violet';
}

export interface PageHomeTabProps {
  /** 3 hero icon badges */
  heroIcons: [HeroIcon, HeroIcon, HeroIcon];
  /** Main headline */
  title: string;
  /** Description paragraph */
  subtitle: string;
  /** Primary CTA button */
  cta: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void };
  /** 4 feature explanation cards */
  features: FeatureCard[];
  /** Getting started steps */
  steps: GettingStartedStep[];
  /** Quick action buttons (typically 2-3) */
  quickActions?: QuickAction[];
  /** Optional info box */
  infoBox?: InfoBox;
  /** Optional footer CTA (different from hero CTA) */
  footerCta?: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void };
  /** Optional extra section between features and steps */
  children?: React.ReactNode;
  /** Skip home preference checkbox */
  skipHomeChecked?: boolean;
  onSkipHomeChange?: (checked: boolean) => void;
  skipHomeLabel?: string;
}

// =============================================================================
// Color maps
// =============================================================================

const INFO_BOX_COLORS = {
  blue: {
    border: 'border-blue-200 dark:border-blue-500/30',
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    title: 'text-blue-700 dark:text-blue-400',
    text: 'text-blue-700 dark:text-blue-300',
  },
  amber: {
    border: 'border-amber-200 dark:border-amber-500/30',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    title: 'text-amber-700 dark:text-amber-400',
    text: 'text-amber-700 dark:text-amber-300',
  },
  green: {
    border: 'border-green-200 dark:border-green-500/30',
    bg: 'bg-green-50 dark:bg-green-500/10',
    title: 'text-green-700 dark:text-green-400',
    text: 'text-green-700 dark:text-green-300',
  },
  violet: {
    border: 'border-violet-200 dark:border-violet-500/30',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    title: 'text-violet-700 dark:text-violet-400',
    text: 'text-violet-700 dark:text-violet-300',
  },
};

// =============================================================================
// Component
// =============================================================================

export function PageHomeTab({
  heroIcons,
  title,
  subtitle,
  cta,
  features,
  steps,
  quickActions,
  infoBox,
  footerCta,
  children,
  skipHomeChecked,
  onSkipHomeChange,
  skipHomeLabel = "Skip this screen next time",
}: PageHomeTabProps) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-10 overflow-y-auto h-full">
      {/* Hero */}
      <div className="text-center space-y-3">
        <div className="flex justify-center gap-3 mb-4">
          {heroIcons.map((hi, i) => (
            <span
              key={i}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center ${hi.color}`}
            >
              <hi.icon className="w-6 h-6" />
            </span>
          ))}
        </div>
        <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
          {title}
        </h1>
        <p className="text-text-secondary dark:text-dark-text-secondary max-w-xl mx-auto leading-relaxed">
          {subtitle}
        </p>
        <button
          onClick={cta.onClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors mt-2"
        >
          <cta.icon className="w-4 h-4" />
          {cta.label}
        </button>

        {/* Skip home checkbox */}
        {onSkipHomeChange && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <input
              type="checkbox"
              id="skip-home"
              checked={skipHomeChecked}
              onChange={(e) => onSkipHomeChange(e.target.checked)}
              className="w-4 h-4 rounded border-border dark:border-dark-border text-primary focus:ring-primary"
            />
            <label
              htmlFor="skip-home"
              className="text-sm text-text-secondary dark:text-dark-text-secondary cursor-pointer select-none"
            >
              {skipHomeLabel}
            </label>
          </div>
        )}
      </div>

      {/* Features grid */}
      {features.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Key Features
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="border border-border dark:border-dark-border rounded-xl p-4 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${f.color}`}
                  >
                    <f.icon className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {f.title}
                  </span>
                </div>
                <p className="text-xs text-text-secondary dark:text-dark-text-secondary leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom content slot */}
      {children}

      {/* Getting started steps */}
      {steps.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Getting Started
          </h2>
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {step.title}
                  </p>
                  <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5 leading-relaxed">
                    {step.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      {quickActions && quickActions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Quick Actions
          </h2>
          <div
            className={`grid grid-cols-1 gap-3 ${quickActions.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
          >
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                onClick={qa.onClick}
                className={`border-2 ${qa.color ?? 'border-border dark:border-dark-border hover:border-primary/60'} rounded-xl p-4 text-left transition-colors group`}
              >
                <qa.icon className="w-5 h-5 text-text-secondary dark:text-dark-text-secondary mb-2 group-hover:text-primary transition-colors" />
                <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {qa.label}
                </p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                  {qa.description}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Info box */}
      {infoBox && (
        <div
          className={`border ${INFO_BOX_COLORS[infoBox.color].border} ${INFO_BOX_COLORS[infoBox.color].bg} rounded-xl p-4 space-y-2`}
        >
          <p
            className={`text-sm font-semibold ${INFO_BOX_COLORS[infoBox.color].title} flex items-center gap-2`}
          >
            <infoBox.icon className="w-4 h-4" />
            {infoBox.title}
          </p>
          <p className={`text-xs ${INFO_BOX_COLORS[infoBox.color].text} leading-relaxed`}>
            {infoBox.description}
          </p>
        </div>
      )}

      {/* Footer CTA */}
      {footerCta && (
        <div className="text-center pb-4">
          <button
            onClick={footerCta.onClick}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <footerCta.icon className="w-4 h-4" />
            {footerCta.label}
          </button>
        </div>
      )}
    </div>
  );
}
