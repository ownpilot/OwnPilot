/**
 * Extension-to-emoji mapping for file browsing UI.
 * Used by LocalFilesTab to display contextual icons next to filenames.
 */

export const FILE_ICONS: Record<string, string> = {
  // Web / Frontend
  tsx: '\u269B\uFE0F',   // React TSX
  jsx: '\u269B\uFE0F',   // React JSX
  ts: '\uD83D\uDCD8',    // TypeScript
  js: '\uD83D\uDFE8',    // JavaScript
  mjs: '\uD83D\uDFE8',
  cjs: '\uD83D\uDFE8',
  html: '\uD83C\uDF10',  // HTML
  css: '\uD83C\uDFA8',   // CSS
  scss: '\uD83C\uDFA8',
  less: '\uD83C\uDFA8',
  vue: '\uD83D\uDFE9',   // Vue
  svelte: '\uD83D\uDD36', // Svelte

  // Data / Config
  json: '\uD83D\uDCCB',  // JSON
  yaml: '\u2699\uFE0F',  // YAML config
  yml: '\u2699\uFE0F',
  toml: '\u2699\uFE0F',
  xml: '\uD83D\uDCE6',   // XML
  csv: '\uD83D\uDCCA',   // CSV
  env: '\uD83D\uDD10',   // Environment

  // Documentation
  md: '\uD83D\uDCC4',    // Markdown
  mdx: '\uD83D\uDCC4',
  txt: '\uD83D\uDCC3',   // Plain text
  rst: '\uD83D\uDCC3',
  pdf: '\uD83D\uDCD5',   // PDF
  doc: '\uD83D\uDCD5',
  docx: '\uD83D\uDCD5',

  // Languages
  py: '\uD83D\uDC0D',    // Python
  rb: '\uD83D\uDC8E',    // Ruby
  rs: '\uD83E\uDD80',    // Rust
  go: '\uD83D\uDC39',    // Go
  java: '\u2615',         // Java
  kt: '\uD83D\uDFE3',    // Kotlin
  swift: '\uD83E\uDD85',  // Swift
  c: '\uD83D\uDD27',     // C
  cpp: '\uD83D\uDD27',   // C++
  h: '\uD83D\uDD27',
  cs: '\uD83D\uDFEA',    // C#
  php: '\uD83D\uDC18',   // PHP
  lua: '\uD83C\uDF19',   // Lua

  // Shell / DevOps
  sh: '\uD83D\uDD27',    // Shell
  bash: '\uD83D\uDD27',
  zsh: '\uD83D\uDD27',
  fish: '\uD83D\uDD27',
  dockerfile: '\uD83D\uDC33', // Docker
  tf: '\uD83C\uDFD7\uFE0F',   // Terraform

  // Images
  png: '\uD83D\uDDBC\uFE0F',  // Image
  jpg: '\uD83D\uDDBC\uFE0F',
  jpeg: '\uD83D\uDDBC\uFE0F',
  gif: '\uD83D\uDDBC\uFE0F',
  svg: '\uD83D\uDDBC\uFE0F',
  webp: '\uD83D\uDDBC\uFE0F',
  ico: '\uD83D\uDDBC\uFE0F',

  // Media
  mp3: '\uD83C\uDFB5',   // Audio
  wav: '\uD83C\uDFB5',
  ogg: '\uD83C\uDFB5',
  mp4: '\uD83C\uDFAC',   // Video
  mkv: '\uD83C\uDFAC',
  avi: '\uD83C\uDFAC',
  webm: '\uD83C\uDFAC',

  // Spreadsheets
  xlsx: '\uD83D\uDCCA',
  xls: '\uD83D\uDCCA',
  ods: '\uD83D\uDCCA',

  // Archives
  zip: '\uD83D\uDCE6',
  tar: '\uD83D\uDCE6',
  gz: '\uD83D\uDCE6',
  rar: '\uD83D\uDCE6',
  '7z': '\uD83D\uDCE6',

  // Git
  gitignore: '\uD83D\uDEAB',

  // Lock files
  lock: '\uD83D\uDD12',

  // SQL
  sql: '\uD83D\uDDC3\uFE0F',

  // Log
  log: '\uD83D\uDCDC',
};

/** Default icon for unknown file types */
export const DEFAULT_FILE_ICON = '\uD83D\uDCC4';

/** Icon for directories */
export const DIRECTORY_ICON = '\uD83D\uDCC2';

/**
 * Get the emoji icon for a given filename.
 */
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  // Check full filename first (e.g., "dockerfile", ".gitignore")
  const baseName = filename.toLowerCase();
  if (FILE_ICONS[baseName]) return FILE_ICONS[baseName];
  return FILE_ICONS[ext] ?? DEFAULT_FILE_ICON;
}
