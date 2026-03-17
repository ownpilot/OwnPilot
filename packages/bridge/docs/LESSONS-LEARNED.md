# OpenClaw Bridge — Lessons Learned & Golden Paths

> Bu dosya projenin öğrettiği her şeyi distile eder.
> Agent veya insan: "Aynı şeyi sıfırdan yapmak zorunda kalsam ne bilmek isterdim?"
> sorusuna cevap verir.

---

## Hızlı Referans — En Kritik 5 Kural

```
1. CC --print stdin açıkken result vermez → her mesajda stdin.end() ZORUNLU
2. process.env'deki ANTHROPIC_API_KEY placeholder'ı her zaman delete et
3. Systemd EnvironmentFile → /etc/sysconfig/ altında sakla (SELinux)
4. spawn('claude') değil spawn('/tam/yol/claude') — systemd PATH minimal
5. StartLimitBurst/StartLimitIntervalSec → [Unit]'te, [Service]'te değil
```

---

## Golden Paths (Kanıtlanmış Çalışan Yollar)

### GP-1: Spawn-Per-Message CC Çağrısı

```typescript
// ✅ ÇALIŞAN PATTERN
const proc = spawn('/home/USERNAME/.local/bin/claude', [
  '--print',
  '--output-format', 'stream-json',
  '--verbose',                      // ZORUNLU
  '--input-format', 'stream-json',
  '--session-id', sessionUUID,
  '--dangerously-skip-permissions',
  '--model', 'claude-sonnet-4-6',
  '--allowedTools', 'Bash,Edit,Read,Write,Glob,Grep',
  '--add-dir', '/home/USERNAME/',
  '--max-budget-usd', '5',
], { env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'] });

proc.stdin!.write(JSON.stringify({
  type: 'user',
  message: { role: 'user', content: userMessage }
}) + '\n');
proc.stdin!.end(); // ← Bu olmadan result eventi ASLA GELMEZ
```

**Neden çalışır:** `stdin.end()` EOF sinyali gönderir, CC mesajı işler ve stream-json eventlerini çıkartır.

---

### GP-2: Güvenli Child Process Env Hazırlama

```typescript
// ✅ DOĞRU SIRALAMA
const env: Record<string, string> = {};
// 1. Tüm process.env kopyala
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined) env[k] = v;
}
// 2. Nested session rejection'ı önle
delete env['CLAUDECODE'];
// 3. Placeholder key'i MUTLAKA sil (.env'den gelmiş olabilir!)
delete env['ANTHROPIC_API_KEY'];
// 4. Gerçek key varsa ve placeholder değilse set et
if (apiKey && !apiKey.startsWith('sk-ant-placeholder')) {
  env['ANTHROPIC_API_KEY'] = apiKey;
}
// ANTHROPIC_API_KEY yoksa CC OAuth keyring kullanır — DOĞRU DAVRANIS
```

---

### GP-3: CC Stream Olaylarını Okuma

```typescript
// ✅ readline + for await PATTERN
const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity, terminal: false });
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let event: Record<string, unknown>;
  try { event = JSON.parse(trimmed); } catch { continue; }

  switch (event['type']) {
    case 'content_block_delta':    // Streaming text delta
    case 'message_delta':          // Token usage update
    case 'result':                 // ← Bu event = mesaj tamamlandı
    // result event'ten sonra CC exit eder → readline kapanır → loop biter
  }
}
```

---

### GP-4: Systemd Service Şablonu (Fedora/SELinux uyumlu)

```ini
[Unit]
Description=Servis Açıklaması
After=network.target
StartLimitBurst=5         # ← [Unit]'te olmalı!
StartLimitIntervalSec=60  # ← [Unit]'te olmalı!

[Service]
Type=simple
User=USERNAME
Group=USERNAME
WorkingDirectory=/home/USERNAME/proje
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/etc/sysconfig/servis-adi  # ← /home/'da değil /etc/sysconfig/'da!
StandardOutput=journal
StandardError=journal
SyslogIdentifier=servis-adi
# EKLEME: ProtectSystem, ProtectHome, PrivateTmp, NoNewPrivileges
# SELinux + bu direktifler çakışıyor

[Install]
WantedBy=multi-user.target
```

**Kurulum sırası:**
```bash
# 1. Önce env dosyasını /etc/sysconfig/'a taşı
sudo cp .env /etc/sysconfig/servis-adi
sudo chmod 640 /etc/sysconfig/servis-adi
sudo chown root:USERNAME /etc/sysconfig/servis-adi

# 2. Sonra service dosyasını kopyala
sudo cp systemd/servis.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now servis-adi
```

---

### GP-5: Docker Compose Host Erişimi

```yaml
# ✅ Container'dan host'a HTTP erişim
services:
  servis:
    extra_hosts:
      - "host.docker.internal:HOST_IP"
# HOST_IP = docker network inspect bridge | grep Gateway
```

```bash
# HOST_IP bulma
docker network inspect bridge | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d[0]['IPAM']['Config'][0]['Gateway'])
"
```

---

### GP-6: OpenClaw Custom Model Provider

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "my-provider": {
        "api": "openai-completions",
        "baseUrl": "http://host.docker.internal:PORT/v1",
        "apiKey": "SECRET_KEY"
      }
    }
  },
  "agents": {
    "list": [{
      "id": "my-agent",
      "model": {
        "primary": "my-provider/model-name",
        "fallbacks": ["other-provider/model"]
      },
      "active": true
    }]
  }
}
```

**Kritik:** `"mode": "merge"` olmadan tüm built-in provider'lar silinir.

---

### GP-7: Mesaj Serializasyonu (Promise Chain)

Aynı session'a eş zamanlı mesajlar için:

```typescript
// ✅ RACE CONDITION'SIZ PATTERN
interface Session {
  pendingChain: Promise<void>;  // Zincir
}

async *send(sessionId: string, message: string) {
  const session = sessions.get(sessionId)!;

  const prevChain = session.pendingChain;  // Önceki zinciri yakala
  let resolveMyChain!: () => void;
  const myChain = new Promise<void>(r => { resolveMyChain = r; });
  session.pendingChain = myChain;  // Güncelle (önceki kaydedildi)

  try {
    await prevChain;           // Öncekinin bitmesini bekle
    for await (const chunk of runProcess(message)) {
      yield chunk;             // Streaming — beklemek yok
    }
  } finally {
    resolveMyChain();          // Kuyruktaki sonrakini serbest bırak
  }
}
```

---

## Anti-Patterns (YAPMA)

### ❌ Long-lived CC Process

```typescript
// YANLIŞ — stdin açık → result eventi asla gelmez
const proc = spawn('claude', [...]);
// stdin'i açık bırakma! Her mesajda yeni process spawn et.
proc.stdin.write(message1);  // result gelmeyecek
proc.stdin.write(message2);  // result gelmeyecek
```

---

### ❌ ANTHROPIC_API_KEY'i Kontrol Etmeden Kullanmak

```typescript
// YANLIŞ
const env = { ...process.env };
// process.env'de 'sk-ant-placeholder' var! CC bu key'i alırsa OAuth kullanmaz.
spawn('claude', args, { env });

// DOĞRU
const env = { ...process.env };
delete env['ANTHROPIC_API_KEY'];  // Her zaman önce sil
if (realKey && !realKey.startsWith('sk-ant-placeholder')) {
  env['ANTHROPIC_API_KEY'] = realKey;
}
```

---

### ❌ spawn() Error Yakalamamak

```typescript
// YANLIŞ — ENOENT process'i crash ettirir
const proc = spawn('claude', args);
// proc.on('error') yok! Hata uncaught exception olur.

// DOĞRU
const proc = spawn(config.claudePath, args);
let spawnError: Error | null = null;
proc.on('error', err => { spawnError = err; });
// Sonra spawnError'ı kontrol et
```

---

### ❌ 'claude' Adıyla Spawn (Systemd'de)

```typescript
// YANLIŞ — systemd PATH'inde ~/.local/bin/ yok
spawn('claude', args);  // ENOENT

// DOĞRU
spawn('/home/USERNAME/.local/bin/claude', args);
// veya config'den:
spawn(process.env.CLAUDE_PATH!, args);
```

---

### ❌ EnvironmentFile'ı User Home'da Saklamak (Systemd)

```ini
# YANLIŞ — SELinux user_home_t bunu engeller
EnvironmentFile=/home/USERNAME/.env

# DOĞRU — etc_t context, systemd okuyabilir
EnvironmentFile=/etc/sysconfig/servis-adi
```

---

### ❌ OpenClaw'da Yanlış API Tipi

```json
// YANLIŞ — bu tip mevcut değil
{ "api": "openai-compat" }
{ "api": "openai" }
{ "api": "openai-compatible" }

// DOĞRU — kaynak koddan doğrulandı
{ "api": "openai-completions" }
```

---

### ❌ HTTP üzerinden Control UI'ya Uzak Erişim

```
# YANLIŞ — browser "secure context" hatası verir
http://100.75.115.68:18789  ← Tailscale IP, HTTP

# Hata: "control UI requires device identity (use HTTPS or localhost secure context)"

# DOĞRU — HTTPS + MagicDNS (GP-8)
https://mainfedora.tailb1cc10.ts.net:18790  ← Tailscale hostname, HTTPS proxy
```

**Neden:** WebCrypto API (device identity için private key işlemleri) yalnızca secure context'te (HTTPS veya localhost) çalışır.

---

### ❌ OpenClaw rate limit lockout'u beklemek

```
# Hata: "unauthorized: too many failed authentication attempts (retry later)"
# lockoutMs: 300000 = 5 dakika bekleme

# YANLIŞ: 5 dakika bekle
# DOĞRU: Container restart → in-memory rate limiter sıfırlanır

docker restart openclaw-gateway
```

---

### ❌ Device pairing'i CLI olmadan çözmeye çalışmak

```
# Hata: "pairing required" — token doğru ama cihaz onaylı değil
# YANLIŞ: UI'da bir şey aramak, config'i karıştırmak

# DOĞRU: CLI ile listele + approve (GP-10)
docker exec openclaw-gateway node /app/dist/index.js devices list --token TOKEN
docker exec openclaw-gateway node /app/dist/index.js devices approve REQUEST_ID --token TOKEN
```

---

### ❌ Security Hardening + SELinux Kombinasyonu

```ini
# YANLIŞ — Fedora SELinux ile çakışır
[Service]
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
NoNewPrivileges=yes
# Bu direktifler EnvironmentFile okumayı ve CC spawn'ı engelleyebilir
```

---

## Debugging Rehberi

### Control UI uzaktan erişim hatası hiyerarşisi

Hataları bu sırayla çöz — her biri öncekinin üstüne inşa edilir:

```
1. "control UI requires device identity (use HTTPS or localhost)"
   → HTTPS proxy yok veya HTTP URL kullanıyorsun
   → GP-8: https-proxy.mjs kur, tailscale cert al

2. "gateway token missing"
   → Browser localStorage'da token yok
   → /init URL'ine git (proxy üzerinden) VEYA console'dan GP-9'daki kodu çalıştır

3. "too many failed authentication attempts (retry later)"
   → Rate limit lockout (5 dakika)
   → docker restart openclaw-gateway → hemen çözülür

4. "pairing required"
   → Token doğru, cihaz onaylı değil
   → GP-10: devices list → devices approve

5. Health: OK, Chat: Connected ✅
   → Bitti
```

---

### "Bridge'e curl atıyorum, yanıt gelmiyor"

```bash
# 1. Servis durumu
systemctl status openclaw-bridge

# 2. Log kontrol
journalctl -u openclaw-bridge --no-pager -n 30

# 3. Health endpoint
curl -s http://localhost:9090/health

# 4. Basit ping testi
curl -s -X POST http://localhost:9090/v1/chat/completions \
  -H "Authorization: Bearer BRIDGE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"ping"}],"stream":false}' \
  --max-time 30
```

Log'da ne arıyorum:
- `Spawning Claude Code` görünüyor ama `Request completed` yok → stdin EOF sorunu (GP-1'e bak)
- `spawn claude ENOENT` → CLAUDE_PATH hatası (GP-4 + anti-pattern)
- `Failed to load environment files` → SELinux sorunu (GP-4)
- `Invalid API key` → ANTHROPIC_API_KEY poisoning (GP-2)

---

### CC Doğrudan Test (bridge bypass)

```bash
# Bridge olmadan CC'nin çalışıp çalışmadığını test et
unset CLAUDECODE
SESSION=$(python3 -c 'import uuid; print(uuid.uuid4())')

echo '{"type":"user","message":{"role":"user","content":"say: TEST_OK"}}' | \
  /home/USERNAME/.local/bin/claude \
    --print \
    --output-format stream-json \
    --verbose \
    --input-format stream-json \
    --session-id "$SESSION" \
    --dangerously-skip-permissions \
    --model claude-haiku-4-5-20251001 \
    --allowedTools "Read" 2>&1 | \
  python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        if d.get('type') == 'result':
            print('RESULT:', d.get('result', ''))
    except: pass
"
# Beklenen: RESULT: TEST_OK
```

---

### OpenClaw Bağlantı Testi

```bash
# Container içinden bridge'e erişim
docker exec openclaw-gateway curl -s http://host.docker.internal:9090/health

# Tam E2E testi
curl -s -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OPENCLAW_TOKEN" \
  -d '{"model":"bridge/bridge-model","messages":[{"role":"user","content":"ping"}],"stream":false}' \
  --max-time 60 | python3 -m json.tool
```

---

### GP-8: Tailscale HTTPS Proxy (Node.js, tek dosya)

Uzak cihazdan OpenClaw Control UI'ya erişim için. Browser "secure context" zorunluluğu nedeniyle HTTP üzerinden çalışmaz.

```bash
# 1. Tailscale cert al (hostname.tailXXXXX.ts.net formatında)
tailscale cert $(tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
# → hostname.crt ve hostname.key dosyaları oluşur

# 2. Proxy'yi başlat (aşağıdaki dosya içeriğiyle ~/https-proxy.mjs oluştur)
node ~/https-proxy.mjs &

# 3. Erişim
# https://HOSTNAME.tailXXXXX.ts.net:18790
```

**https-proxy.mjs içeriği:**
```javascript
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';

const HOSTNAME = 'mainfedora.tailb1cc10.ts.net'; // kendi hostname'in
const CERT = fs.readFileSync(`/home/ayaz/${HOSTNAME}.crt`);
const KEY  = fs.readFileSync(`/home/ayaz/${HOSTNAME}.key`);
const TARGET_PORT = 18789; // OpenClaw port
const LISTEN_PORT = 18790;

// Token init sayfası — ilk kez bu URL'e git, token otomatik set edilir
const GATEWAY_TOKEN = 'YOUR_GATEWAY_TOKEN_HERE';
const INIT_HTML = `<!DOCTYPE html><html><body><script>
  const s = JSON.parse(localStorage.getItem('openclaw.control.settings.v1') || '{}');
  s.gatewayUrl = 'wss://' + location.host;
  s.token = '${GATEWAY_TOKEN}';
  localStorage.setItem('openclaw.control.settings.v1', JSON.stringify(s));
  location.replace('/chat');
</script></body></html>`;

const server = https.createServer({ cert: CERT, key: KEY }, (req, res) => {
  if (req.url === '/init') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INIT_HTML);
    return;
  }
  const proxy = http.request(
    { hostname: '127.0.0.1', port: TARGET_PORT, path: req.url, method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` } },
    (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res, { end: true }); }
  );
  proxy.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
  req.pipe(proxy, { end: true });
});

server.on('upgrade', (req, socket, head) => {
  const conn = net.connect(TARGET_PORT, '127.0.0.1', () => {
    conn.write(`${req.method} ${req.url} HTTP/1.1\r\n` +
      Object.entries(req.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    conn.write(head);
    socket.pipe(conn); conn.pipe(socket);
  });
  conn.on('error', () => socket.destroy());
  socket.on('error', () => conn.destroy());
});

server.listen(LISTEN_PORT, '0.0.0.0', () =>
  console.log(`HTTPS proxy: https://${HOSTNAME}:${LISTEN_PORT}`));
```

---

### GP-9: OpenClaw Control UI Token Ayarlama (localStorage)

Control UI token'ı **browser'ın localStorage**'ında saklar. Her yeni origin (URL) için ayrı ayrı set edilmesi gerekir.

**localStorage key:** `openclaw.control.settings.v1`

**Yöntem A — /init sayfası (proxy üzerinden, önerilen):**
```
https://HOSTNAME:PORT/init
```
Bu URL'e bir kez gitmek yeterli. Token set edilir, /chat'e redirect olur.

**Yöntem B — Browser console (F12):**
```javascript
const s = JSON.parse(localStorage.getItem('openclaw.control.settings.v1') || '{}');
s.gatewayUrl = 'wss://' + location.host;
s.token = 'GATEWAY_TOKEN_BURAYA';
localStorage.setItem('openclaw.control.settings.v1', JSON.stringify(s));
location.reload();
```

**Gateway token nerede:** `~/.openclaw/openclaw.json` → `gateway.auth.token`

---

### GP-10: OpenClaw Device Pairing Flow (CLI ile)

Her yeni browser/cihaz ilk bağlantıda pairing approval gerektirir. Bu bir kerelik işlemdir.

```bash
# Adım 1: Pending request'leri listele
docker exec openclaw-gateway node /app/dist/index.js devices list \
  --token GATEWAY_TOKEN

# Çıktı örneği:
# Pending (1)
# │ 7c43d2d8-080c-45c7-9616-fc7073edb600 │ b7efe98... │ operator │

# Adım 2: Approve et (requestId'yi Pending tablosundan al)
docker exec openclaw-gateway node /app/dist/index.js devices approve \
  7c43d2d8-080c-45c7-9616-fc7073edb600 \
  --token GATEWAY_TOKEN

# Adım 3: Browser'da sayfayı yenile → bağlı olmalı (Health: OK)
```

**CLI için /root/.openclaw/openclaw.json gerekiyor:**
```bash
docker exec openclaw-gateway sh -c '
mkdir -p /root/.openclaw
cat > /root/.openclaw/openclaw.json << EOF
{
  "gateway": {
    "remote": {
      "token": "GATEWAY_TOKEN_BURAYA"
    }
  }
}
EOF'
```
Bu dosya olmadan CLI `--token` flag'ini almaz, her seferinde flag olarak verilmeli.

---

### GP-11: OpenClaw main Agent'ı Bridge'e Yönlendirme

Bridge'i test etmek veya varsayılan model olarak kullanmak için:

```bash
# Geçici: main agent'ı bridge'e yönlendir
docker exec openclaw-gateway node -e "
const fs = require('fs');
const p = '/home/node/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
const main = c.agents.list.find(a => a.id === 'main');
main.model = { primary: 'bridge/bridge-model' };
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('Done');
"
docker restart openclaw-gateway

# Test: Control UI chat'ten mesaj gönder, CC yanıt vermeli

# Geri al (minimax primary, bridge fallback):
docker exec openclaw-gateway node -e "
const fs = require('fs');
const p = '/home/node/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p,'utf8'));
const main = c.agents.list.find(a => a.id === 'main');
main.model = { primary: 'minimax/MiniMax-M2.5', fallbacks: ['bridge/bridge-model'] };
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('Reverted');
"
docker restart openclaw-gateway
```

---

### GP-12: OpenClaw Bundled Channel Plugin Enable (WhatsApp, Telegram, vb.)

OpenClaw'da bundled channel plugin'leri **varsayilan olarak disabled**. Sadece 3 plugin default enabled: `device-pair`, `phone-control`, `talk-voice`. Kanal plugin'lerini (WhatsApp, Discord, Telegram...) kullanmak icin explicit enable gerekiyor.

**Gateway config** (`/home/node/.openclaw/openclaw.json`):
```json
{
  "channels": {
    "whatsapp": {
      "enabled": true
    }
  }
}
```

**CLI config** (`/root/.openclaw/openclaw.json`) — ayni `channels` bolumu:
```json
{
  "channels": {
    "whatsapp": {
      "enabled": true
    }
  },
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "GATEWAY_TOKEN"
    },
    "remote": {
      "token": "GATEWAY_TOKEN"
    }
  }
}
```

**Enable sonrasi:** Gateway otomatik config change detection ile restart eder veya `docker restart openclaw-gateway` yap.

**Dogrulama:**
```bash
# CLI'dan login testi
docker exec openclaw-gateway node /app/dist/index.js channels login --channel whatsapp
# QR kodu goruntulenmeli
```

**Neden:** `resolveEffectiveEnableState()` → `isBundledChannelEnabledByChannelConfig(cfg, "whatsapp")` → `cfg.channels?.whatsapp?.enabled === true` kontrol eder. Bu alan olmadan plugin YUKLENMEZ ve registry bos kalir.

---

### Anti-Pattern: Bundled Channel Plugin'in Enable Edilmemesi

```json
// YANLIS — channels bolumu yok, WhatsApp plugin YUKLENMEZ
{
  "agents": { ... },
  "models": { ... },
  "gateway": { ... }
}
// Hata: "web login provider is not available" veya "Unsupported channel: whatsapp"

// DOGRU — channels.whatsapp.enabled: true ZORUNLU
{
  "channels": {
    "whatsapp": { "enabled": true }
  },
  "agents": { ... },
  "models": { ... },
  "gateway": { ... }
}
```

**Neden:** OpenClaw'da bundled plugin'ler (`/app/extensions/` altinda) varsayilan disabled.
`BUNDLED_ENABLED_BY_DEFAULT` sadece `device-pair`, `phone-control`, `talk-voice` iceriyor.
Diger tum kanal plugin'leri (whatsapp, telegram, discord, irc, slack, signal, googlechat, imessage) explicit enable gerektirir.

---

## Mimari Gelecek Adimları

Bu projede henüz yapılmayan ama önerilenen geliştirmeler:

| Özellik | Öncelik | Açıklama |
|---------|---------|----------|
| Rate limiting | 🟡 Orta | Per conversationId, örn. 10 req/min |
| Container isolation | 🟡 Orta | CC'yi ayrı container'da çalıştır |
| Input sanitization | 🔴 Yüksek | Prompt injection koruması |
| HTTP timeout | 🟡 Orta | CC 5dk timeout var ama HTTP'de yok |
| WhatsApp kanali | 🟡 Ertelendi | Baileys pairing basarisiz — alternatif: Telegram (en kolay), Waha, Evolution, Chatwoot |
| https-proxy.mjs systemd | 🟡 Orta | Kalıcı servis — reboot'ta ölüyor |
| WhatsApp media handling | 🟢 Düşük | Resim/dosya gönderme |
| Conversation export | 🟢 Düşük | Session history JSON export |
| Multi-user support | 🟢 Düşük | Her WhatsApp numarası ayrı session |

---

## Terminoloji Sözlüğü

| Terim | Açıklama |
|-------|----------|
| Bridge daemon | Bu projenin Fastify HTTP sunucusu |
| CC | Claude Code CLI — `claude` binary |
| spawn-per-message | Her HTTP mesajı için yeni CC process |
| stream-json | CC'nin `--output-format stream-json` çıktı formatı |
| session-id | UUID, CC disk history'si için — conversation continuity sağlar |
| pending chain | Promise zinciri ile mesaj serializasyonu |
| SELinux context | Fedora'da `user_home_t` vs `etc_t` ayrımı |
| ENOENT | "Error: No such file or directory" — spawn path hatası |
| chatCompletions | OpenClaw'ın OpenAI-compat endpoint'i |
| openai-completions | OpenClaw'da custom HTTP provider type adı |
| bundled plugin | `/app/extensions/` altindaki OpenClaw ile gelen plugin |
| BUNDLED_ENABLED_BY_DEFAULT | Varsayilan enabled bundled plugin'ler (device-pair, phone-control, talk-voice) |
| plugin registry | Channel/tool/provider plugin'lerinin register edildigi in-memory store |

---

*Son güncelleme: 2026-02-26*
*Dosya: `/home/ayaz/openclaw-bridge/docs/LESSONS-LEARNED.md`*
