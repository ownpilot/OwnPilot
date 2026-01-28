# OwnPilot

Privacy-first personal AI assistant platform with autonomous agents, tool orchestration, and multi-provider support.

## Features

- **89+ AI Providers**: OpenAI, Anthropic, Google, DeepSeek, Groq, xAI, Mistral, and more
- **30+ Agents**: Pre-configured specialists (Code Assistant, Writing Assistant, Research, etc.)
- **Tool Calling**: Web search, weather, calculator, file operations, code execution
- **Personal Data**: Notes, tasks, bookmarks, contacts, calendar, expenses
- **Memories & Goals**: AI learns from interactions and tracks objectives
- **Triggers & Plans**: Schedule-based and condition-based automations
- **Custom Tools**: Create your own tools via LLM
- **Multi-Channel**: Web UI, Telegram, Discord, Slack, REST API
- **Sandboxed Code Execution**: Docker-based isolated environment

## Quick Start

```bash
# Prerequisites: Node.js >= 22, pnpm >= 9, Docker (for PostgreSQL)

# Clone and install
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install

# Start PostgreSQL
docker-compose -f docker-compose.db.yml up -d

# Configure
cp .env.example .env
# Edit .env - add at least one API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)

# Seed database with default agents
pnpm --filter @ownpilot/gateway seed

# Start development
pnpm dev

# UI: http://localhost:3000
# API: http://localhost:8080
```

## Project Structure

```
ownpilot/
├── packages/
│   ├── core/       # AI runtime, providers, tools, agents
│   ├── gateway/    # Hono API server, PostgreSQL, tracing
│   ├── ui/         # React 19 + Vite + Tailwind
│   ├── channels/   # Telegram, Discord, Slack adapters
│   └── cli/        # Command-line tools
└── docker-compose.db.yml
```

## Environment Variables

```bash
# Database (PostgreSQL)
DATABASE_TYPE=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=25432
POSTGRES_DB=ownpilot
POSTGRES_USER=ownpilot
POSTGRES_PASSWORD=ownpilot

# AI Providers (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Optional
PORT=8080
TELEGRAM_BOT_TOKEN=...
SEARXNG_URL=http://localhost:8888
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/chat` | Send message |
| `GET /api/v1/agents` | List agents |
| `GET /api/v1/models` | List models |
| `GET /api/v1/providers` | List providers |
| `GET /api/v1/tools` | List tools |
| `GET/POST /api/v1/memories` | Memories |
| `GET/POST /api/v1/goals` | Goals |
| `GET/POST /api/v1/tasks` | Tasks |
| `GET/POST /api/v1/notes` | Notes |
| `GET/POST /api/v1/expenses` | Expenses |

## Scripts

```bash
pnpm dev        # Development mode
pnpm build      # Build all packages
pnpm start      # Production server
pnpm seed       # Seed database with default agents
```

## License

MIT
