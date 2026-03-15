/**
 * ChatWidget — Floating web chat widget
 *
 * Renders a collapsible chat bubble in the bottom-right corner.
 * Connects via WebSocket to the gateway's webchat channel.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Types
interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  replyToId?: string;
}

// Generate or retrieve a persistent session ID
function getSessionId(): string {
  const KEY = 'ownpilot-webchat-session';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionId = useRef(getSessionId());

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // WebSocket connection
  useEffect(() => {
    if (!isOpen) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'webchat:response') {
          const data = msg.data;
          // Only accept messages for our session
          if (data.sessionId && data.sessionId !== sessionId.current) return;

          setMessages((prev) => [
            ...prev,
            {
              id: data.id || crypto.randomUUID(),
              text: data.text,
              sender: 'assistant',
              timestamp: new Date(data.timestamp || Date.now()),
              replyToId: data.replyToId,
            },
          ]);
          setIsTyping(false);
        }

        if (msg.type === 'webchat:typing') {
          const data = msg.data;
          if (data.sessionId && data.sessionId !== sessionId.current) return;
          setIsTyping(data.typing ?? true);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isOpen]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const id = crypto.randomUUID();

    // Add to local messages
    setMessages((prev) => [
      ...prev,
      {
        id,
        text,
        sender: 'user',
        timestamp: new Date(),
      },
    ]);

    // Send via WebSocket
    wsRef.current.send(
      JSON.stringify({
        type: 'webchat:message',
        data: {
          text,
          sessionId: sessionId.current,
          displayName: 'Web User',
        },
      })
    );

    setInput('');
    setIsTyping(true);
  }, [input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // Floating action button (collapsed)
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary hover:bg-primary-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-50"
        aria-label="Open chat"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {messages.filter((m) => m.sender === 'assistant').length}
          </span>
        )}
      </button>
    );
  }

  // Expanded chat panel
  return (
    <div className="fixed bottom-6 right-6 w-96 h-[32rem] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary text-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <span className="font-medium text-sm">OwnPilot Chat</span>
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-white/20 rounded transition-colors"
          aria-label="Close chat"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
            <svg
              className="w-12 h-12 mb-3 opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-sm">Start a conversation</p>
            <p className="text-xs mt-1">Type a message below to begin</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.sender === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary rounded-bl-md'
              }`}
            >
              {msg.text}
              <div
                className={`text-[10px] mt-1 ${
                  msg.sender === 'user'
                    ? 'text-white/60'
                    : 'text-text-muted dark:text-dark-text-muted'
                }`}
              >
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-bg-secondary dark:bg-dark-bg-secondary text-text-muted dark:text-dark-text-muted px-3 py-2 rounded-2xl rounded-bl-md text-sm">
              <span className="inline-flex gap-1">
                <span
                  className="w-1.5 h-1.5 bg-text-muted dark:bg-dark-text-muted rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-text-muted dark:bg-dark-text-muted rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-text-muted dark:bg-dark-text-muted rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border dark:border-dark-border">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? 'Type a message...' : 'Connecting...'}
            disabled={!isConnected}
            className="flex-1 px-3 py-2 text-sm rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !isConnected}
            className="p-2 bg-primary hover:bg-primary-dark text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
