# OpenClaw Bridge Daemon — Tam Kurulum ve Troubleshooting Rehberi

> **Hedef kitle:** Bu rehberi okuyan herhangi bir insan veya AI agent, sıfırdan başlayıp
> tam çalışan sistemi kurabilmeli — hiçbir adımı atlamamalı.
>
> **Son güncelleme:** 2026-02-26
> **Test edildiği ortam:** Fedora 43, Docker 29.2.0, Claude Code 2.1.56, Node.js 22, OpenClaw 2026.2.24

---

## İçindekiler

1. [Mimari Genel Bakış](#1-mimari-genel-bakış)
2. [Sistem Gereksinimleri](#2-sistem-gereksinimleri)
3. [Kritik Bulgular — Önce Bunları Oku](#3-kritik-bulgular--önce-bunları-oku)
4. [Adım 1: Docker Compose — host.docker.internal](#4-adım-1-docker-compose--hostdockerinternal)
5. [Adım 2: Bridge Daemon Proje Yapısı](#5-adım-2-bridge-daemon-proje-yapısı)
6. [Adım 3: Tüm Kaynak Dosyaları](#6-adım-3-tüm-kaynak-dosyaları)
7. [Adım 4: OpenClaw Config Güncellemesi](#7-adım-4-openclaw-config-güncellemesi)
8. [Adım 5: Systemd Service Kurulumu](#8-adım-5-systemd-service-kurulumu)
9. [Adım 6: Doğrulama ve Testler](#9-adım-6-doğrulama-ve-testler)
10. [Hata Kataloğu — Karşılaşılan Tüm Sorunlar](#10-hata-kataloğu--karşılaşılan-tüm-sorunlar)
11. [Mimari Kararlar ve Araştırma Bulguları](#11-mimari-kararlar-ve-araştırma-bulguları)
12. [Adım 7: Uzaktan Erişim (Tailscale HTTPS)](#adım-7-uzaktan-erişim-tailscale-https)
13. [Adım 8: Bridge'i Test Etmek](#adım-8-bridgei-test-etmek)

---

## 1. Mimari Genel Bakış

```
WhatsApp Mesajı
      │
      ▼
┌─────────────────────────────────┐
│  OpenClaw Gateway               │
│  (Docker container, port 18789) │
│  - WhatsApp → Baileys WebSocket │
│  - Agent routing                │
│  - Model provider: bridge       │
└────────────┬────────────────────┘
             │  HTTP POST /v1/chat/completions
             │  (host.docker.internal:9090)
             ▼
┌─────────────────────────────────┐
│  OpenClaw Bridge Daemon         │
│  (systemd service, port 9090)   │
│  - Fastify HTTP server          │
│  - OpenAI-compatible API        │
│  - Spawns claude per message    │
└────────────┬────────────────────┘
             │  spawn + stdin/stdout
             │  (--print --input-format stream-json)
             ▼
┌─────────────────────────────────┐
│  Claude Code CLI (claude)       │
│  - OAuth auth (keyring)         │
│  - --session-id for continuity  │
│  - Exits after each response    │
└─────────────────────────────────┘
```

### Neden Bu Mimari?

- **OpenClaw → Bridge:** OpenClaw herhangi bir OpenAI-compatible endpoint'e istek atabilir. Bridge bu endpoint'i sağlar.
- **Bridge → Claude Code:** Claude Code CLI `--print` modunda çalıştırılır. Her mesaj için yeni bir process spawn edilir.
- **Session continuity:** `--session-id` parametresi ile Claude Code disk-based history kullanır. Aynı UUID verildiğinde önceki konuşmayı hatırlar.
- **Long-lived process neden çalışmaz:** Bu en kritik bulgudur, bkz. [Hata #1](#hata-1-en-kritik-stdin-açık-kalınca-result-eventi-gelmiyor).

---

## 2. Sistem Gereksinimleri

| Gereksinim | Versiyon | Notlar |
|------------|---------|--------|
| Fedora / RHEL | 40+ | SELinux aktif olacak |
| Node.js | 22+ | `--experimental-strip-types` için |
| Claude Code CLI | 2.1.56+ | `claude` binary, OAuth ile authenticate |
| Docker | 29.0+ | `--add-host host-gateway` desteği için |
| OpenClaw | 2026.2.24+ | `chatCompletions.enabled` config key'i |

### Claude Code'un kurulu ve authenticate olduğunu doğrula:

```bash
claude --version
# Çıktı: claude 2.1.56 (veya üstü)

claude -p "say: AUTH_OK" --model claude-haiku-4-5-20251001
# Çıktı: AUTH_OK
# Eğer hata verirse: claude login ile yeniden authenticate ol
```

### Claude binary'nin tam yolunu bul (systemd için kritik):

```bash
which claude
# Örnek çıktı: /home/USERNAME/.local/bin/claude

readlink -f $(which claude)
# Örnek çıktı: /home/USERNAME/.local/share/claude/versions/2.1.56
```

Bu yolu bir yere not et — service dosyasında ve `.env`'de kullanacaksın.

---

## 3. Kritik Bulgular — Önce Bunları Oku

Bu bölümü atlarsan çok zaman kaybedersin. Bunları önce öğren:

### Bulgu 1: `--input-format stream-json` ile stdin açık kalınca CC yanıt vermiyor

**Problem:** Claude Code'u `--print --input-format stream-json` ile long-lived process olarak çalıştırıp stdin'i açık tutarsan, hiçbir zaman `result` eventi almıyorsun. Process canlı görünüyor ama HTTP response gelmiyor.

**Test etmek için:**
```bash
# stdin 20 saniye açık kalıyor — result eventi GELMİYOR
(echo '{"type":"user","message":{"role":"user","content":"test"}}'; sleep 20) | \
  timeout 15 claude --print --output-format stream-json --verbose \
  --input-format stream-json --session-id "$(python3 -c 'import uuid; print(uuid.uuid4())')" \
  --dangerously-skip-permissions --model claude-haiku-4-5-20251001 2>&1 | \
  grep -E '"type"' | head -5
# Çıktı: sadece "system" eventleri — result yok!
```

**Çözüm:** Her mesaj için yeni process spawn et, `stdin.end()` ile EOF gönder. Detay: [Hata #1](#hata-1-en-kritik-stdin-açık-kalınca-result-eventi-gelmiyor).

### Bulgu 2: ANTHROPIC_API_KEY placeholder process.env'e kirliyor

**Problem:** `.env` dosyasında `ANTHROPIC_API_KEY=sk-ant-placeholder` varsa, Node.js bunu `process.env`'e yükler. Sonra child process spawn ederken `process.env`'i kopyalarsan Claude Code bu geçersiz key'i alır ve OAuth yerine bozuk key ile authenticate etmeye çalışır.

**Çözüm:** Child process env'ini oluştururken her zaman `delete env['ANTHROPIC_API_KEY']` yap, sonra sadece gerçek bir key varsa set et.

### Bulgu 3: Systemd, user home'daki EnvironmentFile'ı okuyamıyor (SELinux)

**Problem:** `EnvironmentFile=/home/USERNAME/openclaw-bridge/.env` systemd'de `user_home_t` SELinux context nedeniyle "Permission denied" hatası verir. Güvenlik hardening (`ProtectHome`, `ProtectSystem`) olmasa bile SELinux bunu engeller.

**Çözüm:** Env dosyasını `/etc/sysconfig/` altına kopyala — bu konum `etc_t` context alır ve systemd okuyabilir.

### Bulgu 4: Systemd'nin PATH'i minimal — claude binary'sini bulamaz

**Problem:** Systemd unit'leri minimal PATH ile başlar (`/usr/bin:/usr/sbin:/bin:/sbin`). `claude` binary'si genellikle `~/.local/bin/` altında olduğu için `spawn claude` → `ENOENT` hatası verir.

**Çözüm:** `CLAUDE_PATH=/home/USERNAME/.local/bin/claude` env değişkeni tanımla, spawn'da tam yolu kullan.

### Bulgu 5: `StartLimitBurst`/`StartLimitIntervalSec` `[Unit]`'te olmalı

**Problem:** Bu iki direktif `[Service]` bölümüne yazılırsa systemd uyarı verir (`Unknown key`) ve bazı versiyonlarda davranış beklenen gibi olmaz.

**Çözüm:** `[Unit]` bölümüne taşı.

---

## 4. Adım 1: Docker Compose — host.docker.internal

OpenClaw, Docker container içinde çalışır. Bridge daemon ise host makinesinde çalışır. Container içinden host'a ulaşmak için `extra_hosts` gerekir.

### Host IP'sini bul:

```bash
# Docker bridge ağının host IP'sini bul
docker network inspect bridge | python3 -c "
import json,sys
d=json.load(sys.stdin)
for n in d:
    gw = n.get('IPAM',{}).get('Config',[{}])[0].get('Gateway','')
    if gw: print('Host IP:', gw)
"
# Veya:
ip route | grep docker | awk '{print $9}' | head -1
# Örnek çıktı: 172.24.0.1 (bu IP her kurulumda farklı olabilir!)
```

### Docker Compose dosyasına ekle:

OpenClaw'ın docker-compose.yml dosyasını bul (Dokploy kullanıyorsan `/etc/dokploy/compose/openclaw-*/code/docker-compose.yml`) ve `openclaw-gateway` servisine:

```yaml
services:
  openclaw-gateway:
    # ... mevcut config ...
    extra_hosts:
      - "host.docker.internal:172.24.0.1"  # Buraya kendi IP'ni yaz!
```

> **ÖNEMLI:** `172.24.0.1` senin ortamına özgü. Her kurulumda yukarıdaki komutla kendi IP'ni bul.

### Container'ı restart et:

```bash
cd /path/to/docker-compose/dir
sudo docker compose up -d --no-build
```

### Doğrula:

```bash
docker exec openclaw-gateway ping -c1 host.docker.internal
# veya:
docker exec openclaw-gateway curl -s http://host.docker.internal:9090/health
# (bridge kurulduktan sonra)
```

---

## 5. Adım 2: Bridge Daemon Proje Yapısı

```bash
mkdir -p /home/USERNAME/openclaw-bridge/src/api
mkdir -p /home/USERNAME/openclaw-bridge/src/utils
mkdir -p /home/USERNAME/openclaw-bridge/systemd
cd /home/USERNAME/openclaw-bridge
npm init -y
npm install fastify @fastify/cors pino pino-pretty dotenv
npm install -D typescript @types/node
```

### package.json:

```json
{
  "name": "openclaw-bridge",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node --experimental-strip-types src/index.ts",
    "dev": "node --experimental-strip-types --watch src/index.ts"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "fastify": "^5.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^13.1.3"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0"
  }
}
```

### .env dosyası oluştur:

```bash
cat > /home/USERNAME/openclaw-bridge/.env << 'EOF'
PORT=9090
BRIDGE_API_KEY=SENIN_GUCLU_RASTGELE_ANAHTARIN_BURAYA
ANTHROPIC_API_KEY=sk-ant-placeholder
CLAUDE_PATH=/home/USERNAME/.local/bin/claude
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_MAX_BUDGET_USD=5
DEFAULT_PROJECT_DIR=/home/USERNAME/
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_TOKEN=OPENCLAW_API_TOKENI_BURAYA
IDLE_TIMEOUT_MS=1800000
LOG_LEVEL=info
EOF
```

> **Placeholder açıklaması:**
> - `BRIDGE_API_KEY`: Rastgele güçlü bir string. OpenClaw bu key'i kullanarak bridge'e istek atar. Örnek üretme: `python3 -c "import secrets; print('bridge-' + secrets.token_hex(16))"`
> - `ANTHROPIC_API_KEY`: `sk-ant-placeholder` olarak bırak. Claude Code OAuth ile auth yapar. Eğer API key (console.anthropic.com) kullanmak istersen gerçek key yaz.
> - `CLAUDE_PATH`: `which claude` çıktısını yaz.
> - `OPENCLAW_TOKEN`: OpenClaw'ın API tokeni. Genelde `openclaw.json`'dan veya OpenClaw UI'dan alınır.

---

## 6. Adım 3: Tüm Kaynak Dosyaları

### src/types.ts

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  metadata?: {
    conversation_id?: string;
    project_dir?: string;
    session_id?: string;
  };
}

export interface SessionInfo {
  conversationId: string;
  sessionId: string;
  processAlive: boolean;
  lastActivity: Date;
  projectDir: string;
  tokensUsed: number;
  budgetUsed: number;
}

export interface SpawnOptions {
  conversationId: string;
  sessionId: string;
  projectDir: string;
  systemPrompt?: string;
  model?: string;
  maxBudgetUsd?: number;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } };
```

---

### src/config.ts

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env bulunamazsa env variable'lardan devam */ }
}

loadDotEnv();

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined || val === '') throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`${key} must be integer, got: ${raw}`);
  return parsed;
}

function optionalEnvFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) throw new Error(`${key} must be number, got: ${raw}`);
  return parsed;
}

export const config = {
  port: optionalEnvInt('PORT', 9090),
  bridgeApiKey: requireEnv('BRIDGE_API_KEY'),
  // ÖNEMLI: sk-ant-placeholder ise boş bırak — CC OAuth kullanır
  anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
  // Tam yol zorunlu — systemd'nin PATH'i minimal olduğundan
  claudePath: optionalEnv('CLAUDE_PATH', '/home/USERNAME/.local/bin/claude'),
  claudeModel: optionalEnv('CLAUDE_MODEL', 'claude-sonnet-4-6'),
  claudeMaxBudgetUsd: optionalEnvFloat('CLAUDE_MAX_BUDGET_USD', 5),
  defaultProjectDir: optionalEnv('DEFAULT_PROJECT_DIR', '/home/USERNAME/'),
  openclawGatewayUrl: optionalEnv('OPENCLAW_GATEWAY_URL', 'http://localhost:18789'),
  openclawToken: optionalEnv('OPENCLAW_TOKEN', ''),
  idleTimeoutMs: optionalEnvInt('IDLE_TIMEOUT_MS', 1_800_000),
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  allowedTools: ['Bash', 'Edit', 'Read', 'Write', 'Glob', 'Grep', 'Task', 'WebFetch'],

  gsdWorkflowDir: `${process.env.HOME ?? '/home/USERNAME'}/.claude/get-shit-done/workflows`,
} as const;

export type Config = typeof config;
```

---

### src/utils/logger.ts

```typescript
import pino from 'pino';
import { config } from '../config.ts';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'openclaw-bridge' },
  transport: config.nodeEnv !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
```

---

### src/claude-manager.ts

Bu en kritik dosyadır. Spawn-per-message mimarisini uygular.

```typescript
/**
 * Claude Code Process Manager (Spawn-Per-Message)
 *
 * NEDEN SPAWN-PER-MESSAGE:
 *   Claude Code --print --input-format stream-json modunda stdin açık kalırken
 *   result eventi ÇIKARTMIYOR. Sadece system init eventleri gelir. EOF alınca
 *   işler. Bu nedenle her mesaj için yeni process spawn edip stdin.end() yapıyoruz.
 *
 * SESSION CONTINUITY:
 *   --session-id parametresi ile CC disk'te (~/.claude/sessions/) conversation
 *   history saklar. Aynı UUID ile yeni process spawn edilince önceki konuşma devam eder.
 *
 * SERİALİZASYON:
 *   Aynı conversation'a eş zamanlı iki mesaj gelirse race condition oluşur
 *   (aynı session dosyasına iki CC yazabilir). Promise chain ile serialize ediyoruz.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import { logger } from './utils/logger.ts';
import type { SessionInfo, SpawnOptions, StreamChunk } from './types.ts';

interface Session {
  info: SessionInfo;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pendingChain: Promise<void>; // Mesaj sıralama için
}

export class ClaudeManager extends EventEmitter {
  private sessions = new Map<string, Session>();

  constructor() { super(); }

  async getOrCreate(conversationId: string, options: Partial<SpawnOptions> = {}): Promise<SessionInfo> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      this.resetIdleTimer(conversationId);
      return { ...existing.info };
    }

    const info: SessionInfo = {
      conversationId,
      sessionId: options.sessionId ?? randomUUID(),
      processAlive: true,
      lastActivity: new Date(),
      projectDir: options.projectDir ?? config.defaultProjectDir,
      tokensUsed: 0,
      budgetUsed: 0,
    };

    const session: Session = { info, idleTimer: null, pendingChain: Promise.resolve() };
    this.sessions.set(conversationId, session);
    this.resetIdleTimer(conversationId);
    logger.info({ conversationId, sessionId: info.sessionId }, 'New conversation session created');
    return { ...info };
  }

  async *send(conversationId: string, message: string, projectDir?: string, systemPrompt?: string): AsyncGenerator<StreamChunk> {
    await this.getOrCreate(conversationId, { projectDir });
    const session = this.sessions.get(conversationId);
    if (!session) { yield { type: 'error', error: 'Session not found' }; return; }

    const log = logger.child({ conversationId, sessionId: session.info.sessionId });
    session.info.lastActivity = new Date();
    this.resetIdleTimer(conversationId);

    // Sıralama: önceki mesaj bitene kadar bekle
    const prevChain = session.pendingChain;
    let resolveMyChain!: () => void;
    const myChain = new Promise<void>((resolve) => { resolveMyChain = resolve; });
    session.pendingChain = myChain;

    try {
      await prevChain;
      for await (const chunk of this.runClaude(session, message, systemPrompt, log)) {
        yield chunk;
      }
    } finally {
      resolveMyChain();
      session.info.lastActivity = new Date();
      this.resetIdleTimer(conversationId);
    }
  }

  private async *runClaude(
    session: Session,
    message: string,
    systemPrompt: string | undefined,
    log: ReturnType<typeof logger.child>,
  ): AsyncGenerator<StreamChunk> {
    // ENV HAZIRLAMA
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    delete env['CLAUDECODE']; // Nested session rejection'ı önle

    // KRİTİK: Placeholder key'i sil. .env'den process.env'e geçmiş olabilir.
    // Eğer CC bu key'i alırsa OAuth yerine geçersiz key ile auth yapar → hata!
    delete env['ANTHROPIC_API_KEY'];
    if (config.anthropicApiKey && !config.anthropicApiKey.startsWith('sk-ant-placeholder')) {
      env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
    }
    // ANTHROPIC_API_KEY yoksa CC kendi OAuth keyring'ini kullanır — doğru davranış

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',                    // ZORUNLU: stream-json için
      '--input-format', 'stream-json',
      '--session-id', session.info.sessionId,  // Conversation continuity
      '--dangerously-skip-permissions',
      '--model', config.claudeModel,
      '--allowedTools', config.allowedTools.join(','),
      '--add-dir', session.info.projectDir,
      '--max-budget-usd', String(config.claudeMaxBudgetUsd),
    ];

    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

    log.info({ model: config.claudeModel }, 'Spawning Claude Code');

    // config.claudePath: TAM YOL kullan, 'claude' değil!
    // Systemd'nin PATH'i /home/USERNAME/.local/bin/ içermez
    const proc = spawn(config.claudePath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: session.info.projectDir,
    });

    // Spawn hatalarını yakala (ENOENT, EACCES gibi)
    // Yakalanmazsa tüm process crash eder!
    let spawnError: Error | null = null;
    proc.on('error', (err) => {
      spawnError = err;
      log.error({ err: err.message }, 'Claude Code spawn error');
    });

    // Mesajı yaz ve stdin'i KAPATi (KRİTİK: bu EOF CC'ye işaret eder)
    const inputLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
    }) + '\n';

    try {
      proc.stdin!.write(inputLine);
      proc.stdin!.end(); // Bu olmadan CC result eventi çıkartmaz!
    } catch (err) {
      yield { type: 'error', error: `stdin write failed: ${String(err)}` };
      return;
    }

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log.debug({ stderr: text.slice(0, 200) }, 'CC stderr');
    });

    const timeoutHandle = setTimeout(() => {
      log.warn('Claude Code timeout (5min), killing');
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }, 5 * 60 * 1000);

    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity, terminal: false });
    let resultReceived = false;

    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          log.debug({ line: trimmed.slice(0, 80) }, 'Non-JSON line');
          continue;
        }

        const type = event['type'] as string | undefined;

        switch (type) {
          case 'content_block_delta': {
            const delta = event['delta'] as Record<string, unknown> | undefined;
            if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
              yield { type: 'text', text: delta['text'] as string };
            }
            break;
          }
          case 'message_delta': {
            const u = event['usage'] as Record<string, number> | undefined;
            if (u) session.info.tokensUsed += (u['input_tokens'] ?? 0) + (u['output_tokens'] ?? 0);
            break;
          }
          case 'result': {
            const subtype = event['subtype'] as string | undefined;
            const resultText = event['result'] as string | undefined;
            const resultUsage = event['usage'] as Record<string, number> | undefined;

            if (resultUsage) {
              const i = resultUsage['input_tokens'] ?? 0;
              const o = resultUsage['output_tokens'] ?? 0;
              session.info.tokensUsed += i + o;
              yield { type: 'done', usage: { input_tokens: i, output_tokens: o } };
            } else {
              yield { type: 'done' };
            }

            if (subtype === 'error') {
              yield { type: 'error', error: resultText ?? 'CC returned error result' };
            } else if (resultText?.trim()) {
              yield { type: 'text', text: resultText };
            }

            resultReceived = true;
            break;
          }
          case 'system':
          case 'message_start':
          case 'content_block_start':
          case 'content_block_stop':
          case 'message_stop':
            break; // Lifecycle eventler — aksiyon gereksiz
          default:
            log.debug({ type }, 'Unknown event type');
        }
      }

      if (!resultReceived) {
        if (spawnError) {
          yield { type: 'error', error: `Spawn failed: ${spawnError.message}` };
        } else {
          yield { type: 'error', error: 'CC exited without result event' };
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
      try { rl.close(); } catch { /* ignore */ }
      // Process'in doğal çıkışını bekle
      await Promise.race([
        new Promise<void>((r) => proc.once('exit', r)),
        new Promise<void>((r) => setTimeout(r, 3000)),
      ]);
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }
  }

  terminate(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    this.clearIdleTimer(conversationId);
    this.sessions.delete(conversationId);
    logger.info({ conversationId }, 'Session terminated');
  }

  async shutdownAll(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) this.terminate(id);
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.info }));
  }

  getSession(conversationId: string): SessionInfo | null {
    const s = this.sessions.get(conversationId);
    return s ? { ...s.info } : null;
  }

  private resetIdleTimer(conversationId: string): void {
    this.clearIdleTimer(conversationId);
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.idleTimer = setTimeout(() => {
      logger.info({ conversationId }, 'Session idle timeout');
      this.terminate(conversationId);
    }, config.idleTimeoutMs);
  }

  private clearIdleTimer(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session?.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }
}

export const claudeManager = new ClaudeManager();
```

---

### src/api/routes.ts

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { routeMessage } from '../router.ts';
import { claudeManager } from '../claude-manager.ts';
import { config } from '../config.ts';
import { logger } from '../utils/logger.ts';
import type { ChatCompletionRequest } from '../types.ts';

function verifyBearerToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: { message: 'Missing Bearer token', type: 'auth_error' } });
    return false;
  }
  const token = authHeader.slice(7).trim();
  if (token !== config.bridgeApiKey) {
    reply.code(401).send({ error: { message: 'Invalid API key', type: 'auth_error' } });
    return false;
  }
  return true;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const sessions = claudeManager.getSessions();
    return reply.code(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      sessions: sessions.map((s) => ({
        conversationId: s.conversationId,
        sessionId: s.sessionId,
        processAlive: s.processAlive,
        lastActivity: s.lastActivity.toISOString(),
        projectDir: s.projectDir,
        tokensUsed: s.tokensUsed,
      })),
      activeSessions: sessions.filter((s) => s.processAlive).length,
      totalSessions: sessions.length,
    });
  });

  app.get('/v1/models', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    return reply.code(200).send({
      object: 'list',
      data: [
        { id: config.claudeModel, object: 'model', created: 1_700_000_000, owned_by: 'anthropic' },
        { id: 'claude-opus-4-6', object: 'model', created: 1_700_000_000, owned_by: 'anthropic' },
      ],
    });
  });

  app.post('/v1/chat/completions',
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;

      const body = request.body;
      if (!body.messages?.length) {
        return reply.code(400).send({ error: { message: 'messages required', type: 'invalid_request' } });
      }

      const conversationId =
        (request.headers['x-conversation-id'] as string | undefined) ??
        body.metadata?.conversation_id ?? randomUUID();

      const projectDir =
        (request.headers['x-project-dir'] as string | undefined) ??
        body.metadata?.project_dir ?? config.defaultProjectDir;

      const isStream = body.stream === true;
      logger.info({ conversationId, model: body.model, stream: isStream }, 'Chat completion request');

      let result: Awaited<ReturnType<typeof routeMessage>>;
      try {
        result = await routeMessage(body, { conversationId, projectDir });
      } catch (err) {
        return reply.code(500).send({ error: { message: String(err), type: 'internal_error' } });
      }

      const completionId = `chatcmpl-${randomUUID().replace(/-/g, '')}`;

      if (isStream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Conversation-Id', result.conversationId);
        reply.raw.flushHeaders?.();

        const sendSSE = (data: string) => {
          if (!reply.raw.writableEnded) reply.raw.write(`data: ${data}\n\n`);
        };

        try {
          for await (const chunk of result.stream) {
            if (chunk.type === 'text') {
              sendSSE(JSON.stringify({
                id: completionId, object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000), model: body.model ?? config.claudeModel,
                choices: [{ index: 0, delta: { role: 'assistant', content: chunk.text }, finish_reason: null }],
              }));
            } else if (chunk.type === 'done') {
              sendSSE(JSON.stringify({
                id: completionId, object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000), model: body.model ?? config.claudeModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: chunk.usage ?? null,
              }));
            }
          }
        } finally {
          if (!reply.raw.writableEnded) {
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
          }
        }
        return;
      }

      // Non-streaming
      const textChunks: string[] = [];
      let usage: { input_tokens: number; output_tokens: number } | undefined;
      for await (const chunk of result.stream) {
        if (chunk.type === 'text') textChunks.push(chunk.text);
        else if (chunk.type === 'done') usage = chunk.usage;
      }

      return reply
        .code(200)
        .header('X-Conversation-Id', result.conversationId)
        .header('X-Session-Id', result.sessionId)
        .send({
          id: completionId, object: 'chat.completion',
          created: Math.floor(Date.now() / 1000), model: body.model ?? config.claudeModel,
          choices: [{ index: 0, message: { role: 'assistant', content: textChunks.join('') }, finish_reason: 'stop' }],
          usage: usage
            ? { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens }
            : undefined,
        });
    });

  app.delete('/v1/sessions/:conversationId',
    async (request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { conversationId } = request.params;
      if (!claudeManager.getSession(conversationId)) {
        return reply.code(404).send({ error: `Session not found: ${conversationId}` });
      }
      claudeManager.terminate(conversationId);
      return reply.code(200).send({ message: 'Session terminated', conversationId });
    });
}
```

---

### src/router.ts

```typescript
import { randomUUID } from 'node:crypto';
import { claudeManager } from './claude-manager.ts';
import { getGSDContext } from './gsd-adapter.ts';
import { matchPatterns, hasStructuredOutput } from './pattern-matcher.ts';
import { config } from './config.ts';
import { logger } from './utils/logger.ts';
import type { ChatCompletionRequest, StreamChunk } from './types.ts';

export interface RouteResult {
  conversationId: string;
  sessionId: string;
  stream: AsyncGenerator<StreamChunk>;
}

export async function routeMessage(
  request: ChatCompletionRequest,
  options: { conversationId?: string; projectDir?: string } = {},
): Promise<RouteResult> {
  const conversationId = options.conversationId ?? request.metadata?.conversation_id ?? randomUUID();
  const projectDir = options.projectDir ?? request.metadata?.project_dir ?? config.defaultProjectDir;
  const log = logger.child({ conversationId });

  const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    async function* emptyStream(): AsyncGenerator<StreamChunk> {
      yield { type: 'error', error: 'No user message in request' };
    }
    return { conversationId, sessionId: '', stream: emptyStream() };
  }

  const userMessage = lastUserMessage.content;

  let systemPrompt: string | undefined;
  try {
    const gsdContext = await getGSDContext(userMessage, projectDir);
    systemPrompt = gsdContext.fullSystemPrompt;
    log.debug({ command: gsdContext.command }, 'GSD context built');
  } catch (err) {
    log.warn({ err }, 'Failed to build GSD context — continuing without');
  }

  const sessionInfo = await claudeManager.getOrCreate(conversationId, { projectDir, systemPrompt });
  log.info({ sessionId: sessionInfo.sessionId }, 'Session ready');

  const stream = (async function* (): AsyncGenerator<StreamChunk> {
    const collectedText: string[] = [];
    for await (const chunk of claudeManager.send(conversationId, userMessage, projectDir, systemPrompt)) {
      if (chunk.type === 'text') collectedText.push(chunk.text);
      yield chunk;
    }
    const fullText = collectedText.join('');
    if (hasStructuredOutput(fullText)) {
      const patterns = matchPatterns(fullText);
      log.info({ patterns: patterns.map((p) => ({ key: p.key, value: p.value.slice(0, 80) })) }, 'Patterns detected');
    }
  })();

  return { conversationId, sessionId: sessionInfo.sessionId, stream };
}
```

---

### src/index.ts

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.ts';
import { logger } from './utils/logger.ts';
import { registerRoutes } from './api/routes.ts';
import { claudeManager } from './claude-manager.ts';

const app = Fastify({ logger: false, trustProxy: true });

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Conversation-Id', 'X-Project-Dir'],
  exposedHeaders: ['X-Conversation-Id', 'X-Session-Id'],
});

app.addHook('onRequest', async (request) => {
  logger.info({ method: request.method, url: request.url, ip: request.ip }, 'Incoming request');
});

app.addHook('onResponse', async (request, reply) => {
  logger.info({ method: request.method, url: request.url, statusCode: reply.statusCode }, 'Request completed');
});

await registerRoutes(app);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');
  try {
    await app.close();
    await claudeManager.shutdownAll();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (err) => { logger.error({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.error({ reason }, 'Unhandled rejection'); process.exit(1); });

await app.listen({ port: config.port, host: '0.0.0.0' });
logger.info({ port: config.port, claudeModel: config.claudeModel }, 'OpenClaw Bridge Daemon started');
```

---

## 7. Adım 4: OpenClaw Config Güncellemesi

OpenClaw config'i Docker container içindedir: `/home/node/.openclaw/openclaw.json`

Güncellenmesi gereken bölümler:

### chatCompletions endpoint'ini aktif et:

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

### Bridge model provider ekle:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "bridge": {
        "api": "openai-completions",
        "baseUrl": "http://host.docker.internal:9090/v1",
        "apiKey": "SENIN_BRIDGE_API_KEYIN_BURAYA"
      }
    }
  }
}
```

> **Dikkat:**
> - `"mode": "merge"` zorunlu — yoksa custom provider'lar çalışmaz
> - `"api": "openai-completions"` zorunlu (not: `"openai-compat"` değil, bu mevcut değil)
> - `"apiKey"` bridge'in `BRIDGE_API_KEY` değeriyle aynı olmalı

### Bridge agent tanımla:

```json
{
  "agents": {
    "list": [
      {
        "id": "bridge",
        "name": "Claude Code (Bridge)",
        "model": {
          "primary": "bridge/bridge-model"
        },
        "active": true
      }
    ]
  }
}
```

### Config güncelleme betiği (container içinde çalıştır):

```bash
# Bu script'i container içinde çalıştır:
docker exec openclaw-gateway node -e "
const fs = require('fs');
const path = '/home/node/.openclaw/openclaw.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));

// chatCompletions
config.gateway = config.gateway || {};
config.gateway.http = config.gateway.http || {};
config.gateway.http.endpoints = config.gateway.http.endpoints || {};
config.gateway.http.endpoints.chatCompletions = { enabled: true };

// Bridge provider
config.models = config.models || {};
config.models.mode = 'merge';
config.models.providers = config.models.providers || {};
config.models.providers.bridge = {
  api: 'openai-completions',
  baseUrl: 'http://host.docker.internal:9090/v1',
  apiKey: 'SENIN_BRIDGE_API_KEYIN_BURAYA'
};

// Bridge agent
config.agents = config.agents || {};
config.agents.list = config.agents.list || [];
const existing = config.agents.list.find(a => a.id === 'bridge');
if (!existing) {
  config.agents.list.push({
    id: 'bridge',
    name: 'Claude Code (Bridge)',
    model: { primary: 'bridge/bridge-model' },
    active: true
  });
}

fs.writeFileSync(path, JSON.stringify(config, null, 2));
console.log('Config updated!');
console.log('Providers:', Object.keys(config.models.providers));
console.log('chatCompletions:', config.gateway.http.endpoints.chatCompletions);
"
```

---

## 8. Adım 5: Systemd Service Kurulumu

### systemd/openclaw-bridge.service:

```ini
[Unit]
Description=OpenClaw Bridge Daemon
Documentation=https://github.com/USERNAME/openclaw-bridge
After=network.target
Wants=network.target
# Restart limitleri [Unit]'te olmalı — [Service]'te Unknown key hatası verir!
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=USERNAME
Group=USERNAME
WorkingDirectory=/home/USERNAME/openclaw-bridge
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
# /etc/sysconfig/ altında — SELinux user_home_t sorununu çözer
EnvironmentFile=/etc/sysconfig/openclaw-bridge

# Output
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw-bridge

[Install]
WantedBy=multi-user.target
```

> **GÜVENLİK NOTU:** `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp=yes`
> gibi hardening direktiflerini EKLEME. Fedora'da SELinux + bu direktiflerin
> kombinasyonu EnvironmentFile okumayı engeller. Güvenlik SELinux tarafından sağlanır.

### Kurulum adımları:

```bash
# 1. Env dosyasını systemd'nin okuyabileceği yere kopyala
sudo cp /home/USERNAME/openclaw-bridge/.env /etc/sysconfig/openclaw-bridge
sudo chmod 640 /etc/sysconfig/openclaw-bridge
sudo chown root:USERNAME /etc/sysconfig/openclaw-bridge

# 2. Service dosyasını kopyala
sudo cp /home/USERNAME/openclaw-bridge/systemd/openclaw-bridge.service /etc/systemd/system/

# 3. Reload ve enable
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-bridge

# 4. Status kontrol
systemctl status openclaw-bridge

# Başarılı çıktı:
# Active: active (running) since ...
```

> **ÖNEMLİ:** `/etc/sysconfig/openclaw-bridge`'i güncellediğinde service'i restart etmen gerekir:
> ```bash
> sudo systemctl restart openclaw-bridge
> ```
> Systemd, EnvironmentFile'ı sadece başlangıçta okur.

---

## 9. Adım 6: Doğrulama ve Testler

### Sıralı doğrulama (hepsini geç):

```bash
# TEST 1: claude binary authenticate ve çalışıyor mu?
claude -p "say: ALIVE" --model claude-haiku-4-5-20251001
# Beklenen: ALIVE

# TEST 2: Bridge servisi çalışıyor mu?
systemctl is-active openclaw-bridge
# Beklenen: active

# TEST 3: Bridge health endpoint
curl -s http://localhost:9090/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('Status:', d['status'])"
# Beklenen: Status: ok

# TEST 4: Bridge auth kontrolü (yanlış key)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9090/v1/chat/completions \
  -H "Authorization: Bearer YANLIS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"x","messages":[]}'
# Beklenen: 401

# TEST 5: Bridge → Claude Code tam yanıt
curl -s -X POST http://localhost:9090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SENIN_BRIDGE_API_KEYIN" \
  -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"2+2?"}],"stream":false}' \
  --max-time 90 | python3 -c "import sys,json; d=json.load(sys.stdin); print('Yanıt:', d['choices'][0]['message']['content'])"
# Beklenen: Yanıt: 4

# TEST 6: Container → Bridge erişimi
docker exec openclaw-gateway curl -s http://host.docker.internal:9090/health | python3 -c "import sys,json; print('OK:', json.load(sys.stdin)['status'])"
# Beklenen: OK: ok

# TEST 7: Tam end-to-end (OpenClaw → Bridge → Claude Code)
curl -s -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OPENCLAW_TOKEN_BURAYA" \
  -d '{"model":"bridge/bridge-model","messages":[{"role":"user","content":"2+2?"}],"stream":false}' \
  --max-time 120 | python3 -c "import sys,json; d=json.load(sys.stdin); print('E2E Yanıt:', d['choices'][0]['message']['content'])"
# Beklenen: E2E Yanıt: 4
```

### Log takibi (problem debuglama için):

```bash
# Gerçek zamanlı log
journalctl -u openclaw-bridge -f

# Son 50 log satırı
journalctl -u openclaw-bridge --no-pager -n 50

# Sadece hataları filtrele
journalctl -u openclaw-bridge --no-pager | grep -i "error\|fail\|warn"
```

---

## 10. Hata Kataloğu — Karşılaşılan Tüm Sorunlar

### Hata #1 (EN KRİTİK): stdin açık kalınca `result` eventi gelmiyor

**Belirti:** HTTP request asılı kalıyor, timeout oluyor. Bridge log'unda "Spawning Claude Code" görünüyor ama "Request completed" gelmiyor. Health endpoint ise çalışıyor.

**Kök Neden:** `claude --print --input-format stream-json` modunda, stdin açık tutulduğunda (EOF gönderilmediğinde) Claude Code sadece `system` init eventlerini çıkartır. `result` eventi ASLA gelmez. Önceki mimaride long-lived process tutuluyordu ama stdin asla kapatılmıyordu.

**Test:**
```bash
unset CLAUDECODE
(echo '{"type":"user","message":{"role":"user","content":"test"}}'; sleep 20) | \
  timeout 15 claude --print --output-format stream-json --verbose \
  --input-format stream-json --session-id "$(python3 -c 'import uuid; print(uuid.uuid4())')" \
  --dangerously-skip-permissions --model claude-haiku-4-5-20251001 2>&1 | \
  python3 -c "
import sys,json
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try:
        d=json.loads(line)
        print('EVENT:', d.get('type'))
    except: pass
"
# Çıktı: sadece EVENT: system satırları — result hiç yok
```

**Çözüm:** Her mesaj için yeni process spawn et. `stdin.write()` sonrası `stdin.end()` çağır. Process mesajı işler, stream-json eventlerini çıkartır ve exit eder. Session continuity için `--session-id` ile aynı UUID kullan.

**Değişiklik:** `claude-manager.ts` tamamen yeniden yazıldı — long-lived process'ten spawn-per-message'a geçildi.

---

### Hata #2: ANTHROPIC_API_KEY placeholder Claude Code'u bozuyor

**Belirti:** Bridge çalışıyor, request alıyor, CC spawn ediliyor ama yanıt: `"Invalid API key · Fix external API key"`. HTTP 200 dönüyor ama içerik hata mesajı.

**Kök Neden:**
1. `.env` dosyasında `ANTHROPIC_API_KEY=sk-ant-placeholder` var
2. `loadDotEnv()` bunu `process.env`'e yazar
3. Child process env'i kopyalanırken: `for (const [k,v] of Object.entries(process.env))` ile `sk-ant-placeholder` da kopyalanır
4. Claude Code bu geçersiz key ile Anthropic API'ye bağlanmaya çalışır ve hata alır
5. OAuth keyring'e hiç başvurulmaz

**Çözüm:**
```typescript
// YANLIŞ:
const env = { ...process.env };
if (config.anthropicApiKey && !config.anthropicApiKey.startsWith('sk-ant-placeholder')) {
  env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
}
// Hata: process.env'deki 'sk-ant-placeholder' hala envde!

// DOĞRU:
const env = { ...process.env };
delete env['ANTHROPIC_API_KEY']; // Her zaman önce sil
if (config.anthropicApiKey && !config.anthropicApiKey.startsWith('sk-ant-placeholder')) {
  env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
}
// ANTHROPIC_API_KEY yoksa CC OAuth keyring kullanır
```

---

### Hata #3: SELinux — systemd EnvironmentFile okuyamıyor

**Belirti:** `journalctl -u openclaw-bridge` çıktısı:
```
Failed to load environment files: Permission denied
Failed to spawn 'start' task: Permission denied
```

**Kök Neden:** `/home/USERNAME/.openclaw-bridge/.env` dosyası `user_home_t` SELinux context'ine sahip. Systemd (init_t context) bu context'i okuyamaz. `ProtectHome=read-only` ve `ProtectSystem=strict` güvenlik direktifleri durumu daha da kötüleştirir ama olmasalar bile SELinux yine de engeller.

**Doğrulama:**
```bash
ls -laZ /home/USERNAME/openclaw-bridge/.env
# Çıktı: ... unconfined_u:object_r:user_home_t:s0 ... .env
```

**Çözüm:**
```bash
# Env dosyasını systemd'nin okuyabileceği yere taşı
sudo cp /home/USERNAME/openclaw-bridge/.env /etc/sysconfig/openclaw-bridge
sudo chmod 640 /etc/sysconfig/openclaw-bridge
sudo chown root:USERNAME /etc/sysconfig/openclaw-bridge
```

Service dosyasını güncelle:
```ini
# YANLIŞ:
EnvironmentFile=/home/USERNAME/openclaw-bridge/.env

# DOĞRU:
EnvironmentFile=/etc/sysconfig/openclaw-bridge
```

`/etc/sysconfig/` altındaki dosyalar `etc_t` context alır ve systemd okuyabilir.

---

### Hata #4: `spawn claude ENOENT` — systemd'de claude bulunamıyor

**Belirti:** Service başlıyor ama request gelince hemen crash:
```
Error: spawn claude ENOENT
Uncaught exception
```

**Kök Neden:** Systemd'nin başlattığı process'lerin PATH'i minimaldır:
`/usr/bin:/usr/sbin:/bin:/sbin`

`claude` binary'si `~/.local/bin/` altında — bu PATH'te yok. `spawn('claude', ...)` ENOENT verir.

**Doğrulama:**
```bash
which claude       # Örnek: /home/USERNAME/.local/bin/claude
sudo env -i PATH=/usr/bin:/usr/sbin:/bin:/sbin which claude  # Çıktı: claude bulunamadı
```

**Çözüm:**

`.env` / `/etc/sysconfig/openclaw-bridge`'e ekle:
```
CLAUDE_PATH=/home/USERNAME/.local/bin/claude
```

`config.ts`'e ekle:
```typescript
claudePath: optionalEnv('CLAUDE_PATH', '/home/USERNAME/.local/bin/claude'),
```

`claude-manager.ts`'de kullan:
```typescript
const proc = spawn(config.claudePath, args, { ... });
// 'claude' değil config.claudePath!
```

---

### Hata #5: `StartLimitIntervalSec` Unknown key uyarısı

**Belirti:** `journalctl` çıktısında:
```
/etc/systemd/system/openclaw-bridge.service:25: Unknown key 'StartLimitIntervalSec' in section [Service]
```

**Kök Neden:** `StartLimitBurst` ve `StartLimitIntervalSec` direktifleri `[Service]` bölümüne değil, `[Unit]` bölümüne aittir.

**Çözüm:**
```ini
# YANLIŞ:
[Service]
StartLimitBurst=5
StartLimitIntervalSec=60

# DOĞRU:
[Unit]
StartLimitBurst=5
StartLimitIntervalSec=60
```

---

### Hata #6: Port 9090 EADDRINUSE

**Belirti:** Service restart edilince:
```
listen EADDRINUSE: address already in use 0.0.0.0:9090
```

**Kök Neden:** Önceki bir test için manuel başlatılan bridge process'i hala çalışıyordur.

**Çözüm:**
```bash
sudo fuser -k 9090/tcp
# veya:
lsof -ti:9090 | xargs kill -9
```

---

### Hata #7: OpenClaw provider `openai-compat` yok

**Belirti:** OpenClaw bridge model kullanmaya çalışınca:
```
No API provider registered for api: openai-compat
```

**Kök Neden:** OpenClaw'ın doğru provider type adı `openai-completions`'dır, `openai-compat` değil.

**Çözüm:**
```json
{
  "models": {
    "providers": {
      "bridge": {
        "api": "openai-completions"
      }
    }
  }
}
```

---

### Hata #8: OpenClaw `fallback` vs `fallbacks` schema hatası

**Belirti:** OpenClaw startup'ta config parse hatası veya agent beklenmedik model kullanıyor.

**Kök Neden:** OpenClaw schema'sı model fallback için `fallbacks` (array) bekler, `fallback` (string) değil.

**YANLIŞ:**
```json
{ "model": { "primary": "minimax/...", "fallback": "bridge/bridge-model" } }
```

**DOĞRU:**
```json
{ "model": { "primary": "minimax/...", "fallbacks": ["bridge/bridge-model"] } }
```

---

### Hata #10: "control UI requires device identity" (Tailscale/uzak erişim)

**Belirti:** Tailscale IP'si üzerinden HTTP ile Control UI'ya girilince:
```
control UI requires device identity (use HTTPS or localhost secure context)
```

**Kök Neden:** OpenClaw Control UI, device identity keypair'ı WebCrypto API ile üretir. WebCrypto yalnızca secure context'te (HTTPS veya localhost) çalışır. `http://100.x.x.x:18789` güvenli context değil.

**Çözüm:** HTTPS proxy kur (Adım 7). Tailscale cert al, Node.js HTTPS proxy başlat.
```bash
tailscale cert $(tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
node /home/ayaz/openclaw-bridge/https-proxy.mjs &
```

---

### Hata #11: "gateway token missing" (Control UI remote)

**Belirti:** HTTPS üzerinden Control UI'ya girince:
```
unauthorized: gateway token missing (open the dashboard URL and paste the token in Control UI settings)
```

**Kök Neden:** Control UI token'ı browser localStorage'da saklar: `openclaw.control.settings.v1`. Her yeni origin (URL) için ayrı localStorage vardır. HTTPS URL'i için token set edilmemiş.

**Çözüm:** `/init` sayfasına git (proxy'nin eklediği özel route):
```
https://HOSTNAME:18790/init
```
Bu sayfa JavaScript ile localStorage'a token + gatewayUrl set eder, ardından /chat'e yönlendirir.

Alternatif: Browser console (F12):
```javascript
const s = JSON.parse(localStorage.getItem('openclaw.control.settings.v1') || '{}');
s.gatewayUrl = 'wss://' + location.host;
s.token = 'GATEWAY_TOKEN';
localStorage.setItem('openclaw.control.settings.v1', JSON.stringify(s));
location.reload();
```

---

### Hata #12: "too many failed authentication attempts" (rate limit)

**Belirti:** Birkaç başarısız token denemesinden sonra:
```
unauthorized: too many failed authentication attempts (retry later)
```

**Kök Neden:** OpenClaw gateway `lockoutMs: 300000` (5 dakika) in-memory rate limit uygular. Önceki başarısız denemeler (yanlış token, eski localStorage verisi, vs.) bunu tetikler.

**Çözüm:** Container restart → in-memory limiter sıfırlanır:
```bash
docker restart openclaw-gateway
```
5 dakika beklemeye gerek yok.

---

### Hata #13: "pairing required" (device pairing)

**Belirti:** Token doğru set edilmiş ama:
```
pairing required
```

**Kök Neden:** OpenClaw, her yeni browser/cihazı device keypair ile tanımlar. İlk bağlantıda gateway bu cihazı tanımaz ve pairing approval bekler. Token auth ile bile pairing gereklidir — bu güvenlik katmanı.

**Çözüm:** CLI ile pending request'i approve et:
```bash
# Pending listesini gör
docker exec openclaw-gateway node /app/dist/index.js devices list \
  --token GATEWAY_TOKEN

# Approve et (Request sütunundaki UUID ile)
docker exec openclaw-gateway node /app/dist/index.js devices approve \
  REQUEST_UUID \
  --token GATEWAY_TOKEN
```

**Önemli:** CLI için `/root/.openclaw/openclaw.json` gerekli, yoksa `--token` flag hep verilmeli:
```bash
# /root/.openclaw/openclaw.json oluşturma (container içinde):
docker exec openclaw-gateway sh -c '
mkdir -p /root/.openclaw
echo "{\"gateway\":{\"remote\":{\"token\":\"GATEWAY_TOKEN\"}}}" > /root/.openclaw/openclaw.json'
```

Approve sonrası browser F5 → Health: OK, bağlı.

---

### Hata #14: "web login provider is not available" / "Unsupported channel: whatsapp"

**Belirti:** Control UI'dan WhatsApp login yapmaya calisinca `web login provider is not available`. CLI'dan `channels login --channel whatsapp` calistirilinca `Unsupported channel: whatsapp`.

**Kok Neden:** OpenClaw'da bundled channel plugin'leri (WhatsApp dahil) **varsayilan olarak disabled**. `channels.whatsapp.enabled: true` config'de olmadigi icin WhatsApp plugin yuklenmez ve plugin registry bos kalir.

**Cozum:**

1. Gateway config'e channels bolumu ekle:
```bash
docker exec openclaw-gateway node -e "
const fs = require('fs');
const p = '/home/node/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!c.channels) c.channels = {};
if (!c.channels.whatsapp) c.channels.whatsapp = {};
c.channels.whatsapp.enabled = true;
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('Done');
"
```

2. CLI config'e de ekle:
```bash
docker exec openclaw-gateway sh -c '
mkdir -p /root/.openclaw
cat > /root/.openclaw/openclaw.json << EOF
{
  "channels": { "whatsapp": { "enabled": true } },
  "gateway": {
    "auth": { "mode": "token", "token": "GATEWAY_TOKEN" },
    "remote": { "token": "GATEWAY_TOKEN" }
  }
}
EOF'
```

3. Gateway restart (veya otomatik config reload bekle):
```bash
docker restart openclaw-gateway
```

**Dogrulama:**
```bash
docker exec openclaw-gateway node /app/dist/index.js channels login --channel whatsapp
# QR kodu goruntulenmeli
```

**Detay:** `BUNDLED_ENABLED_BY_DEFAULT` set'i sadece `device-pair`, `phone-control`, `talk-voice` iceriyor. Diger tum kanal plugin'leri explicit enable gerektirir. Bkz. `manifest-registry-C6u54rI3.js:70`.

---

### Hata #9: Unhandled exception — spawn error process'i çökertir

**Belirti:** Service tamamen çöküyor (`Failed with result 'exit-code'`). Log'da `Uncaught exception` ve ENOENT veya başka bir spawn hatası.

**Kök Neden:** `proc.on('error', ...)` eventi handle edilmediğinde Node.js bunu unhandled error olarak fırlatır ve `process.on('uncaughtException')` tetiklenir. `index.ts`'deki uncaughtException handler `process.exit(1)` yapıyor.

**Çözüm:** `runClaude()` içinde:
```typescript
let spawnError: Error | null = null;
proc.on('error', (err) => {
  spawnError = err;
  log.error({ err: err.message }, 'Spawn error');
});
// spawnError'ı resultReceived kontrolünde kullan
```

---

## 11. Mimari Kararlar ve Araştırma Bulguları

### Neden spawn-per-message?

Long-lived process (`claude` sürekli çalışır, her mesaj stdin'e yazılır) ilk tasarımdı. Ancak test sonucu ortaya çıktı ki CC `--print --input-format stream-json` modunda stdin açık olduğu sürece `result` eventi çıkartmıyor. Bu bilinen bir davranış — aynı sorun WSL/Windows ortamında da raporlanmış ([anthropics/claude-code#3187](https://github.com/anthropics/claude-code/issues/3187)).

Bu nedenle spawn-per-message seçildi:
- Her mesaj → yeni CC process
- `stdin.write(message)` → `stdin.end()` (EOF)
- CC işler, stream-json eventleri çıkartır, exit eder
- Session continuity: aynı `--session-id` UUID → CC disk history'den devam eder

**Gecikme:** Her mesajda ~3-5 saniyelik CC startup gecikmesi var. WhatsApp kullanımı için kabul edilebilir.

### Bilinen projeler (araştırma bulgularından)

Aynı problemi çözen topluluk projeleri:
- **atalovesyou/claude-max-api-proxy** — Node.js subprocess wrapper, OpenAI-compat API, OpenClaw'ın resmi dokümanında referans var
- **13rac1/openclaw-plugin-claude-code** — Podman container içinde CC, AppArmor + resource limits

### ToS durumu

- **Güvenli olan:** `claude` binary'yi doğrudan çalıştırmak. Bu Anthropic'in `--print` / headless mode dokümanında açıkça destekleniyor.
- **Riskli olan:** OAuth token'ı extract edip başka app'te kullanmak (biz bunu yapmıyoruz).
- **En güvenli yol:** `ANTHROPIC_API_KEY`'e gerçek API key (console.anthropic.com) vermek.

### Alternatif: `--resume` vs `--session-id`

Session continuity için iki seçenek:
- `--session-id <uuid>` → belirtilen UUID'li session'ı yükler (veya yeni oluşturur)
- `--resume <session-id>` → aynı şey, farklı syntax
- `--continue` → son session'ı devam ettirir

`--session-id` kullanıyoruz çünkü her conversation'ın UUID'si hafızada tutulur ve her spawn'da aynı UUID geçilir.

---

## Adım 7: Uzaktan Erişim (Tailscale HTTPS)

> Bu adım **zorunlu değil** — sadece başka bir cihazdan (telefon, laptop) Control UI'ya erişmek istiyorsan gerekli. Aynı makinedeysen localhost:18789 kullan.

### Neden HTTPS zorunlu?

Browser, OpenClaw Control UI'nın ihtiyaç duyduğu WebCrypto API'yi (device identity private key işlemleri) yalnızca **secure context**'te (HTTPS veya localhost) çalıştırır. Tailscale IP'si üzerinden HTTP ile gittiğinde şu hatayı alırsın:

```
control UI requires device identity (use HTTPS or localhost secure context)
```

### 7.1 Tailscale Sertifikası Al

```bash
# Tailscale hostname'ini öğren
tailscale status --json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d['Self']['DNSName'].rstrip('.'))
"
# Örnek çıktı: mainfedora.tailb1cc10.ts.net

# Sertifikayı al (home dizinine yazar)
tailscale cert mainfedora.tailb1cc10.ts.net
# → mainfedora.tailb1cc10.ts.net.crt
# → mainfedora.tailb1cc10.ts.net.key
```

### 7.2 HTTPS Proxy'yi Başlat

`/home/ayaz/openclaw-bridge/https-proxy.mjs` dosyası zaten mevcut:

```bash
node /home/ayaz/openclaw-bridge/https-proxy.mjs &
# Çıktı: HTTPS proxy: https://mainfedora.tailb1cc10.ts.net:18790

# Test:
curl -sk https://mainfedora.tailb1cc10.ts.net:18790 -o /dev/null -w "%{http_code}"
# Beklenen: 200
```

> **Önemli:** Proxy arka planda çalışır ve oturum kapanınca durur. Kalıcı için systemd'ye ekle (aşağıda).

### 7.3 Browser'da Token Ayarla (bir kerelik)

Control UI token'ı browser'ın localStorage'ında saklar. Her yeni cihaz/browser için bir kez yapılır.

**Yöntem (önerilen): /init URL'ine git:**
```
https://mainfedora.tailb1cc10.ts.net:18790/init
```
Bu sayfa token'ı otomatik set eder ve /chat'e yönlendirir.

**Alternatif — Browser console (F12 → Console):**
```javascript
const s = JSON.parse(localStorage.getItem('openclaw.control.settings.v1') || '{}');
s.gatewayUrl = 'wss://mainfedora.tailb1cc10.ts.net:18790';
s.token = 'YOUR_GATEWAY_TOKEN_HERE';
localStorage.setItem('openclaw.control.settings.v1', JSON.stringify(s));
location.reload();
```

> **Token nerede:** `docker exec openclaw-gateway cat /home/node/.openclaw/openclaw.json | python3 -c "import json,sys; print(json.load(sys.stdin)['gateway']['auth']['token'])"`

### 7.4 Device Pairing Approve Et (bir kerelik, her yeni cihaz için)

Her yeni cihaz/browser ilk bağlantıda "pairing required" hatası verir. Bu güvenlik özelliği — devre dışı bırakılmaz, approve edilir.

```bash
# Pending request'leri listele
docker exec openclaw-gateway node /app/dist/index.js devices list \
  --token YOUR_GATEWAY_TOKEN_HERE

# Çıktı:
# Pending (1)
# │ 7c43d2d8-080c-45c7-9616-fc7073edb600 │ b7efe98... │ operator │ 172.24.0.1 │

# Approve et (Request sütunundaki UUID'yi kullan):
docker exec openclaw-gateway node /app/dist/index.js devices approve \
  7c43d2d8-080c-45c7-9616-fc7073edb600 \
  --token YOUR_GATEWAY_TOKEN_HERE

# Çıktı: Approved b7efe98... (7c43d2d8-...)
```

Approve sonrası browser'da F5 — Health: OK, chat: bağlı görünmeli.

### 7.5 Rate Limit Lockout Çözümü

Çok fazla başarısız deneme sonrası:
```
unauthorized: too many failed authentication attempts (retry later)
```
lockoutMs: 300000 = 5 dakika bekleme. Beklemek yerine:

```bash
docker restart openclaw-gateway
# In-memory rate limiter sıfırlanır, hemen devam edebilirsin.
```

### 7.6 Proxy'yi Systemd ile Kalıcı Yap (opsiyonel)

```bash
sudo tee /etc/systemd/system/openclaw-https-proxy.service << 'EOF'
[Unit]
Description=OpenClaw HTTPS Proxy (Tailscale)
After=network.target

[Service]
Type=simple
User=ayaz
ExecStart=/usr/bin/node /home/ayaz/openclaw-bridge/https-proxy.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-https-proxy
sudo systemctl status openclaw-https-proxy
```

### 7.7 Hata Hiyerarşisi (Uzak Erişim)

Bu hatalar sırayla çözülür — bir sonrakine geçmek için öncekini fix etmen gerekir:

```
Hata 1: "control UI requires device identity"
  → HTTPS kullanmıyorsun
  → Çözüm: https-proxy.mjs başlat, HTTPS URL kullan

Hata 2: "gateway token missing"
  → localStorage'da token yok
  → Çözüm: /init URL'ine git (7.3)

Hata 3: "too many failed authentication attempts"
  → Rate limit lockout
  → Çözüm: docker restart openclaw-gateway (7.5)

Hata 4: "pairing required"
  → Cihaz onaylı değil
  → Çözüm: devices list + devices approve (7.4)

✅ Health: OK → Bağlı, hazır
```

---

## Adım 8: Bridge'i Test Etmek

### 8.1 Control UI Chat Testi (yapıldı ✅)

Control UI üzerinden bridge agent'a mesaj gönderme testi başarıyla tamamlandı:

1. `main` agent primary modeli geçici olarak `bridge/bridge-model` yapıldı
2. `https://mainfedora.tailb1cc10.ts.net:18790/chat` üzerinden mesaj yazıldı
3. Claude Code yanıt verdi, conversation history çalıştı

**Sonuç:** OpenClaw Control UI → Bridge daemon → Claude Code pipeline çalışıyor.

### 8.2 Main Agent'ı Bridge'e Yönlendirme / Geri Alma

```bash
# Bridge'i PRIMARY yap (test için):
docker exec openclaw-gateway node -e "
const fs = require('fs'), p = '/home/node/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.agents.list.find(a=>a.id==='main').model = { primary: 'bridge/bridge-model' };
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log('Bridge primary set');
"
docker restart openclaw-gateway

# Minimax'a geri al (bridge fallback kalır):
docker exec openclaw-gateway node -e "
const fs = require('fs'), p = '/home/node/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
c.agents.list.find(a=>a.id==='main').model = {
  primary: 'minimax/MiniMax-M2.5',
  fallbacks: ['bridge/bridge-model']
};
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log('Minimax primary restored');
"
docker restart openclaw-gateway
```

### 8.3 WhatsApp Testi (henüz yapılmadı)

WhatsApp üzerinden bridge'e mesaj atmak için:
1. `main` agent'ın primary'sini bridge yap (8.2'deki ilk komut)
2. OpenClaw'a bağlı WhatsApp numarasından kendi numarana mesaj at
3. Yanıt 4 gelirse WhatsApp → OpenClaw → Bridge → Claude tam E2E çalışıyor

> **Not:** OpenClaw WhatsApp'a Baileys ile bağlı — waha/evolution/chatwoot gerekmez.

---

## Hızlı Sorun Giderme Karar Ağacı

```
Bridge çalışmıyor mu?
├── systemctl status → "failed"
│   ├── "Permission denied" on EnvironmentFile → /etc/sysconfig/'e taşı (Hata #3)
│   ├── "EADDRINUSE" → sudo fuser -k 9090/tcp (Hata #6)
│   └── "exit-code" → journalctl -u openclaw-bridge -n 20 → detaya bak
│
├── systemctl status → "active" ama curl yanıt vermiyor
│   ├── /health çalışıyor ama /v1/chat/completions asılı → spawn-per-message'a geç (Hata #1)
│   └── Hiçbiri çalışmıyor → curl -v http://localhost:9090/health ile bağlantı test et
│
├── Bridge çalışıyor, yanıt "Invalid API key"
│   └── ANTHROPIC_API_KEY placeholder process.env'de → delete env['ANTHROPIC_API_KEY'] (Hata #2)
│
├── Bridge çalışıyor, "spawn claude ENOENT"
│   └── CLAUDE_PATH tam yolu .env ve config.ts'e ekle (Hata #4)
│
├── OpenClaw bridge modeli görmüyor / kullanmıyor
│   ├── "api": "openai-compat" → "openai-completions" olmalı (Hata #7)
│   ├── "mode": "merge" eksik → ekle
│   └── "fallback" string → "fallbacks" array olmalı (Hata #8)
│
├── WhatsApp login calismiyormu?
│   ├── "web login provider is not available" veya "Unsupported channel"
│   │   └── channels.whatsapp.enabled: true config'e ekle (Hata #14)
│   └── QR kodu goruntuleniyor ama baglanti basarisiz
│       └── Baileys/WhatsApp Web uyumluluk sorunu olabilir
│
└── Uzak erişim (Tailscale) sorunları
    ├── "control UI requires device identity"
    │   └── HTTPS kullanmıyorsun → https-proxy.mjs başlat (Hata #10)
    ├── "gateway token missing"
    │   └── /init URL'ine git veya browser console'dan token set et (Hata #11)
    ├── "too many failed authentication attempts"
    │   └── docker restart openclaw-gateway (Hata #12)
    └── "pairing required"
        └── devices list → devices approve (Hata #13)
```

---

*Bu rehber `/home/USERNAME/openclaw-bridge/SETUP-GUIDE.md` olarak kaydedilmiştir.*
*Sistemdeki tüm `USERNAME` ifadelerini kendi kullanıcı adınla değiştir.*
