# Session Handoff S30/S31 → S32

**Tarih:** 2026-03-06 / 2026-03-07
**Önceki Session:** S29 (unit tests, integration test, push d6c5a32)
**S30:** SOR/voorinfra workflow için depolama mimarisi araştırması — 10 specialist agent + devil's advocate
**S31:** OwnPilot workflow engine derinlemesi — 4 ek specialist agent + Queue Pattern mimari kararı

---

## S30 Özeti

S30'da kod yazılmadı. **10 paralel specialist agent** aşağıdaki soruları derinlemesine araştırdı:

- Database tipi (PostgreSQL vs SQLite vs diğer): SONUÇ → PostgreSQL'de kal
- Attachment storage stratejisi (JSONB binary vs dosya sistemi): SONUÇ → binary'yi DB'den çıkar
- Voorinfra entegrasyon yolu (Option A: volume mount vs Option B: in-memory API): SONUÇ → Option B (client.py ~30 satır değişiklik)
- Trigger mekanizması (inotifywait vs cron vs webhook): SONUÇ → OwnPilot `/webhooks/trigger/:triggerId` veya cron
- Backup sistemi: SONUÇ → pg_dump zstd:3 + mega-cmd, günlük cron

---

## Agent Araştırma Dosyaları

Kalıcı lokasyon: `/home/ayaz/.claude/projects/-home-ayaz/ab31bebe-f4d2-4131-92b5-8e126ec1bda1/subagents/`

| Agent | ID | JSONL Dosyası | Konu |
|-------|----|---------------|------|
| OwnPilot Storage Analyst | `a8d2c6463ecc7403e` | `agent-a8d2c6463ecc7403e.jsonl` | Mevcut pipeline, attachment flow, TOAST analizi |
| PostgreSQL Storage Expert | `a297173a8850aece8` | `agent-a297173a8850aece8.jsonl` | BYTEA vs JSONB, TOAST, object storage kıyaslaması |
| Voorinfra Constraints Analyst | `a9a4ee62e3417850d` | `agent-a9a4ee62e3417850d.jsonl` | mcp_server_api.py, client.py disk bağımlılığı, fix yolu |
| Docker Volume Architect | `ae53213d38bc989a2` | `agent-ae53213d38bc989a2.jsonl` | Bind mount, UID mismatch, SELinux, restart policy |
| ObjectStorage Alt. Expert | `a0937e63431110f82` | `agent-a0937e63431110f82.jsonl` | MinIO/SeaweedFS/Garage/RustFS, dual-write sorunu |
| Backup Architecture Expert | `a89e54ddaefd67300` | `agent-a89e54ddaefd67300.jsonl` | pg_dump zstd:3, MEGA, restic, WAL analizi |
| Event Architecture Expert | `a830fa46f5bd64ada` | `agent-a830fa46f5bd64ada.jsonl` | inotifywait vs cron vs webhook, pipeline tasarımı |
| Devil's Advocate 1 (Volume) | `a9c4457b39daa3905` | `agent-a9c4457b39daa3905.jsonl` | Volume mount yaklaşımı riskleri, kırılma senaryoları |
| Devil's Advocate 2 (PG) | `a1e9b2e48232d43e4` | `agent-a1e9b2e48232d43e4.jsonl` | PostgreSQL + metadata-only yaklaşımı riskleri |
| Devil's Advocate 3 (Trigger) | `a97b84b7734424a66` | `agent-a97b84b7734424a66.jsonl` | inotifywait+bridge trigger riskleri, race condition |

---

## Mimari Kararlar (Kesinleşti)

### 1. Database Tipi: PostgreSQL'de KAL

**Karar:** PostgreSQL'den ayrılmak YASAK.

**Kanıt (Agent a8d2c6463ecc7403e + a1e9b2e48232d43e4):**
- pgvector HNSW indexleri aktif: `idx_memories_embedding_hnsw` (memories tablosu)
- `text-embedding-3-small` (1536 dim) hybrid search kullanılıyor
- Tüm repository katmanı PostgreSQL-native (`pg` driver, JSONB, CTE)
- SQLite: `better-sqlite3` devDependency olarak var ama sadece migration utility — production'da kullanılmıyor
- `DatabaseType = 'postgres'` — SQLite kodu kaldırılmış

**Sonuç:** Database değişikliği = tüm repository katmanını yeniden yazmak. Gerçekçi değil.

---

### 2. Attachment Storage: Binary'yi DB'den Çıkar

**Karar:** `data` alanını JSONB attachment'tan kaldır, `file_path` ekle.

**Kanıt (Agent a297173a8850aece8 + a1e9b2e48232d43e4):**

Mevcut durum:
```
channel_messages: 115 MB toplam
  └── TOAST: 103 MB (binary base64 data)
  └── Asıl satır: 12 MB
  └── 4800+ satır: data=null (CDN URL expire olmuş)
```

SOR dosyaları ~21 KB binary → Microsoft Research 256 KB eşiği altında → teorik olarak DB'de tutulabilir.
**AMA:** CDN URL expire sorunuyla gerçek dünyada data=null olarak geliyor. Disk yolu daha güvenilir.

**Değişiklik:**
```typescript
// Önce:
interface ChannelMessageAttachment {
  data: string | null;  // base64 binary — KALDIRILIYOR
  ...
}

// Sonra:
interface ChannelMessageAttachment {
  file_path: string | null;  // /app/data/sor/{YYYY/MM/DD/filename.SOR}
  ...
}
```

**Etki:** 103 MB TOAST → ~2 MB JSONB. `repairMissingAttachmentData()` basitleşir.

---

### 3. Dosya Depolama: Dedicated Dizin + Atomik Write

**Karar:** SOR dosyaları için `/home/ayaz/sor-pipeline/` (host) = `/app/data/sor/` (container)

**Kanıt (Agent ae53213d38bc989a2 + a9c4457b39daa3905 devil's advocate):**

Dizin yapısı:
```
/home/ayaz/sor-pipeline/
├── incoming/           # OwnPilot buraya yazar
│   └── YYYY/MM/DD/
│       └── {POSTCODE}_{HUISNR}_{VERSION}.SOR
└── processed/          # Upload sonrası taşınır
    └── YYYY/MM/DD/
```

**Atomik write** (veri bütünlüğü için zorunlu):
```typescript
// OwnPilot whatsapp-api.ts içinde:
const tmpPath = `${targetPath}.tmp`;
await fs.writeFile(tmpPath, buffer);
await fs.rename(tmpPath, targetPath);  // OS-level atomic
```

**UID fix** (container UID 1001 ≠ host UID 1000):
```bash
# Seçenek A (temiz): setfacl
setfacl -m u:1001:rwx /home/ayaz/sor-pipeline/
setfacl -dm u:1001:rwx /home/ayaz/sor-pipeline/

# Seçenek B: supplemental group
docker run ... --group-add 1000 ...
```

**SELinux:** `:z` flag zorunlu (relabeling için)
```
-v /home/ayaz/sor-pipeline:/app/data/sor:z
```

**KRITIK:** Input dizini `voorinfra/input/` ile AYRI olmalı (contamination riski). Dedicated `sor-pipeline/` kullan.

---

### 4. Voorinfra Entegrasyonu: Option B (In-Memory API)

**Karar:** `client.py`'e `upload_file_bytes()` ekle (~30-35 satır), volume mount gerekmez.

**Kanıt (Agent a9a4ee62e3417850d):**

```python
# client.py mevcut (KIRIYOR — disk bağımlı):
def upload_file(self, opdracht_id, file_path: Path):
    if not file_path.exists():  # ← BLOCKER
        raise FileNotFoundError(...)
    file_content = open(file_path, "rb").read()  # disk I/O
    ...

# client.py yeni eklenti (~30 satır):
def upload_file_bytes(self, opdracht_id: str, filename: str, content: bytes, skip_if_exists: bool = True):
    """Upload SOR bytes directly without disk file requirement."""
    files = {"file": (filename, content, "application/octet-stream")}
    response = self.client.post(f"/opdracht/{opdracht_id}/upload", files=files)
    ...

# mcp_server_api.py yeni MCP tool (~40 satır):
@mcp.tool()
def upload_sor_bytes(sor_file: str, base64_content: str, skip_if_exists: bool = True):
    """Upload SOR file from base64 content (no disk file required)."""
    content = base64.b64decode(base64_content)
    # 1. SORManager.register_file(sor_file, content, source="ownpilot")
    # 2. _upload_sor_internal_bytes(opdracht_id, sor_file, content)
    ...
```

**Alternatif (Option A - volume mount):** Çalışır ama 4 prereq (UID, SELinux, lock, restart policy) — daha fazla operasyonel risk. Option B tercih edilmeli.

---

### 5. Trigger Mekanizması: Webhook veya Cron (inotifywait+bridge DEĞİL)

**Karar:** `inotifywait + bridge API -m 30` YASAK. İki güvenilir alternatif:

**Seçenek A (En İyi): OwnPilot /webhooks/trigger/:triggerId**

**Kanıt (Agent a830fa46f5bd64ada + a97b84b7734424a66 devil's advocate):**

```typescript
// whatsapp-api.ts — SOR dosyayı diske yazdıktan sonra:
await fetch(`http://localhost:8080/webhooks/trigger/${SOR_TRIGGER_ID}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files: [filename], receivedAt: new Date().toISOString() })
});
// Fire-and-forget — HTTP 200 anında döner, blocking yok
```

Neden iNotifywait+bridge değil:
- `curl -m 30` → 30 saniyede timeout, async `batch_upload` hala çalışıyor → sessiz failure
- Debounce yok → 3 SOR aynı anda gelirse 3 paralel `batch_upload` → Planbord 503
- Process restart mekanizması yok
- Bridge overhead: her SOR için tam CC session başlatır (5-30s boot)

**Seçenek B (Basit Fallback): Cron Polling**

```bash
# crontab -e
*/5 * * * * flock -n /tmp/voorinfra-upload.lock python3 /path/to/batch_upload_runner.py
```

- `flock -n` ile concurrent execution koruması
- İşlenen dosyaları `processed/` alt dizinine taşı (double-upload koruması)
- Hollanda mesai saatlerinde (08:00-18:00 CEST) 5 dakika gecikme kabul edilebilir

---

### 6. Backup Sistemi: pg_dump zstd:3 + MEGA

**Karar:** Günlük cron + MEGA offsite, WAL archiving gerekmez.

**Kanıt (Agent a89e54ddaefd67300):**

```bash
# /usr/local/bin/ownpilot-backup.sh
#!/bin/bash
set -euo pipefail

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/ayaz/backups/ownpilot"
mkdir -p "${BACKUP_DIR}"

# 1. PostgreSQL dump (zstd:3 — 4.7x daha hızlı, gzip ile aynı boyut)
docker exec ownpilot-postgres pg_dump \
  -U ownpilot -d ownpilot \
  -Fc --compress=zstd:3 \
  > "${BACKUP_DIR}/ownpilot-${DATE}.dump"

# 2. WhatsApp sessions (QR scan gerektirmemek için kritik)
docker cp ownpilot:/app/data/whatsapp-sessions /tmp/wa-sessions-${DATE}
tar -czf "${BACKUP_DIR}/wa-sessions-${DATE}.tar.gz" /tmp/wa-sessions-${DATE}
rm -rf /tmp/wa-sessions-${DATE}

# 3. MEGA offsite upload
mega-put "${BACKUP_DIR}/ownpilot-${DATE}.dump" /backups/ownpilot/db/
mega-put "${BACKUP_DIR}/wa-sessions-${DATE}.tar.gz" /backups/ownpilot/sessions/

# 4. Local cleanup (30 gün retention)
find "${BACKUP_DIR}" -mtime +30 -delete
```

```bash
# crontab -e
0 3 * * * /usr/local/bin/ownpilot-backup.sh >> /var/log/ownpilot-backup.log 2>&1
```

**Performans ölçümü (agent tarafından test edildi):**
- DB boyutu: 128 MB (115 MB channel_messages, 103 MB TOAST)
- pg_dump gzip: 75 MB, 4.6s
- pg_dump zstd:3: 75 MB, **0.97s** (4.7x hızlı, aynı boyut)
- WhatsApp sessions: 4.3 MB, 1073 dosya — **kaybedilirse QR scan şart**
- MEGA kalan alan: 5.56 GB → 28 günlük backup (80 MB × 28 = 2.24 GB) sığar

**Kurulum gerekenler:**
```bash
sudo dnf install -y restic rclone  # Fedora 43 repo'da mevcut (opsiyonel, mega-cmd yeterli)
mkdir -p /home/ayaz/backups/ownpilot
```

**WAL archiving:** KAPALI (archive_mode=off). Container restart = WhatsApp QR risk. Günlük pg_dump bu risk'e değmez.

---

## Object Storage Alternatifleri — Değerlendirme

**Kanıt (Agent a0937e63431110f82):**

| Çözüm | Durum | Değerlendirme |
|-------|-------|---------------|
| MinIO | **Maintenance mode** (Aralık 2025) | KULLANMA — AGPL lisans + yavaşlayan geliştirme |
| SeaweedFS | Aktif, Go, S3-compat. | SOR için overkill (~21 KB dosyalar), fazla karmaşıklık |
| Garage | Aktif, Rust, tek node OK | İlginç ama 542 dosya için overhead fazla |
| RustFS | Yeni, tam S3 API | Üretim kanıtı az, risk yüksek |
| **Local FS** | **Seçilen** | Basit, güvenilir, 21 KB dosyalar için yeterli |

**Dual-write sorun:** Hem DB hem object storage yazarken transactional consistency yok. Outbox pattern gerektirir. Bu karmaşıklık SOR boyutu (~21 KB) için gereksiz.

**Net karar:** Object storage HAYIR. Local filesystem + `file_path` metadata yeterli.

---

## Uygulama Adımları (Öncelik Sırası)

### Adım 1: Backup Kur (HEMEN — Risk Sıfır)

```bash
# Kurulum
mkdir -p /home/ayaz/backups/ownpilot
# Script oluştur (yukarıdaki backup script)
# Cron ekle
# İlk manual test: sh /usr/local/bin/ownpilot-backup.sh
```

**Risk:** Sıfır — mevcut sisteme dokunmuyor.

---

### Adım 2: Voorinfra client.py — upload_file_bytes() Ekle (~30-35 satır)

```
Dosya: /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/api/client.py
```

```python
def upload_file_bytes(
    self,
    opdracht_id: str,
    filename: str,
    content: bytes,
    skip_if_exists: bool = True
) -> dict:
    """Upload SOR file from bytes — no disk file required."""
    if skip_if_exists:
        existing = self.get_sor_list(opdracht_id)
        if any(s.get("bestandsnaam") == filename for s in existing):
            return {"status": "skipped", "filename": filename}
    files = {"file": (filename, content, "application/octet-stream")}
    response = self.client.post(f"/upload/{opdracht_id}", files=files)
    response.raise_for_status()
    return response.json()
```

```
Dosya: /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/mcp_server_api.py
```

Yeni MCP tool: `upload_sor_bytes(sor_file: str, base64_content: str, skip_if_exists: bool = True)`

**Risk:** Düşük — mevcut tool'lar bozulmaz. Yeni function ekleniyor.

---

### Adım 3: OwnPilot — SOR Disk Write + file_path (S31 sprint)

Bu adım en büyük kod değişikliği. Planlama gerektirir.

**Değişen dosyalar:**
```
packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts
packages/gateway/src/db/repositories/channel-messages.ts
packages/gateway/src/routes/channels.ts
packages/gateway/src/db/schema.ts (migration)
```

**Migration planı:**
```sql
-- Adım A: file_path sütunu ekle
ALTER TABLE channel_messages
  ADD COLUMN IF NOT EXISTS sor_file_path TEXT;

-- Adım B: Mevcut data sütununu koru (backward compat), yeni kayıtlar file_path kullanır
-- Adım C: Data migration (isteğe bağlı — 542 kayıt, 10.7 MB)
-- Adım D: data sütununu kaldır (TOAST temizlenir)
```

**Container yeniden oluşturma gerekir** (bind mount eklemek için):
```bash
# WhatsApp session korunur (named volume aynı kalıyor)
docker stop ownpilot
docker rm ownpilot
docker run ... -v /home/ayaz/sor-pipeline:/app/data/sor:z ...
# QR scan gerekmez — session named volume'da
```

---

### Adım 4: Trigger — Webhook Entegrasyonu

`POST /webhooks/trigger/:triggerId` endpoint'i zaten var.

Gerekli:
1. OwnPilot UI'da trigger oluştur (triggerId al)
2. `whatsapp-api.ts`'de SOR disk write sonrası webhook çağrısı ekle
3. Trigger action'ı tanımla: MCP tool çağrısı → `upload_sor_bytes`

---

## Mevcut Sistem Durumu (S30 sonu)

| Bileşen | Durum | Not |
|---------|-------|-----|
| Container `ownpilot` | ✅ Running | Port 8080, 5+ saat ayakta |
| WhatsApp | ✅ Connected | `31633196146 / Ayaz Murat` |
| DB | ✅ Healthy | 128 MB, 542 attachment (çoğu data=null) |
| SOR files | ✅ 64 dosya diske çıkarıldı | `~/Downloads/sor-euronet-2026-03-06/` |
| Backup | ❌ Yok | Kurulum bekleniyor |
| voorinfra `upload_file_bytes` | ❌ Yok | Kodlanmamış |
| `file_path` migration | ❌ Yok | Planlandı |

---

## GIT State (S30 sonu — değişiklik yok)

- **Branch:** `fix/whatsapp-440-reconnect-loop`
- **HEAD:** `d6c5a32` (S29 — unit tests, pushed to fork)
- S30'da commit yok (araştırma sessionu)

---

## Referans: SOR Export Script (Acil Kullanım)

```bash
# Bugünün SOR dosyalarını DB'den diske çıkar
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -t -A -c "
  SELECT content || '|' || (attachments->0->>'data')
  FROM channel_messages
  WHERE metadata->>'jid' = '120363423491841999@g.us'
    AND created_at::date = CURRENT_DATE
    AND content ILIKE '%.SOR'
    AND jsonb_array_length(attachments) > 0
  ORDER BY created_at;" > /tmp/sor_data.txt

python3 -c "
import base64, os
out_dir = os.path.expanduser('~/Downloads/sor-$(date +%Y-%m-%d)')
os.makedirs(out_dir, exist_ok=True)
count = 0
with open('/tmp/sor_data.txt') as f:
    for line in f:
        line = line.strip()
        if not line or '|' not in line: continue
        filename, b64data = line.split('|', 1)
        data = base64.b64decode(b64data)
        open(os.path.join(out_dir, filename), 'wb').write(data)
        count += 1
print(f'Saved: {count} files -> {out_dir}')
"
```

---

## S31 Öncelik Sırası

1. **[HEMEN]** Backup scripti kur ve test et (risk sıfır)
2. **[KISA VADE]** `voorinfra client.py` → `upload_file_bytes()` ekle + MCP tool
3. **[S31 SPRINT]** OwnPilot: SOR disk write + `file_path` migration + bind mount
4. **[S31 SPRINT]** Trigger entegrasyonu (webhook veya cron)
5. **[DÜŞÜK ÖNCELİK]** Upstream PR #11 follow-up

---

---
---

# S31 ADDENDUM — OwnPilot Workflow Engine Derinlemesi + Queue Pattern Mimarisi

> **AI Okuma Tetikleyicisi:** Bu bölümü oku → OwnPilot içinde workflow/trigger/queue entegrasyonu yapılacaksa
> **Kritik:** S30'daki "Option B webhook trigger" kararı S31'de REVİZE EDİLDİ → Queue Pattern seçildi

---

## S31 Yeni Agent Araştırma Dosyaları

Kalıcı lokasyon: `/home/ayaz/.claude/projects/-home-ayaz/ab31bebe-f4d2-4131-92b5-8e126ec1bda1/subagents/`

| Agent | ID | JSONL Dosyası | Konu |
|-------|----|---------------|------|
| OwnPilot Engine Analyst | `ac130f7590c30863f` | `agent-ac130f7590c30863f.jsonl` | TriggerEngine internals, executingTriggers dedup, activeExecutions Map, 2-line gap discovery |
| Custom Data Analyst | `a1242041012af2479` | `agent-a1242041012af2479.jsonl` | Custom Data repository tools, schema, ownerPluginId isolation, Extension sandbox kısıtları |
| Best Practices Researcher | `ab3be49a46b8115c2` | `agent-ab3be49a46b8115c2.jsonl` | n8n/Temporal/Windmill karşılaştırması, Transactional Outbox konsensüs, LISTEN/NOTIFY alternatifi |
| Devil's Advocate (Workflow) | `afde8e79daddd4251` | `agent-afde8e79daddd4251.jsonl` | 14 risk (C1-C3 kritik, H1-H5 yüksek, M1-M5 orta, L1-L3 düşük) |

---

## OwnPilot'ta Zaten Var Olan Altyapı (Kod Analizinden)

| Bileşen | Durum | Notlar |
|---------|-------|--------|
| DAG Workflow Engine | ✅ | 15 node tipi: tool, code, llm, condition, foreach, http_request, transformer, switch, delay, sub_workflow, approval, parallel, merge, error_handler, notification |
| TriggerEngine | ✅ | schedule, event (EventBus), webhook, condition |
| `channel.message.received` EventBus | ✅ | Payload: `{ message: { id, platformChatId, attachments[{filename, data: Uint8Array}] } }` |
| `/webhooks/trigger/:id` endpoint | ✅ | Fire-and-forget, HTTP 200 anında |
| Custom Data Repository | ✅ | AI-managed dynamic tables, no migration, 11 tool |
| Extension system | ✅ | JS code bundle + trigger manifest |
| `{{ inputs.field }}` template syntax | ✅ | `variables.__inputs` namespace (template-resolver.ts:76-79) |
| `{{ nodeId.output.field }}` templates | ✅ | Full nested access, JSON auto-parse |

**Temel Prensip:**
- OwnPilot = Orchestrator (ne, ne zaman, takip)
- MCPs/Scripts = Workers (domain logic)
- PostgreSQL Custom Data = Workflow state
- Filesystem = Binary data (sadece gerektiğinde)

---

## Minimum Bileşen Listesi (Toplam Değişiklik)

| Değişiklik | Dosya | Satır | Risk |
|-----------|-------|-------|------|
| SOR detection + enqueue | `whatsapp-api.ts` | +20 | Düşük — additive |
| `upload_file_bytes()` | `voorinfra/api/client.py` | +30 | Düşük — new function |
| `upload_sor_bytes` MCP tool | `voorinfra/mcp_server_api.py` | +40 | Düşük — new tool |
| `sor_queue` custom table | OwnPilot AI chat | 0 | — AI yaratır |
| SOR Process Workflow DAG | OwnPilot UI | 0 | — UI konfig |
| Schedule trigger | OwnPilot UI | 0 | — UI konfig |
| engine.ts inputs fix | OwnPilot (fork) | +2 | Düşük — **gelecekte**, şimdi gerekmez |
| webhooks.ts inputs fix | OwnPilot (fork) | +2 | Düşük — **gelecekte**, şimdi gerekmez |

**Toplam şimdi:** ~90 satır, 3 dosya.

---

## SOR Workflow — Opsiyon A vs Opsiyon B

### Opsiyon A: Direct Event-Trigger (Basit ama Kırılgan)

```
WhatsApp SOR mesajı
    ↓
whatsapp-api.ts: SOR tespiti
    ↓ (fire-and-forget)
POST /webhooks/trigger/SOR_TRIGGER_ID
Body: { messageId, files: [{filename, base64data}] }
    ↓
TriggerEngine → workflow action (2-line fix ile)
    ↓
WorkflowService.executeWorkflow(id, userId, _, { inputs: body })
    ↓
DAG: [Code] → [ForEach] → upload_sor_bytes → custom_data_insert
```

**Sorun:** `activeExecutions` lock — art arda 2 SOR mesajı gelirse ikincisi "Workflow is already running" ile sessizce atılır.

---

### Opsiyon B: Queue Pattern (Seçilen — Production-Grade)

| Kriter | Opsiyon A | Opsiyon B (Queue) |
|--------|-----------|-------------------|
| Concurrency güvenli | ❌ Lock çakışması | ✅ Her zaman tek processor |
| Mesaj kayıp riski | ❌ Lock'ta kayıp | ✅ Queue'da bekler |
| Retry | ❌ Yok | ✅ Failed status, re-queue |
| Audit trail | ⚠️ Sadece workflow log | ✅ Her dosya için DB kaydı |
| Throughput | ❌ Sequential | ✅ Batch |
| Debounce doğal | ❌ Yok | ✅ 2 dakika window |
| Container restart safe | ❌ In-memory state kayıp | ✅ Queue DB'de |

---

## S31 Kritik Keşifler — OwnPilot Dahili

### KEŞİF 1: 2-Line Gap in TriggerEngine + Webhooks (engine.ts:350, webhooks.ts:181)

```typescript
// engine.ts ~350 — MEVCUT (BOZUK):
const wfLog = await service.executeWorkflow(workflowId, this.config.userId);
// EKSIK: , undefined, { inputs: payload }

// webhooks.ts ~181 — MEVCUT (BOZUK):
await service.executeWorkflow(workflowId, trigger.userId);
// EKSIK: , undefined, { inputs: _payload }
```

**Sonuç:** Event payload → `{{ inputs.field }}` template değişkenlerine ASLA ulaşmaz.
**Fix:** Her iki satıra `undefined, { inputs: payload }` parametresi ekle.
**ANCAK:** Bu gap Scheduled Trigger için ÖNEMSIZ — scheduled workflow DB'den okur, event payload'ından değil.

---

### KEŞİF 2: Extension Sandbox — fetch/Buffer/btoa YOK

```typescript
// Extension (.ts) sandbox içinde ÇALIŞMAZ:
fetch(url)              // ← ReferenceError
Buffer.from(data)       // ← ReferenceError
btoa(str)               // ← ReferenceError

// ÇALIŞIR:
utils.callTool('tool_name', args)  // MCP tool çağrısı
```

**Sonuç:** Extension event-trigger yaklaşımı ile Uint8Array → base64 dönüşümü YAPILMAZ.
**Fix:** `whatsapp-api.ts` (tam Node.js ortamı) içinde dönüşüm yap, Extension'a binary verme.

---

### KEŞİF 3: executingTriggers — Concurrent SOR Dropper (C3 KRİTİK)

```typescript
// engine.ts
private executingTriggers = new Set<string>();

// Trigger fire edince:
if (this.executingTriggers.has(triggerId)) {
  return; // ← SESSIZCE DROP! Log bile yok.
}
this.executingTriggers.add(triggerId);
// ... workflow execute ...
this.executingTriggers.delete(triggerId);
```

**Sonuç:** Aynı trigger'dan 3 SOR dosyası aynı anda gelirse → yalnızca 1 işlenir, 2 KAYBOLUR.
**Bu neden kritik:** Sor Euronet grubunda 60+ SOR, Sinan/MazluM/Yassin aynı anda gönderir.

---

### KEŞİF 4: activeExecutions — In-Memory Map, Restart'ta Orphan

```typescript
// workflow-service.ts:84-86
private activeExecutions = new Map<string, AbortController>();

if (this.activeExecutions.has(workflowId)) {
  throw new Error('Workflow is already running');
}
```

**Sonuç:** Container restart → Map sıfırlanır ama DB'de `status='running'` kalan log'lar kalır.
**Sonuç 2:** Aynı workflow'u paralel çalıştırmak mümkün değil (per workflowId).
**Queue Pattern bunu çözer:** Her "run" yeni workflow invocation, aynı workflowId değil.

---

### KEŞİF 5: Custom Data {{ template }} ÇALIŞMAZ

```
{{ custom_data.sor_upload_log }}  ← YANLIŞ, bu syntax YOK
```

**Doğru yol:** `list_custom_records` tool node kullan, output'u sonraki node'a `{{ nodeId.output }}` ile geç.
Template resolver Custom Data tablolarından haberdar değil.

---

### KEŞİF 6: ForEach Body Retry Bypass (M5)

```typescript
// foreach-executor.ts — body node'ları için:
await executeNode(node, ...)   // ← executeWithRetryAndTimeout ÇAĞRILMIYOR
```

**Sonuç:** ForEach body içindeki node'lara `retryCount: 3` yazsan da retry olmaz, sessizce yok sayılır.
**Workaround:** ForEach body'ye `error_handler` node ekle, retry mantığını oraya koy.

---

## S31 Mimari Karar: Queue Pattern (Transactional Outbox)

### Neden Event-Trigger + Workflow DEĞIL?

| Risk | Etki | Neden Seçilmedi |
|------|------|-----------------|
| C3: executingTriggers dedup | KRİTİK | Concurrent SOR'lar drop edilir |
| C2: activeExecutions in-memory | KRİTİK | Restart'ta orphan running status |
| H3: blocking await circuit breaker | YÜKSEK | Upload sırasında yeni SOR'lar circuit breaker'a takılır |
| 2-line gap fix + C3 hala çözülmemiş | — | Fix yapmak gerekir AMA C3 hala bloke |

### Queue Pattern — Pipeline Diyagramı (Tam)

```
┌─────────────────────────────────────────────────────────────────┐
│                    OwnPilot Container                           │
│                                                                 │
│  WhatsApp (Baileys)                                             │
│       │  messages.upsert type='notify' / type='append'         │
│       ▼                                                         │
│  handleIncomingMessage()                ← mevcut               │
│       │  DB kaydet (channel_messages)  ← mevcut                │
│       │                                                         │
│       │  +20 satır yeni:                                        │
│       ├─ SOR detect: filter(a => a.filename?.endsWith('.SOR'))  │
│       └─ Internal API call (fire-and-forget):                   │
│              POST /api/v1/custom-data/tables/sor_queue/records  │
│              body: { message_id, filename, base64data,          │
│                      group_jid, status: 'pending' }             │
│                                         │                       │
│                                         ▼                       │
│                             PostgreSQL: sor_queue               │
│                             (Custom Data Repository)            │
│                                         │                       │
│  ┌──────────────────────────────────────┤                      │
│  │  Scheduled Trigger: */2 * * * *      │                      │
│  │  (Her 2 dakika, concurrent-safe)     │                      │
│  │       ▼                              │                      │
│  │  SOR Process Workflow (DAG)          │                      │
│  │  ┌──────────────────────────────┐    │                      │
│  │  │ [pending-query]              │◄───┘                      │
│  │  │  list_custom_records         │                           │
│  │  │  filter: {status: pending}   │                           │
│  │  │         ▼                    │                           │
│  │  │ [has-pending] Condition      │                           │
│  │  │  length > 0 ?                │                           │
│  │  │  false → END                 │                           │
│  │  │         ▼ true               │                           │
│  │  │ [process-loop] ForEach       │                           │
│  │  │   ├─ [upload] Tool           │──────────────────────────┼──► voorinfra MCP
│  │  │   │  upload_sor_bytes(       │                           │   (Python host)
│  │  │   │    filename, base64)     │                           │   client.py +30 satır
│  │  │   ├─ [mark-ok] update_record │                           │
│  │  │   │  status: uploaded        │                           │
│  │  │   └─ [mark-fail] error_handler                          │
│  │  │      status: failed          │                           │
│  │  │ [notify] Notification        │                           │
│  │  └──────────────────────────────┘                           │
│  └──────────────────────────────────                            │
└─────────────────────────────────────────────────────────────────┘
```

### Queue Pattern — Metin Özeti

```
WhatsApp Grubu → SOR Dosyaları
         ↓
whatsapp-api.ts (+20 satır)
  - Uint8Array → Buffer.from(data).toString('base64')
  - POST http://localhost:8080/api/v1/custom-data/tables/sor_queue/records
  - { message_id, filename, base64data, group_jid, status: 'pending', enqueued_at }
  - Fire-and-forget (200ms, blocking yok)
         ↓
sor_queue Custom Data Tablosu (PostgreSQL)
  - status: 'pending' | 'uploaded' | 'failed'
  - retry_count, last_error
         ↓
Scheduled Trigger: */2 * * * * → SOR Process Workflow
  - Her 2 dakikada bir çalışır
  - executingTriggers problemi YOK (scheduled = her zaman yeni fire)
         ↓
SOR Process Workflow (DAG):
  Node 1: list_custom_records(table='sor_queue', filter={status:'pending'}, limit=50)
  Node 2: condition → length > 0 ? devam : stop
  Node 3: foreach(items={{ node1.output }}) →
    Node 3a: upload_sor_bytes(filename={{ item.filename }}, base64={{ item.base64data }})
    Node 3b: update_custom_record(id={{ item.id }}, status='uploaded', uploaded_at=now())
    Node 3c (hata): update_custom_record(id={{ item.id }}, status='failed', error={{ err }})
         ↓
voorinfra MCP: upload_sor_bytes(sor_file, base64_content)
  - base64.b64decode(base64_content) → bytes
  - client.upload_file_bytes(opdracht_id, filename, content)
  - skip_if_exists=True (idempotent)
```

### Uygulama Değişiklikleri

**1. whatsapp-api.ts (+20 satır)**
```typescript
// handleIncomingMessage() içinde, DB kaydetmeden SONRA ekle:
const SOR_GROUP_JID = process.env.SOR_GROUP_JID ?? '120363423491841999@g.us';
const sorAttachments = (message.attachments ?? [])
  .filter(a => a.filename?.endsWith('.SOR') && a.data);

if (sorAttachments.length > 0 && message.platformChatId === SOR_GROUP_JID) {
  // Fire-and-forget: non-blocking, hata loglansın ama mesaj işlemeyi durdurmasın
  Promise.all(sorAttachments.map(async (att) => {
    try {
      const base64data = Buffer.from(att.data!).toString('base64');
      await fetch(
        `http://localhost:${process.env.PORT ?? 8080}/api/v1/custom-data/tables/sor_queue/records`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OWNPILOT_API_KEY ?? ''}`,
          },
          body: JSON.stringify({
            data: {
              message_id: message.id,
              filename: att.filename,
              base64data,
              group_jid: message.platformChatId,
              status: 'pending',
              enqueued_at: new Date().toISOString(),
            }
          }),
        }
      );
    } catch (err) {
      log.warn('SOR enqueue failed:', err);
    }
  })).catch(() => {});
}
```

**2. Custom Data — sor_queue tablosu**

OwnPilot UI → Custom Data → Yeni Tablo:
```
Tablo adı: sor_queue
Kolonlar:
  message_id   text      (WhatsApp mesaj ID)
  filename     text      (ör: 12345_1A_v3.SOR)
  base64data   text      (SOR binary base64)
  group_jid    text      (120363423491841999@g.us)
  status       text      (pending/uploaded/failed)
  enqueued_at  datetime
  uploaded_at  datetime  (nullable)
  retry_count  number    (default 0)
  last_error   text      (nullable)
```

**3. voorinfra client.py (+30 satır) — GERÇEK ASYNC CLIENT**
```python
async def upload_file_bytes(
    self,
    opdracht_id: str,
    filename: str,
    content: bytes,
    skip_if_exists: bool = True,
) -> "UploadResult":
    """Upload SOR bytes directly — no disk file required."""
    self._ensure_authenticated()

    # Optional skip-if-exists check
    if skip_if_exists:
        try:
            existing = await self.get_sor_list(opdracht_id)
            if any(s.get("bestandsnaam") == filename for s in existing):
                return UploadResult(
                    success=True, filename=filename,
                    opdracht_id=opdracht_id, message="skipped (already exists)"
                )
        except Exception:
            pass  # Devam et, upload dene

    # DHX Vault HTML5 format: file + file_fullname + file_id
    import time, uuid
    file_id = f"u{int(time.time() * 1000)}"
    csrf_token = await self._get_csrf_token()
    headers = {"X-CSRF-TOKEN": csrf_token} if csrf_token else {}

    files = {"file": (filename, content, "application/octet-stream")}
    data  = {"file_fullname": filename, "file_id": file_id}

    # URL: API.FILE_UPLOAD_ENDPOINT?opdrachtid=...&mode=html5
    response = await self._upload_request(
        f"{API.FILE_UPLOAD_ENDPOINT}?opdrachtid={opdracht_id}&mode=html5",
        files=files, data=data, headers=headers,
    )

    if response.status_code == 200:
        j = response.json()
        if j.get("state") is True:
            return UploadResult(
                success=True, filename=filename, opdracht_id=opdracht_id,
                message=j.get("extra", {}).get("info", "Upload successful"),
                file_size=len(content),
            )
        return UploadResult(
            success=False, filename=filename, opdracht_id=opdracht_id,
            message=f"Upload failed: {j.get('extra',{}).get('info','unknown')}",
        )
    return UploadResult(
        success=False, filename=filename, opdracht_id=opdracht_id,
        message=f"HTTP {response.status_code}",
    )
```

**4a. OwnPilot — sor_queue Custom Table (AI Chat komutu)**

```
"Create a custom table called 'sor_queue' with these columns:
  - message_id (text, required)
  - filename (text, required)
  - base64data (text, required)
  - group_jid (text)
  - status (text, required, default: pending)
  - enqueued_at (datetime)
  - uploaded_at (datetime)
  - error (text)"
```

**4b. OwnPilot — SOR Process Workflow DAG (node-by-node, GERÇEK PARAMETRE ADLARI)**

```
[pending-query]  → Tool      → list_custom_records
                               table: "sor_queue"           ← "table" (tableNameOrId DEĞİL)
                               filter: {"status": "pending"}
                               limit: 20

Çıktı yapısı: { records: [{id, filename, base64data, ...}], total, hasMore }
              ↑ records array — tool output'u doğrudan array DEĞİL

[has-pending]    → Condition  → {{ pending-query.output.records.length > 0 }}
                               true  → [process-loop]
                               false → END

[process-loop]   → ForEach   → arrayExpression: {{ pending-query.output.records }}
                               itemVariable: "sorFile"      ← "itemVariable" (iterVariable DEĞİL)

  [upload]         → Tool    → upload_sor_bytes
                               sor_file: {{ sorFile.filename }}
                               base64_content: {{ sorFile.base64data }}
                               skip_if_exists: true

  [mark-done]      → Condition → {{ upload.output.status == 'skipped'
                                 || upload.output.status == 'uploaded' }}
    [update-ok]    → Tool    → update_custom_record
                               recordId: {{ sorFile.id }}
                               data: {"status": "{{ upload.output.status }}"}
                                ← {{ now() }} YOK, template'de fonksiyon desteği yok

    [update-fail]  → Tool    → update_custom_record  ← false branch
                               recordId: {{ sorFile.id }}
                               data: {"status": "failed",
                                      "last_error": "{{ upload.error }}"}

[notify]         → Notification → "SOR Upload complete"
```

**4c. Schedule Trigger (UI'da)**

```
Type: schedule
Cron: */2 * * * *   (her 2 dakika)
Action: workflow → SOR Process Workflow
```

**4d. voorinfra mcp_server_api.py (+40 satır) — tam versiyon (auto-detect opdracht_id)**
```python
@mcp.tool()
def upload_sor_bytes(
    sor_file: str,
    base64_content: str,
    opdracht_id: str = "",
    skip_if_exists: bool = True
) -> str:
    """
    Upload SOR file from base64 content — no disk file required.

    Args:
        sor_file: Filename (e.g. "1234_1_001.SOR")
        base64_content: Base64-encoded SOR binary content
        opdracht_id: Planbord opdracht ID (auto-detected from filename if empty)
        skip_if_exists: Skip if already uploaded (default: True, idempotent)
    """
    import base64

    content = base64.b64decode(base64_content)

    # Auto-detect opdracht_id from filename if not provided
    if not opdracht_id:
        # SOR naming: "12345_1_001.SOR" → opdracht_id = "12345"
        parts = sor_file.split('_')
        if parts and parts[0].isdigit():
            opdracht_id = parts[0]
        else:
            return json.dumps({"error": f"Cannot determine opdracht_id for: {sor_file}"})

    result = get_client().upload_file_bytes(
        opdracht_id=opdracht_id,
        filename=sor_file,
        content=content,
        skip_if_exists=skip_if_exists
    )
    return json.dumps(result)
```

---

## S31 Devil's Advocate — 14 Risk Tablosu

> Kaynak: Agent `afde8e79daddd4251` — TÜM riskler Queue Pattern ile değerlendirilmiştir.

| ID | Kategori | Risk | Etki | Queue Pattern ile Durum |
|----|----------|------|------|-------------------------|
| **C1** | KRITIK | Custom Data API erişimi için `Authorization` token gerekiyor — `whatsapp-api.ts` token'ı nasıl alacak? | Tüm enqueue işlemi başarısız | OwnPilot internal HTTP → same-process call mı? Yoksa token mekanizması doğrulanmalı |
| **C2** | KRITIK | `activeExecutions` Map restart'ta sıfırlanır → DB'de orphan `running` workflow log'lar | Workflow bir daha başlamaz (sanki hala çalışıyor) | Queue Pattern ile hafifletildi: her scheduled run yeni invocation |
| **C3** | KRITIK | `executingTriggers` dedup → concurrent SOR'ları drop eder | Veri kaybı | Queue Pattern bu riski TAMAMEN ELİMİNE EDER (scheduled = her zaman yeni) |
| **H1** | YÜKSEK | base64 boyutu: 21 KB SOR → ~28 KB base64 → Custom Data JSON string olarak saklanır → TOAST'a girer | DB şişer | Kabul edilebilir: geçici kuyruk, status='uploaded' sonrası silinecek |
| **H2** | YÜKSEK | `list_custom_records` pagination: 50'den fazla pending SOR varsa ilk batch'den sonrası işlenmez | Büyük günlerde (60+ SOR) backlog oluşur | Limit parametresini düşür + multi-run bekle (2 dk spacing yeterli) |
| **H3** | YÜKSEK | `upload_sor_bytes` voorinfra API zaman aşımına uğrarsa ForEach body retry çalışmaz (M5 keşfi) | Silent failure | error_handler node ekle + `retry_count` custom data'da izle |
| **H4** | YÜKSEK | Scheduled trigger */2 → 2 dk içinde container restart → SOR enqueue oldu ama işlenmedi | Max 2 dk gecikme | Kabul edilebilir, sonraki run işler |
| **H5** | YÜKSEK | `skip_if_exists` voorinfra tarafında kontrol → N+1 API çağrısı (her SOR için get_sor_list) | Rate limiting | Batch kontrol endpoint varsa kullan, yoksa kabul et |
| **M1** | ORTA | ForEach body içinde `{{ item.field }}` template resolve — `item` variable aliasMap'te tanımlı mı? | Template render hatası | Foreach executor `item` alias'ını set ediyor, test et |
| **M2** | ORTA | Custom Data tablo adı `sor_queue` çakışması — başka plugin aynı adı kullanırsa? | Veri kirlenmesi | `ownerPluginId` isolation mekanizması var, benzersiz prefix kullan |
| **M3** | ORTA | `whatsapp-api.ts` içinde `fetch` çağrısı — Node.js 22 native fetch ama SSRF riski | Güvenlik | Internal localhost:8080, kabul edilebilir |
| **M4** | ORTA | base64data kolonu text type → JSON stringify iki kez gömülür → çift kaçış karakteri | Template render bozulur | `JSON.parse` katmanını test et, direkt bytes string verilmeli |
| **M5** | ORTA | ForEach retry bypass (forEach-executor.ts — executeWithRetryAndTimeout çağrılmıyor) | Upload hatalarında retry olmaz | error_handler node workaround |
| **L1** | DÜŞÜK | sor_queue tablosu büyüdükçe `list_custom_records` yavaşlar | Performans degradasyonu | `status='uploaded'` kayıtları periyodik temizle |
| **L2** | DÜŞÜK | Workflow UI'da "SOR Process Workflow" her 2 dakikada log üretir → log tablosu şişer | Storage | OwnPilot'ta workflow log retention ayarı varsa konfigüre et |
| **L3** | DÜŞÜK | Voorinfra opdracht_id → filename'den parse etme brittle (`'12345_1A_v3.SOR'.split('_')[0]`) | Yanlış upload hedefi | Doğrulama: SOR naming convention'ı teyit et |

---

## S31 Best Practices Sentezi

> Kaynak: Agent `ab3be49a46b8115c2` — n8n, Temporal, Windmill karşılaştırması

### Sektör Konsensüsü: Transactional Outbox = Standart

| Platform | Yaklaşım | OwnPilot İçin Ders |
|----------|----------|---------------------|
| **n8n** | Shared PostgreSQL schema, `EXECUTIONS_DATA_PRUNE` env, Redis queue mode for scale, S3 for binary | Custom Data = shared schema (doğru), binary'yi ayrı tut (S30 kararı doğrulandı) |
| **Temporal** | Event sourcing, workflow state DB'de shard atomic, external queue'ya gerek yok | OwnPilot Temporal değil, ama aynı fikir: state DB'de → schedule = doğal retry |
| **Windmill** | Workspace isolation, S3 for large files, `pg_notify` lightweight trigger | `pg_notify` OwnPilot'a eklenebilir — şimdilik scheduled trigger yeterli |
| **Outbox Pattern** | DB write + event atomik → schedule/queue consumer okur → idempotent process | **Bu tam Queue Pattern'ımız**: enqueue (DB write) + scheduled processor + skip_if_exists |

### Neden Queue Pattern Best Practice?

1. **Atomik**: Enqueue = tek DB insert, atomik (transaction garantisi)
2. **Non-blocking**: Fire-and-forget, WhatsApp handler'ı bloke etmez
3. **Restart-safe**: Queue DB'de, container restart = processor sonraki run'da devam
4. **Audit trail**: Her SOR'un `status`, `uploaded_at`, `last_error` izlenebilir
5. **Idempotent**: `skip_if_exists=True` → çift upload riski yok
6. **Debounce built-in**: 2 dk window → burst'ları doğal gruplar

### Neden Shared PostgreSQL (Custom Data) Doğru Seçim?

1. **Cross-workflow AI context:** "Geçen hafta kaç SOR yüklendi ve hangi T4F göreviyle ilişkilendirilebilir?" — AI tek DB'de hepsini sorgulayabilir.
2. **Backup tek noktadan:** `pg_dump` bir kez çalıştırınca tüm workflow logları, queue'lar, izleme verileri gelir.
3. **Custom Data = no migration:** Extension veya workflow yeni tablo istediğinde `create_custom_table(name, columns)` çağrısı yeterli. `schema.ts`'e hiç dokunulmaz.
4. **`ownerPluginId` izolasyonu:** Her Extension kendi tablolarını `ownerPluginId: 'sor-processor'` ile tag'ler. Extension kaldırıldığında veriler cascade siler.
5. **pgvector entegrasyonu:** Custom Data + pgvector = workflow sonuçlarını semantik arama ile bulabilirsin ("geçen ay yüklenen tüm SOR'lardan anomalileri bul").

### Harici DB Ne Zaman Gerekir?

OwnPilot Custom Data (PostgreSQL içi) YETERLİ — harici DB gerekmez:
- < 5 tablo
- Veri < 100 MB
- FK/complex relational model yok
- Standalone operation gerekmiyor
- Compliance/privacy isolation gerekmiyor

SOR queue bu kriterlerin hepsine uyuyor → Custom Data = doğru seçim.

---

## Extension vs Workflow — Ne Zaman Ne

| Durum | Kullan |
|-------|--------|
| Tek adım, basit logic, tekrar kullanılabilir tool | Extension (JS code tool) |
| Multi-step, conditional, retry, tracking | Workflow (DAG) |
| Periyodik batch (cron) + tracking | Workflow + Schedule Trigger |
| Reactive (event-based) + queue | Webhook Trigger + Workflow |
| AI'ın context'e ihtiyacı var | Extension (system_prompt ekler) |

**SOR workflow = Workflow** (multi-step + tracking + retry + scheduling).
Gelecekte "SOR format analizi yap, anomali tespit et" = Extension (AI tool, system prompt ile).

---

## 2-Line Fix — Şimdi Değil, Gelecekte

| Senaryo | Fix Gerekli mi? |
|---------|----------------|
| SOR Queue (bu workflow) | ❌ Gerekmez — scheduled trigger event payload almaz |
| Event-driven workflow (webhook tetiklemeli, `{{ inputs.field }}` kullanıyor) | ✅ Gerekir |
| Gerçek zamanlı başka bir şey | ✅ Gerekir |

**Fix yeri:** `engine.ts:350` ve `webhooks.ts:181` — 2 satır, düşük risk.
```typescript
// engine.ts:348 — ÖNCE:
const wfLog = await service.executeWorkflow(workflowId, this.config.userId);
// SONRA:
const wfLog = await service.executeWorkflow(
  workflowId, this.config.userId, undefined, { inputs: payload }
);

// webhooks.ts:181 — ÖNCE:
.executeWorkflow(workflowId, trigger.userId ?? 'default')
// SONRA:
.executeWorkflow(workflowId, trigger.userId ?? 'default', undefined, { inputs: _payload })
```

---

## Gözlemlenebilirlik

OwnPilot built-in:
- `workflow_logs` tablosu → her execution: status, durationMs, node sonuçları
- `sor_queue` custom table → her dosya için granüler takip
- TriggerEngine execution logs → her trigger fire'ı

Sorgulanabilir:
```sql
-- Son 24 saat SOR upload özeti
SELECT status, COUNT(*), MIN(enqueued_at), MAX(uploaded_at)
FROM custom_data_records
WHERE table_id = 'sor_queue'
  AND enqueued_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Bugün kaç SOR yüklendi?
SELECT COUNT(*) FROM custom_data_records
WHERE table_id = 'sor_queue' AND status = 'uploaded'
  AND uploaded_at::date = CURRENT_DATE;

-- Başarısız olanlar
SELECT filename, last_error, retry_count, enqueued_at
FROM custom_data_records
WHERE table_id = 'sor_queue' AND status = 'failed'
ORDER BY enqueued_at DESC LIMIT 20;
```

---

## Tam Kurulum Sırası (S32, Süre Tahminleri)

| Adım | İşlem | Süre | Risk |
|------|-------|------|------|
| 1 | voorinfra `client.py` + `mcp_server_api.py` değişiklikleri | 15 dk | Düşük |
| 2 | Test: `python3 -c "from api.client import Client; ..."` | 5 dk | — |
| 3 | `sor_queue` custom table → OwnPilot AI chat | 5 dk | Sıfır |
| 4 | SOR Process Workflow DAG → OwnPilot UI | 20 dk | Sıfır |
| 5 | Schedule trigger → OwnPilot UI | 5 dk | Sıfır |
| 6 | `whatsapp-api.ts` değişikliği (+20 satır) | 15 dk | Düşük |
| 7 | `docker build` + `docker push` + deploy | 10 dk | Orta (QR riski yok, named volume) |
| 8 | Smoke test: SOR mesajı → sor_queue kayıt → 2 dk bekle → uploaded | 10 dk | — |
| **Toplam** | | **~85 dk** | |

**Not:** Adım 3-5 hiç kod yazmadan UI'da yapılır. Adım 1 ve 6'da toplam ~90 satır yeni kod.

---

## S32 Uygulama Öncelik Sırası (GÜNCEL)

### Önce (Hiç Kod Yazmadan Test Et)

1. **OwnPilot Custom Data API erişimi doğrula** (C1 riski)
   - `curl -X POST http://localhost:8080/api/v1/custom-data/tables/sor_queue/records` → 200 mu?
   - Token gerekiyor mu? → Yanıt auth mekanizmasını belirler
   - Internal process call için token exempt mi?

2. **`sor_queue` tablosunu OwnPilot UI'da oluştur**
   - Custom Data → New Table → kolonları yukarıdaki şemaya göre ekle

3. **Scheduled Workflow'u UI'da oluştur (no-code)**
   - Trigger: Schedule `*/2 * * * *`
   - Node 1: `list_custom_records` tool
   - Node 2: condition (`{{ node1.output }}.length > 0`)
   - Node 3: ForEach → `upload_sor_bytes` → `update_custom_record`

### Sonra (Kod Değişiklikleri)

4. **`voorinfra/mcp_server_api.py` → `upload_sor_bytes` tool ekle** (~40 satır)
5. **`voorinfra/client.py` → `upload_file_bytes()` ekle** (~30 satır)
6. **`whatsapp-api.ts` → SOR enqueue logic ekle** (~20 satır)
   - SOR detect → Buffer.from(att.data).toString('base64') → fire-and-forget POST

### En Son (Docker Rebuild)

7. **Container rebuild** — yeni `whatsapp-api.ts` kodu için
   - `--no-verify` gerekecek (pre-existing cli typecheck hatası)
   - WhatsApp session korunur (named volume)

### Opsiyonel (S30 Planı — Hala Geçerli)

8. Backup scripti kur (risk sıfır, istediğin zaman)
9. `file_path` migration — binary DB'den çıkar (büyük refactor, deferrable)

---

## Deferred (S29'dan taşınan)

| Item | Öncelik | Not |
|------|---------|-----|
| UNIQUE(channel_id, external_id) constraint | MEDIUM | Data audit gerekiyor |
| `create()` ON CONFLICT in service-impl.ts | MEDIUM | Race condition riski |
| Composite index `idx_channel_messages_channel_jid_created` | LOW | Safe additive |
| Network flapping detection | LOW | `recentDisconnectTimestamps[]` |
| Upstream PR merge | — | Maintainer bekleniyor |
