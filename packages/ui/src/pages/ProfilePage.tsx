/**
 * Profile Page - Premium Edition
 *
 * Comprehensive user profile management with:
 * - Identity & Personalization
 * - AI Behavior Configuration
 * - Memory Production & Management
 * - Advanced Settings
 * - Visual Progress Tracking
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UserCircle,
  Brain,
  MessageSquare,
  Globe,
  Plus,
  Download,
  Upload,
  Home,
  FileText,
  Settings2,
  User,
  Sparkles,
  Target,
  Heart,
  Building,
  MapPin,
  Clock,
  Trash2,
  Save,
  X,
  CheckCircle2,
  AlertCircle,
  Zap,
  Shield,
  Lightbulb,
  Bookmark,
  History,
  Star,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { profileApi } from '../api';
import { memoriesApi } from '../api/endpoints/personal-data';
import type { ProfileData } from '../api';
import type { Memory } from '../api/types';

// =============================================================================
// Types
// =============================================================================

interface QuickSetupData {
  name: string;
  nickname: string;
  location: string;
  timezone: string;
  occupation: string;
  language: string;
  communicationStyle: 'formal' | 'casual' | 'mixed';
  verbosity: 'concise' | 'detailed' | 'mixed';
  autonomyLevel: 'none' | 'low' | 'medium' | 'high' | 'full';
}

interface EditableSection {
  hobbies: string[];
  skills: string[];
  goals: { short: string[]; medium: string[]; long: string[] };
  favoriteFoods: string[];
  dietaryRestrictions: string[];
  allergies: string[];
}

type TabId = 'home' | 'overview' | 'identity' | 'behavior' | 'memories' | 'advanced';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_QUICK_SETUP: QuickSetupData = {
  name: '',
  nickname: '',
  location: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  occupation: '',
  language: navigator.language.split('-')[0] || 'en',
  communicationStyle: 'casual',
  verbosity: 'detailed',
  autonomyLevel: 'medium',
};

const AUTONOMY_DESCRIPTIONS: Record<string, string> = {
  none: 'AI always asks before taking any action',
  low: 'AI can read freely, asks for writes',
  medium: 'AI acts freely, asks for destructive actions',
  high: 'AI acts autonomously, rarely asks',
  full: 'Full autonomy - AI makes all decisions',
};

const AUTONOMY_COLORS: Record<string, string> = {
  none: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  low: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  medium: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  high: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  full: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
};

const COMMUNICATION_STYLES: { value: QuickSetupData['communicationStyle']; label: string; icon: typeof MessageSquare; desc: string }[] = [
  { value: 'formal', label: 'Formal', icon: Building, desc: 'Professional and polite' },
  { value: 'casual', label: 'Casual', icon: MessageSquare, desc: 'Friendly and relaxed' },
  { value: 'mixed', label: 'Mixed', icon: Sparkles, desc: 'Adapts to context' },
];

const VERBOSITY_OPTIONS: { value: QuickSetupData['verbosity']; label: string; desc: string }[] = [
  { value: 'concise', label: 'Concise', desc: 'Brief, to-the-point responses' },
  { value: 'detailed', label: 'Detailed', desc: 'Comprehensive explanations' },
  { value: 'mixed', label: 'Adaptive', desc: 'Adjusts based on context' },
];

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
];

// =============================================================================
// Utility Components
// =============================================================================

function ProgressRing({ progress, size = 80, strokeWidth = 8, color = 'text-primary' }: { progress: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          className="text-bg-tertiary dark:text-dark-bg-tertiary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} transition-all duration-500 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-text-primary dark:text-dark-text-primary">{progress}%</span>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, trend }: { icon: typeof User; label: string; value: string | number; color: string; trend?: { value: number; positive: boolean } }) {
  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm text-text-muted dark:text-dark-text-muted">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">{value}</span>
        {trend && (
          <span className={`text-xs mb-1 ${trend.positive ? 'text-success' : 'text-error'}`}>
            {trend.positive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, action }: { title: string; icon: typeof User; children: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">{title}</h3>
        </div>
        {action && (
          <button onClick={action.onClick} className="text-xs text-primary hover:underline">
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function TagInput({ tags, onAdd, onRemove, placeholder, color = 'primary' }: { tags: string[]; onAdd: (tag: string) => void; onRemove: (tag: string) => void; placeholder: string; color?: 'primary' | 'success' | 'warning' | 'error' }) {
  const [input, setInput] = useState('');

  const colorClasses = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    error: 'bg-error/10 text-error border-error/20',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      onAdd(input.trim());
      setInput('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border ${colorClasses[color]}`}>
            {tag}
            <button onClick={() => onRemove(tag)} className="hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ProfilePage() {
  const toast = useToast();
  const { confirm } = useDialog();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('home');

  // Skip home preference
  const SKIP_HOME_KEY = 'ownpilot_skip_home__profile';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Form states
  const [quickSetup, setQuickSetup] = useState<QuickSetupData>(DEFAULT_QUICK_SETUP);
  const [editable, setEditable] = useState<EditableSection>({
    hobbies: [],
    skills: [],
    goals: { short: [], medium: [], long: [] },
    favoriteFoods: [],
    dietaryRestrictions: [],
    allergies: [],
  });

  // Memory form
  const [newMemory, setNewMemory] = useState({ content: '', type: 'fact' as const, importance: 2 });
  const [isAddingMemory, setIsAddingMemory] = useState(false);

  // AI Instructions
  const [newInstruction, setNewInstruction] = useState('');
  const [newBoundary, setNewBoundary] = useState('');

  // Load data
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      setIsLoading(true);
      const [profileData, memoriesData] = await Promise.all([
        profileApi.get(),
        memoriesApi.list({ limit: '10' }),
      ]);
      setProfile(profileData);
      setMemories(memoriesData.memories || []);

      // Initialize forms with existing data
      setQuickSetup({
        name: profileData.identity?.name || '',
        nickname: profileData.identity?.nickname || '',
        location: profileData.location?.home?.city || '',
        timezone: profileData.location?.home?.timezone || DEFAULT_QUICK_SETUP.timezone,
        occupation: profileData.work?.occupation || '',
        language: profileData.communication?.primaryLanguage || DEFAULT_QUICK_SETUP.language,
        communicationStyle: profileData.communication?.preferredStyle || 'casual',
        verbosity: profileData.communication?.verbosity || 'detailed',
        autonomyLevel: profileData.aiPreferences?.autonomyLevel || 'medium',
      });

      setEditable({
        hobbies: profileData.lifestyle?.hobbies || [],
        skills: profileData.work?.skills || [],
        goals: {
          short: profileData.goals?.shortTerm || [],
          medium: profileData.goals?.mediumTerm || [],
          long: profileData.goals?.longTerm || [],
        },
        favoriteFoods: profileData.lifestyle?.eatingHabits?.favoriteFoods || [],
        dietaryRestrictions: profileData.lifestyle?.eatingHabits?.dietaryRestrictions || [],
        allergies: profileData.lifestyle?.eatingHabits?.allergies || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  // Skip home handlers
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, checked ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (skipHome) {
      setActiveTab('overview');
    }
  }, [skipHome]);

  // Save handlers
  const saveQuickSetup = async () => {
    try {
      setIsSaving(true);
      const result = await profileApi.quickSetup({ ...quickSetup });
      setProfile(result.profile);
      toast.success('Profile saved successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const saveAdvanced = async () => {
    try {
      setIsSaving(true);
      // Save hobbies
      for (const hobby of editable.hobbies) {
        await profileApi.setData('lifestyle', `hobby_${hobby}`, hobby);
      }
      // Save skills
      for (const skill of editable.skills) {
        await profileApi.setData('work', `skill_${skill}`, skill);
      }
      // Save goals
      for (const goal of editable.goals.short) {
        await profileApi.setData('goals', `short_${goal}`, goal);
      }
      toast.success('Advanced settings saved');
      loadAllData();
    } catch {
      toast.error('Failed to save advanced settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Memory handlers
  const addMemory = async () => {
    if (!newMemory.content.trim()) return;
    try {
      setIsAddingMemory(true);
      const memory = await memoriesApi.create({
        content: newMemory.content,
        type: newMemory.type,
        importance: newMemory.importance,
      });
      setMemories((prev) => [memory, ...prev]);
      setNewMemory({ content: '', type: 'fact', importance: 2 });
      toast.success('Memory added');
    } catch {
      toast.error('Failed to add memory');
    } finally {
      setIsAddingMemory(false);
    }
  };

  const deleteMemory = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Memory',
      message: 'Are you sure you want to delete this memory?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await memoriesApi.delete(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      toast.success('Memory deleted');
    } catch {
      toast.error('Failed to delete memory');
    }
  };

  // Instruction handlers
  const addInstruction = async () => {
    if (!newInstruction.trim()) return;
    try {
      await profileApi.setData('instructions', `instruction_${Date.now()}`, newInstruction);
      setNewInstruction('');
      toast.success('Instruction added');
      loadAllData();
    } catch {
      toast.error('Failed to add instruction');
    }
  };

  const addBoundary = async () => {
    if (!newBoundary.trim()) return;
    try {
      await profileApi.setData('boundaries', `boundary_${Date.now()}`, newBoundary);
      setNewBoundary('');
      toast.success('Boundary added');
      loadAllData();
    } catch {
      toast.error('Failed to add boundary');
    }
  };

  // Export/Import
  const exportProfile = async () => {
    try {
      const data = await profileApi.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `profile-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Profile exported');
    } catch {
      toast.error('Failed to export profile');
    }
  };

  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await profileApi.import(data.entries);
      loadAllData();
      toast.success('Profile imported');
    } catch {
      toast.error('Failed to import profile');
    }
  };

  // Computed values
  const completeness = profile?.meta?.completeness || 0;
  const languageName = useMemo(() => LANGUAGES.find((l) => l.code === quickSetup.language)?.name || quickSetup.language, [quickSetup.language]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <LoadingSpinner message="Loading your profile..." />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <UserCircle className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {profile?.identity?.name || 'Your Profile'}
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {completeness}% complete · {memories.length} memories
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportProfile}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <label className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors cursor-pointer">
            <Upload className="w-4 h-4" />
            Import
            <input type="file" accept=".json" onChange={importProfile} className="hidden" />
          </label>
        </div>
      </header>

      {/* Error display */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-error shrink-0" />
          <span className="text-sm text-error flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-sm text-error hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-6 bg-bg-primary dark:bg-dark-bg-primary">
        {[
          { id: 'home' as TabId, label: 'Home', icon: Home },
          { id: 'overview' as TabId, label: 'Overview', icon: UserCircle },
          { id: 'identity' as TabId, label: 'Identity', icon: User },
          { id: 'behavior' as TabId, label: 'AI Behavior', icon: Brain },
          { id: 'memories' as TabId, label: 'Memories', icon: History },
          { id: 'advanced' as TabId, label: 'Advanced', icon: Settings2 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ==================== HOME TAB ==================== */}
        {activeTab === 'home' && (
          <PageHomeTab
            heroIcons={[
              { icon: UserCircle, color: 'text-primary bg-primary/10' },
              { icon: Sparkles, color: 'text-violet-500 bg-violet-500/10' },
              { icon: Brain, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Personalize Your AI Experience"
            subtitle="Configure your profile to help your AI understand you better. Set your preferences, manage memories, and customize AI behavior."
            cta={{
              label: 'View Overview',
              icon: UserCircle,
              onClick: () => setActiveTab('overview'),
            }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Overview"
            features={[
              {
                icon: User,
                color: 'text-primary bg-primary/10',
                title: 'Identity & Profile',
                description: 'Set your name, location, occupation, and personal details.',
              },
              {
                icon: Brain,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'AI Behavior',
                description: 'Configure how the AI communicates and makes decisions.',
              },
              {
                icon: History,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Memory Management',
                description: 'Create and manage memories for your AI to remember.',
              },
              {
                icon: Target,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Goals & Skills',
                description: 'Track your goals and skills for personalized assistance.',
              },
            ]}
            steps={[
              { title: 'Set up your identity', detail: 'Add your name, location, and basic info.' },
              { title: 'Configure AI behavior', detail: 'Choose communication style and autonomy level.' },
              { title: 'Add important memories', detail: 'Help your AI remember key information.' },
              { title: 'Set goals and track progress', detail: 'Define what you want to achieve.' },
            ]}
            quickActions={[
              { icon: User, label: 'Edit Identity', description: 'Update your personal info', onClick: () => setActiveTab('identity') },
              { icon: Brain, label: 'AI Settings', description: 'Configure AI behavior', onClick: () => setActiveTab('behavior') },
              { icon: History, label: 'Add Memory', description: 'Create a new memory', onClick: () => setActiveTab('memories') },
              { icon: Target, label: 'Set Goals', description: 'Define your objectives', onClick: () => setActiveTab('advanced') },
            ]}
          />
        )}

        {/* ==================== OVERVIEW TAB ==================== */}
        {activeTab === 'overview' && profile && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Profile Hero Card */}
            <div className="p-6 bg-gradient-to-br from-primary/5 to-violet-500/5 dark:from-primary/10 dark:to-violet-500/10 rounded-2xl border border-primary/20">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border-4 border-bg-primary dark:border-dark-bg-primary">
                    <UserCircle className="w-12 h-12 text-primary" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-success flex items-center justify-center border-2 border-bg-primary dark:border-dark-bg-primary">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                    {profile.identity?.name || 'Guest User'}
                  </h3>
                  {profile.identity?.nickname && (
                    <p className="text-text-muted dark:text-dark-text-muted">"{profile.identity.nickname}"</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {profile.location?.home?.city && (
                      <span className="inline-flex items-center gap-1 text-sm text-text-secondary dark:text-dark-text-secondary">
                        <MapPin className="w-3.5 h-3.5" />
                        {profile.location.home.city}
                      </span>
                    )}
                    {profile.work?.occupation && (
                      <span className="inline-flex items-center gap-1 text-sm text-text-secondary dark:text-dark-text-secondary">
                        <Building className="w-3.5 h-3.5" />
                        {profile.work.occupation}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-sm text-text-secondary dark:text-dark-text-secondary">
                      <Globe className="w-3.5 h-3.5" />
                      {languageName}
                    </span>
                  </div>
                </div>
                <div className="hidden sm:block">
                  <ProgressRing progress={completeness} color={completeness >= 80 ? 'text-success' : completeness >= 50 ? 'text-primary' : 'text-warning'} />
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Bookmark} label="Data Entries" value={profile.meta?.totalEntries || 0} color="bg-primary/10 text-primary" />
              <StatCard icon={Brain} label="Instructions" value={profile.aiPreferences?.customInstructions?.length || 0} color="bg-violet-500/10 text-violet-500" />
              <StatCard icon={Shield} label="Boundaries" value={profile.aiPreferences?.boundaries?.length || 0} color="bg-amber-500/10 text-amber-500" />
              <StatCard icon={History} label="Memories" value={memories.length} color="bg-emerald-500/10 text-emerald-500" />
            </div>

            {/* AI Settings Summary */}
            <SectionCard title="AI Configuration" icon={Brain} action={{ label: 'Edit', onClick: () => setActiveTab('behavior') }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`p-3 rounded-lg border ${AUTONOMY_COLORS[profile.aiPreferences?.autonomyLevel || 'medium']}`}>
                  <span className="text-xs opacity-70 uppercase tracking-wider">Autonomy</span>
                  <p className="font-medium capitalize">{profile.aiPreferences?.autonomyLevel || 'medium'}</p>
                </div>
                <div className="p-3 rounded-lg border bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border">
                  <span className="text-xs text-text-muted uppercase tracking-wider">Style</span>
                  <p className="font-medium capitalize">{profile.communication?.preferredStyle || 'casual'}</p>
                </div>
                <div className="p-3 rounded-lg border bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border">
                  <span className="text-xs text-text-muted uppercase tracking-wider">Verbosity</span>
                  <p className="font-medium capitalize">{profile.communication?.verbosity || 'detailed'}</p>
                </div>
              </div>
            </SectionCard>

            {/* Recent Memories Preview */}
            <SectionCard title="Recent Memories" icon={History} action={{ label: 'View All', onClick: () => setActiveTab('memories') }}>
              {memories.slice(0, 3).length > 0 ? (
                <div className="space-y-2">
                  {memories.slice(0, 3).map((memory) => (
                    <div key={memory.id} className="flex items-start gap-3 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                      <History className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <p className="text-sm text-text-primary dark:text-dark-text-primary line-clamp-2">{memory.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted dark:text-dark-text-muted italic">No memories yet. Add some to help your AI remember important things.</p>
              )}
            </SectionCard>
          </div>
        )}

        {/* ==================== IDENTITY TAB ==================== */}
        {activeTab === 'identity' && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">Personal Information</h3>
              <button
                onClick={saveQuickSetup}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            {/* Basic Info */}
            <SectionCard title="Basic Information" icon={User}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">Full Name</label>
                    <input
                      type="text"
                      value={quickSetup.name}
                      onChange={(e) => setQuickSetup({ ...quickSetup, name: e.target.value })}
                      placeholder="What should the AI call you?"
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">Nickname</label>
                    <input
                      type="text"
                      value={quickSetup.nickname}
                      onChange={(e) => setQuickSetup({ ...quickSetup, nickname: e.target.value })}
                      placeholder="A friendly alias"
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">Location</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="text"
                        value={quickSetup.location}
                        onChange={(e) => setQuickSetup({ ...quickSetup, location: e.target.value })}
                        placeholder="City or region"
                        className="w-full pl-10 pr-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">Occupation</label>
                    <div className="relative">
                      <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="text"
                        value={quickSetup.occupation}
                        onChange={(e) => setQuickSetup({ ...quickSetup, occupation: e.target.value })}
                        placeholder="What do you do?"
                        className="w-full pl-10 pr-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">Language</label>
                    <select
                      value={quickSetup.language}
                      onChange={(e) => setQuickSetup({ ...quickSetup, language: e.target.value })}
                      className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.flag} {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">Timezone</label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <select
                        value={quickSetup.timezone}
                        onChange={(e) => setQuickSetup({ ...quickSetup, timezone: e.target.value })}
                        className="w-full pl-10 pr-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        {Intl.supportedValuesOf('timeZone').map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Tags Sections */}
            <SectionCard title="Hobbies & Interests" icon={Heart}>
              <TagInput
                tags={editable.hobbies}
                onAdd={(tag) => setEditable({ ...editable, hobbies: [...editable.hobbies, tag] })}
                onRemove={(tag) => setEditable({ ...editable, hobbies: editable.hobbies.filter((t) => t !== tag) })}
                placeholder="Add a hobby and press Enter..."
                color="primary"
              />
            </SectionCard>

            <SectionCard title="Skills" icon={Star}>
              <TagInput
                tags={editable.skills}
                onAdd={(tag) => setEditable({ ...editable, skills: [...editable.skills, tag] })}
                onRemove={(tag) => setEditable({ ...editable, skills: editable.skills.filter((t) => t !== tag) })}
                placeholder="Add a skill and press Enter..."
                color="success"
              />
            </SectionCard>
          </div>
        )}

        {/* ==================== BEHAVIOR TAB ==================== */}
        {activeTab === 'behavior' && profile && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">AI Behavior Settings</h3>
              <button
                onClick={saveQuickSetup}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            {/* Communication Style */}
            <SectionCard title="Communication Style" icon={MessageSquare}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {COMMUNICATION_STYLES.map(({ value, label, icon: Icon, desc }) => (
                  <button
                    key={value}
                    onClick={() => setQuickSetup({ ...quickSetup, communicationStyle: value })}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      quickSetup.communicationStyle === value
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/50'
                    }`}
                  >
                    <Icon className={`w-6 h-6 mb-2 ${quickSetup.communicationStyle === value ? 'text-primary' : 'text-text-muted'}`} />
                    <p className={`font-medium ${quickSetup.communicationStyle === value ? 'text-primary' : 'text-text-primary dark:text-dark-text-primary'}`}>{label}</p>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">{desc}</p>
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Verbosity */}
            <SectionCard title="Response Verbosity" icon={FileText}>
              <div className="space-y-2">
                {VERBOSITY_OPTIONS.map(({ value, label, desc }) => (
                  <button
                    key={value}
                    onClick={() => setQuickSetup({ ...quickSetup, verbosity: value })}
                    className={`w-full p-3 rounded-lg border transition-all flex items-center justify-between ${
                      quickSetup.verbosity === value
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/50'
                    }`}
                  >
                    <div className="text-left">
                      <p className={`font-medium ${quickSetup.verbosity === value ? 'text-primary' : 'text-text-primary dark:text-dark-text-primary'}`}>{label}</p>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted">{desc}</p>
                    </div>
                    {quickSetup.verbosity === value && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Autonomy Level */}
            <SectionCard title="AI Autonomy Level" icon={Zap}>
              <div className="space-y-3">
                {Object.entries(AUTONOMY_DESCRIPTIONS).map(([level, desc]) => (
                  <button
                    key={level}
                    onClick={() => setQuickSetup({ ...quickSetup, autonomyLevel: level as QuickSetupData['autonomyLevel'] })}
                    className={`w-full p-3 rounded-lg border-2 transition-all flex items-center gap-3 ${
                      quickSetup.autonomyLevel === level
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/50'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full ${
                      level === 'none' ? 'bg-blue-500' :
                      level === 'low' ? 'bg-emerald-500' :
                      level === 'medium' ? 'bg-amber-500' :
                      level === 'high' ? 'bg-orange-500' : 'bg-purple-500'
                    }`} />
                    <div className="flex-1 text-left">
                      <p className={`font-medium capitalize ${quickSetup.autonomyLevel === level ? 'text-primary' : 'text-text-primary dark:text-dark-text-primary'}`}>{level}</p>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted">{desc}</p>
                    </div>
                    {quickSetup.autonomyLevel === level && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Custom Instructions */}
            <SectionCard title="Custom Instructions" icon={Lightbulb}>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Tell the AI how you want it to behave. These instructions guide all interactions.
              </p>
              <div className="space-y-2 mb-4">
                {profile.aiPreferences?.customInstructions?.map((instruction, i) => (
                  <div key={i} className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/10 rounded-lg">
                    <Lightbulb className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary">{instruction}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newInstruction}
                  onChange={(e) => setNewInstruction(e.target.value)}
                  placeholder="Add a custom instruction..."
                  className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && addInstruction()}
                />
                <button onClick={addInstruction} disabled={!newInstruction.trim()} className="px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </SectionCard>

            {/* Boundaries */}
            <SectionCard title="Boundaries" icon={Shield}>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Things the AI should never do or discuss.
              </p>
              <div className="space-y-2 mb-4">
                {profile.aiPreferences?.boundaries?.map((boundary, i) => (
                  <div key={i} className="flex items-center gap-2 p-3 bg-error/5 border border-error/10 rounded-lg">
                    <Shield className="w-4 h-4 text-error flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary">{boundary}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBoundary}
                  onChange={(e) => setNewBoundary(e.target.value)}
                  placeholder="Add a boundary..."
                  className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && addBoundary()}
                />
                <button onClick={addBoundary} disabled={!newBoundary.trim()} className="px-4 py-2 bg-error text-white rounded-lg disabled:opacity-50">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ==================== MEMORIES TAB ==================== */}
        {activeTab === 'memories' && (
          <div className="space-y-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">Memory Management</h3>
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  {memories.length} memories stored · Help your AI remember important information
                </p>
              </div>
            </div>

            {/* Add Memory Form */}
            <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
              <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                Add New Memory
              </h4>
              <div className="space-y-4">
                <textarea
                  value={newMemory.content}
                  onChange={(e) => setNewMemory({ ...newMemory, content: e.target.value })}
                  placeholder="What should your AI remember? (e.g., 'I prefer concise responses', 'My dog's name is Max', 'I have a meeting every Monday at 9am')"
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
                <div className="flex flex-wrap gap-3">
                  <select
                    value={newMemory.type}
                    onChange={(e) => setNewMemory({ ...newMemory, type: e.target.value as typeof newMemory.type })}
                    className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary"
                  >
                    <option value="fact">Fact</option>
                    <option value="preference">Preference</option>
                    <option value="conversation">Conversation</option>
                    <option value="event">Event</option>
                  </select>
                  <select
                    value={newMemory.importance}
                    onChange={(e) => setNewMemory({ ...newMemory, importance: parseInt(e.target.value) })}
                    className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary"
                  >
                    <option value={1}>Low Priority</option>
                    <option value={2}>Normal</option>
                    <option value={3}>High Priority</option>
                  </select>
                  <button
                    onClick={addMemory}
                    disabled={!newMemory.content.trim() || isAddingMemory}
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 ml-auto"
                  >
                    {isAddingMemory ? 'Adding...' : 'Add Memory'}
                  </button>
                </div>
              </div>
            </div>

            {/* Memories List */}
            <div className="space-y-3">
              {memories.length === 0 ? (
                <div className="text-center py-12 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-dashed border-border dark:border-dark-border">
                  <History className="w-12 h-12 text-text-muted mx-auto mb-3" />
                  <p className="text-text-muted dark:text-dark-text-muted">No memories yet</p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">Add your first memory above to help your AI understand you better.</p>
                </div>
              ) : (
                memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="group p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                        memory.importance >= 3 ? 'bg-error' :
                        memory.importance <= 1 ? 'bg-text-muted' : 'bg-primary'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary dark:text-dark-text-primary">{memory.content}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs px-2 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full text-text-muted dark:text-dark-text-muted capitalize">
                            {memory.type}
                          </span>
                          <span className="text-xs text-text-muted dark:text-dark-text-muted">
                            {new Date(memory.createdAt).toLocaleDateString()}
                          </span>
                          {memory.source && (
                            <span className="text-xs text-text-muted dark:text-dark-text-muted">
                              via {memory.source}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteMemory(memory.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-error hover:bg-error/10 rounded-lg transition-all"
                        title="Delete memory"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ==================== ADVANCED TAB ==================== */}
        {activeTab === 'advanced' && profile && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">Advanced Settings</h3>
              <button
                onClick={saveAdvanced}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            {/* Goals */}
            <SectionCard title="Goals" icon={Target}>
              <div className="space-y-4">
                <div>
                  <h5 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    Short Term
                  </h5>
                  <TagInput
                    tags={editable.goals.short}
                    onAdd={(tag) => setEditable({ ...editable, goals: { ...editable.goals, short: [...editable.goals.short, tag] } })}
                    onRemove={(tag) => setEditable({ ...editable, goals: { ...editable.goals, short: editable.goals.short.filter((t) => t !== tag) } })}
                    placeholder="Add a short-term goal..."
                    color="success"
                  />
                </div>
                <div>
                  <h5 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-warning" />
                    Medium Term
                  </h5>
                  <TagInput
                    tags={editable.goals.medium}
                    onAdd={(tag) => setEditable({ ...editable, goals: { ...editable.goals, medium: [...editable.goals.medium, tag] } })}
                    onRemove={(tag) => setEditable({ ...editable, goals: { ...editable.goals, medium: editable.goals.medium.filter((t) => t !== tag) } })}
                    placeholder="Add a medium-term goal..."
                    color="warning"
                  />
                </div>
                <div>
                  <h5 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    Long Term
                  </h5>
                  <TagInput
                    tags={editable.goals.long}
                    onAdd={(tag) => setEditable({ ...editable, goals: { ...editable.goals, long: [...editable.goals.long, tag] } })}
                    onRemove={(tag) => setEditable({ ...editable, goals: { ...editable.goals, long: editable.goals.long.filter((t) => t !== tag) } })}
                    placeholder="Add a long-term goal..."
                    color="primary"
                  />
                </div>
              </div>
            </SectionCard>

            {/* Food Preferences */}
            <SectionCard title="Food Preferences" icon={Heart}>
              <div className="space-y-4">
                <div>
                  <h5 className="text-sm font-medium text-success mb-2">Favorite Foods</h5>
                  <TagInput
                    tags={editable.favoriteFoods}
                    onAdd={(tag) => setEditable({ ...editable, favoriteFoods: [...editable.favoriteFoods, tag] })}
                    onRemove={(tag) => setEditable({ ...editable, favoriteFoods: editable.favoriteFoods.filter((t) => t !== tag) })}
                    placeholder="Add favorite food..."
                    color="success"
                  />
                </div>
                <div>
                  <h5 className="text-sm font-medium text-warning mb-2">Dietary Restrictions</h5>
                  <TagInput
                    tags={editable.dietaryRestrictions}
                    onAdd={(tag) => setEditable({ ...editable, dietaryRestrictions: [...editable.dietaryRestrictions, tag] })}
                    onRemove={(tag) => setEditable({ ...editable, dietaryRestrictions: editable.dietaryRestrictions.filter((t) => t !== tag) })}
                    placeholder="Add restriction..."
                    color="warning"
                  />
                </div>
                <div>
                  <h5 className="text-sm font-medium text-error mb-2">Allergies</h5>
                  <TagInput
                    tags={editable.allergies}
                    onAdd={(tag) => setEditable({ ...editable, allergies: [...editable.allergies, tag] })}
                    onRemove={(tag) => setEditable({ ...editable, allergies: editable.allergies.filter((t) => t !== tag) })}
                    placeholder="Add allergy..."
                    color="error"
                  />
                </div>
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
