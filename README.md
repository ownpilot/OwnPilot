# OwnPilot

Privacy-first personal AI assistant platform with autonomous agents, multi-channel support, and secure data management.

## Features

- **Multi-Channel Support**: Chat UI, Telegram, Slack, Discord, REST API
- **Autonomous Agents**: Specialized agents with tool orchestration and automatic routing
- **Privacy-First**: PII detection/redaction, encrypted credential storage, sandboxed execution
- **Extensible**: Plugin system, custom tools, user-defined agents
- **Self-Hosted**: Run entirely on your own infrastructure

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CHANNELS                             │
│   Chat UI  │  Telegram  │  Slack  │  Discord  │  REST API   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                      AGENT ROUTER                            │
│   LLM-based routing to specialized agents                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     AGENT EXECUTOR                           │
│   Autonomous loop: think → act → observe → repeat            │
├────────────────────────┬─────────────────────────────────────┤
│     TOOL REGISTRY      │      PERSONAL DATA GATEWAY          │
│   Permissioned tools   │   Secure, audited data access       │
└────────────────────────┴─────────────────────────────────────┘
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

Edit `.env` and set your API keys:

```bash
# Required: At least one AI provider
OPENAI_API_KEY=sk-your-openai-api-key
# or
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key

# Optional: Telegram bot
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
```

### Development

```bash
# Start all services in development mode
pnpm dev

# Or start individual packages
pnpm --filter @ownpilot/gateway dev   # API Gateway (port 8080)
pnpm --filter @ownpilot/ui dev        # Web UI (port 5173)
```

### Production

```bash
# Build all packages
pnpm build

# Start gateway
pnpm --filter @ownpilot/gateway start
```

## Project Structure

```
ownpilot/
├── packages/
│   ├── core/        # Zero-dependency core: types, crypto, privacy, audit
│   ├── gateway/     # HTTP API gateway (Hono)
│   ├── ui/          # Web interface (React 19 + Tailwind)
│   ├── channels/    # Channel adapters (Telegram, Slack, Discord)
│   └── cli/         # Command-line interface
├── docs/            # Documentation
├── scripts/         # Build and deployment scripts
└── data/            # Local data storage (gitignored)
```

## Packages

| Package | Description |
|---------|-------------|
| `@ownpilot/core` | Type-safe foundation with zero runtime dependencies |
| `@ownpilot/gateway` | HTTP API gateway with WebSocket support |
| `@ownpilot/ui` | React-based web interface |
| `@ownpilot/channels` | Multi-platform channel adapters |
| `@ownpilot/cli` | Command-line tools |

## Scripts

```bash
pnpm dev           # Start development servers
pnpm build         # Build all packages
pnpm test          # Run tests
pnpm lint          # Lint code
pnpm typecheck     # TypeScript type checking
pnpm clean         # Clean build artifacts
```

## Supported AI Providers

OwnPilot supports **89+ AI providers** out of the box via OpenAI-compatible API. Provider configs are sourced from [models.dev](https://models.dev).

<details>
<summary><strong>View all providers</strong></summary>

| Provider | Type | Notable Models |
|----------|------|----------------|
| **OpenAI** | Native | GPT-5, GPT-4o, o3, Codex |
| **Anthropic** | Native | Claude Opus 4.5, Claude Sonnet |
| **Google** | Native | Gemini 2.5, Gemini Pro |
| **xAI** | OpenAI-compatible | Grok 4, Grok 3 |
| **DeepSeek** | OpenAI-compatible | DeepSeek R1, DeepSeek V3 |
| **Groq** | OpenAI-compatible | Llama 3.3 70B, Mixtral |
| **Mistral** | OpenAI-compatible | Mistral Large, Codestral |
| **Cohere** | OpenAI-compatible | Command A, Command R+ |
| **Together AI** | OpenAI-compatible | Llama, Qwen, Mixtral |
| **Fireworks** | OpenAI-compatible | Llama, DeepSeek, Qwen |
| **NVIDIA** | OpenAI-compatible | Nemotron, Llama 3.1 |
| **Alibaba** | OpenAI-compatible | Qwen3, QVQ Max |
| **Moonshot** | OpenAI-compatible | Kimi K2.5, Kimi K2 |
| **Zhipu AI** | OpenAI-compatible | GLM-4, GLM-Z1 |
| **Perplexity** | OpenAI-compatible | Sonar Pro, Sonar |
| **GitHub Models** | OpenAI-compatible | GPT-4o, Llama, Phi |
| **Azure OpenAI** | OpenAI-compatible | GPT-4, GPT-4o |
| **AWS Bedrock** | OpenAI-compatible | Claude, Titan, Llama |
| **Hugging Face** | OpenAI-compatible | Open models |
| **Ollama** | OpenAI-compatible | Local models |
| + 69 more... | | |

</details>

Provider configurations: [`packages/core/src/agent/providers/configs/`](packages/core/src/agent/providers/configs/)

## Security

- **Credential Storage**: AES-256-GCM encryption with PBKDF2 key derivation
- **PII Detection**: Automatic detection and redaction of sensitive data
- **Sandboxed Execution**: Agents run in isolated sandboxes
- **Audit Logging**: All tool calls and data access are logged
- **Access Control**: Fine-grained permissions for agents and tools

## Docker

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t ownpilot .
docker run -p 8080:8080 --env-file .env ownpilot
```

## Environment Variables

See [.env.example](.env.example) for all configuration options.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `NODE_ENV` | Environment | `development` |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | - |
| `AUTH_TYPE` | Auth method: `none`, `api-key`, `jwt` | `none` |
| `ENABLE_PII_REDACTION` | Enable PII detection | `true` |

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.
