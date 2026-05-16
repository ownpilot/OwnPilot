/**
 * Facade for the per-tab components rendered inside the Claw detail panel.
 *
 * The actual implementations live in `./tabs/<TabName>.tsx`. This file
 * preserves the original import path used by `ClawManagementPanel.tsx`
 * (single `import { OverviewTab, ..., type AuditEntry, type ClawOutputEvent }
 *  from './ClawDetailTabs'`) while letting each tab evolve in isolation.
 */

export { OverviewTab } from './tabs/OverviewTab';
export { StatsTab } from './tabs/StatsTab';
export { SettingsTab } from './tabs/SettingsTab';
export { MemoryTab } from './tabs/MemoryTab';
export { ConfigTab } from './tabs/ConfigTab';
export { DoctorTab } from './tabs/DoctorTab';
export { SkillsTab } from './tabs/SkillsTab';
export { HistoryTab } from './tabs/HistoryTab';
export { TimelineTab } from './tabs/TimelineTab';
export { AuditTab, type AuditEntry } from './tabs/AuditTab';
export { FilesTab } from './tabs/FilesTab';
export { OutputTab, type ClawOutputEvent } from './tabs/OutputTab';
export { ConversationTab } from './tabs/ConversationTab';

// Re-export FileBrowser and FileEditorModal for parent (preserved from original)
export { FileBrowser, FileEditorModal } from './FileBrowser';
