/**
 * LayoutWireframe — interactive mini layout prototype for LayoutConfigPage.
 *
 * Renders a clickable wireframe of the app layout (header zones + body areas).
 * Clicking a zone selects it and triggers onZoneSelect callback.
 * Active zone is highlighted with primary border.
 *
 * Pattern reference: Soybean Admin layout thumbnails + Shopify Preview Inspector.
 */
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { Settings } from './icons';
import type { HeaderZoneId } from '../types/layout-config';

export type WireframeZone =
  | 'header-brand'
  | 'header-left'
  | 'header-center'
  | 'header-right'
  | 'header-settings'
  | 'sidebar'
  | 'customize'
  | 'content'
  | 'stats-panel';

interface LayoutWireframeProps {
  selectedZone: WireframeZone | null;
  onZoneSelect: (zone: WireframeZone) => void;
}

const HEADER_ZONE_MAP: Record<string, HeaderZoneId> = {
  'header-left': 'left',
  'header-center': 'center',
  'header-right': 'right',
};

function ZoneBox({
  zone: _zone,
  label,
  isSelected,
  onClick,
  className = '',
  badge,
  children,
}: {
  zone: WireframeZone;
  label: string;
  isSelected: boolean;
  onClick: () => void;
  className?: string;
  badge?: number;
  children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={`Click to configure: ${label}`}
      className={`relative flex items-center justify-center transition-all duration-200 rounded text-[10px] font-medium ${
        isSelected
          ? 'border-2 border-primary bg-primary/10 text-primary shadow-sm shadow-primary/20'
          : 'border border-border/50 dark:border-dark-border/50 text-text-muted dark:text-dark-text-muted hover:border-primary/50 hover:bg-primary/5 hover:text-text-secondary dark:hover:text-dark-text-secondary'
      } ${className}`}
    >
      {children ?? label}
      {badge != null && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full bg-primary text-white text-[8px] font-bold leading-none">
          {badge}
        </span>
      )}
    </button>
  );
}

export function LayoutWireframe({ selectedZone, onZoneSelect }: LayoutWireframeProps) {
  const { getZone } = useLayoutConfig();

  const zoneEntryCount = (zoneId: string): number => {
    const mapped = HEADER_ZONE_MAP[zoneId];
    if (!mapped) return 0;
    return getZone(mapped).entries.length;
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Mini wireframe container */}
      <div className="rounded-xl border border-border dark:border-dark-border bg-bg-tertiary/30 dark:bg-dark-bg-tertiary/30 overflow-hidden shadow-sm">

        {/* Header row */}
        <div className="flex items-stretch h-10 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 border-b border-border/50 dark:border-dark-border/50 gap-px p-1">
          <ZoneBox
            zone="header-brand"
            label="Brand"
            isSelected={selectedZone === 'header-brand'}
            onClick={() => onZoneSelect('header-brand')}
            className="px-3 shrink-0"
          />
          <ZoneBox
            zone="header-left"
            label="Left"
            isSelected={selectedZone === 'header-left'}
            onClick={() => onZoneSelect('header-left')}
            className="flex-1 min-w-[60px]"
            badge={zoneEntryCount('header-left')}
          />
          <ZoneBox
            zone="header-center"
            label="Center"
            isSelected={selectedZone === 'header-center'}
            onClick={() => onZoneSelect('header-center')}
            className="flex-1 min-w-[60px]"
            badge={zoneEntryCount('header-center')}
          />
          <ZoneBox
            zone="header-right"
            label="Right"
            isSelected={selectedZone === 'header-right'}
            onClick={() => onZoneSelect('header-right')}
            className="flex-1 min-w-[60px]"
            badge={zoneEntryCount('header-right')}
          />
          <ZoneBox
            zone="header-settings"
            label=""
            isSelected={selectedZone === 'header-settings'}
            onClick={() => onZoneSelect('header-settings')}
            className="w-8 shrink-0"
          >
            <Settings className="w-3 h-3" />
          </ZoneBox>
        </div>

        {/* Body row */}
        <div className="flex items-stretch h-32 gap-px p-1">
          <ZoneBox
            zone="sidebar"
            label="Sidebar"
            isSelected={selectedZone === 'sidebar'}
            onClick={() => onZoneSelect('sidebar')}
            className="w-16 shrink-0 flex-col gap-1"
          />
          <ZoneBox
            zone="customize"
            label="Customize"
            isSelected={selectedZone === 'customize'}
            onClick={() => onZoneSelect('customize')}
            className="w-20 shrink-0 flex-col gap-1 text-[9px]"
          />
          <ZoneBox
            zone="content"
            label="Content"
            isSelected={selectedZone === 'content'}
            onClick={() => onZoneSelect('content')}
            className="flex-1"
          />
          <ZoneBox
            zone="stats-panel"
            label="Stats"
            isSelected={selectedZone === 'stats-panel'}
            onClick={() => onZoneSelect('stats-panel')}
            className="w-14 shrink-0"
          />
        </div>
      </div>

      {/* Zone hint */}
      <p className="text-center text-[11px] text-text-muted dark:text-dark-text-muted mt-2">
        Click a zone above to configure it
      </p>
    </div>
  );
}
