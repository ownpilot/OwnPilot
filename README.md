# OwnPilot

Privacy-first personal AI assistant platform with autonomous agents, tool orchestration, and secure data management.

## Features

### Core Capabilities
- **Multi-Provider AI**: 89+ AI providers supported (OpenAI, Anthropic, Google, DeepSeek, Groq, etc.)
- **Tool Calling**: Extensible tool system with web search, weather, file operations, and more
- **Autonomous Execution**: Configurable autonomy levels from manual to fully autonomous
- **Chat History**: Persistent conversations with SQLite storage

### Personal AI Assistant
- **Memories**: AI learns and recalls context from past interactions
- **Goals**: Track objectives with automated progress updates
- **Triggers**: Schedule-based and condition-based automations
- **Custom Instructions**: Personalized behavior and preferences

### Developer Experience
- **Debug Tracing**: Full visibility into tool calls, arguments, results, and timing
- **Request Logs**: Detailed logging of all AI interactions
- **Cost Tracking**: Token usage and cost monitoring per provider

### Security
- **Encrypted Credentials**: AES-256-GCM with PBKDF2 key derivation
- **PII Detection**: Automatic detection and redaction of sensitive data
- **Sandboxed Execution**: Docker-based isolated execution environment
- **Audit Logging**: All operations are logged for accountability

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           CHANNELS                               │
│     Web UI (React)  │  Telegram Bot  │  REST API  │  CLI        │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API GATEWAY (Hono)                        │
│   Authentication  │  Rate Limiting  │  Request Tracing          │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         AGENT RUNTIME                            │
│   Provider Routing  │  Tool Orchestration  │  Memory Injection  │
├─────────────────────┬───────────────────────────────────────────┤
│    TOOL REGISTRY    │         PERSONAL DATA LAYER               │
│  Web Search, Weather│   Memories, Goals, Triggers, Notes        │
│  Files, Calculator  │   Bookmarks, Contacts, Custom Tables      │
└─────────────────────┴───────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA STORAGE (SQLite)                       │
│   Chat History  │  User Data  │  Logs  │  Cost Tracking         │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot

# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env
# Edit .env with your API keys
```

### Configuration

Edit `.env` and set at least one AI provider key:

```bash
# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key

# Or Anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key

# Or Google AI
GOOGLE_API_KEY=your-google-api-key
```

### Development

```bash
# Start all services in development mode
pnpm dev

# Access the UI at http://localhost:5173
# API Gateway runs at http://localhost:8080
```

### Production

```bash
# Build all packages
pnpm build

# Start the server
pnpm start

# Or use Docker
docker-compose up -d
```

## Project Structure

```
ownpilot/
├── packages/
│   ├── core/           # AI runtime: providers, tools, agents, types
│   ├── gateway/        # HTTP API server (Hono), database, tracing
│   ├── ui/             # Web interface (React 19 + Vite + Tailwind)
│   ├── channels/       # Channel adapters (Telegram, etc.)
│   └── cli/            # Command-line interface
├── scripts/            # Build and deployment scripts
├── data/               # Local data storage (gitignored)
└── docker-compose.yml  # Docker deployment config
```

## Packages

| Package | Description |
|---------|-------------|
| `@ownpilot/core` | AI agent runtime, tool registry, provider adapters |
| `@ownpilot/gateway` | Hono-based API server with SQLite persistence |
| `@ownpilot/ui` | React frontend with chat, settings, and data management |
| `@ownpilot/channels` | Multi-platform adapters (Telegram, Slack, Discord) |
| `@ownpilot/cli` | Command-line tools for setup and management |

## Supported AI Providers

OwnPilot supports **89+ AI providers** out of the box. Provider configs are sourced from [models.dev](https://models.dev).

<details>
<summary><strong>View all providers</strong></summary>

| Provider | Type | Notable Models |
|----------|------|----------------|
| **OpenAI** | Native | GPT-4o, o1, o3-mini |
| **Anthropic** | Native | Claude Opus 4.5, Claude Sonnet 4 |
| **Google** | Native | Gemini 2.0, Gemini 1.5 Pro |
| **xAI** | OpenAI-compatible | Grok 2, Grok 3 |
| **DeepSeek** | OpenAI-compatible | DeepSeek R1, DeepSeek V3 |
| **Groq** | OpenAI-compatible | Llama 3.3 70B, Mixtral |
| **Mistral** | OpenAI-compatible | Mistral Large, Codestral |
| **Cohere** | OpenAI-compatible | Command R+, Command A |
| **Together AI** | OpenAI-compatible | Llama, Qwen, Mixtral |
| **Fireworks** | OpenAI-compatible | FLUX, Llama, DeepSeek |
| **Alibaba** | OpenAI-compatible | Qwen 3, QVQ Max |
| **Zhipu AI** | OpenAI-compatible | GLM-4, GLM-Z1 |
| **Perplexity** | OpenAI-compatible | Sonar Pro |
| **Ollama** | OpenAI-compatible | Local models |
| + 75 more... | | |

</details>

## Available Tools

| Tool | Description |
|------|-------------|
| `search_web` | Search the internet using SearXNG or Google |
| `weather_current` | Get current weather for a location |
| `weather_forecast` | Get weather forecast |
| `read_file` | Read files from workspace |
| `write_file` | Write files to workspace |
| `list_files` | List files in workspace |
| `calculate` | Perform mathematical calculations |
| `get_current_time` | Get current date and time |

## API Endpoints

### Chat
- `POST /api/v1/chat` - Send a message
- `GET /api/v1/chat/history` - List conversations
- `GET /api/v1/chat/history/:id` - Get conversation with messages
- `DELETE /api/v1/chat/history/:id` - Delete conversation

### Personal Data
- `GET/POST /api/v1/memories` - Manage memories
- `GET/POST /api/v1/goals` - Manage goals
- `GET/POST /api/v1/triggers` - Manage triggers
- `GET/POST /api/v1/notes` - Manage notes
- `GET/POST /api/v1/bookmarks` - Manage bookmarks

### System
- `GET /api/v1/providers` - List configured providers
- `GET /api/v1/models` - List available models
- `GET /api/v1/tools` - List available tools
- `GET /api/v1/costs` - Get usage costs

## Scripts

```bash
pnpm dev           # Start development servers
pnpm build         # Build all packages
pnpm start         # Start production server
pnpm test          # Run tests
pnpm lint          # Lint code
pnpm typecheck     # TypeScript type checking
pnpm clean         # Clean build artifacts
```

## Docker

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t ownpilot .
docker run -p 8080:8080 -p 5173:5173 --env-file .env ownpilot
```

## Environment Variables

See [.env.example](.env.example) for all configuration options.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `8080` |
| `NODE_ENV` | Environment | `development` |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `GOOGLE_API_KEY` | Google AI API key | - |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | - |
| `AUTH_TYPE` | Auth: `none`, `api-key`, `jwt` | `none` |
| `DEFAULT_AUTONOMY_LEVEL` | 0-4 (Manual to Full) | `1` |
| `ENABLE_PII_REDACTION` | Enable PII detection | `true` |
| `DATA_DIR` | SQLite database directory | `./data` |

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.
