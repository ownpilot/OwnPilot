# Session Handoff S32 → S33

**Tarih:** 2026-03-07
**Onceki Session:** S30/S31 (SOR/voorinfra mimari arastirma + OwnPilot engine derinlemesi)
**S32:** 21 specialist agent + 4 wave ile tam mimari revizyon — S31 plani REVIZE edildi

---

## S32 Ozeti

S32'de kod yazilmadi. **21 specialist agent** (4 wave, ~2M token) ile S31 planindaki her karari kaynak koddan dogruladi ve kritik hatalar tespit etti. S31'in "Queue Pattern + DAG Workflow + Custom Data" plani **TAMAMEN REVIZE** edildi.

### Wave 1 — 8 Agent (OwnPilot Internals + Alternativeler)

| Agent | Bulgu |
|-------|-------|
| DAG Executor Analyst | F2: ForEach body'de timeout YOK, F3: itemVariable sessiz bos, F5: error handler bypass |
| Custom Data Auth | C1 KAPANDI — HTTP auth gereksiz, direct import mumkun |
| WhatsApp Attachment Flow | notify=binary OK, append=undefined (kasitli ban korumasi) |
| Voorinfra Client Deep | opdracht_id filename'den parse CALISMAZ — grid search gerekli |
| Extension Sandbox | fetch/Buffer/btoa YOK — binary processing imkansiz |
| Alternative Architecture | Python cron + direct DB onerisi (9/10) |
| Devils Advocate DAG | KOSULSUZ RED — F2+F3+F5 kombinasyonu sonsuz retry dongusu |
| Devils Advocate Queue | S31 "Transactional Outbox" aslinda outbox DEGIL — iki ayri transaction |

### Wave 2 — 3 Agent (Implementation Detaylari)

| Agent | Bulgu |
|-------|-------|
| SOR Filename Verifier | %47 dosya (Tip C/E, dash ayirici) mevcut parser'i gecimiyor → fallback regex gerekli |
| Schema Migration | IF NOT EXISTS yeterli, COALESCE fix zorunlu (NULL attachments), TEXT id (UUID degil) |
| ServiceImpl Transaction | BaseRepository.transaction() GERCEK atomicity saglamiyor — PG TRIGGER kazandi |

### Wave 3 — 5 Agent (Trigger Engine + Embedded vs External)

| Agent | Bulgu |
|-------|-------|
| TriggerEngine type='tool' | DOGRUDAN fonksiyon cagrisi, LLM YOK, sifir token. AMA: retry yok, timeout yok |
| MCP Server Registration | Tam destekli, unified ToolRegistry, trigger→MCP tool bridge MEVCUT |
| Tool Execution Runtime | Onaylandi: type='tool' trigger = sifir AI token. Scheduler type='tool' ise GEREKSIZ YERE LLM kullaniyor (design flaw) |
| Devils Advocate Embedded vs External | Option B (external Python) KAZANDI — blast radius izolasyonu, bagimsiz yasam dongusu |
| Restate Scope Check | SCOPE DISI — 15 dosya/gun icin Kubernetes gibi. Sonra, OwnPilot agent orchestration icin ayri inisiyatif |

### Wave 4 — 5 Agent (AI Ekosistemi Stratejisi)

| Agent | Bulgu |
|-------|-------|
| AI Provider Analyst | MiniMax tool calling DESTEKLI, smart routing VAR, cost tracking BUILT-IN, $0.30/1M token |
| Tool Query Capability | AI native tabloları SORGULAYAMAZ (arbitrary SQL yok). Custom Data tools ile CRUD mumkun. channel_messages erisimi YOK |
| SOR Analysis Feasibility | pyOTDR ile parse → structured JSON → threshold check (if/else) → opsiyonel MiniMax rapor. CNN/ML suan overkill |
| AI Ecosystem Architect | Hub-and-spoke, OwnPilot orchestrator, tiered model (MiniMax %85 / Sonnet %15), aylik AI maliyet ~$2.30 |
| Devils Advocate AI Scope | "Build the boring thing." Pipeline icin AI YOK. 15 dosya/gun, 3 teknisyen = bash script + cron yeterli |

---

## S31 Plani vs S32 Revize Plan — Karsilastirma

| Konu | S31 Plani (IPTAL) | S32 Revize Plan (GECERLI) |
|------|-------------------|--------------------------|
| Queue tablosu | Custom Data (OwnPilot AI chat ile olustur) | Native PG tablo (schema.ts, IF NOT EXISTS) |
| Enqueue mekanizmasi | HTTP POST fire-and-forget (iki ayri transaction) | PG TRIGGER (ayni transaction, atomik) |
| Processor | DAG Workflow (ForEach + tool nodes) | Python cron script (systemd timer) |
| Binary depolama | base64 JSONB Custom Data'da (TOAST tekrar) | channel_messages'tan dogrudan okuma (psycopg2) |
| whatsapp-api.ts degisikligi | +20 satir (SOR detect + HTTP POST) | 0 satir (PG TRIGGER otomatik) |
| OwnPilot TS kodu degisikligi | 3 dosya, ~90 satir | Sadece schema.ts (~50 satir SQL) |
| Trigger | Schedule trigger → DAG workflow | systemd timer (60s, Type=oneshot) |
| AI | DAG icinde MiniMax tool calling | Pipeline'da AI YOK. AI sadece ustteki katmanda |
| Blast radius | Tum OwnPilot (DAG crash = WhatsApp down) | Sadece SOR upload (script crash = OwnPilot etkilenmez) |

---

## Kesinlesmis Mimari (S32 Final)

```
                    OwnPilot (DOKUNULMAZ — sifir TS degisikligi whatsapp-api.ts'e)
                         |
  WhatsApp msg ──→ channel_messages INSERT (mevcut kod, degismez)
                         |  (ayni PG transaction icinde)
                         v
                    [PG TRIGGER] enqueue_sor_message()
                      IF: direction='inbound'
                          AND content ILIKE '%.sor'
                          AND jid='120363423491841999@g.us'
                          AND COALESCE(attachments, '[]'::jsonb) != '[]'::jsonb
                          AND attachments->0->>'data' IS NOT NULL
                      THEN: INSERT INTO sor_queue(message_id, filename, channel_id)
                            ON CONFLICT DO NOTHING
                         |
                    ──────────────── (surec siniri) ────────────────
                         |
                    systemd timer (60s)
                         |
                    Python script (sor-upload-cron.py)
                         |──→ SELECT pending FROM sor_queue
                         |    FOR UPDATE SKIP LOCKED (veya status+picked_at pattern)
                         |──→ channel_messages'tan base64 binary oku (psycopg2)
                         |──→ base64 decode → SOR parse (filename → postcode)
                         |──→ Voorinfra grid search → opdracht_id
                         |──→ client.upload_file_bytes(opdracht_id, filename, content)
                         |──→ UPDATE sor_queue SET status='done'
                         v
                    Voorinfra API (mevcut client.py, upload_file() unchanged)
```

### Toplam Kod Degisikligi

| Degisiklik | Dosya | Satir | Risk |
|-----------|-------|-------|------|
| sor_queue CREATE TABLE | schema.ts (SCHEMA_SQL veya MIGRATIONS_SQL) | +20 | Sifir |
| sor_queue INDEX | schema.ts | +5 | Sifir |
| PG trigger function + trigger | schema.ts | +30 | Dusuk |
| Python cron script | ~/scripts/sor-upload-cron.py | ~120 | Dusuk |
| systemd timer + service | /etc/systemd/system/sor-upload.* | ~20 | Sifir |
| voorinfra client.py upload_file_bytes() | scrapling-workspace/tasks/voorinfra-api/api/client.py | +30 | Dusuk |
| **whatsapp-api.ts** | **YOK — DOKUNULMAZ** | **0** | **—** |
| **service-impl.ts** | **YOK — DOKUNULMAZ** | **0** | **—** |

**Toplam:** ~225 satir yeni kod, hicbir OwnPilot TypeScript dosyasi DEGISMEZ (schema.ts haric).

---

## AI Katman Stratejisi (Pipeline'dan AYRI)

### Layer 0: Pipeline (Phase 1 — SIMDI) — AI YOK
- detect → enqueue → upload → done
- Deterministik, $0 maliyet

### Layer 1: Etkilesim (Phase 1.5 — Pipeline bittikten hemen sonra) — MiniMax
- "Bugun kac SOR yuklendi?" → OwnPilot chat → MiniMax → tool call → cevap
- sor_queue'yu AI'a acmak icin: Custom Data mirror VEYA custom query tool
- Maliyet: ~$0.60/ay

### Layer 2: Analiz + Matching (Phase 2, 1-2 hafta sonra) — MiniMax + pyOTDR
- SOR binary parse: pyOTDR → structured JSON
- Quality score: deterministic threshold (if/else, AI degil)
- Task matching: postcode SQL JOIN (%90), technician+time (%9), AI fuzzy (%1)
- Opsiyonel: MiniMax ile Hollandaca kalite raporu
- Maliyet: ~$0.50/ay

### Layer 3: Proaktif Zeka (Phase 3, 1-3 ay) — MiniMax + Sonnet
- 17:00 daily: "3 gorev tamamlandi ama SOR yuklenmedi: [liste]"
- Haftalik kalite raporu per teknisyen
- Anomaly alert: "splice loss 0.52 dB at 156.7m"
- Supabase analytical store (ayri DB, OwnPilot'tan bagimsiz)
- Maliyet: ~$0.90/ay

### Layer 4: Full Platform (Phase 4, 6-12 ay)
- Predictive maintenance, training assistant, customer certificates
- Multi-team scale, supervisor dashboard
- Network topology intelligence

### Model Stratejisi

| Model | Rol | Oran | Maliyet |
|-------|-----|------|---------|
| MiniMax M2.5 | Chat, sorgular, basit analiz | %85+ | $0.30/1M token |
| Claude Sonnet | Fuzzy matching, anomaly analysis | %10-15 | Gerektiginde |
| Claude Opus | Stratejik, ad-hoc | <%5 | Nadir |
| Claude Code | Sadece gelistirme | Production'da YOK | Dev-only |
| AI yok | Pipeline (Layer 0) | Pipeline isleri %100 | $0 |

---

## SOR Dosya Analizi Altyapisi (Phase 2+)

### pyOTDR ile Parse

```python
# SOR binary → structured JSON
from pyotdr import read as pyotdr_read
result = pyotdr_read(sor_bytes)
# → wavelength, fiber_length, events[], total_loss, ORL
```

### Quality Threshold (deterministik, AI degil)

```python
THRESHOLDS = {
    "splice_loss_warn": 0.3,   # dB
    "splice_loss_fail": 0.5,   # dB
    "connector_loss_fail": 0.75,  # dB
    "total_loss_budget": 3.5,  # dB (depends on fiber length)
}
```

### Kutuphaneler

| Kutuphane | Dil | Lisans | Not |
|-----------|-----|--------|-----|
| pyOTDR | Python | GPLv3 | En olgun, JSON cikti |
| otdrparser | Python | Unknown | Basit API, .parse2() |
| jsOTDR | Node.js | GPLv3 | OwnPilot'a direkt entegre edilebilir |

---

## Reddedilen Yaklasimlar (Kanitli)

| Yaklasim | Neden Red | Kanit |
|----------|-----------|-------|
| OwnPilot DAG Workflow | F2 timeout yok + F3 itemVariable bos + F5 error handler bypass = sonsuz retry | Wave 1: 3 agent onayladi |
| Custom Data queue | Index yok, TOAST tekrar, iki ayri transaction | Wave 1: queue devil's advocate |
| Extension sandbox | fetch/Buffer/btoa yok | Wave 1: sandbox capability audit |
| HTTP enqueue (fire-and-forget) | Atomicity yok, SOR sessizce kaybolur | Wave 1: queue devil's advocate |
| OwnPilot type='tool' trigger (embedded cron) | Blast radius tum OwnPilot, retry yok, timeout yok | Wave 3: devils advocate embedded vs external |
| Restate | 15 dosya/gun icin overkill, ayri inisiyatif | Wave 3: scope check |
| Pipeline icinde AI | "Build the boring thing." Deterministik is icin AI gereksiz | Wave 4: devils advocate AI scope |
| Vector embeddings | Yapisal veri, SQL daha iyi | Wave 4: ecosystem architect |

---

## OwnPilot Teknik Notlar (S32'de Ogrenilenler)

### TriggerEngine (engine.ts)
- `type='tool'` action: DOGRUDAN tool cagrisi, LLM YOK, sifir token
- `type='chat'` action: TAM LLM inference gerekli (pahali)
- Scheduler `type='tool'`: GEREKSIZ YERE agent.chat() ile LLM kullanir (design flaw)
- `executingTriggers: Set<string>` — in-memory, restart'ta kaybolur
- `isProcessingSchedule` — bir tool takilirsa TUM schedule trigger'lar bloke olur
- Retry YOK, timeout YOK, missed schedule catch-up YOK

### MCP Registration
- Tam destekli: stdio, SSE, streamable-http
- Unified ToolRegistry: `mcp.{serverName}.{toolName}` namespace
- Trigger → MCP tool bridge MEVCUT (type='tool' action)
- Auto-connect on startup (enabled + auto_connect)
- API: `POST /api/v1/mcp` ile kayit

### AI Provider System
- 97 provider registered (config-driven)
- MiniMax: OpenAI-compatible, tool calling TRUE, 4 model
- Smart routing: cheapest/fastest/smartest/balanced
- Per-process model routing: chat, channel, pulse, subagent
- Cost tracking built-in: provider/model bazinda
- Budget manager: daily/weekly/monthly limits, auto-downgrade

### Custom Data vs Native Tables
- AI native tabloları SORGULAYAMAZ (arbitrary SQL yok)
- Custom Data: 11 CRUD tool, AI erisimi hazir
- channel_messages: AI erisimi YOK (dedicated tool yok)
- Cozum: sor_queue native tablo + AI icin custom query tool veya Custom Data mirror

---

## Mevcut Sistem Durumu (S32 sonu)

| Bilesen | Durum | Not |
|---------|-------|-----|
| Container `ownpilot` | UP | Port 8080 |
| WhatsApp | Connected | 31633196146 / Ayaz Murat |
| DB | Healthy | 128 MB, 542 attachment |
| MiniMax API | Kayitli | OwnPilot provider olarak |
| sor_queue tablosu | YOK | Phase 1'de olusturulacak |
| PG trigger | YOK | Phase 1'de olusturulacak |
| Python cron script | YOK | Phase 1'de yazilacak |
| systemd timer | YOK | Phase 1'de kurulacak |
| voorinfra upload_file_bytes | YOK | Phase 1'de eklenecek |
| Backup | YOK | Kurulum bekleniyor (S30 plani gecerli) |

---

## GIT State (S32 sonu — degisiklik yok)

- **Branch:** `fix/whatsapp-440-reconnect-loop`
- **HEAD:** `d6c5a32` (S29 — unit tests, pushed to fork)
- **Fork:** `git@github.com:CyPack/OwnPilot.git` (remote: "fork")
- S32'de commit yok (arastirma sessionu)

---

## S33 Uygulama Sirasi

### Phase 1: Pipeline (oncelik sirasi)

**Adim 1: schema.ts — sor_queue tablo + PG trigger**
```
Dosya: packages/gateway/src/db/schema.ts
Icerik: CREATE TABLE IF NOT EXISTS sor_queue + enqueue_sor_message() trigger
Risk: Sifir (IF NOT EXISTS, additive)
Test: docker restart ownpilot → SELECT * FROM sor_queue → bos tablo
```

**Adim 2: voorinfra client.py — upload_file_bytes()**
```
Dosya: ~/projects/scrapling-workspace/tasks/voorinfra-api/api/client.py
Icerik: +30 satir async method
Risk: Dusuk (yeni fonksiyon, mevcut kodlara dokunmaz)
Test: python3 -c "from api.client import VoorinfraClient; ..."
```

**Adim 3: Python cron script**
```
Dosya: ~/scripts/sor-upload-cron.py
Icerik: ~120 satir (psycopg2 + voorinfra client + SOR parse)
Risk: Dusuk (izole script)
Test: python3 sor-upload-cron.py --dry-run
```

**Adim 4: systemd timer + service**
```
Dosyalar: /etc/systemd/system/sor-upload.timer + sor-upload.service
Icerik: ~20 satir
Risk: Sifir
Test: systemctl start sor-upload.service (tek seferlik calistir)
```

**Adim 5: Docker restart + Integration test**
```
docker restart ownpilot  (schema otomatik uygulanir)
Test: WhatsApp'tan SOR mesaj gonder → sor_queue kayit dogrula → 60s bekle → upload dogrula
```

### Sonraki Adimlar (Phase 1 bittikten sonra)

- Phase 1.5: OwnPilot chat'te "bugunku SOR durum" sorgulama (MiniMax)
- Phase 2: pyOTDR parse + task matching + WhatsApp confirmation
- Phase 3: Proaktif alertler + Supabase analytical store

---

## Agent Arastirma Dosyalari (S32)

Kalici lokasyon: `/tmp/claude-1000/-home-ayaz/tasks/`

### Wave 1 (8 agent)
| Agent | Konu |
|-------|------|
| DAG Executor Analyst | ForEach retry/timeout/itemVariable analizi |
| Custom Data Auth | C1 riski — HTTP auth gereksiz |
| WhatsApp Attachment Flow | SOR binary veri akisi, hook noktasi |
| Voorinfra Client Deep | upload internals, opdracht_id parse |
| Extension Sandbox Audit | fetch/Buffer/btoa yok |
| Alternative Architecture | Python cron + direct DB onerisi |
| Devils Advocate DAG | DAG kosulsuz red |
| Devils Advocate Queue | Custom Data queue yetersiz |

### Wave 2 (3 agent)
| Agent | Konu |
|-------|------|
| SOR Filename Verifier | Gercek Euronet dosya adi formati |
| Schema Migration Analyst | schema.ts pattern, PG trigger feasibility |
| ServiceImpl Transaction | Atomik enqueue icin PG TRIGGER |

### Wave 3 (5 agent)
| Agent | Konu |
|-------|------|
| TriggerEngine ToolCall Path | type='tool' = LLM yok, direkt cagri |
| MCP Server Registration | Unified ToolRegistry, 3 transport |
| Tool Execution Runtime | Onay: trigger type='tool' sifir token |
| Devils Advocate Embedded vs External | External Python kazandi |
| Restate Scope Check | Scope disi |

### Wave 4 (5 agent)
| Agent | Konu |
|-------|------|
| AI Provider Analyst | MiniMax tool calling, smart routing, cost tracking |
| Tool Query Capability | AI native tablo sorgulayamaz, Custom Data CRUD |
| SOR Analysis Feasibility | pyOTDR parse, threshold check, MiniMax rapor |
| AI Ecosystem Architect | Hub-and-spoke, tiered model, progressive roadmap |
| Devils Advocate AI Scope | "Build the boring thing" |

---

## Deferred (S29'dan tasinan + S32 eklemeleri)

| Item | Oncelik | Not |
|------|---------|-----|
| Restate OwnPilot entegrasyonu | GELECEK | SOR bittikten sonra, agent orchestration icin |
| Backup scripti | MEDIUM | S30 plani gecerli, risk sifir |
| file_path migration (binary DB'den cikar) | LOW | Buyuk refactor, deferrable |
| UNIQUE(channel_id, external_id) constraint | MEDIUM | Data audit gerekiyor |
| parseJsonBody BUG | LOW | curl --data-raw workaround |
| Upstream PR #11 follow-up | LOW | Maintainer bekleniyor |
| OwnPilot TriggerEngine 2-line fix | LOW | engine.ts:350 + webhooks.ts:181 — inputs payload |
| jsOTDR OwnPilot native SOR parser | GELECEK | Phase 2'de degerlendirilecek |
| Supabase analytical store | GELECEK | Phase 3'te |
| Per-technician quality dashboard | GELECEK | Phase 3'te |
