import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export function ProvidersPage() {
  return (
    <DocsLayout>
      <Badge variant="purple" className="mb-3">
        AI Providers
      </Badge>
      <h1>AI Provider Overview</h1>
      <p>
        OwnPilot supports 96 AI providers through a unified provider abstraction. All providers use
        the same agent interface — you can switch models without changing any code.
      </p>

      <h2>Provider categories</h2>

      <h3>Native providers (4)</h3>
      <p>
        Direct API integrations with full feature support including streaming, tool calling, and
        prompt caching:
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Env Variable</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI</td>
            <td>
              <code>OPENAI_API_KEY</code>
            </td>
            <td>GPT-4o, o1, o3, etc.</td>
          </tr>
          <tr>
            <td>Anthropic</td>
            <td>
              <code>ANTHROPIC_API_KEY</code>
            </td>
            <td>Claude 3.x + prompt caching</td>
          </tr>
          <tr>
            <td>Google</td>
            <td>
              <code>GOOGLE_API_KEY</code>
            </td>
            <td>Gemini Pro, Flash, etc.</td>
          </tr>
          <tr>
            <td>Zhipu</td>
            <td>
              <code>ZHIPU_API_KEY</code>
            </td>
            <td>GLM-4 series</td>
          </tr>
        </tbody>
      </table>

      <h3>Aggregator providers (8)</h3>
      <p>Access hundreds of models through aggregator APIs:</p>
      <ul>
        <li>Together AI, Groq, Fireworks, DeepInfra</li>
        <li>OpenRouter, Perplexity, Cerebras, fal.ai</li>
      </ul>

      <h3>Local providers (4+)</h3>
      <p>For fully local inference — no internet required for AI:</p>
      <ul>
        <li>
          <strong>Ollama</strong> — Auto-discovered on <code>http://localhost:11434</code>
        </li>
        <li>
          <strong>LM Studio</strong> — Auto-discovered on <code>http://localhost:1234</code>
        </li>
        <li>
          <strong>LocalAI</strong> — Auto-discovered on <code>http://localhost:8080</code>
        </li>
        <li>
          <strong>vLLM</strong> — OpenAI-compatible endpoint
        </li>
      </ul>

      <h3>OpenAI-compatible endpoints</h3>
      <p>
        Any provider that exposes an OpenAI-compatible API can be used. This includes xAI (Grok),
        DeepSeek, Mistral, and hundreds of others.
      </p>

      <h2>Smart Provider Routing</h2>
      <p>
        OwnPilot can automatically route requests to the optimal provider based on your strategy:
      </p>
      <table>
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>cheapest</td>
            <td>Minimize cost per token</td>
          </tr>
          <tr>
            <td>fastest</td>
            <td>Minimize latency</td>
          </tr>
          <tr>
            <td>smartest</td>
            <td>Maximize capability (benchmark scores)</td>
          </tr>
          <tr>
            <td>balanced</td>
            <td>Optimize cost/quality ratio</td>
          </tr>
          <tr>
            <td>fallback</td>
            <td>Try providers in order; use next on failure</td>
          </tr>
        </tbody>
      </table>

      <h2>Anthropic Prompt Caching</h2>
      <p>
        OwnPilot supports Anthropic's prompt caching via <code>cache_control</code> blocks. The
        static system prompt is cached to reduce input token costs on repeated requests. The
        orchestrator section is placed in a static cache block; the time context is rounded to the
        hour boundary to prevent cache invalidation.
      </p>

      <h2>Extended Thinking</h2>
      <p>
        Anthropic's extended thinking is supported for deeper reasoning in complex tasks. Configure
        the thinking budget tokens per agent:
      </p>
      <CodeBlock
        code={`# Via API
POST /api/v1/agents
{
  "name": "Deep Thinker",
  "model": "claude-3-5-sonnet-20241022",
  "extendedThinking": true,
  "thinkingBudget": 10000
}`}
        language="json"
      />

      <h2>Model Routing</h2>
      <p>Different processes can use different models with fallback chains:</p>
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>chat</td>
            <td>Web UI and channel conversations</td>
          </tr>
          <tr>
            <td>channel</td>
            <td>Telegram/WhatsApp messages</td>
          </tr>
          <tr>
            <td>pulse</td>
            <td>Proactive autonomy engine</td>
          </tr>
          <tr>
            <td>subagent</td>
            <td>Spawned child agents</td>
          </tr>
          <tr>
            <td>fleet</td>
            <td>Fleet worker tasks</td>
          </tr>
        </tbody>
      </table>

      <h2>Configuring providers</h2>
      <p>Two methods are available:</p>

      <h3>Web UI (recommended)</h3>
      <p>
        Navigate to <strong>Settings → Config Center</strong>. Keys are stored AES-256-GCM encrypted
        in PostgreSQL.
      </p>

      <h3>CLI</h3>
      <CodeBlock
        code={`ownpilot config set openai-api-key sk-...
ownpilot config set anthropic-api-key sk-ant-...
ownpilot config set ollama-base-url http://localhost:11434`}
        language="bash"
      />

      <Callout type="tip" title="Local AI for privacy">
        For maximum privacy, configure Ollama with a capable local model (llama3.3, qwen2.5, etc.).
        All AI processing stays on your machine — no data ever leaves your server.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/architecture"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Architecture
        </Link>
        <Link
          to="/docs/agents"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Agent System
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
