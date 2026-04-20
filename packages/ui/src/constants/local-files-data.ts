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
  { id: 'home', label: 'Home', icon: '\uD83C\uDFE0', path: '/home/user' },
  { id: 'starred', label: 'Starred', icon: '\u2B50', path: '/home/user', virtual: true },
  { id: 'recent', label: 'Recent', icon: '\uD83D\uDD50', path: '/home/user', virtual: true },
  { id: 'network', label: 'Network', icon: '\uD83C\uDF10', path: '/home/user', virtual: true },
  { id: 'sep-sys', type: 'separator' },
  // Common user directories
  { id: 'downloads', label: 'Downloads', icon: '\uD83D\uDCE5', path: '/home/user/Downloads' },
  { id: 'documents', label: 'Documents', icon: '\uD83D\uDCC1', path: '/home/user/Documents' },
  { id: 'desktop', label: 'Desktop', icon: '\uD83D\uDDA5\uFE0F', path: '/home/user/Desktop' },
  { id: 'pictures', label: 'Pictures', icon: '\uD83D\uDDBC\uFE0F', path: '/home/user/Pictures' },
  { id: 'music', label: 'Music', icon: '\uD83C\uDFB5', path: '/home/user/Music' },
  { id: 'videos', label: 'Videos', icon: '\uD83C\uDFAC', path: '/home/user/Videos' },
  { id: 'screenshots', label: 'Screenshots', icon: '\uD83D\uDCF8', path: '/home/user/Pictures/Screenshots' },
  { id: 'projects', label: 'projects', icon: '\uD83D\uDCBB', path: '/home/user/projects' },
  { id: 'sep-custom', type: 'separator' },
  // Dev/work dirs
  { id: 'ownpilot', label: 'OwnPilot', icon: '\uD83E\uDD16', path: '/home/user/ownpilot' },
  { id: 'backups', label: 'Backups', icon: '\uD83D\uDCBE', path: '/home/user/backups' },
  { id: 'claude', label: '.claude', icon: '\uD83E\uDDE0', path: '/home/user/.claude' },
];

/** All edge devices — machines + IoT */
export const EDGE_DEVICES: EdgeDeviceEntry[] = [
  {
    id: 'local-machine',
    label: 'user@local',
    sublabel: 'ownpilot',
    icon: '\uD83D\uDDA5\uFE0F',
    status: 'online',
    type: 'machine',
    bookmarks: FILE_BOOKMARKS,
    active: true,
  },
  { id: 'sep-tailscale', type: 'separator' },
  {
    id: 'linux-host',
    label: 'user@linux-host',
    sublabel: 'linux-workstation',
    icon: '\uD83D\uDCBB',
    status: 'offline',
    type: 'machine',
    bookmarks: [
      { id: 'linux-home', label: 'Home', icon: '\uD83C\uDFE0', path: '/home/user' },
      { id: 'linux-projects', label: 'projects', icon: '\uD83D\uDCBB', path: '/home/user/projects' },
      { id: 'linux-docs', label: 'Documents', icon: '\uD83D\uDCC1', path: '/home/user/Documents' },
    ],
  },
  {
    id: 'windows-host',
    label: 'user@windows-host',
    sublabel: 'windows-workstation',
    icon: '\uD83E\uDE9F',
    status: 'offline',
    type: 'machine',
    bookmarks: [
      { id: 'win-home', label: 'Home', icon: '\uD83C\uDFE0', path: 'C:/Users/user' },
      { id: 'win-downloads', label: 'Downloads', icon: '\uD83D\uDCE5', path: 'C:/Users/user/Downloads' },
      { id: 'win-desktop', label: 'Desktop', icon: '\uD83D\uDDA5\uFE0F', path: 'C:/Users/user/Desktop' },
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
