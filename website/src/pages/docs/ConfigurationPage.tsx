import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const CLI_CONFIG = `# Set configuration values
ownpilot config set openai-api-key sk-...
ownpilot config set anthropic-api-key sk-ant-...
ownpilot config set auth-type jwt
ownpilot config set jwt-secret $(openssl rand -base64 64)

# Get a configuration value
ownpilot config get openai-api-key

# List all configuration keys
ownpilot config list

# Delete a configuration key
ownpilot config delete old-key`;

const CONFIG_API = `# Get all configuration (keys only — values masked for secrets)
GET /api/v1/config

# Get a specific key
GET /api/v1/config/:key

# Set a configuration value
POST /api/v1/config
Content-Type: application/json
{
  "key": "default-model",
  "value": "claude-opus-4-5"
}

# Set multiple values at once
POST /api/v1/config/bulk
{
  "values": {
    "default-provider": "anthropic",
    "default-model": "claude-opus-4-5",
    "log-level": "info"
  }
}`;

const ENV_VARS_FULL = `# Server
PORT=8080                    # Gateway HTTP port (default: 8080)
HOST=0.0.0.0                 # Bind address (default: 0.0.0.0)
NODE_ENV=production          # development | production
LOG_LEVEL=info               # error | warn | info | debug
UI_PORT=5173                 # Vite dev server port (dev mode only)

# Database
POSTGRES_HOST=localhost       # PostgreSQL hostname
POSTGRES_PORT=25432           # PostgreSQL port (Docker maps 5432→25432)
POSTGRES_USER=ownpilot        # Database user
POSTGRES_PASSWORD=secret      # Database password (use Docker secret or vault)
POSTGRES_DB=ownpilot          # Database name

# Authentication
AUTH_TYPE=none                # none | api-key | jwt
API_KEY=your-api-key          # Required when AUTH_TYPE=api-key
JWT_SECRET=your-64-char-secret # Required when AUTH_TYPE=jwt (min 64 chars)
JWT_EXPIRY=7d                 # JWT token expiry (default: 7d)

# AI Provider keys (can also be set via Config Center)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
ZHIPU_API_KEY=...
GROQ_API_KEY=...
TOGETHER_API_KEY=...
OPENROUTER_API_KEY=...

# Local AI
OLLAMA_BASE_URL=http://localhost:11434
LM_STUDIO_BASE_URL=http://localhost:1234
LOCALAI_BASE_URL=http://localhost:8080
VLLM_BASE_URL=http://localhost:8000

# Channels
TELEGRAM_BOT_TOKEN=7123456789:AAG...
TELEGRAM_CHAT_ID=123456789

# Edge / IoT
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=ownpilot
MQTT_PASSWORD=secret

# Encryption (auto-generated on first run if not set)
ENCRYPTION_KEY=base64-encoded-32-byte-key

# Composio (1000+ app integrations)
COMPOSIO_API_KEY=...`;

const CONFIG_PRIORITY = `# Configuration resolution priority (highest to lowest):
#
# 1. CLI flags (e.g., --port 9090)
# 2. Database (Config Center / ownpilot config set)
# 3. Environment variables (.env file or system env)
# 4. Built-in defaults (e.g., PORT=8080, AUTH_TYPE=none)
#
# Example: if OPENAI_API_KEY is set both in .env and Config Center,
# the Config Center value wins (it's stored in DB at priority 2).`;

const CONFIG_CENTER = `# The Config Center web UI (Settings → Config Center) provides:
# - Visual management of all configuration keys
# - Secure input for API keys (masked display)
# - AES-256-GCM encryption for sensitive values
# - No .env file editing required
# - Changes take effect immediately (no restart needed for most settings)

# Encrypted keys in the database:
# - All API keys (openai, anthropic, etc.)
# - JWT secret
# - Telegram bot token
# - MQTT password
# - Any key containing: key, secret, password, token`;

const AGENT_DEFAULTS = `# Agent runtime defaults (configurable per agent):
AGENT_DEFAULT_MAX_TOKENS=8192    # Max output tokens
AGENT_DEFAULT_TEMPERATURE=0.7    # Sampling temperature (0.0–2.0)

# Time constants used in agent scheduling:
MS_PER_MINUTE=60000
MS_PER_HOUR=3600000
MS_PER_DAY=86400000

# Meta-tool names (sent to all agents instead of full tool list):
AI_META_TOOL_NAMES=["search_tools","get_tool_help","use_tool","batch_use_tool"]`;

const ROUTING_CONFIG = `# Model routing: different processes can use different providers/models
POST /api/v1/config/routing
{
  "chat":      { "provider": "anthropic", "model": "claude-opus-4-5" },
  "channel":   { "provider": "openai",    "model": "gpt-4o-mini" },
  "pulse":     { "provider": "anthropic", "model": "claude-haiku-3-5" },
  "subagent":  { "provider": "openai",    "model": "gpt-4o" },
  "fleet":     { "provider": "groq",      "model": "llama3-70b-8192" },
  "workflow":  { "provider": "openai",    "model": "gpt-4o-mini" }
}`;

const WORKSPACE_CONFIG = `# Workspace configuration (ownpilot workspace commands)
ownpilot workspace init          # Initialize a workspace in current directory
ownpilot workspace status        # Show current workspace info
ownpilot workspace set-default   # Set as the default workspace

# Workspace stores agent-specific files and state
# Each background agent gets an isolated workspace directory`;

export function ConfigurationPage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        Configuration
      </Badge>
      <h1>Configuration</h1>
      <p className="text-lg text-[var(--color-text-muted)] mb-8">
        OwnPilot has four configuration sources with a clear priority order: CLI flags override DB
        values, which override environment variables, which override built-in defaults. All
        sensitive values are stored AES-256-GCM encrypted in PostgreSQL — no plain-text secrets in{' '}
        <code>.env</code>.
      </p>

      <h2>Configuration priority</h2>
      <CodeBlock code={CONFIG_PRIORITY} language="bash" />

      <h2>Config Center (web UI)</h2>
      <p>
        The recommended way to manage configuration. Navigate to{' '}
        <strong>Settings → Config Center</strong> in the OwnPilot web UI. All API keys and sensitive
        values are stored encrypted in PostgreSQL.
      </p>
      <CodeBlock code={CONFIG_CENTER} language="bash" />

      <Callout type="tip" title="No restart needed">
        Most configuration changes via the Config Center take effect immediately without restarting
        the server. AI provider keys, model routing, and agent defaults all hot-reload.
      </Callout>

      <h2>CLI configuration</h2>
      <CodeBlock code={CLI_CONFIG} language="bash" />

      <h2>REST API</h2>
      <CodeBlock code={CONFIG_API} language="http" filename="config-api.http" />

      <h2>All environment variables</h2>
      <CodeBlock code={ENV_VARS_FULL} language="bash" filename=".env.example" />

      <h3>Core server variables</h3>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Default</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PORT</code>
            </td>
            <td>8080</td>
            <td>No</td>
            <td>HTTP server port</td>
          </tr>
          <tr>
            <td>
              <code>HOST</code>
            </td>
            <td>0.0.0.0</td>
            <td>No</td>
            <td>Bind address</td>
          </tr>
          <tr>
            <td>
              <code>NODE_ENV</code>
            </td>
            <td>development</td>
            <td>No</td>
            <td>
              Set to <code>production</code> for deployments
            </td>
          </tr>
          <tr>
            <td>
              <code>LOG_LEVEL</code>
            </td>
            <td>info</td>
            <td>No</td>
            <td>error | warn | info | debug</td>
          </tr>
        </tbody>
      </table>

      <h3>Database variables</h3>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Default</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>POSTGRES_HOST</code>
            </td>
            <td>localhost</td>
            <td>Yes</td>
            <td>PostgreSQL hostname</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_PORT</code>
            </td>
            <td>25432</td>
            <td>No</td>
            <td>Port (Docker maps container 5432 → host 25432)</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_USER</code>
            </td>
            <td>ownpilot</td>
            <td>Yes</td>
            <td>Database user</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_PASSWORD</code>
            </td>
            <td>—</td>
            <td>Yes</td>
            <td>Database password</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_DB</code>
            </td>
            <td>ownpilot</td>
            <td>No</td>
            <td>Database name</td>
          </tr>
        </tbody>
      </table>

      <h3>Authentication variables</h3>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Default</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>AUTH_TYPE</code>
            </td>
            <td>none</td>
            <td>No</td>
            <td>none | api-key | jwt</td>
          </tr>
          <tr>
            <td>
              <code>API_KEY</code>
            </td>
            <td>—</td>
            <td>If api-key</td>
            <td>Static API key for Bearer auth</td>
          </tr>
          <tr>
            <td>
              <code>JWT_SECRET</code>
            </td>
            <td>—</td>
            <td>If jwt</td>
            <td>JWT signing secret (min 64 characters)</td>
          </tr>
          <tr>
            <td>
              <code>JWT_EXPIRY</code>
            </td>
            <td>7d</td>
            <td>No</td>
            <td>JWT token expiry (e.g., 1h, 7d, 30d)</td>
          </tr>
        </tbody>
      </table>

      <Callout type="warning" title="Production authentication">
        For any internet-facing deployment, set <code>AUTH_TYPE=jwt</code> and use a strong
        <code>JWT_SECRET</code> (64+ random characters). Without authentication, anyone who can
        reach port 8080 has full access to your assistant and personal data.
      </Callout>

      <h2>Agent runtime defaults</h2>
      <CodeBlock code={AGENT_DEFAULTS} language="bash" />

      <h2>Model routing</h2>
      <p>
        Configure different AI providers and models for different processes. This lets you use a
        fast cheap model for workflows while using a powerful model for chat.
      </p>
      <CodeBlock code={ROUTING_CONFIG} language="json" filename="routing-config.json" />

      <h2>Workspace configuration</h2>
      <CodeBlock code={WORKSPACE_CONFIG} language="bash" />

      <h2>Config API endpoints</h2>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Endpoint</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/config</code>
            </td>
            <td>List all keys (values masked)</td>
          </tr>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/config/:key</code>
            </td>
            <td>Get specific value</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/config</code>
            </td>
            <td>Set a value</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/config/bulk</code>
            </td>
            <td>Set multiple values</td>
          </tr>
          <tr>
            <td>
              <code>DELETE</code>
            </td>
            <td>
              <code>/api/v1/config/:key</code>
            </td>
            <td>Delete a key</td>
          </tr>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/config/services</code>
            </td>
            <td>List configured services</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/config/services</code>
            </td>
            <td>Configure a service (Telegram, etc.)</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/config/routing</code>
            </td>
            <td>Set model routing config</td>
          </tr>
        </tbody>
      </table>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/edge-devices"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Edge Devices
        </Link>
        <Link
          to="/docs/security"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Security
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
