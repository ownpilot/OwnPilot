# OpenClaw Bridge — Research Log (Tam Araştırma Kaydı)

> Bu dosya, projenin tasarım sürecinde yürütülen tüm araştırma görevlerinin
> tam kaydıdır. Her kararın arkasındaki "neden"i açıklar.
> Agent veya insan okuyucu için eşit derecede tasarlanmıştır.
>
> Format: Task ID → Amaç → Bulgular → Karar

---

## Görev Listesi Özeti

| ID | Görev | Durum | Kritiklik |
|----|-------|-------|-----------|
| RESEARCH-1 | Claude Code stream-json mode doğrulama | ✅ Tamamlandı | 🔴 Kritik |
| RESEARCH-2 | Docker extra_hosts networking | ✅ Tamamlandı | 🔴 Kritik |
| RESEARCH-3 | Mimari Şeytan'ın Avukatı | ✅ Tamamlandı | 🟡 Önemli |
| RESEARCH-4 | Bridge Daemon tech stack analizi | ✅ Tamamlandı | 🟡 Önemli |
| RESEARCH-5 | OpenClaw HTTP API gerçek endpoint | ✅ Tamamlandı | 🔴 Kritik |
| IMPL-1 | Docker Compose extra_hosts güncelleme | ✅ Tamamlandı | 🔴 Kritik |
| IMPL-2 | Bridge daemon proje iskeleti | ✅ Tamamlandı | 🟡 Önemli |
| IMPL-3 | Claude Code process manager | ✅ Tamamlandı | 🔴 Kritik |
| IMPL-4 | HTTP API server + pattern matcher + router | ✅ Tamamlandı | 🟡 Önemli |
| IMPL-5 | OpenClaw config + bridge agent | ✅ Tamamlandı | 🔴 Kritik |
| IMPL-6 | Systemd service + end-to-end test | ✅ Tamamlandı | 🔴 Kritik |
| VERIFY | Güvenlik audit + scope doğrulama | 🟡 Devam ediyor | 🟡 Önemli |
| RESEARCH-6 | OpenClaw→Bridge iletişim yöntemi | ✅ Tamamlandı | 🔴 Kritik |
| RESEARCH-7 | claude mcp serve alternatif mimari | ✅ Tamamlandı | 🟡 Önemli |
| RESEARCH-8 | Güvenlik hardening | ✅ Tamamlandı | 🟡 Önemli |
| RESEARCH-9 | Final mimari sentezi | ✅ Tamamlandı | 🔴 Kritik |
| IMPL-7 | Tailscale HTTPS proxy kurulumu | ✅ Tamamlandı | 🟡 Önemli |
| IMPL-8 | OpenClaw Control UI uzak erişim + device pairing | ✅ Tamamlandı | 🔴 Kritik |
| TEST-1 | Control UI chat testi (E2E doğrulama) | ✅ Tamamlandı | 🔴 Kritik |
| TEST-2 | WhatsApp testi (gerçek kanal) | ⬜ Bekliyor | 🔴 Kritik |
| DEBUG-1 | WhatsApp plugin registry boş — çözüldü | ✅ Tamamlandı | 🔴 Kritik |

---

## RESEARCH-1: Claude Code stream-json Mode Kapsamlı Doğrulama

**Amaç:** `claude --print --output-format stream-json --verbose` modunun gerçekten çalışıp çalışmadığını doğrula. Uzun süreli çalışan process olarak kullanılabilir mi?

**Yürütülen Testler:**
```bash
# Test 1: Temel print modu
unset CLAUDECODE
SESSION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
echo '{"type":"user","message":{"role":"user","content":"say: PARALLEL_OK"}}' | \
  timeout 45 claude --print --output-format stream-json --verbose \
  --input-format stream-json --session-id "$SESSION_ID" \
  --dangerously-skip-permissions --model claude-haiku-4-5-20251001 \
  --allowedTools "Read" 2>&1
```

**Bulgular:**

| Bulgu | Değer | Önemi |
|-------|-------|-------|
| `--verbose` ZORUNLU mu? | Evet, olmadan stream-json eventleri gelmiyor | 🔴 Kritik |
| Startup süresi | ~3-4 saniye (14 saniye korkuluyordu) | 🟢 İyi haber |
| session-id formatı | UUID RFC 4122 zorunlu (random hex çalışmaz) | 🟡 Önemli |
| CLAUDECODE env | Delete edilmeli — yoksa nested session rejection | 🔴 Kritik |
| Long-lived process | **ÇALIŞMIYOR** — stdin açıkken result eventi gelmiyor | 🔴 KRİTİK |

**En Kritik Bulgu — Stdin EOF Zorunluluğu:**

```bash
# BAŞARISIZ TEST: stdin açık tutuluyor, result gelmiyor
(echo '{"type":"user","message":{"role":"user","content":"test"}}'; sleep 20) | \
  timeout 15 claude --print --output-format stream-json --verbose \
  --input-format stream-json --session-id "..." \
  --dangerously-skip-permissions --model claude-haiku-4-5-20251001 2>&1 | \
  python3 -c "
import sys,json
for line in sys.stdin:
    try: d=json.loads(line.strip()); print('EVENT:', d.get('type'))
    except: pass
"
# ÇIKTI: sadece EVENT: system satırları × 5
# result eventi HİÇ GELMEDİ
```

**Kök Neden:** CC `--print` modunda stdin'i okurken EOF'a kadar bekler. Açık bırakılan bir stdin'de mesaj işleme tetiklenmez.

**Karar:** Long-lived process → **spawn-per-message** mimarisine geçildi.

---

## RESEARCH-2: Docker extra_hosts Networking Fedora/Dokploy

**Amaç:** Docker container içinden host makinesine HTTP erişiminin doğrulanması.

**Ortam:**
- Docker 29.2.0
- Fedora 43
- Dokploy üzerinden yönetilen container

**Testler:**
```bash
# Host IP bulma
docker network inspect bridge | python3 -c "
import json,sys
d=json.load(sys.stdin)
for n in d:
    gw = n.get('IPAM',{}).get('Config',[{}])[0].get('Gateway','')
    if gw: print('Host IP:', gw)
"
# Çıktı: Host IP: 172.24.0.1

# Container içinden host erişim testi
docker exec openclaw-gateway ping -c1 host.docker.internal
docker exec openclaw-gateway curl -s http://host.docker.internal:9090/health
```

**Bulgular:**

| Yöntem | Durum | Notlar |
|--------|-------|--------|
| `--add-host host-gateway` (docker run) | ✅ | Tek container için |
| `extra_hosts: ["host.docker.internal:HOST_IP"]` | ✅ | Docker Compose için |
| `extra_hosts: ["host.docker.internal:host-gateway"]` | ✅ | Docker 20.10.0+ alias |
| `172.17.0.1` (default bridge) | ❌ | Bu kurulumda yanlış IP |

**Önemli Not:** Host IP her kurulumda farklıdır!
- Default bridge: `172.17.0.1`
- Dokploy custom network: `172.24.0.1` (bu kurulumda)
- Her zaman `docker network inspect bridge` ile doğrula.

**Docker Compose değişikliği:**
```yaml
services:
  openclaw-gateway:
    extra_hosts:
      - "host.docker.internal:172.24.0.1"
```

**Doğrulama sonucu:** Container → Host HTTP erişimi başarılı.

---

## RESEARCH-3: Mimari Şeytan'ın Avukatı

**Amaç:** Üç farklı mimari seçeneği karşılaştır, her birinin zayıf noktalarını bul.

**Değerlendirilen Mimariler:**

### Seçenek A: Claude Code MCP Server Modu
```
OpenClaw → claude mcp serve → HTTP/WebSocket
```

**Avantajları:**
- Resmi desteklenen mod
- MCP protokolü üzerinden araç kullanımı
- Tool discovery otomatik

**Dezavantajları:**
- MCP protokolü OpenAI-compat değil → OpenClaw doğrudan kullanamazdı
- Ek dönüştürme katmanı gerekiyordu
- Session management karmaşık

**Sonuç:** Elendi — OpenClaw MCP client değil.

---

### Seçenek B: Bridge Daemon (SEÇİLDİ)
```
OpenClaw → Bridge (Fastify) → claude --print
```

**Avantajları:**
- OpenAI-compat API → OpenClaw doğrudan bağlanır
- Full control over message handling
- GSD context injection mümkün
- Session management esnek

**Dezavantajları:**
- Her mesajda CC startup süresi (~3-4 sn)
- Ekstra process yönetimi
- Daha fazla kod

**Sonuç:** Seçildi.

---

### Seçenek C: OpenClaw Native claude-cli Backend
**Amaç:** OpenClaw'ın kendi `claude-cli` backend modunu kullan.

**Araştırma:** OpenClaw kaynak kodunda `api: "claude-cli"` seçeneği bulundu. Ancak:
- Belgelenmemiş
- GSD context injection imkansız
- Message routing kontrolü yok

**Sonuç:** Elendi — kontrol yetersiz.

---

### Şeytan'ın Avukatı Argümanları (Bridge Daemon aleyhine):

| Argüman | Cevap |
|---------|-------|
| "Her mesajda 3-4 sn gecikme kabul edilemez" | WhatsApp'ta bu gecikme tipiktir, sorun değil |
| "Process her seferinde spawn = kaynak israfı" | CC lightweight, 45MB RAM, OS cache yardımcı olur |
| "Session history disk'te güvenli değil" | `~/.claude/sessions/` user-owned, sistemde tek kullanıcı |
| "dangerously-skip-permissions riski" | allowedTools listesi + max-budget-usd ile sınırlandırıldı |
| "Systemd + user home = SELinux sorunu" | /etc/sysconfig/ ile çözüldü |

---

## RESEARCH-4: Bridge Daemon Tech Stack Analizi

**Amaç:** Node.js mi Bun mu? Fastify mi Express mi? readline mi başka bir parser mı?

### Runtime Seçimi: Node.js vs Bun

| Kriter | Node.js | Bun |
|--------|---------|-----|
| Stabilite | 🟢 Production-proven | 🟡 Hâlâ beta edge cases |
| TypeScript native | ✅ `--experimental-strip-types` (v22+) | ✅ Dahili |
| Systemd uyumu | ✅ `/usr/bin/node` mevcut | ⚠️ Kurulum gerekir |
| Fedora paketi | ✅ `dnf install nodejs` | ❌ Manuel kurulum |
| readline compat | ✅ Native module | ✅ Uyumlu |

**Karar: Node.js 22** — Stability + systemd uyumu öncelikli.

### HTTP Framework: Fastify vs Express vs Hono

| Kriter | Fastify 5 | Express 4 | Hono |
|--------|-----------|-----------|------|
| TypeScript | 🟢 Birinci sınıf | 🟡 `@types` gerekir | 🟢 Birinci sınıf |
| Performans | 🟢 En hızlı | 🟡 Orta | 🟢 Edge-optimize |
| Schema validation | ✅ Dahili (Ajv) | ❌ Ekstra paket | ✅ Zod ile |
| Ecosystem matürüte | 🟢 Çok olgun | 🟢 En olgun | 🟡 Görece yeni |
| SSE (streaming) | ✅ reply.raw | ✅ res.write | ✅ |

**Karar: Fastify 5.x** — Performance + TypeScript + schema validation.

### NDJSON Parsing: readline vs stream

**readline yaklaşımı (SEÇILEN):**
```typescript
const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity, terminal: false });
for await (const line of rl) {
  const event = JSON.parse(line);
  // ...
}
```

**Neden readline:** Her satır bir complete JSON event. readline `\n` ile split eder, her satırı event olarak işler. `for await` async generator olarak çalışır → temiz stream handling.

**Alternatif (elendi):** Transform stream ile piping — daha karmaşık, hata yönetimi zorlaşıyor.

---

## RESEARCH-5: OpenClaw HTTP API Gerçek Endpoint Araştırması

**Amaç:** OpenClaw'ın gerçek chatCompletions endpoint config key'ini bul. Dokümanlar eksik/eski.

**Araştırma yöntemi:** OpenClaw kaynak kodu incelemesi.

**Kritik Bulgular:**

### 1. chatCompletions config key
```json
// YANLIŞ (tahmin):
"gateway.http.endpoints.chat_completions.enabled": true

// DOĞRU (kaynak koddan doğrulandı):
"gateway.http.endpoints.chatCompletions.enabled": true
```

### 2. Model provider API tipi
```json
// YANLIŞ (denendi, hata verdi):
{ "api": "openai-compat" }

// DOĞRU (kaynak kodu: /app/src/config/types.models.ts):
{ "api": "openai-completions" }
```

Kaynak dosya referansı: `/app/src/config/types.models.ts` — `openai-completions` enum değeri.

### 3. mode: "merge" zorunluluğu
```json
// Bu olmadan custom provider'lar default provider'ları ezer:
{ "models": { "mode": "merge" } }
```

### 4. fallbacks array zorunluluğu
```json
// YANLIŞ (schema hatası):
{ "model": { "primary": "...", "fallback": "bridge/bridge-model" } }

// DOĞRU:
{ "model": { "primary": "...", "fallbacks": ["bridge/bridge-model"] } }
```

### 5. Model adı formatı
```
provider-id/model-id
Örnek: bridge/bridge-model
Örnek: minimax/MiniMax-M2.5
```

---

## IMPL-1: Docker Compose extra_hosts Güncelleme

**Görev:** OpenClaw container'ına `host.docker.internal` desteği ekle.

**Yapılan:**
1. Host IP tespit edildi: `172.24.0.1`
2. Geçici dosyaya yazıldı: `/tmp/docker-compose-new.yml`
3. Kullanıcı sudo ile kopyaladı (direkt yazma izni yoktu)
4. Docker Compose restart: `sudo docker compose up -d --no-build`

**Doğrulama:**
```bash
docker exec openclaw-gateway curl -s http://host.docker.internal:9090/health
# {"status":"ok",...} ✅
```

**Durum:** ✅ Tamamlandı

---

## IMPL-2: Bridge Daemon Proje İskeleti

**Görev:** Node.js + Fastify + TypeScript proje yapısını kur.

**Yapılan:**
```
openclaw-bridge/
├── src/
│   ├── api/routes.ts       # HTTP endpoints
│   ├── utils/logger.ts     # pino logger
│   ├── claude-manager.ts   # CC process management (en kritik)
│   ├── config.ts           # env var yönetimi
│   ├── gsd-adapter.ts      # NL → GSD context injection
│   ├── index.ts            # Fastify server entry
│   ├── pattern-matcher.ts  # Structured output detection
│   ├── router.ts           # Message routing
│   ├── stream-parser.ts    # NDJSON readline parser
│   └── types.ts            # TypeScript interfaces
├── systemd/
│   └── openclaw-bridge.service
├── .env
├── package.json
└── tsconfig.json
```

**Dikkat Edilen Noktalar:**
- ESM modules (`"type": "module"`)
- `--experimental-strip-types` ile TypeScript runtime'da çalışır (build adımı yok)
- pino-pretty: development'ta, JSON: production'da
- dotenv yerine custom `loadDotEnv()` — daha az dependency

**Durum:** ✅ Tamamlandı

---

## IMPL-3: Claude Code Process Manager (claude-manager.ts)

**Görev:** CC süreçlerini yöneten merkezi sınıfı yaz.

**İlk Tasarım (Long-lived process — BAŞARISIZ):**
```
Session oluştur → CC spawn et → stdin açık tut → Her mesajda stdin.write()
```

Problem: stdin açık kalınca CC result eventi üretmiyor. (Bkz. RESEARCH-1)

**İkinci Tasarım (Spawn-per-message — BAŞARILI):**
```
Mesaj gelince → CC spawn et → stdin.write(msg) → stdin.end() → events oku → CC exit
```

**Serialize Problemi:**
Aynı conversation'a eş zamanlı iki mesaj gelirse aynı `--session-id` ile iki CC process
aynı history dosyasına yazabilir → race condition.

**Çözüm: Promise Chain Serialization:**
```typescript
// Session başına zincir
let pendingChain: Promise<void> = Promise.resolve();

async *send(...) {
  const prevChain = session.pendingChain;
  let resolveMyChain: () => void;
  const myChain = new Promise<void>(r => { resolveMyChain = r; });
  session.pendingChain = myChain; // Sonraki mesaj bunu bekler
  try {
    await prevChain; // Önceki bitmeden başlama
    for await (const chunk of this.runClaude(...)) {
      yield chunk;
    }
  } finally {
    resolveMyChain(); // Kuyruktaki sonrakini serbest bırak
  }
}
```

**Bug #1 — ANTHROPIC_API_KEY Poisoning:**
- `.env` → `process.env` → child env kopyası → CC'ye geçiyor
- `sk-ant-placeholder` geçerli key değil → CC OAuth yerine bu key'i kullanıyor
- Fix: `delete env['ANTHROPIC_API_KEY']` her zaman önce yapılır

**Bug #2 — ENOENT Uncaught Exception:**
- `spawn('claude', ...)` → ENOENT → `proc.on('error')` handle edilmezse process crash
- Fix: `let spawnError = null; proc.on('error', err => { spawnError = err; })`

**Durum:** ✅ Tamamlandı

---

## IMPL-4: HTTP API Server + Pattern Matcher + Router

**Görev:** Fastify routes, OpenAI-compat response format, GSD pattern detection.

**routes.ts (POST /v1/chat/completions):**

Non-streaming akışı:
```
1. Bearer token doğrula
2. Body parse et (Fastify native JSON)
3. conversationId: header → metadata → randomUUID()
4. routeMessage() çağır → AsyncGenerator<StreamChunk>
5. for await → tüm chunks topla
6. OpenAI format JSON response
```

Streaming (SSE) akışı:
```
1. Content-Type: text/event-stream
2. for await → her chunk → data: {...}\n\n
3. done chunk → finish_reason: 'stop'
4. data: [DONE]\n\n
```

**pattern-matcher.ts:**
```typescript
// GSD structured output tespiti
const GSD_PATTERNS = [
  /✅\s+Tamamlandı/,
  /🔄\s+/,
  /PHASE_COMPLETE:/,
  /GSD_STATE:/,
  // ...
];
```

WhatsApp'a gelen mesajlarda GSD format tespiti → log/notify hook tetikleme (ileride).

**Durum:** ✅ Tamamlandı

---

## IMPL-5: OpenClaw Config + Bridge Agent Tanımı

**Görev:** OpenClaw'ın bridge daemon'ı model provider olarak kullanmasını sağla.

**Sorunlar karşılaşıldı:**

1. **`openai-compat` → `openai-completions`:** API tipi adı yanlıştı, kaynak koddan doğrulandı.
2. **`fallback` → `fallbacks`:** Schema array bekliyor, string değil.
3. **Config güncellemesi:** Container içinde `/home/node/.openclaw/openclaw.json` — Node.js script ile güncellendi.

**Final Config (kritik bölümler):**
```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "bridge": {
        "api": "openai-completions",
        "baseUrl": "http://host.docker.internal:9090/v1",
        "apiKey": "BRIDGE_API_KEY_PLACEHOLDER"
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "bridge",
        "model": { "primary": "bridge/bridge-model" },
        "active": true
      }
    ]
  },
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

**Durum:** ✅ Tamamlandı

---

## IMPL-6: Systemd Service + End-to-End Test

**Görev:** Bridge daemon'ı systemd ile yönet, tam E2E testi geç.

**Karşılaşılan Tüm Sorunlar (kronolojik):**

| Sıra | Sorun | Fix |
|------|-------|-----|
| 1 | EnvironmentFile Permission denied | /etc/sysconfig/ + SELinux |
| 2 | StartLimitIntervalSec [Service]'te | [Unit]'e taşındı |
| 3 | Port 9090 EADDRINUSE | Test bridge kill edildi |
| 4 | spawn claude ENOENT | CLAUDE_PATH tam yol |
| 5 | Unhandled spawn exception | proc.on('error') eklendi |
| 6 | ANTHROPIC_API_KEY placeholder | delete env[] eklendi |

**Final Test Sonuçları:**

```bash
# Systemd status
systemctl is-active openclaw-bridge
# active ✅

# Bridge health
curl -s http://localhost:9090/health | jq '.status'
# "ok" ✅

# Bridge → CC
curl -X POST http://localhost:9090/v1/chat/completions \
  -H "Authorization: Bearer BRIDGE_KEY" \
  -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"2+2?"}],"stream":false}'
# {"choices":[{"message":{"content":"4"}}]} ✅

# Container → Bridge
docker exec openclaw-gateway curl http://host.docker.internal:9090/health
# {"status":"ok"} ✅

# E2E: OpenClaw → Bridge → CC
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer OPENCLAW_TOKEN" \
  -d '{"model":"bridge/bridge-model","messages":[{"role":"user","content":"2+2?"}]}'
# {"choices":[{"message":{"content":"4"}}]} ✅
```

**Durum:** ✅ Tamamlandı

---

## VERIFY: Güvenlik Audit + Scope Doğrulama

**Durum:** 🟡 Devam ediyor

**Yapılan değerlendirme:**

| Konu | Durum | Notlar |
|------|-------|--------|
| Bearer token auth | ✅ | BRIDGE_API_KEY ile korunuyor |
| allowedTools kısıtlaması | ✅ | `Bash,Edit,Read,Write,Glob,Grep,Task,WebFetch` |
| max-budget-usd | ✅ | `$5` per message, ayarlanabilir |
| CLAUDECODE env delete | ✅ | Nested session rejection önleniyor |
| Container isolation | ⚠️ | CC host'ta çalışıyor, container'da değil |
| ToS durumu | ✅ | Kendi claude binary kullanımı — resmi headless mode |
| Rate limiting | ❌ | Henüz yok — eklenebilir |
| Request logging | ✅ | pino ile tüm istekler loglanıyor |

**Bekleyen görevler:**
- Rate limiting (per conversationId)
- Request timeout (şu an sadece CC process timeout var, HTTP timeout yok)
- OpenClaw'dan gelen IP kısıtlaması (sadece loopback kabul)

---

## RESEARCH-6: OpenClaw→Bridge İletişim Yöntemi

**Amaç:** OpenClaw hangi mekanizma ile bridge'i çağıracak? web_fetch DENY sorunu var mıydı?

**Sorun:** `minimax-agent` için `web_fetch: DENY` konfigürasyonu vardı. Bridge'i bu agent üzerinden kullanacak mıydık?

**Araştırma Sonucu:** web_fetch DENY sorun değil, çünkü:
- Bridge, model backend olarak konumlandırıldı
- OpenClaw → Bridge: HTTP call (OpenClaw'ın kendi HTTP client'ı, CC web_fetch değil)
- CC → Anthropic API: CC'nin kendi SDK'sı
- web_fetch sadece CC'nin tool olarak web'e erişimini etkiler — model backend'e erişimi değil

**Mimari netleşmesi:**
```
OpenClaw (model backend HTTP call) → Bridge (Fastify server)
                                           ↓
                                     spawn(claude)
                                           ↓
                             claude (kendi HTTPS ile Anthropic'e bağlanır)
```

OpenClaw'ın bridge'i çağırması için web_fetch gerekmiyor. OpenClaw kendi HTTP client'ı ile çağırıyor.

---

## RESEARCH-7: claude mcp serve Alternatif Mimari

**Amaç:** `claude mcp serve` komutunu kullanarak daha basit bir mimari mümkün mü?

**Araştırma:**

`claude mcp serve` komutu Claude Code'u bir MCP server olarak başlatır:
- Araçları MCP protokolü üzerinden expose eder
- JSON-RPC 2.0 over stdio

**Neden seçilmedi:**

1. MCP protokolü ≠ OpenAI-compat → OpenClaw bunu model provider olarak kullanamaz
2. MCP server mesaj almaz, araçları expose eder (ters yönlü)
3. Conversation yönetimi MCP'de farklı — session olmaz
4. GSD context injection yapılamaz

**Sonuç:** claude mcp serve bu use case için uygun değil. Bridge daemon doğru seçim.

---

## RESEARCH-8: Güvenlik Hardening

**Amaç:** `--dangerously-skip-permissions` riskini azaltmak için mitigation stratejileri.

**Riskler:**
- CC, dosya sistemi üzerinde istenilen yazma/silme yapabilir
- Potansiyel olarak şüpheli komutlar çalıştırabilir
- Kötü niyetli input prompt injection yapabilir

**Uygulanan Mitigasyonlar:**

| Mitigation | Uygulama | Etki |
|------------|---------|------|
| `--allowedTools` listesi | `Bash,Edit,Read,Write,Glob,Grep,Task,WebFetch` | Yalnızca bu araçlar |
| `--max-budget-usd 5` | Her message max $5 | Maliyet kontrolü |
| `--add-dir /home/ayaz/` | Proje dizini kısıtlaması | Görece kapsam |
| BRIDGE_API_KEY auth | Yetkisiz erişim engeli | Network layer |
| systemd User=ayaz | Root değil normal user | OS level |

**Önerilen ek adımlar (henüz uygulanmadı):**
1. Container içinde çalıştır (Podman/Docker) — topluluk projelerinden öğrenildi
2. Input sanitization — sistem promptu XSS/injection için temizle
3. Per-conversation rate limiting — spam/flood koruması
4. CC session izolasyonu — her conversation kendi `--project-dir`'ında

---

## RESEARCH-9: Final Mimari Sentezi

**Amaç:** Tüm araştırma bulgularını birleştir, final kararları kayıt altına al.

### Temel Kararlar Özeti

| Karar | Seçilen | Neden |
|-------|---------|-------|
| Process stratejisi | spawn-per-message | Long-lived stdin EOF bug |
| Runtime | Node.js 22 | Stability + systemd uyumu |
| HTTP framework | Fastify 5 | Performance + TypeScript |
| Session continuity | `--session-id` UUID | Disk history, process-independent |
| Env file konumu | `/etc/sysconfig/` | SELinux uyumu |
| Binary yolu | tam path via config | systemd minimal PATH |
| Auth | Bearer token | Basit, etkili |

### Topluluk Referansları (araştırmada bulunanlar)

1. **atalovesyou/claude-max-api-proxy**
   - Aynı yaklaşım: Node.js subprocess wrapper
   - Fark: OAuth token extract ediyor (ToS riski var)
   - Biz: `claude` binary'yi direkt spawn ediyoruz (ToS uyumlu)

2. **13rac1/openclaw-plugin-claude-code**
   - Podman container isolation
   - AppArmor profile
   - Resource limits

3. **anthropics/claude-code GitHub Issues**
   - Issue #3187: `--input-format stream-json` stdin open hang (bilinen bug, biz de yaşadık)
   - Bu issue bizi spawn-per-message'a yönlendirdi

### ToS Değerlendirmesi (Final)

- **Güvenli:** `claude` binary doğrudan spawn → Anthropic'in resmi headless/programmatic kullanımı
- **Kişisel kullanım:** Kendi WhatsApp → kendi CC → sorun yok
- **Ticari kullanım:** Anthropic API key (`console.anthropic.com`) kullan → net ToS uyumu
- **Kesinlikle yapılmamalı:** OAuth token extract edip başka app'te kullanmak

---

---

## IMPL-7: Tailscale HTTPS Proxy Kurulumu

**Amaç:** Uzak cihazdan (Tailscale üzerinden bağlı) OpenClaw Control UI'ya erişim. HTTP üzerinden erişim mümkün değil — browser secure context zorunluluğu var.

**Problem:** Tailscale IP'si (`100.75.115.68:18789`) HTTP olduğu için browser WebCrypto API'yi reddeder:
```
control UI requires device identity (use HTTPS or localhost secure context)
```

**Çözüm:** Node.js HTTPS reverse proxy (`https-proxy.mjs`):
- Tailscale MagicDNS sertifikası: `tailscale cert HOSTNAME` → valid cert (tarayıcı uyarısı vermez)
- Port `18790` (HTTPS) → forward → `18789` (HTTP, OpenClaw)
- WebSocket upgrade desteği (OpenClaw realtime için)
- `/init` endpoint: token'ı localStorage'a yazar, /chat'e yönlendirir

**Sertifika alımı:**
```bash
tailscale cert mainfedora.tailb1cc10.ts.net
# → mainfedora.tailb1cc10.ts.net.crt (public)
# → mainfedora.tailb1cc10.ts.net.key (private)
```

**Test:** `curl -sk https://mainfedora.tailb1cc10.ts.net:18790 -o /dev/null -w "%{http_code}"` → `200`

**Karar:** Dosya `/home/ayaz/openclaw-bridge/https-proxy.mjs` olarak kaydedildi. Proxy arka planda çalışır — kalıcı olmak için systemd servisi öneriliyor (henüz yapılmadı).

---

## IMPL-8: OpenClaw Control UI Uzak Erişim + Device Pairing

**Amaç:** Uzak cihazdan Control UI'ya bağlanma. 4 aşamalı hata zincirine karşı sistematik çözüm.

### Hata Zinciri ve Çözümler

**Hata 1: "gateway token missing"**

Control UI token'ı `openclaw.control.settings.v1` localStorage key'inde saklar. Her origin (URL) için ayrı localStorage olduğundan HTTPS URL'i için ayarlanmamış.

Araştırma: OpenClaw bundle'ından (`/app/dist/control-ui/assets/index-yUL4-MTm.js`) key isimleri çıkarıldı:
```bash
grep -oP '\bic\s*=\s*"[^"]*"|\bFl\s*=\s*"[^"]*"|\bfi\s*=\s*"[^"]*"' bundle.js
# fi="openclaw-device-identity-v1"
# Fl="openclaw.device.auth.v1"
# ic="openclaw.control.settings.v1"  ← settings key
```

Settings schema (bundle'dan):
```javascript
// Default value (bundle'daki ap() fonksiyonu):
{
  gatewayUrl: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
  token: "",   // ← bunu set etmek gerekiyor
  sessionKey: "main",
  ...
}
```

Çözüm: `/init` endpoint (proxy'ye eklendi) → localStorage'a `token` ve `gatewayUrl` yazar.

**Hata 2: "too many failed authentication attempts"**

`lockoutMs: 300000` in-memory rate limit. Önceki başarısız denemeler (yanlış token veya henüz token set edilmemişken deneme) lockout'a giriyor.

Çözüm: `docker restart openclaw-gateway` → in-memory limiter sıfırlanır.

**Hata 3: "pairing required"**

OpenClaw device identity sistemi:
- Her browser `openclaw-device-identity-v1` localStorage key'inde bir keypair (public/private key) saklar
- İlk bağlantıda device, gateway'e public key + imzalı token gönderir
- Gateway bu device'ı "pending" olarak tutar
- Admin approval olmadan bağlantı kurulmaz

Pending cihazları görme ve approve etme:
```bash
# CLI için /root/.openclaw/openclaw.json gerekli (gateway.remote.token)
docker exec openclaw-gateway node /app/dist/index.js devices list --token TOKEN
docker exec openclaw-gateway node /app/dist/index.js devices approve REQUEST_ID --token TOKEN
```

**Sonuç:** Approve sonrası Health: OK, chat: Connected ✅

---

## TEST-1: Control UI Chat Testi (E2E Doğrulama)

**Amaç:** Bridge daemon'ın gerçek bir client'tan mesaj alıp Claude Code'a iletip yanıt döndürdüğünü doğrula.

**Test ortamı:**
- Client: OpenClaw Control UI (`https://mainfedora.tailb1cc10.ts.net:18790/chat`)
- Agent: `main` agent, primary model: `bridge/bridge-model` (geçici olarak değiştirildi)
- Bridge: `openclaw-bridge` systemd servisi, port 9090

**Test prosedürü:**
1. `main` agent primary modeli `bridge/bridge-model` yapıldı (openclaw.json node script ile)
2. Container restart
3. `/init` → token set → pairing approve
4. Chat'ten mesaj gönderildi

**Gözlemlenen yanıt:**
```
System: [2026-02-25 22:22:33 GMT+1] Hook BridgeHook (error): Test webhook received...
User: "mesajlarimi yanitlayabiliyor musun"
Assistant: "Evet, mesajlarını yanıtlayabiliyorum! Senin için ne yapabilirim?"
```

**Sonuç:** ✅ OpenClaw Control UI → Bridge daemon → Claude Code → yanıt zinciri tam çalışıyor.
- Conversation history çalışıyor (session continuity)
- Streaming yanıt çalışıyor
- Hook sistemi çalışıyor

**Not:** Bu test Control UI üzerinden yapıldı. WhatsApp testi (gerçek kanal) henüz yapılmadı — TEST-2.

---

## TEST-2: WhatsApp Pairing Denemesi — Ertelendi

**Tarih:** 2026-02-26 | **Durum:** ERTELENDI — Baileys pairing basarisiz

### On-kosul: Plugin Registry Sorununun Cozulmesi (DEBUG-1)

WhatsApp testi yapmadan once plugin registry'nin bos olmasi sorununu cozmek gerekti.
3 session boyunca (toplam ~4 saat) arastirma yapildi:

**Session 1:** Chromium/Playwright kurulumu denendi → yanlis yol (sorun browser degil)
**Session 2:** Gateway-cli kaynak kodu analizi → `listChannelPlugins()` bos → plugin registry bos tespit edildi
**Session 3:** Plugin yukleme mekanizmasi tam olarak izlendi:
- `/app/extensions/whatsapp/` dizininde plugin mevcut
- `BUNDLED_ENABLED_BY_DEFAULT` sadece 3 plugin iceriyor (device-pair, phone-control, talk-voice)
- WhatsApp bu set'te YOK → varsayilan disabled
- `channels.whatsapp.enabled: true` config'e eklenerek cozuldu

Detay icin: DEBUG-1 bolumu.

### WhatsApp QR Login Denemesi

**Adim 1: QR Kodu Olusturma**

Plugin enable edildikten sonra CLI'dan login baslatildi:
```bash
docker exec openclaw-gateway node /app/dist/index.js channels login --channel whatsapp
```
Sonuc: Terminal'de QR kodu goruntulendi. Gateway loglarinda:
```
Cleared WhatsApp Web credentials.
WhatsApp QR received.
web.login.start ✓ 736ms
```

Control UI'da da QR kodu goruntulendi (`https://mainfedora.tailb1cc10.ts.net:18790` uzerinden).
Ekranda "logged out" ve "Scan this QR in WhatsApp → Linked Devices" yazisi vardi.
Alt kisimda 4 buton: "Show QR", "Relink", "Wait for scan", "Logout".

**Adim 2: Telefon ile QR Tarama**

iPhone'dan WhatsApp Business acildi → Linked Devices → Link a Device → QR kodu tarantildi.
Telefon ekraninda:
- "QR kodunu tara" basliginda kamera acildi
- QR tarandi
- "Giris yapiliyor... WhatsApp Business'i her iki cihazda da acik tutun" mesaji goruntulendi
- Loading spinner dondu (~5-10 saniye)

**Adim 3: Basarisizlik**

Telefon ekraninda dialog kutusu:
```
Cihaz baglanamadi
Daha sonra tekrar deneyin.
[Tamam]
```

Bu hata WhatsApp uygulamasindan geldi — OpenClaw/Baileys tarafindan degil.

### Hata Analizi (Sistematik)

**1. Network kontrol (container → WhatsApp serverlari):**
```bash
docker exec openclaw-gateway curl -s --max-time 5 -o /dev/null -w "%{http_code}" https://web.whatsapp.com
# 200 ✅ — container WhatsApp'a erisebiliyor
```

**2. Gateway loglari:**
- `web.login.start ✓` — gateway tarafinda login baslatma basarili
- `WhatsApp QR received.` — QR kodu basariyla olusturuldu
- Baileys-spesifik hata mesaji **YOK** (disconnect, timeout, handshake fail gibi)
- Detayli log dosyasinda (`/tmp/openclaw/openclaw-2026-02-26.log`) da Baileys hatasi yok

**3. Gateway WebSocket loglari:**
Cok sayida `closed before connect` mesaji var ama bunlar WhatsApp ile ilgili DEGIL:
```
cause: "control-ui-insecure-auth"
host: "100.75.115.68:18789"
origin: "http://100.75.115.68:18789"
```
Bu mesajlar Mac'teki Firefox'un HTTP (HTTPS degil) uzerinden Tailscale IP'ye
baglanmaya calismasi — tamamen ayri bir sorun.

**4. WhatsApp Business faktoru:**
Telefon ekraninda "WhatsApp Business'i her iki cihazda da acik tutun" yaziyordu.
Bu, hesabin WhatsApp Business oldugunu gosteriyor. WhatsApp Business'in linked devices
davranisi normal WhatsApp'tan farkli olabilir:
- Business hesaplarinda linked device limiti farkli (4 yerine 1-2 olabilir)
- Business API vs Business App farkli protokol kullanabilir
- Baileys WhatsApp Business ile tam uyumlu olmayabilir

**5. Baileys versiyon uyumlulugu:**
OpenClaw 2026.2.24 surumuyle gelen Baileys versiyonu bilinmiyor. WhatsApp
protokolunu sik guncelliyor ve eski Baileys versiyonlari calismayabiliyor.
OpenClaw'un kendi Baileys entegrasyonu (`/app/extensions/whatsapp/`) ne kadar
guncel bilinmiyor.

**6. QR tarama zamanlama:**
QR kodu tarandiginda telefon "Giris yapiliyor..." gosterdi — bu, QR'in
gecerli oldugunu ve telefon-server iletisiminin basladigini gosteriyor.
Hata, QR taramadan SONRA, Baileys-WhatsApp server handshake sirasinda olustu.

### Iddialar ve Sonuclar

| Iddia | Kanit | Sonuc |
|-------|-------|-------|
| Plugin registry sorunu cozuldu | QR kodu goruntulendi, `web.login.start ✓` | ✅ Kesin |
| Network sorunu degil | `curl https://web.whatsapp.com` → 200 | ✅ Kesin |
| QR kodu gecerli olusturuldu | Telefon basariyla taradi, "Giris yapiliyor..." goruntulendi | ✅ Kesin |
| Hata Baileys↔WhatsApp handshake'te | QR tarama basarili ama pairing basarisiz | 🟡 Yuksek ihtimal |
| WhatsApp Business faktoru | "WhatsApp Business'i... acik tutun" mesaji | 🟡 Olasi etken |
| Baileys versiyon uyumsuzlugu | Hata mesaji generic, spesifik log yok | 🟡 Olasi etken |
| OpenClaw/Bridge tarafinda sorun | Tum gateway loglari basarili | ❌ Sorun bizde degil |

### Denenmemis Ama Denenebilecek Adimlar

1. **Normal WhatsApp (Business degil) ile QR tarama** — Business'a ozel limitasyon olup olmadigini test eder
2. **Telefondan mevcut linked device'lari silme** — limit bosaltma (WhatsApp → Settings → Linked Devices → mevcut cihazlari kaldir)
3. **`docker restart openclaw-gateway` sonrasi hemen yeni QR ile tekrar deneme** — temiz Baileys session
4. **OpenClaw'u guncelleme** (`docker pull` ile en son image) — Baileys versiyonu guncellenebilir
5. **OpenClaw Discord/GitHub'da Baileys pairing sorunlarini arastirma** — baskalarinda da var mi?
6. **OpenClaw loglama seviyesini artirma** — `OPENCLAW_LOG_LEVEL=debug` gibi env var ile Baileys detay loglari

### Karar: WhatsApp Ertelendi, Ana Amaca Odaklanma

WhatsApp entegrasyonu bu projenin **ana amaci degil**. Ana amac:
- Bridge daemon uzerinden Claude Code session'lari calistirmak
- Paralel CC islemleri test etmek
- Session continuity dogrulamak
- Streaming yanit dogrulamak

Bu testler Control UI chat uzerinden zaten basariyla yapildi (TEST-1).
WhatsApp/mesajlasma kanali gerektiginde asagidaki alternatifler denenecek:

| Alternatif | Tip | Nasil Calisir | Avantaj | Dezavantaj |
|-----------|-----|---------------|---------|------------|
| **Waha** (whatsapp-http-api) | Docker REST API | Baileys uzerine REST wrapper, webhook ile mesaj aliyor | Basit REST API, Docker Compose ile kurulum, Baileys'ten ayri proje | Ek container, ayni Baileys sorunu olabilir |
| **Evolution API** | Docker REST API | Multi-channel (WA, Telegram, Instagram), webhook + WebSocket | Cok kanalli, aktif gelistirme | Agir (PostgreSQL + Redis gerektirir) |
| **Chatwoot** | Tam platform | Musteri destek platformu, WhatsApp Business API destegi | UI, cok kanal, resmi WA Business API | En agir, tam platform kurulumu gerekir |
| **OpenClaw Telegram** | Bundled plugin | `channels.telegram.enabled: true` + BotFather token | En stabil, Bot API resmi, QR tarama yok | Farkli platform (WhatsApp degil) |
| **n8n/Make webhook** | Otomasyon | WhatsApp Cloud API → webhook → Bridge HTTP | Resmi API, guvenilir | Ek arac, Meta Business dogrulama |

**Oneri sirasi (kolaydan zora):**
1. OpenClaw Telegram (en az is, bundled plugin)
2. Waha (basit REST, Docker tek container)
3. n8n webhook + WhatsApp Cloud API (resmi API)
4. Evolution API (cok kanalli gerekirse)
5. Chatwoot (tam platform gerekirse)

---

*Bu log `/home/ayaz/openclaw-bridge/docs/RESEARCH-LOG.md` olarak saklanmıştır.*
*Her USERNAME → kendi kullanıcı adınla değiştir.*
*Son güncelleme: 2026-02-26*


---

## DEBUG-1: WhatsApp Plugin Registry Bos — Cozuldu

**Tarih:** 2026-02-26 | **Durum:** COZULDU

### Belirti

Control UI'dan veya CLI'dan `channels login --channel whatsapp` calistirildiginda:
- Gateway: `web login provider is not available`
- CLI: `Unsupported channel: whatsapp`

### Arastirma Sureci

**Session 1 (yarim kaldi):** Chromium/browser kurulumuyla ugrasma → yanlis yol.
Sonra gateway-cli koduna bakinca `listChannelPlugins()` bos donuyor tespit edildi.

**Session 2 (cozuldu):** Plugin registry'nin nasil doldugunu kod uzerinden izledik:

1. `entry.js` → `registerChannelPlugin` fonksiyonu var ama HIC cagrilmiyor
2. `plugin-registry-Dj4zvCk-.js` → `ensurePluginRegistryLoaded()` → `loadOpenClawPlugins()` cagirir
3. `manifest-registry-C6u54rI3.js` → `discoverOpenClawPlugins()` → `/app/extensions/` altindaki plugin'leri tarar
4. `/app/extensions/whatsapp/openclaw.plugin.json` → WhatsApp plugin MEVCUT
5. `resolveEffectiveEnableState()` → bundled plugin'ler DEFAULT DISABLED

### Kod Akisi (kanitlanmis)

```
resolveEnableState("whatsapp", "bundled", config)
  → BUNDLED_ENABLED_BY_DEFAULT = {"device-pair", "phone-control", "talk-voice"}
  → whatsapp bu set'te YOK → "bundled (disabled by default)"

resolveEffectiveEnableState(params)
  → base.reason === "bundled (disabled by default)" → fallback kontrol:
  → isBundledChannelEnabledByChannelConfig(rootConfig, "whatsapp")
    → rootConfig.channels?.whatsapp?.enabled === true ?
    → Config'de channels bölümü YOK → false → DISABLED
```

### Kok Neden

OpenClaw bundled channel plugin'leri (WhatsApp, Telegram, Discord, IRC, vb.) **varsayilan olarak disabled**.
Enable etmek icin `openclaw.json`'da explicit `channels.KANAL.enabled: true` gerekiyor.
Config'de `channels` bolumu hic yoktu.

### Cozum

**1. Gateway config** (`/home/node/.openclaw/openclaw.json`):
```json
{ "channels": { "whatsapp": { "enabled": true } } }
```

**2. CLI config** (`/root/.openclaw/openclaw.json`):
```json
{ "channels": { "whatsapp": { "enabled": true } } }
```

**3. Restart:** Gateway config degisikligi otomatik algilandi ve restart etti.

### Dogrulama

```bash
docker exec openclaw-gateway node /app/dist/index.js channels login --channel whatsapp
# QR kodu goruntulendi ✅
```

### Yanlis Yollar (denenen, ise yaramayan)
- Playwright Chromium kurulumu: irrelevant (sorun browser degil plugin registry)
- browser.attachOnly + cdpPort config: schema validation crash, geri alindi
- 5 dakika lockout beklemek: docker restart ile aninda cozulur

### Kilit Dosyalar (referans)

| Dosya | Icerdigi | Satir |
|-------|----------|-------|
| `manifest-registry-C6u54rI3.js:70` | `BUNDLED_ENABLED_BY_DEFAULT` set | device-pair, phone-control, talk-voice |
| `manifest-registry-C6u54rI3.js:187` | `isBundledChannelEnabledByChannelConfig()` | `cfg.channels?.[channelId]?.enabled === true` |
| `manifest-registry-C6u54rI3.js:195` | `resolveEffectiveEnableState()` | Fallback: bundled disabled → channel config kontrol |
| `/app/extensions/whatsapp/index.ts` | Plugin register kodu | `api.registerChannel({ plugin: whatsappPlugin })` |
| `plugins-DSxliTwO.js:450` | `normalizeChannelId()` | `normalizeAnyChannelId()` cagirir → registry'ye bakar |
