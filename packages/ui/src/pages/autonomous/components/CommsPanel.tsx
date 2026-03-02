/**
 * CommsPanel — Messages tab: inter-agent communication viewer
 */

import { useState, useEffect, useCallback } from 'react';
import { agentMessagesApi } from '../../../api/endpoints/souls';
import type { AgentMessage } from '../../../api/endpoints/souls';
import { RefreshCw, Send, MessageSquare } from '../../../components/icons';
import { EmptyState } from '../../../components/EmptyState';
import { useToast } from '../../../components/ToastProvider';
import type { UnifiedAgent } from '../types';
import { MESSAGE_TYPE_COLORS, PRIORITY_COLORS, formatTimeAgo } from '../helpers';

interface Props {
  agents: UnifiedAgent[];
}

export function CommsPanel({ agents }: Props) {
  const toast = useToast();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeContent, setComposeContent] = useState('');
  const [selectedThread, setSelectedThread] = useState<AgentMessage[] | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      setIsLoading(true);
      if (filterAgent) {
        const data = await agentMessagesApi.listByAgent(filterAgent);
        setMessages(Array.isArray(data) ? data : []);
      } else {
        const data = await agentMessagesApi.list();
        setMessages(data.items);
      }
    } catch {
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, [filterAgent]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleSend = useCallback(async () => {
    if (!composeTo.trim() || !composeContent.trim()) return;
    try {
      await agentMessagesApi.send({
        to: composeTo,
        content: composeContent,
        subject: composeSubject || undefined,
        type: 'coordination',
      });
      toast.success('Message sent');
      setShowCompose(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeContent('');
      fetchMessages();
    } catch {
      toast.error('Failed to send message');
    }
  }, [composeTo, composeContent, composeSubject, toast, fetchMessages]);

  const viewThread = useCallback(async (threadId: string) => {
    try {
      const data = await agentMessagesApi.getThread(threadId);
      setSelectedThread(data);
    } catch {
      /* handled */
    }
  }, []);

  const getAgentName = (id: string): string => {
    const agent = agents.find((a) => a.id === id);
    return agent ? `${agent.emoji} ${agent.name}` : id;
  };

  const inputClass =
    'w-full rounded-lg border border-border dark:border-dark-border bg-surface dark:bg-dark-surface text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className={`${inputClass} max-w-xs`}
        >
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.emoji} {a.name}
            </option>
          ))}
        </select>
        <button
          onClick={fetchMessages}
          className="p-2 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors ml-auto"
        >
          <Send className="w-3.5 h-3.5" />
          Compose
        </button>
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="border border-primary/20 rounded-xl p-4 bg-primary/5 space-y-3">
          <select
            value={composeTo}
            onChange={(e) => setComposeTo(e.target.value)}
            className={inputClass}
          >
            <option value="">Select recipient...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={composeSubject}
            onChange={(e) => setComposeSubject(e.target.value)}
            placeholder="Subject (optional)"
            className={inputClass}
          />
          <textarea
            value={composeContent}
            onChange={(e) => setComposeContent(e.target.value)}
            placeholder="Message content..."
            rows={3}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSend}
              disabled={!composeTo || !composeContent}
              className="px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
            >
              Send
            </button>
            <button
              onClick={() => setShowCompose(false)}
              className="text-sm text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Thread detail panel */}
      {selectedThread && (
        <div className="border border-border dark:border-dark-border rounded-xl p-4 bg-surface dark:bg-dark-surface space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              Thread ({selectedThread.length} messages)
            </h3>
            <button
              onClick={() => setSelectedThread(null)}
              className="text-xs text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
            >
              Close
            </button>
          </div>
          {selectedThread.map((msg) => (
            <div
              key={msg.id}
              className="text-xs p-2 rounded border border-border dark:border-dark-border"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {getAgentName(msg.from)}
                </span>
                <span className="text-text-muted dark:text-dark-text-muted">→</span>
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {getAgentName(msg.to)}
                </span>
                <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                  {formatTimeAgo(msg.createdAt)}
                </span>
              </div>
              <p className="text-text-primary dark:text-dark-text-primary mt-1">{msg.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Message list */}
      {isLoading ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted">Loading messages...</p>
      ) : messages.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No messages"
          description="Agents haven't communicated yet. Messages will appear here when agents send each other messages during heartbeat cycles."
        />
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="border border-border dark:border-dark-border rounded-lg p-3 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {getAgentName(msg.from)}
                </span>
                <span className="text-text-muted dark:text-dark-text-muted">→</span>
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {getAgentName(msg.to)}
                </span>
                <span className={`px-2 py-0.5 rounded ${MESSAGE_TYPE_COLORS[msg.type] || ''}`}>
                  {msg.type}
                </span>
                <span className={`${PRIORITY_COLORS[msg.priority] || ''}`}>
                  {msg.priority !== 'normal' ? msg.priority : ''}
                </span>
                <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                  {formatTimeAgo(msg.createdAt)}
                </span>
                {!msg.readAt && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
              </div>
              {msg.subject && (
                <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mt-1">
                  {msg.subject}
                </p>
              )}
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1 line-clamp-2">
                {msg.content}
              </p>
              {msg.threadId && (
                <button
                  onClick={() => viewThread(msg.threadId!)}
                  className="text-xs text-primary hover:text-primary-dark mt-1"
                >
                  View thread →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
