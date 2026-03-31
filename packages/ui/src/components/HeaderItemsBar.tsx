/**
 * HeaderItemsBar — container for pinned items/groups in the global header.
 *
 * Renders between the logo and PulseSlotGrid. Returns null when empty
 * (same conditional pattern as MiniPomodoro). Desktop only — Layout
 * guards with {!isMobile && <HeaderItemsBar />}.
 */
import { useHeaderItems } from '../hooks/useHeaderItems';
import { NAV_ITEM_MAP } from '../constants/nav-items';
import { HeaderItem } from './HeaderItem';
import { HeaderGroup } from './HeaderGroup';

export function HeaderItemsBar() {
  const { headerItems } = useHeaderItems();

  if (headerItems.length === 0) return null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <div className="w-px h-5 bg-border dark:bg-dark-border mx-1" />
      {headerItems.map((config) => {
        if (config.type === 'item') {
          const navItem = NAV_ITEM_MAP.get(config.path);
          if (!navItem) return null;
          return <HeaderItem key={config.path} item={navItem} />;
        }
        if (config.type === 'group') {
          return <HeaderGroup key={config.id} config={config} />;
        }
        return null;
      })}
    </div>
  );
}
