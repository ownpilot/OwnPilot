import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const TELEGRAM_ENV = `# .env
TELEGRAM_BOT_TOKEN=7123456789:AAGxyz...
TELEGRAM_CHAT_ID=123456789       # Your personal Telegram user ID (optional)`;

const TELEGRAM_CLI = `# Start the Telegram bot
ownpilot bot start

# Check bot status
ownpilot bot status

# Stop the bot
ownpilot bot stop`;

const TELEGRAM_CONFIG_API = `POST /api/v1/config/services
Content-Type: application/json

{
  "service": "telegram",
  "bot_token": "7123456789:AAGxyz..."
}`;

const WHATSAPP_START = `# The WhatsApp channel uses Baileys (multi-device)
# Start the WhatsApp channel via the web UI:
# Settings → Channels → WhatsApp → Connect

# Or via API:
POST /api/v1/channels/whatsapp/connect

# Response includes a QR code as base64 PNG:
{
  "qrCode": "data:image/png;base64,...",
  "status": "waiting_scan"
}`;

const CHANNEL_APPROVAL = `# Check pending approval requests
GET /api/v1/channels/telegram/approval-queue

# Approve a user
POST /api/v1/channels/telegram/users/:userId/approve

# Block a user
POST /api/v1/channels/telegram/users/:userId/block

# Unblock a user
POST /api/v1/channels/telegram/users/:userId/unblock`;

const PAIRING_KEY = `# Generate a pairing key for channel ownership verification
POST /api/v1/channels/telegram/pairing-key

# Response:
{
  "key": "PAIR-7X9K-2M4N",
  "expiresAt": "2026-03-16T11:00:00Z"
}

# User sends this key to the bot to claim ownership
# Keys rotate every 10 minutes`;

const MESSAGE_FORMAT = `# Telegram supports Markdown formatting in bot replies:
# *bold*, _italic_, \`code\`, [text](url)
# The agent automatically formats responses appropriately.

# WhatsApp formatting:
# *bold*, _italic_, ~strikethrough~, \`\`\`code\`\`\``;

const CHANNEL_MESSAGES_API = `# Read channel inbox (read-only, DB-backed)
GET /api/v1/inbox/messages?channel=telegram&limit=50

# Response:
{
  "data": [
    {
      "id": "msg_abc123",
      "channel": "telegram",
      "userId": "tg_123456789",
      "content": "What's on my task list today?",
      "timestamp": "2026-03-16T09:15:00Z",
      "response": "You have 3 tasks due today..."
    }
  ],
  "total": 127
}`;

const WHATSAPP_SAFETY = `# WhatsApp anti-ban safety settings (configured in Settings → Channels → WhatsApp):
# - Typing simulation: adds realistic typing delays
# - Message rate limiting: max N messages per hour
# - Auto-reply protection: prevents bot loops
# - Business account detection: adjusts behavior`;

export function ChannelsPage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        Channels
      </Badge>
      <h1>Channels</h1>
      <p className="text-lg text-[var(--color-text-muted)] mb-8">
        OwnPilot connects to Telegram and WhatsApp via channel plugins, bringing the full assistant
        experience — 190+ tools, memory, workflows — directly into your messaging apps. Each channel
        has approval flow, pairing keys, user management, and inbox persistence.
      </p>

      <h2>Supported channels</h2>
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Status</th>
            <th>Auth method</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Telegram</td>
            <td>Production</td>
            <td>Bot token</td>
            <td>Full feature support</td>
          </tr>
          <tr>
            <td>WhatsApp</td>
            <td>Production</td>
            <td>QR code scan</td>
            <td>Multi-device (Baileys)</td>
          </tr>
        </tbody>
      </table>

      <Callout type="note" title="Channel plugin architecture">
        Channels are implemented as plugins using a builder pattern:{' '}
        <code>createChannelPlugin().meta().platform().channelApi(factory).build()</code>. The
        Universal Channel Protocol (UCP) provides a unified message format across channels.
      </Callout>

      <h2>Telegram</h2>

      <h3>Step 1: Create a Telegram bot</h3>
      <ol>
        <li>
          Open Telegram and message <code>@BotFather</code>
        </li>
        <li>
          Send <code>/newbot</code> and follow the prompts
        </li>
        <li>
          Copy the bot token (format: <code>1234567890:AABBccDDeeFF...</code>)
        </li>
        <li>
          Optionally: use <code>/setprivacy</code> to disable group privacy for group use
        </li>
      </ol>

      <h3>Step 2: Configure the token</h3>
      <p>
        You can configure via <code>.env</code>, the Config Center web UI, or the REST API:
      </p>
      <CodeBlock code={TELEGRAM_ENV} language="bash" filename=".env" />

      <p>Or via the Config Center API:</p>
      <CodeBlock code={TELEGRAM_CONFIG_API} language="http" filename="configure-telegram.http" />

      <h3>Step 3: Start the bot</h3>
      <CodeBlock code={TELEGRAM_CLI} language="bash" />

      <Callout type="tip" title="Telegram bot in Docker">
        When running in Docker, the Telegram bot starts automatically if{' '}
        <code>TELEGRAM_BOT_TOKEN</code> is set. You don't need to run{' '}
        <code>ownpilot bot start</code> manually.
      </Callout>

      <h3>Telegram features</h3>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Streaming responses</td>
            <td>Messages delivered in chunks as the AI generates them</td>
          </tr>
          <tr>
            <td>Markdown formatting</td>
            <td>
              <code>*bold*</code>, <code>_italic_</code>, <code>`code`</code>, links
            </td>
          </tr>
          <tr>
            <td>File/image support</td>
            <td>Photos, documents, and voice messages accepted</td>
          </tr>
          <tr>
            <td>Inline keyboards</td>
            <td>Approval dialogs and action buttons sent as inline keyboards</td>
          </tr>
          <tr>
            <td>Group chats</td>
            <td>Bot responds when mentioned or in private conversations</td>
          </tr>
          <tr>
            <td>User approval</td>
            <td>Only approved users can interact with the bot</td>
          </tr>
        </tbody>
      </table>

      <h2>WhatsApp</h2>
      <p>
        WhatsApp integration uses the Baileys library for multi-device support. No phone number
        portability or WhatsApp Business API required — connects your personal WhatsApp.
      </p>

      <h3>Connecting via QR code</h3>
      <CodeBlock code={WHATSAPP_START} language="bash" filename="connect-whatsapp.sh" />

      <ol>
        <li>
          Open the web UI: <strong>Settings → Channels → WhatsApp → Connect</strong>
        </li>
        <li>A QR code is displayed (30-second expiry)</li>
        <li>Open WhatsApp on your phone</li>
        <li>
          Go to <strong>Settings → Linked Devices → Link a Device</strong>
        </li>
        <li>Scan the QR code</li>
        <li>
          Connection status updates to <code>connected</code> in real-time via WebSocket
        </li>
      </ol>

      <Callout type="warning" title="WhatsApp ToS">
        Using unofficial WhatsApp integrations may violate WhatsApp's Terms of Service. Use
        responsibly and only for personal automation.
      </Callout>

      <h3>WhatsApp safety filters</h3>
      <CodeBlock code={WHATSAPP_SAFETY} language="bash" />

      <h2>User approval flow</h2>
      <p>
        Both Telegram and WhatsApp channels support a user approval system. When a new user messages
        the bot, they are added to a pending queue. An admin must approve them before they can
        interact with the assistant.
      </p>
      <CodeBlock code={CHANNEL_APPROVAL} language="http" filename="channel-approval.http" />

      <h3>Approval settings</h3>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>open</code>
            </td>
            <td>Anyone can use the bot (no approval required)</td>
          </tr>
          <tr>
            <td>
              <code>allowlist</code>
            </td>
            <td>Only pre-approved users can interact</td>
          </tr>
          <tr>
            <td>
              <code>request</code>
            </td>
            <td>Users request access; admin approves via web UI</td>
          </tr>
        </tbody>
      </table>

      <h2>Pairing keys</h2>
      <p>
        Pairing keys are rotating short codes used to verify channel ownership and link a
        Telegram/WhatsApp user account to an OwnPilot user account.
      </p>
      <CodeBlock code={PAIRING_KEY} language="http" filename="pairing-key.http" />

      <h2>Message formatting</h2>
      <CodeBlock code={MESSAGE_FORMAT} language="text" />

      <h2>Inbox (channel messages)</h2>
      <p>
        All channel messages and bot responses are persisted in the <code>channel_messages</code>
        database table. The web UI provides a read-only inbox view.
      </p>
      <CodeBlock code={CHANNEL_MESSAGES_API} language="http" filename="inbox-api.http" />

      <h2>Middleware pipeline</h2>
      <p>Channel messages flow through the same middleware pipeline as web UI messages:</p>
      <ol>
        <li>
          <strong>Audit middleware</strong> — Tamper-evident log entry created
        </li>
        <li>
          <strong>Persistence middleware</strong> — Message stored in conversation history
        </li>
        <li>
          <strong>Post-processing</strong> — Message normalization and metadata extraction
        </li>
        <li>
          <strong>Context injection</strong> — Memories, goals, and soul context prepended
        </li>
        <li>
          <strong>Agent execution</strong> — Tool orchestration and LLM inference
        </li>
        <li>
          <strong>Channel delivery</strong> — Response delivered back via the channel API
        </li>
      </ol>

      <Callout type="info" title="Shared conversation history">
        A conversation started on Telegram can continue in the web UI, and vice versa. All channels
        share the same conversation history for a given user.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/personal-data"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Personal Data
        </Link>
        <Link
          to="/docs/mcp"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          MCP Integration
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
