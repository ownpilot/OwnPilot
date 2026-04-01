/**
 * HeaderItemsBar — renders 3 configurable header zones (left, center, right).
 *
 * Each zone reads its entries from useLayoutConfig zone config.
 * Falls back to legacy useHeaderItems if zones are empty (migration compat).
 * Desktop only — Layout guards with {!isMobile && <HeaderItemsBar />}.
 */
import { useHeaderItems } from '../hooks/useHeaderItems';
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { NAV_ITEM_MAP } from '../constants/nav-items';
import { HeaderItem } from './HeaderItem';
import { HeaderGroup } from './HeaderGroup';
import type { HeaderZoneId, HeaderZoneEntry, HeaderItemDisplayMode } from '../types/layout-config';

const ZONE_IDS: HeaderZoneId[] = ['left', 'center', 'right'];

function ZoneEntries({ entries, displayMode }: { entries: HeaderZoneEntry[]; displayMode: HeaderItemDisplayMode }) {
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((entry, i) => {
        if (entry.type === 'item') {
          const navItem = NAV_ITEM_MAP.get(entry.path);
          if (!navItem) return null;
          return <HeaderItem key={entry.path} item={navItem} displayMode={displayMode} />;
        }
        if (entry.type === 'group') {
          return <HeaderGroup key={entry.id} config={entry} displayMode={displayMode} />;
        }
        return null;
      })}
    </>
  );
}

export function HeaderItemsBar() {
  const { headerItems } = useHeaderItems();
  const { config, getZone } = useLayoutConfig();

  // Check if any zone has entries
  const hasZoneEntries = ZONE_IDS.some((id) => getZone(id).entries.length > 0);

  // Fallback: if no zone entries configured, render legacy headerItems in center zone
  if (!hasZoneEntries && headerItems.length === 0) return null;

  if (!hasZoneEntries) {
    // Legacy mode: render all headerItems as a single flat bar
    const displayMode = config.header.itemDisplayMode;
    return (
      <div className="flex items-center gap-1 shrink-0">
        {headerItems.map((cfg) => {
          if (cfg.type === 'item') {
            const navItem = NAV_ITEM_MAP.get(cfg.path);
            if (!navItem) return null;
            return <HeaderItem key={cfg.path} item={navItem} displayMode={displayMode} />;
          }
          if (cfg.type === 'group') {
            return <HeaderGroup key={cfg.id} config={cfg} displayMode={displayMode} />;
          }
          return null;
        })}
      </div>
    );
  }

  // Zone mode: left | center | right
  const leftZone = getZone('left');
  const centerZone = getZone('center');
  const rightZone = getZone('right');

  const zones = [
    { zone: leftZone, justify: 'justify-start' },
    { zone: centerZone, justify: 'justify-center' },
    { zone: rightZone, justify: 'justify-end' },
  ];

  const hasAnyEntries = zones.some(({ zone }) => zone.entries.length > 0);
  const filledCount = zones.filter(({ zone }) => zone.entries.length > 0).length;

  return (
    <div className="flex items-center gap-3 shrink-0">
      {zones.map(({ zone, justify }, i) => {
        if (zone.entries.length === 0) return null;
        return (
          <div key={i} className={`flex items-center gap-1 ${justify}`}>
            <ZoneEntries entries={zone.entries} displayMode={zone.displayMode} />
          </div>
        );
      })}
    </div>
  );
}
