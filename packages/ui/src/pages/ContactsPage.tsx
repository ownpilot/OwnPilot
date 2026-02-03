import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, Phone, Mail, Building, Star, Search } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { contactsApi } from '../api';

interface Contact {
  id: string;
  name: string;
  nickname?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  avatar?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  relationship?: string;
  tags: string[];
  isFavorite: boolean;
  socialLinks?: Record<string, string>;
  customFields?: Record<string, string>;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}


export function ContactsPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');

  const fetchContacts = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filter === 'favorites') params.favorite = 'true';

      const data = await contactsApi.list(params);
      setContacts(data as Contact[]);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, filter]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleDelete = async (contactId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this contact?', variant: 'danger' })) return;

    try {
      await contactsApi.delete(contactId);
      toast.success('Contact deleted');
      fetchContacts();
    } catch {
      // API client handles error reporting
    }
  };

  const handleToggleFavorite = async (contact: Contact) => {
    try {
      await contactsApi.favorite(contact.id);
      toast.success(contact.isFavorite ? 'Removed from favorites' : 'Added to favorites');
      fetchContacts();
    } catch {
      // API client handles error reporting
    }
  };

  const favoriteCount = contacts.filter((c) => c.isFavorite).length;

  // Group contacts alphabetically
  const groupedContacts = contacts.reduce((acc, contact) => {
    const letter = (contact.name?.[0] ?? '#').toUpperCase();
    if (!acc[letter]) acc[letter] = [];
    acc[letter].push(contact);
    return acc;
  }, {} as Record<string, Contact[]>);

  const sortedGroups = Object.entries(groupedContacts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Contacts
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''}, {favoriteCount} favorite{favoriteCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </header>

      {/* Search and Filters */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'favorites'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
              }`}
            >
              {f === 'all' ? 'All' : 'Favorites'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading contacts..." />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={searchQuery ? 'No contacts found' : 'No contacts yet'}
            description={searchQuery ? 'Try a different search term.' : 'Add your first contact to get started.'}
            action={!searchQuery ? { label: 'Add Contact', onClick: () => setShowCreateModal(true), icon: Plus } : undefined}
          />
        ) : (
          <div className="space-y-6">
            {sortedGroups.map(([letter, letterContacts]) => (
              <div key={letter}>
                <h4 className="text-sm font-medium text-text-muted dark:text-dark-text-muted mb-2 sticky top-0 bg-bg-primary dark:bg-dark-bg-primary py-1">
                  {letter}
                </h4>
                <div className="space-y-2">
                  {letterContacts.map((contact) => (
                    <ContactItem
                      key={contact.id}
                      contact={contact}
                      onEdit={() => setEditingContact(contact)}
                      onDelete={() => handleDelete(contact.id)}
                      onToggleFavorite={() => handleToggleFavorite(contact)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingContact) && (
        <ContactModal
          contact={editingContact}
          onClose={() => {
            setShowCreateModal(false);
            setEditingContact(null);
          }}
          onSave={() => {
            toast.success(editingContact ? 'Contact updated' : 'Contact created');
            setShowCreateModal(false);
            setEditingContact(null);
            fetchContacts();
          }}
        />
      )}
    </div>
  );
}

interface ContactItemProps {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

function ContactItem({ contact, onEdit, onDelete, onToggleFavorite }: ContactItemProps) {
  const displayName = contact.name || contact.nickname || 'Unknown';
  // Get initials from name (first letter of first and last word)
  const nameParts = (contact.name || '').trim().split(/\s+/);
  const initials = nameParts.length > 1
    ? `${nameParts[0]?.[0] ?? ''}${nameParts[nameParts.length - 1]?.[0] ?? ''}`.toUpperCase()
    : (nameParts[0]?.[0] ?? '?').toUpperCase();

  return (
    <div className="card-elevated card-hover flex items-center gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary dark:text-dark-text-primary">
            {displayName}
          </span>
          {contact.isFavorite && <Star className="w-4 h-4 text-warning fill-warning" />}
        </div>

        <div className="flex items-center gap-3 mt-1 text-sm text-text-muted dark:text-dark-text-muted">
          {contact.company && (
            <span className="flex items-center gap-1">
              <Building className="w-3 h-3" />
              {contact.company}
            </span>
          )}
          {contact.email && (
            <span className="flex items-center gap-1">
              <Mail className="w-3 h-3" />
              {contact.email}
            </span>
          )}
          {contact.phone && (
            <span className="flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {contact.phone}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleFavorite}
          className={`p-1 transition-colors ${
            contact.isFavorite
              ? 'text-warning'
              : 'text-text-muted dark:text-dark-text-muted hover:text-warning'
          }`}
        >
          <Star className={`w-4 h-4 ${contact.isFavorite ? 'fill-warning' : ''}`} />
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface ContactModalProps {
  contact: Contact | null;
  onClose: () => void;
  onSave: () => void;
}

function ContactModal({ contact, onClose, onSave }: ContactModalProps) {
  const [name, setName] = useState(contact?.name ?? '');
  const [nickname, setNickname] = useState(contact?.nickname ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [company, setCompany] = useState(contact?.company ?? '');
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [isFavorite, setIsFavorite] = useState(contact?.isFavorite ?? false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        relationship: relationship.trim() || undefined,
        notes: notes.trim() || undefined,
        isFavorite,
      };

      if (contact) {
        await contactsApi.update(contact.id, body);
      } else {
        await contactsApi.create(body);
      }

      onSave();
    } catch {
      // handled by typed API client
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {contact ? 'Edit Contact' : 'Add Contact'}
            </h3>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Nickname
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Johnny"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Company
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Inc."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Software Engineer"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Relationship
              </label>
              <input
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Friend, Family, Colleague..."
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                rows={3}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isFavorite"
                checked={isFavorite}
                onChange={(e) => setIsFavorite(e.target.checked)}
                className="w-4 h-4 rounded border-border dark:border-dark-border"
              />
              <label htmlFor="isFavorite" className="text-sm text-text-secondary dark:text-dark-text-secondary">
                Mark as favorite
              </label>
            </div>
          </div>

          <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : contact ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
