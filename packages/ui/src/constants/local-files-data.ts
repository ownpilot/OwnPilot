/**
 * Static data for the Local Files tab in CustomizePage.
 *
 * Matches the prototype's Nautilus-style bookmark structure.
 * In future phases, this can be replaced with live API data.
 */

// ---- Types ----

export interface FileBookmark {
  id: string;
  label: string;
  icon: string;
  path: string;
  virtual?: boolean;
}

export interface BookmarkSeparator {
  id: string;
  type: 'separator';
}

export type BookmarkEntry = FileBookmark | BookmarkSeparator;

export interface MachineDevice {
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  status: 'online' | 'offline';
  type: 'machine';
  bookmarks: BookmarkEntry[];
  active?: boolean;
}

export interface IoTDevice {
  id: string;
  label: string;
  icon: string;
  status: 'online' | 'offline';
  type: 'iot';
  description: string;
}

export interface DeviceSeparator {
  id: string;
  type: 'separator';
}

export type EdgeDeviceEntry = MachineDevice | IoTDevice | DeviceSeparator;

function isSeparator(entry: BookmarkEntry | EdgeDeviceEntry): entry is BookmarkSeparator | DeviceSeparator {
  return 'type' in entry && entry.type === 'separator';
}
export { isSeparator };

// ---- Data ----

/** Nautilus-style bookmarks for the local machine */
const FILE_BOOKMARKS: BookmarkEntry[] = [
  // System (built-in)
  { id: 'home', label: 'Home', icon: '\uD83C\uDFE0', path: '/home/ayaz' },
  { id: 'starred', label: 'Starred', icon: '\u2B50', path: '/home/ayaz', virtual: true },
  { id: 'recent', label: 'Recent', icon: '\uD83D\uDD50', path: '/home/ayaz', virtual: true },
  { id: 'network', label: 'Network', icon: '\uD83C\uDF10', path: '/home/ayaz', virtual: true },
  { id: 'sep-sys', type: 'separator' },
  // Nautilus custom bookmarks
  { id: 'exports', label: 'exports', icon: '\uD83D\uDCE4', path: '/home/ayaz/projects' },
  { id: 'downloads', label: 'Downloads', icon: '\uD83D\uDCE5', path: '/home/ayaz/Downloads' },
  { id: 'output', label: 'output', icon: '\uD83D\uDCC2', path: '/home/ayaz/projects' },
  { id: 'input', label: 'input', icon: '\uD83D\uDCC2', path: '/home/ayaz/projects' },
  { id: 'projects', label: 'projects', icon: '\uD83D\uDCBB', path: '/home/ayaz/projects' },
  { id: 'opensource-crm', label: 'opensource-crm-projects', icon: '\uD83D\uDCC1', path: '/home/ayaz' },
  { id: 'desktop', label: 'Desktop', icon: '\uD83D\uDDA5\uFE0F', path: '/home/ayaz/Desktop' },
  { id: 'pmg', label: 'Project Meta Genesis', icon: '\uD83E\uDDEC', path: '/home/ayaz/Desktop' },
  { id: 'git-sync', label: 'Git-sync', icon: '\uD83D\uDD04', path: '/home/ayaz/Desktop' },
  { id: 'isler', label: 'isler', icon: '\uD83C\uDFAC', path: '/home/ayaz/Videos' },
  { id: 'screenshots', label: 'Screenshots', icon: '\uD83D\uDCF8', path: '/home/ayaz/Pictures/Screenshots' },
  { id: 'documents', label: 'Documents', icon: '\uD83D\uDCC1', path: '/home/ayaz/Documents' },
  { id: 'music', label: 'Music', icon: '\uD83C\uDFB5', path: '/home/ayaz/Music' },
  { id: 'pictures', label: 'Pictures', icon: '\uD83D\uDDBC\uFE0F', path: '/home/ayaz/Pictures' },
  { id: 'videos', label: 'Videos', icon: '\uD83C\uDFAC', path: '/home/ayaz/Videos' },
  { id: 'sep-custom', type: 'separator' },
  // Dev/work dirs
  { id: 'ownpilot', label: 'OwnPilot', icon: '\uD83E\uDD16', path: '/home/ayaz/ownpilot' },
  { id: 'bridge', label: 'Bridge', icon: '\uD83C\uDF09', path: '/home/ayaz/openclaw-bridge' },
  { id: 'backups', label: 'Backups', icon: '\uD83D\uDCBE', path: '/home/ayaz/backups' },
  { id: 'claude', label: '.claude', icon: '\uD83E\uDDE0', path: '/home/ayaz/.claude' },
];

/** All edge devices — machines + IoT */
export const EDGE_DEVICES: EdgeDeviceEntry[] = [
  {
    id: 'ownpilot-local',
    label: 'ayaz@100.75.115.68',
    sublabel: 'ownpilot',
    icon: '\uD83D\uDDA5\uFE0F',
    status: 'online',
    type: 'machine',
    bookmarks: FILE_BOOKMARKS,
    active: true,
  },
  { id: 'sep-tailscale', type: 'separator' },
  {
    id: 'dell-lab',
    label: 'ayaz@100.86.8.11',
    sublabel: 'dell-lab',
    icon: '\uD83D\uDCBB',
    status: 'offline',
    type: 'machine',
    bookmarks: [
      { id: 'dell-home', label: 'Home', icon: '\uD83C\uDFE0', path: '/home/ayaz' },
      { id: 'dell-projects', label: 'projects', icon: '\uD83D\uDCBB', path: '/home/ayaz/projects' },
      { id: 'dell-docs', label: 'Documents', icon: '\uD83D\uDCC1', path: '/home/ayaz/Documents' },
    ],
  },
  {
    id: 'harktu-win',
    label: 'ayaz@100.124.84.44',
    sublabel: 'harktu-windows',
    icon: '\uD83E\uDE9F',
    status: 'offline',
    type: 'machine',
    bookmarks: [
      { id: 'win-home', label: 'Home', icon: '\uD83C\uDFE0', path: 'C:/Users/ayaz' },
      { id: 'win-downloads', label: 'Downloads', icon: '\uD83D\uDCE5', path: 'C:/Users/ayaz/Downloads' },
      { id: 'win-desktop', label: 'Desktop', icon: '\uD83D\uDDA5\uFE0F', path: 'C:/Users/ayaz/Desktop' },
    ],
  },
  { id: 'sep-iot', type: 'separator' },
  {
    id: 'rasp-01',
    label: 'raspi-sensor-01',
    icon: '\uD83D\uDD0C',
    status: 'online',
    type: 'iot',
    description: 'Temperature + humidity sensor',
  },
  {
    id: 'rasp-02',
    label: 'raspi-cam-02',
    icon: '\uD83D\uDD0C',
    status: 'offline',
    type: 'iot',
    description: 'Security camera stream',
  },
  {
    id: 'esp32-01',
    label: 'esp32-relay-01',
    icon: '\uD83D\uDCE1',
    status: 'online',
    type: 'iot',
    description: 'Smart relay controller',
  },
];
