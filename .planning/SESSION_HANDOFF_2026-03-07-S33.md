# Session Handoff S33 → S34

**Tarih:** 2026-03-07
**Onceki Session:** S32 (21 agent mimari revizyon), S33 (CC spawn ile Phase 1 implementation + mimari analiz)

---

## S33 Ozeti

S33'te iki is yapildi:

### 1. SOR Pipeline Phase 1 — CC Spawn ile Implementation (TAMAMLANDI)

Bridge uzerinden CC spawn edilerek 5 adimlik pipeline implement edildi:
- **schema.ts**: sor_queue tablo + PG trigger (2 commit: `1074ce2`, `d9880e8`)
- **voorinfra client.py**: upload_file_bytes() metodu (+142 satir)
- **sor-upload-cron.py**: Python cron script (313 satir, --dry-run destekli)
- **systemd timer**: user-level, 60s aralik, aktif calisiyor
- **Integration test**: Trigger test + dry-run E2E

### 2. CC Spawner Mimari Analizi (BU HANDOFF'UN KONUSU)

Bridge uzerinden CC spawn surecinde 3 kritik sorun tespit edildi.
**Sonraki session (S34) bu 3 sorunu fixleyecek.**

---

## Tespit Edilen 3 Bug + Fix Planlari

### BUG 1: resolveIntent() uzun prompt'lari yanlis siniflandiriyor (KRITIK)

**Belirtiler:**
- `spawn_cc` MCP veya `curl POST /v1/chat/completions` ile uzun prompt gonderildiginde bridge "No active session." donuyor
- CC spawn OLMUYOR — mesaj bridge-internal `/status` handler'ina gidiyor
- Kisa mesaj ("echo hello") sorunsuz spawn ediyor

**Kok Neden:**
- `intent-adapter.ts:resolveIntent()` regex pattern'leri TUM mesaj uzerinde calisiyor
- Prompt icindeki SQL `status TEXT DEFAULT 'pending'` cumlesindeki "status" kelimesi `/\bstatus\b(?! code)/` pattern'ina match ediyor
- Sonuc: intent = `/status` → bridge komutu olarak isleniyor → CC spawn edilmiyor

**Kanitlar:**
```
Bridge log:
[12:33:20] INFO: Intent resolved
    intentCommand: "/status"
    messagePreview: "# SOR Pipeline Orchestrator — GSD Execution\n\nSen bu projenin"
```

**Fix Lokasyonu:**
- Dosya: `~/openclaw-bridge/src/commands/intent-adapter.ts`
- Fonksiyon: `resolveIntent()` (satir ~50)
- LLM router'da (`llm-router.ts`) zaten bypass var: `MAX_MESSAGE_LENGTH = 80` ve `MAX_WORD_COUNT = 6`
- AYNI bypass `resolveIntent()`'e de eklenmeli

**Fix (3 satir):**
```typescript
export function resolveIntent(message: string): string | null {
  const normalized = normalize(message);
  if (!normalized) return null;

  // FIX: Long messages are CC tasks, not bridge commands
  // Mirrors llm-router.ts bypass (MAX_MESSAGE_LENGTH=80, MAX_WORD_COUNT=6)
  if (normalized.length > 80 || normalized.split(/\s+/).length > 6) return null;

  for (const { pattern, command } of COMMAND_INTENT_MAP) {
    if (pattern.test(normalized)) {
      return command;
    }
  }

  return null;
}
```

**Test:**
```typescript
// intent-adapter.test.ts
it('should return null for long CC task prompts', () => {
  const longPrompt = 'Implement SOR pipeline with status TEXT DEFAULT pending and CREATE TABLE sor_queue';
  expect(resolveIntent(longPrompt)).toBeNull();
});

it('should still resolve short status queries', () => {
  expect(resolveIntent('status')).toBe('/status');
  expect(resolveIntent('durum nedir')).toBe('/status');
});
```

**Etki:** Bu fix olmadan bridge uzerinden uzun prompt'lu CC spawn GUVENILMEZ.

---

### BUG 2: spawn_cc MCP tool senkron — uzun gorevlerde fetch failed

**Belirtiler:**
- `spawn_cc` MCP tool 1800000ms timeout ile cagirildiginda "fetch failed" donuyor
- CC arka planda calismaya DEVAM ediyor (bridge session "active")
- Orchestrator (bu chat) sonucu alamiyor, manuel polling gerekiyor

**Kok Neden:**
- MCP stdio transport'un kendi timeout'u spawn_cc'nin timeout parametresinden ONCE devreye giriyor
- spawn_cc senkron: cagir → CC bitene kadar bekle → sonuc don
- 10+ dakika suren CC gorevlerinde bu pattern kirilir

**Onerilen Fix — Async Spawn Pattern:**
```
spawn_cc_async(prompt) → { job_id, conversation_id }   (aninda doner)
poll_cc(job_id)        → { status: active|idle|error, result? }
get_cc_result(job_id)  → { content, tokens_used }
```

Implementasyon:
1. MCP tool `spawn_cc_async` ekle → bridge'e POST yapar, aninda `{job_id}` doner
2. MCP tool `poll_cc` ekle → bridge session API'yi sorgular
3. MCP tool `get_cc_result` ekle → idle olunca JSONL'den son assistant mesaji okur

**Dosyalar:**
- `~/openclaw-bridge/src/mcp-tools.ts` (veya MCP tool tanimlari neredeyse)
- Bridge routes.ts'e yeni endpoint gerekmeyebilir — mevcut session API yeterli

**Workaround (simdilik):**
- Kisa "hello" mesaji ile CC spawn et → conversation_id al
- Ayni conversation_id ile asil gorevi gonder
- Session API ile polling yap (60s aralik)
- CC idle olunca sonucu sor (ayni conv_id'ye yeni mesaj)

---

### BUG 3: GSD entegrasyonu CC spawn'da calismadi

**Belirtiler:**
- Prompt'a "GSD kullan" yazildi ama CC GSD'yi tamamen ignore etti
- `.planning/phases/` altinda yeni dizin olusturulmadi
- PROJECT.md olusturulmadi
- Sub-CC spawn edilmedi — tek CC tum isi yapti

**Kok Neden:**
- CC spawn'a GSD context inject ediliyor (router.ts satir 154: `getGSDContext()`), ama bu system prompt SON KULLANICIYA bagli — CC'nin GSD skill'lerini bilmesi lazim
- Bridge-spawned CC'ler `.claude/rules/` dosyalarini okuyor AMA GSD skill'leri ICIN `/gsd:*` komutlari bilmiyor olabilir
- Prompt'taki "GSD kullan" soyut — somut `/gsd:new-project` veya `/gsd:progress` komutu yok

**Onerilen Fix:**
1. GSD enforcement icin prompt template olustur:
```
ZORUNLU: Baslamadan once /gsd:progress calistir.
GSD yoksa /gsd:new-project ile olustur.
Her adim icin /gsd:plan-phase + /gsd:execute-phase kullan.
```
2. Bridge router'da `X-Force-GSD: true` header'i ile GSD system prompt'u ZORLA inject et
3. Alternatif: Bridge'in GSD trigger endpoint'ini (`POST /v1/projects/:projectDir/gsd`) kullan — bu zaten GSD context ile CC spawn ediyor

**Hizli Workaround (sonraki session'da test et):**
- `spawn_cc` yerine bridge GSD endpoint kullan:
```bash
curl -s -X POST "http://localhost:9090/v1/projects/${ENCODED}/gsd" \
  -H "Authorization: Bearer bridge-c751f34a5d6185ff40779fda57a6b6c5" \
  -H "Content-Type: application/json" \
  -d '{"message":"/gsd:execute-phase 10"}'
```

---

## Retroaktif GSD — SOR Pipeline

SOR pipeline isi GSD disinda yapildi. Retroaktif kayit:

### Mevcut Durum (commit'ler)
| Commit | Aciklama | Dosya |
|--------|----------|-------|
| `1074ce2` | sor_queue tablo + PG trigger | `packages/gateway/src/db/schema.ts` (+55 satir) |
| `d9880e8` | JID filter fix (metadata->jid) | `packages/gateway/src/db/schema.ts` (+1/-5 satir) |
| (uncommitted) | upload_file_bytes() | `~/projects/scrapling-workspace/tasks/voorinfra-api/api/client.py` (+142 satir) |
| (uncommitted) | cron script | `~/scripts/sor-upload-cron.py` (313 satir, yeni dosya) |
| (user service) | systemd timer | `~/.config/systemd/user/sor-upload.{timer,service}` |

### Kalici Olmayanlar (DIKKAT)
- schema.ts degisikligi `docker exec psql` ile dogrudan DB'ye uygulandi
- Docker image rebuild yapilMADI — container restart'ta schema kaybolur
- DB'deki SQL kalici (PG data volume), AMA yeni container = yeni image = eski schema.ts
- **Cozum:** Docker build + push + deploy gerekiyor

### Cron Script Hardcoded IP
- `sor-upload-cron.py` satir 55: `host=172.19.0.2` — Docker bridge IP
- Bu IP Docker restart'ta degisebilir
- **Cozum:** Environment variable veya `docker inspect` ile dinamik IP al

---

## Git State (S33 sonu)

### OwnPilot
- **Branch:** `fix/whatsapp-440-reconnect-loop`
- **HEAD:** `d9880e8` (fix(sor-pipeline): correct JID filter)
- **Uncommitted:** `.planning/` (untracked), `RESEARCH-whatsapp-media-retry.md` (untracked)
- **Fork:** `git@github.com:CyPack/OwnPilot.git` (remote: "fork")
- **Push durumu:** `d9880e8` PUSH EDILMEDI (fork remote'a)

### Bridge (openclaw-bridge)
- **Branch:** (varsayilan, muhtemelen main)
- **HEAD:** `0ecf1fb` (feat(opencode): add concurrent spawn limit)
- **Uncommitted:** `.planning/phases/10-..../fixture-output.json` (modified), 10+ untracked .planning/ dosyasi
- **Remote:** `git@github.com:CyPack/openclaw-bridge.git`

---

## Sistem Durumu (S33 sonu — CANLI KOMUT CIKTILARI)

| Bilesen | Durum | Kanit |
|---------|-------|-------|
| Bridge | UP | `{"pong":true,"timestamp":"2026-03-07T11:57:57.070Z"}` |
| OwnPilot container | UP | Port 8080, WhatsApp connected |
| OwnPilot DB | Healthy | sor_queue tablo VAR (docker exec psql ile olusturuldu) |
| systemd timer | AKTIF | `sor-upload.timer` her 60s'de bir calisiyor |
| OwnPilot sessions | 2 idle | `5225d723...` ve `chatcmpl-9b46...` |

---

## S34 Uygulama Plani (SADECE Bridge + GSD)

> Docker rebuild + cron IP fix AYRI handoff: `SESSION_HANDOFF_2026-03-07-S33-A-DOCKER.md`

### Oncelik 1: Bridge Fix — resolveIntent bypass (BUG 1)
```
Dosya: ~/openclaw-bridge/src/commands/intent-adapter.ts
Degisiklik: resolveIntent() basina length/word-count bypass ekle
Test: intent-adapter.test.ts (varsa ekle, yoksa olustur)
Verify: Uzun prompt ile spawn_cc → CC spawn olmali
Commit: fix(intent): bypass resolveIntent for long messages (>80 chars)
```

### Oncelik 2: spawn_cc async pattern (BUG 2)
```
Dosyalar: MCP tool tanimlari + bridge routes (gerekirse)
Degisiklik: spawn_cc_async + poll_cc + get_cc_result MCP tools
Test: Uzun gorevde spawn → poll → collect
Commit: feat(mcp): async CC spawn pattern (spawn/poll/collect)
```

### Oncelik 3: GSD enforcement (BUG 3)
```
Yaklasim: Bridge GSD endpoint ile test ET
Alternatif: X-Force-GSD header veya prompt template
Test: /gsd:progress ile GSD state olusturuldugunu dogrula
```

---

## Deferred (S29'dan + S32'den + S33 eklemeleri)

| Item | Oncelik | Not |
|------|---------|-----|
| Docker rebuild (sor-pipeline kalici) | HIGH | schema.ts image'a yansimali |
| Cron script hardcoded IP fix | HIGH | 172.19.0.2 → env var |
| voorinfra client.py git commit | MEDIUM | scrapling-workspace'te uncommitted |
| Restate OwnPilot entegrasyonu | GELECEK | SOR bittikten sonra |
| Backup scripti | MEDIUM | S30 plani gecerli |
| file_path migration | LOW | Buyuk refactor |
| UNIQUE(channel_id, external_id) | MEDIUM | Data audit gerekiyor |
| parseJsonBody BUG | LOW | curl workaround |
| Upstream PR #11 follow-up | LOW | Maintainer bekleniyor |
| jsOTDR native SOR parser | GELECEK | Phase 2 |
| Supabase analytical store | GELECEK | Phase 3 |
| Per-technician quality dashboard | GELECEK | Phase 3 |

---

## Bridge Mimari Referans (S34 icin)

### Dosya Haritasi (fix lokasyonlari)
```
~/openclaw-bridge/src/
  commands/
    intent-adapter.ts      ← BUG 1 FIX: resolveIntent() bypass
    llm-router.ts          ← Referans: MAX_MESSAGE_LENGTH=80 bypass zaten var
    command-metadata.ts    ← Referans: /status pattern'lari
    index.ts               ← tryInterceptCommand()
  router.ts                ← Akis: tryIntercept → resolveIntent → resolveLLMIntent → GSD → CC spawn
  claude-manager.ts        ← CC session yonetimi
  api/routes.ts            ← HTTP endpoints (MCP tool'lar buraya POST yapar)
  gsd-adapter.ts           ← GSD context injection
```

### Router.ts Akisi (satirlar)
```
104: tryInterceptCommand(userMessage) → slash command mi?
117: resolveIntent(userMessage) → regex pattern match (BUG 1 BURASI)
133: resolveLLMIntent(userMessage) → LLM fallback (bypass var, sorun yok)
154: getGSDContext(userMessage) → GSD system prompt injection
163: claudeManager.getOrCreate() → CC session spawn
```

### MCP Tool Tanimlari Nerede?
- Bridge MCP server: muhtemelen `~/openclaw-bridge/src/` icerisinde veya ayri bir MCP config'de
- `spawn_cc` MCP tool tanimitool registry'de: `mcp__bridge-local__spawn_cc`
- Yeni async tool'lar AYNI registry'ye eklenecek

### Bridge Credentials
- Auth: `Bearer bridge-c751f34a5d6185ff40779fda57a6b6c5`
- Port: 9090
- Health: `GET /ping`

---

## Arastirma Dosyalari (S33)

| Dosya | Icerik |
|-------|--------|
| Bu handoff | Bridge mimari analiz + 3 bug + fix planlari |
| `/tmp/sor-pipeline-orchestrator-prompt.txt` | CC'ye gonderilen prompt (referans) |
