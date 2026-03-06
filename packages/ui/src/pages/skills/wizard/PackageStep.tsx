import { Download, CheckCircle2 } from '../../../components/icons';
import type { ExtensionInfo } from '../../../api/types';
import { FORMAT_BADGE_COLORS, FORMAT_LABELS } from '../constants';

interface PackageStepProps {
  pkg: ExtensionInfo;
  onFinish: () => void;
  onBack: () => void;
}

export function PackageStep({ pkg, onFinish, onBack }: PackageStepProps) {
  const fmt = ((pkg.manifest as Record<string, unknown>).format ?? 'ownpilot') as string;
  const badgeColor = FORMAT_BADGE_COLORS[fmt] ?? FORMAT_BADGE_COLORS.ownpilot;
  const badgeLabel = FORMAT_LABELS[fmt] ?? fmt;

  const handleDownload = () => {
    window.open(`/api/v1/extensions/${pkg.id}/package`, '_blank');
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          Package & export
        </h3>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
          Download your skill as a portable <code className="font-mono">.skill</code> file (ZIP) to
          share or reinstall later.
        </p>
      </div>

      {/* Summary card */}
      <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl shrink-0">
            {pkg.icon ?? '✨'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-text-primary dark:text-dark-text-primary">
                {pkg.name}
              </h4>
              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${badgeColor}`}>
                {badgeLabel}
              </span>
            </div>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
              v{pkg.version}
            </p>
            {pkg.description && (
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-2">
                {pkg.description}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-border dark:border-dark-border text-center">
          <div>
            <div className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {pkg.toolCount}
            </div>
            <div className="text-xs text-text-muted dark:text-dark-text-muted">Tools</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {pkg.triggerCount}
            </div>
            <div className="text-xs text-text-muted dark:text-dark-text-muted">Triggers</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-success">
              <CheckCircle2 className="w-5 h-5 mx-auto" />
            </div>
            <div className="text-xs text-text-muted dark:text-dark-text-muted">Installed</div>
          </div>
        </div>
      </div>

      {/* .skill format info */}
      <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-xs text-text-muted dark:text-dark-text-muted space-y-1">
        <p className="font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
          .skill file contents
        </p>
        <p>
          <code className="font-mono">skill-name/SKILL.md</code> — skill manifest
        </p>
        <p>
          <code className="font-mono">skill-name/skill.meta.json</code> — metadata (version, format,
          author)
        </p>
        <p>
          <code className="font-mono">skill-name/scripts/</code> — tool code (if any)
        </p>
        <p>Upload the .skill file to reinstall on any OwnPilot instance.</p>
      </div>

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download .skill
          </button>
          <button
            onClick={onFinish}
            className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
