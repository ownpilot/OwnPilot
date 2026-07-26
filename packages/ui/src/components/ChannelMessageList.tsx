import { forwardRef } from 'react';

interface ChannelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  senderName?: string;
}

interface ChannelMessageListProps {
  messages: ChannelMessage[];
}

export const ChannelMessageList = forwardRef<HTMLDivElement, ChannelMessageListProps>(
  function ChannelMessageList({ messages }, ref) {
    if (messages.length === 0) {
      return (
        <div className="h-full flex items-center justify-center">
          <p className="text-text-muted dark:text-dark-text-muted text-sm italic">
            No messages yet
          </p>
          <div ref={ref} />
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
          >
            <div
              className={`max-w-[75%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary'
                  : 'bg-primary text-white'
              }`}
            >
              {msg.senderName && msg.role === 'user' && (
                <p className="text-[10px] opacity-60 mb-0.5 font-medium">{msg.senderName}</p>
              )}
              {msg.content}
              <p className="text-[10px] mt-1 opacity-50 text-right">
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}
        <div ref={ref} />
      </div>
    );
  }
);
