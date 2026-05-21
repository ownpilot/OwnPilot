import { useState } from 'react';
import { useToast } from '../../components/ToastProvider';
import { fleetApi } from '../../api/endpoints/fleet';
import type { FleetConfig } from '../../api/endpoints/fleet';
import { X, Send } from '../../components/icons';

export function BroadcastModal({ fleet, onClose }: { fleet: FleetConfig; onClose: () => void }) {
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;
    setIsSending(true);
    try {
      await fleetApi.broadcast(fleet.id, message.trim());
      toast.success('Message broadcast to all workers');
      onClose();
    } catch (err) {
      toast.error(`Broadcast failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border shadow-xl">
        <div className="flex items-center justify-between border-b border-border dark:border-dark-border p-4">
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Broadcast to {fleet.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message to broadcast to all workers..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary resize-none"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border dark:border-dark-border p-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Send className="w-4 h-4" />
            {isSending ? 'Sending...' : 'Broadcast'}
          </button>
        </div>
      </div>
    </div>
  );
}
