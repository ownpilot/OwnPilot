/**
 * Profile Page
 *
 * User profile management for personal AI customization.
 * Allows users to set their preferences, personal info, and AI behavior settings.
 */

import { useState, useEffect } from 'react';
import {
  UserCircle,
  Settings,
  Brain,
  MessageSquare,
  Globe,
  Check,
  Plus,
  Download,
  Upload,
} from '../components/icons';
import { profileApi } from '../api';
import type { ProfileData } from '../api';

interface QuickSetupData {
  name: string;
  nickname: string;
  location: string;
  timezone: string;
  occupation: string;
  language: string;
  communicationStyle: 'formal' | 'casual' | 'mixed';
  autonomyLevel: 'none' | 'low' | 'medium' | 'high' | 'full';
}

const defaultQuickSetup: QuickSetupData = {
  name: '',
  nickname: '',
  location: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  occupation: '',
  language: navigator.language.split('-')[0] || 'en',
  communicationStyle: 'casual',
  autonomyLevel: 'medium',
};

const AUTONOMY_DESCRIPTIONS = {
  none: 'AI always asks before taking any action',
  low: 'AI can read freely, asks for writes',
  medium: 'AI acts freely, asks for destructive actions',
  high: 'AI acts autonomously, rarely asks',
  full: 'Full autonomy - AI makes all decisions',
};

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'quick' | 'advanced' | 'instructions'>('overview');
  const [quickSetup, setQuickSetup] = useState<QuickSetupData>(defaultQuickSetup);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Custom instruction input
  const [newInstruction, setNewInstruction] = useState('');
  const [newBoundary, setNewBoundary] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      const data = await profileApi.get();
      setProfile(data);
      // Pre-fill quick setup with existing data
      setQuickSetup({
        name: data.identity?.name || '',
        nickname: data.identity?.nickname || '',
        location: data.location?.home?.city || '',
        timezone: data.location?.home?.timezone || defaultQuickSetup.timezone,
        occupation: data.work?.occupation || '',
        language: data.communication?.primaryLanguage || defaultQuickSetup.language,
        communicationStyle: data.communication?.preferredStyle || 'casual',
        autonomyLevel: data.aiPreferences?.autonomyLevel || 'medium',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  };

  const saveQuickSetup = async () => {
    try {
      setIsSaving(true);
      setSaveSuccess(false);

      const result = await profileApi.quickSetup({ ...quickSetup });
      setProfile(result.profile);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const addCustomInstruction = async () => {
    if (!newInstruction.trim()) return;

    try {
      await profileApi.setData('instructions', `instruction_${Date.now()}`, newInstruction);
      setNewInstruction('');
      fetchProfile();
    } catch {
      setError('Failed to add instruction');
    }
  };

  const addBoundary = async () => {
    if (!newBoundary.trim()) return;

    try {
      await profileApi.setData('boundaries', `boundary_${Date.now()}`, newBoundary);
      setNewBoundary('');
      fetchProfile();
    } catch {
      setError('Failed to add boundary');
    }
  };

  const exportProfile = async () => {
    try {
      const data = await profileApi.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'profile-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Failed to export profile');
    }
  };

  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await profileApi.import(data.entries);
      fetchProfile();
    } catch {
      setError('Failed to import profile');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-muted dark:text-dark-text-muted">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Your Profile
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Personalize your AI experience
          </p>
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
            <input
              type="file"
              accept=".json"
              onChange={importProfile}
              className="hidden"
            />
          </label>
        </div>
      </header>

      {/* Error display */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 pt-4 border-b border-border dark:border-dark-border">
        <div className="flex gap-4">
          {[
            { id: 'overview', label: 'Overview', icon: UserCircle },
            { id: 'quick', label: 'Quick Setup', icon: Settings },
            { id: 'instructions', label: 'AI Instructions', icon: Brain },
            { id: 'advanced', label: 'Advanced', icon: Globe },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && profile && (
          <div className="space-y-6">
            {/* Profile Card */}
            <div className="p-6 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserCircle className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary">
                    {profile.identity?.name || 'Guest User'}
                  </h3>
                  {profile.identity?.nickname && (
                    <p className="text-text-muted dark:text-dark-text-muted">
                      "{profile.identity.nickname}"
                    </p>
                  )}
                </div>
              </div>

              {/* Completeness */}
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-text-muted dark:text-dark-text-muted">Profile completeness</span>
                  <span className="text-text-primary dark:text-dark-text-primary font-medium">
                    {profile.meta?.completeness ?? 0}%
                  </span>
                </div>
                <div className="h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${profile.meta?.completeness ?? 0}%` }}
                  />
                </div>
              </div>

              {/* Quick facts */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                {profile.location?.home?.city && (
                  <div>
                    <span className="text-text-muted dark:text-dark-text-muted">Location: </span>
                    <span className="text-text-primary dark:text-dark-text-primary">
                      {profile.location.home.city}
                    </span>
                  </div>
                )}
                {profile.work?.occupation && (
                  <div>
                    <span className="text-text-muted dark:text-dark-text-muted">Occupation: </span>
                    <span className="text-text-primary dark:text-dark-text-primary">
                      {profile.work.occupation}
                    </span>
                  </div>
                )}
                {profile.communication?.primaryLanguage && (
                  <div>
                    <span className="text-text-muted dark:text-dark-text-muted">Language: </span>
                    <span className="text-text-primary dark:text-dark-text-primary">
                      {profile.communication.primaryLanguage}
                    </span>
                  </div>
                )}
                {profile.aiPreferences?.autonomyLevel && (
                  <div>
                    <span className="text-text-muted dark:text-dark-text-muted">AI Autonomy: </span>
                    <span className="text-text-primary dark:text-dark-text-primary capitalize">
                      {profile.aiPreferences.autonomyLevel}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border text-center">
                <div className="text-2xl font-bold text-primary">{profile.meta?.totalEntries ?? 0}</div>
                <div className="text-sm text-text-muted dark:text-dark-text-muted">Data entries</div>
              </div>
              <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border text-center">
                <div className="text-2xl font-bold text-success">
                  {profile.aiPreferences?.customInstructions?.length ?? 0}
                </div>
                <div className="text-sm text-text-muted dark:text-dark-text-muted">Instructions</div>
              </div>
              <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border text-center">
                <div className="text-2xl font-bold text-warning">
                  {profile.aiPreferences?.boundaries?.length ?? 0}
                </div>
                <div className="text-sm text-text-muted dark:text-dark-text-muted">Boundaries</div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Setup Tab */}
        {activeTab === 'quick' && (
          <div className="space-y-6">
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Set up the essentials quickly. These settings help the AI understand you better.
            </p>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={quickSetup.name}
                  onChange={(e) => setQuickSetup({ ...quickSetup, name: e.target.value })}
                  placeholder="What should the AI call you?"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Nickname */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Nickname (optional)
                </label>
                <input
                  type="text"
                  value={quickSetup.nickname}
                  onChange={(e) => setQuickSetup({ ...quickSetup, nickname: e.target.value })}
                  placeholder="A friendly name or alias"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={quickSetup.location}
                  onChange={(e) => setQuickSetup({ ...quickSetup, location: e.target.value })}
                  placeholder="City or region"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Occupation */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Occupation
                </label>
                <input
                  type="text"
                  value={quickSetup.occupation}
                  onChange={(e) => setQuickSetup({ ...quickSetup, occupation: e.target.value })}
                  placeholder="What do you do?"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Preferred Language
                </label>
                <select
                  value={quickSetup.language}
                  onChange={(e) => setQuickSetup({ ...quickSetup, language: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="en">English</option>
                  <option value="tr">Turkish</option>
                  <option value="de">German</option>
                  <option value="fr">French</option>
                  <option value="es">Spanish</option>
                  <option value="zh">Chinese</option>
                  <option value="ja">Japanese</option>
                </select>
              </div>

              {/* Communication Style */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  Communication Style
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['formal', 'casual', 'mixed'] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => setQuickSetup({ ...quickSetup, communicationStyle: style })}
                      className={`px-3 py-2 rounded-lg border transition-colors capitalize ${
                        quickSetup.communicationStyle === style
                          ? 'bg-primary text-white border-primary'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:border-primary'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Autonomy Level */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                  AI Autonomy Level
                </label>
                <select
                  value={quickSetup.autonomyLevel}
                  onChange={(e) => setQuickSetup({ ...quickSetup, autonomyLevel: e.target.value as typeof quickSetup.autonomyLevel })}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {Object.entries(AUTONOMY_DESCRIPTIONS).map(([level, desc]) => (
                    <option key={level} value={level}>
                      {level.charAt(0).toUpperCase() + level.slice(1)} - {desc}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                  {AUTONOMY_DESCRIPTIONS[quickSetup.autonomyLevel]}
                </p>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={saveQuickSetup}
              disabled={isSaving}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                'Saving...'
              ) : saveSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  Saved!
                </>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>
        )}

        {/* AI Instructions Tab */}
        {activeTab === 'instructions' && profile && (
          <div className="space-y-6">
            {/* Custom Instructions */}
            <div>
              <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Custom Instructions
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Tell the AI how you want it to behave. These instructions are always followed.
              </p>

              <div className="space-y-2 mb-4">
                {profile.aiPreferences?.customInstructions?.map((instruction, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                  >
                    <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary">
                      {instruction}
                    </span>
                  </div>
                ))}
                {(!profile.aiPreferences?.customInstructions || profile.aiPreferences.customInstructions.length === 0) && (
                  <p className="text-sm text-text-muted dark:text-dark-text-muted italic">
                    No custom instructions yet
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newInstruction}
                  onChange={(e) => setNewInstruction(e.target.value)}
                  placeholder="Add a custom instruction..."
                  className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && addCustomInstruction()}
                />
                <button
                  onClick={addCustomInstruction}
                  disabled={!newInstruction.trim()}
                  className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Boundaries */}
            <div>
              <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Boundaries
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Things the AI should never do or discuss.
              </p>

              <div className="space-y-2 mb-4">
                {profile.aiPreferences?.boundaries?.map((boundary, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-lg"
                  >
                    <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary">
                      {boundary}
                    </span>
                  </div>
                ))}
                {(!profile.aiPreferences?.boundaries || profile.aiPreferences.boundaries.length === 0) && (
                  <p className="text-sm text-text-muted dark:text-dark-text-muted italic">
                    No boundaries set
                  </p>
                )}
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
                <button
                  onClick={addBoundary}
                  disabled={!newBoundary.trim()}
                  className="px-4 py-2 bg-error hover:bg-error/80 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Advanced Tab */}
        {activeTab === 'advanced' && profile && (
          <div className="space-y-6">
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Advanced profile data. You can add custom data entries here.
            </p>

            {/* Hobbies */}
            <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
              <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Hobbies & Interests
              </h4>
              <div className="flex flex-wrap gap-2">
                {profile.lifestyle?.hobbies?.map((hobby, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full text-sm text-text-secondary dark:text-dark-text-secondary"
                  >
                    {hobby}
                  </span>
                ))}
                {(!profile.lifestyle?.hobbies || profile.lifestyle.hobbies.length === 0) && (
                  <span className="text-sm text-text-muted dark:text-dark-text-muted italic">
                    No hobbies added
                  </span>
                )}
              </div>
            </div>

            {/* Skills */}
            <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
              <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Skills
              </h4>
              <div className="flex flex-wrap gap-2">
                {profile.work?.skills?.map((skill, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm"
                  >
                    {skill}
                  </span>
                ))}
                {(!profile.work?.skills || profile.work.skills.length === 0) && (
                  <span className="text-sm text-text-muted dark:text-dark-text-muted italic">
                    No skills added
                  </span>
                )}
              </div>
            </div>

            {/* Goals */}
            <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
              <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Goals
              </h4>
              <div className="space-y-2">
                {profile.goals?.shortTerm?.map((goal, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-0.5 bg-success/10 text-success rounded text-xs">
                      Short
                    </span>
                    <span className="text-text-primary dark:text-dark-text-primary">{goal}</span>
                  </div>
                ))}
                {profile.goals?.mediumTerm?.map((goal, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-0.5 bg-warning/10 text-warning rounded text-xs">
                      Medium
                    </span>
                    <span className="text-text-primary dark:text-dark-text-primary">{goal}</span>
                  </div>
                ))}
                {profile.goals?.longTerm?.map((goal, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">
                      Long
                    </span>
                    <span className="text-text-primary dark:text-dark-text-primary">{goal}</span>
                  </div>
                ))}
                {(!profile.goals?.shortTerm?.length && !profile.goals?.mediumTerm?.length && !profile.goals?.longTerm?.length) && (
                  <span className="text-sm text-text-muted dark:text-dark-text-muted italic">
                    No goals set
                  </span>
                )}
              </div>
            </div>

            {/* Food Preferences */}
            <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
              <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Food Preferences
              </h4>
              <div className="space-y-2">
                {profile.lifestyle?.eatingHabits?.favoriteFoods?.length ? (
                  <div>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">Favorites:</span>
                    <span className="ml-2 text-sm text-text-primary dark:text-dark-text-primary">
                      {profile.lifestyle.eatingHabits.favoriteFoods.join(', ')}
                    </span>
                  </div>
                ) : null}
                {profile.lifestyle?.eatingHabits?.dietaryRestrictions?.length ? (
                  <div>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">Restrictions:</span>
                    <span className="ml-2 text-sm text-warning">
                      {profile.lifestyle.eatingHabits.dietaryRestrictions.join(', ')}
                    </span>
                  </div>
                ) : null}
                {profile.lifestyle?.eatingHabits?.allergies?.length ? (
                  <div>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">Allergies:</span>
                    <span className="ml-2 text-sm text-error">
                      {profile.lifestyle.eatingHabits.allergies.join(', ')}
                    </span>
                  </div>
                ) : null}
                {(!profile.lifestyle?.eatingHabits?.favoriteFoods?.length &&
                  !profile.lifestyle?.eatingHabits?.dietaryRestrictions?.length &&
                  !profile.lifestyle?.eatingHabits?.allergies?.length) && (
                  <span className="text-sm text-text-muted dark:text-dark-text-muted italic">
                    No food preferences set
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
