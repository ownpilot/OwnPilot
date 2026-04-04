# Session Handoff S34: VoorinfraAPIServer → OwnPilot MCP Entegrasyonu

**Tarih:** 2026-03-07
**Oturum:** S34 (araştırma tamamlandı, implementasyon başlamadı)
**Kural:** ANA MCP SERVER'A ASLA DOKUNMA — sadece klon ile çalış

---

## 1. NEDEN BU MİGRASYON?

### Mevcut Durum (SORUNLU)
```
WhatsApp (Sor Euronet) → OwnPilot DB → sor_queue → Python cron (host) → Voorinfra API
```
- Python cron `~/scripts/sor-upload-cron.py` HOST'ta çalışıyor (systemd timer, 60s polling)
- Dış bağımlılık — OwnPilot içinde yönetilemiyor
- Hedef: Her şeyi OwnPilot içinde yönetmek

### Hedef Durum
```
WhatsApp → OwnPilot DB → sor_queue → OwnPilot Schedule Trigger → VoorinfraAPIServer MCP (Docker) → Voorinfra API
```
- VoorinfraAPIServer MCP ayrı Docker container'da (KLONLANMIŞ, orijinale dokunulmamış)
- OwnPilot'un mcp_servers tablosuna kayıtlı
- Dokploy'dan yönetilen

---

## 2. DERINLEMESINE ARASTIRMA BULGULARI (S34'te 7 Agent)

### 2.1 Neden Extension + Event Trigger CALISMAZ

| Engel | Kanıt | Sonuç |
|-------|-------|-------|
| `fetch()` sandbox'ta yok | `extension-sandbox.ts:137-172` | Voorinfra API'ye bağlanılamaz |
| `localhost` SSRF korumasıyla bloklu | `dynamic-tool-sandbox.ts:23-51` | OwnPilot kendi API'sine bile ulaşamaz |
| 30s CPU timeout | `extension-sandbox.ts:17-18` | Büyük SOR + API latency = timeout |
| Config Center değerleri inject edilmiyor | `extension-service.ts:298-303` | Credentials erişilemiyor |

### 2.2 Neden MCP + streamable-http DOGRU YAKLASIM

- VoorinfraAPIServer zaten `--http` flag'i destekliyor (`mcp_server_api.py` son satırlar)
- `server.run(transport="streamable-http")` — sıfır kod değişikliği
- Default port: **8766**
- OwnPilot `mcp_servers` tablosu: stdio / sse / **streamable-http** destekliyor
- Docker container → container HTTP iletişimi: SORUNSUZ

### 2.3 Trigger Mimarisi (Devil's Advocate Bulgusu)

Saf event-driven 19 HIGH severity risk taşıyor:
- Event loss (gateway crash)
- No retry mechanism
- Duplicate upload (WhatsApp reconnect)

**Çözüm: HYBRID — sor_queue buffer KORUNUYOR**
- PG trigger (trg_enqueue_sor) → sor_queue'ya INSERT (MEVCUT — değişmiyor)
- OwnPilot **Schedule Trigger** (60s) → sor_queue poll → MCP tool çağrısı
- FOR UPDATE SKIP LOCKED (idempotency)
- sor_queue audit trail korunuyor

### 2.4 OwnPilot Trigger Sistemi

```typescript
// Event trigger format (engine.ts:423-466):
config: {
  eventType: 'channel.message.received',
  filters: { 'message.platformChatId': '120363423491841999@g.us' }
}

// Schedule trigger format:
config: { cron: '* * * * *', timezone: 'Europe/Amsterdam' }

// Tool action:
action: { type: 'tool', payload: { toolId: 'mcp.voorinfra.upload_sor', input: {} } }
```

### 2.5 VoorinfraAPIServer MCP Araçları (12 tool)

Mevcut araçlar (`mcp_server_api.py`):
- `login` — Voorinfra'ya giriş (PHPSESSID cookie)
- `session_status` — Oturum durumu
- `get_task_list` — Görev listesi
- `get_task_detail` — Görev detayı
- `query_grid` — Grid sorgulama
- `lookup_address` — Adres arama (postcode + huisnummer)
- `batch_search` — Toplu adres arama
- `upload_sor` — **ANA ARAÇ** — SOR dosya yükleme
- `batch_upload` — Toplu yükleme
- `mega_sor_workflow` — Tam pipeline
- `get_sor_stats` — Queue istatistikleri
- `get_upload_history` — Upload geçmişi

### 2.6 Voorinfra API Detayları

```
Base URL: https://voorinfra.connectsoftware.nl
Login: POST /app/login (form-urlencoded, CSRF token gerekli)
Grid Search: GET /tfc/views/planbord/connectors/conn_grid_planlijst.php?profielid=594&dhx_filter[6]=POSTCODE&dhx_filter[4]=HUISNUMMER
  → XML döndürür, opdracht_id = <userdata name="opdracht_id"> tag'ından
Upload: POST /tfc/views/opdrachten/connectors/conn_file_upload.php?opdrachtid=UUID&mode=html5
  → multipart/form-data, fields: file, file_fullname, file_id
Auth: Cookie-based (PHPSESSID), session lifetime ~1 saat
```

### 2.7 SOR Pipeline DB Durumu

```sql
-- PG Trigger (MEVCUT, DEGISMIYOR):
AFTER INSERT ON channel_messages
IF direction='inbound' AND content ILIKE '%.sor'
   AND attachments != [] AND attachments->0->>'data' IS NOT NULL
   AND metadata->>'jid' = '120363423491841999@g.us'  -- SADECE Sor Euronet grubu
THEN INSERT INTO sor_queue(message_id, channel_id, filename) ON CONFLICT DO NOTHING

-- sor_queue şeması:
id, message_id (UNIQUE), channel_id, filename,
status (pending/processing/done/error), error, created_at, processed_at

-- Mevcut durum:
3 pending kayıt
549 total attachment ama sadece 3 queue'de (trigger strict)
```

### 2.8 OwnPilot Internal API (Referans)

```
Auth: Authorization: Bearer <api-key>  OR  X-API-Key: <api-key>
API key: DB settings table 'gateway_api_keys' OR env API_KEYS
Media endpoint: GET /api/v1/channels/messages/:id/media/:index → binary
```

---

## 3. ANA KAYNAK DOSYALARI

### VoorinfraAPIServer MCP (ORIJINAL — DOKUNMA!)
```
/home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/
├── mcp_server_api.py          # ANA SERVER (115KB, ~2800 satır) — DOKUNMA!
├── api/
│   ├── client.py              # REST API client (1449 satır)
│   ├── parser.py              # XML parser
│   ├── grid_cache.py          # SQLite cache
│   └── sor_manager.py         # SOR file yönetimi
├── config.py                  # Konfigürasyon
├── requirements.txt           # httpx, mcp[cli], pydantic, python-dotenv, lxml, pandas, openpyxl
├── .env                       # CREDENTIALS (git'e girmesin!)
└── .env.example               # Template
```

### Claude Code MCP Config (ORIJINAL — DOKUNMA!)
```json
// ~/.claude.json içinde:
"VoorinfraAPIServer": {
  "command": "/home/ayaz/projects/scrapling-workspace/.venv/bin/python",
  "args": ["/home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/mcp_server_api.py"],
  "env": { "PYTHONPATH": "/home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api" }
}
```

### Klon Hedefi (BURAYA KOPYALANACAK)
```
/home/ayaz/projects/voorinfra-mcp-ownpilot/   ← YENİ DIZIN
```

---

## 4. UYGULAMA PLANI (3 FAZ)

### FAZ 1: KLONLAMA + DOCKER IMAGE (S35 başlangıcı)

#### Adım 1.1: Klonla (orijinale DOKUNMA)
```bash
# Orijinal: /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/
# Klon hedefi:
cp -r /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/ \
       /home/ayaz/projects/voorinfra-mcp-ownpilot/

# Doğrula:
ls /home/ayaz/projects/voorinfra-mcp-ownpilot/
diff -r /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/api/ \
        /home/ayaz/projects/voorinfra-mcp-ownpilot/api/

# .env kopyala (credentials):
cp /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/.env \
   /home/ayaz/projects/voorinfra-mcp-ownpilot/.env
```

#### Adım 1.2: Dockerfile Oluştur
```dockerfile
# /home/ayaz/projects/voorinfra-mcp-ownpilot/Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Sistem bağımlılıkları
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python bağımlılıkları
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kaynak kod
COPY . .

# Port
EXPOSE 8766

# PYTHONPATH
ENV PYTHONPATH=/app

# Başlatma: streamable-http modu
CMD ["python", "mcp_server_api.py", "--http", "--host", "0.0.0.0", "--port", "8766"]
```

#### Adım 1.3: .dockerignore
```
__pycache__/
*.pyc
.pytest_cache/
.coverage
*.log
browser-profile/
network_capture/
output/
test_output/
.planning/
.claude-flow/
```

#### Adım 1.4: Docker Build + Push
```bash
cd /home/ayaz/projects/voorinfra-mcp-ownpilot/

# Build
docker build -t localhost:5000/voorinfra-mcp:latest .

# Test (lokal)
docker run --rm -p 8766:8766 \
  --env-file .env \
  localhost:5000/voorinfra-mcp:latest

# Health check
curl http://localhost:8766/health  # veya MCP endpoint test

# Push to local registry
docker push localhost:5000/voorinfra-mcp:latest
```

#### Adım 1.5: Dokploy'a Ekle
```yaml
# OwnPilot compose'una ekleme (Dokploy üzerinden):
voorinfra-mcp:
  image: localhost:5000/voorinfra-mcp:latest
  environment:
    VOORINFRA_EMAIL: "${VOORINFRA_EMAIL}"
    VOORINFRA_PASSWORD: "${VOORINFRA_PASSWORD}"
    VOORINFRA_CONTRACTOR_CODE: "${VOORINFRA_CONTRACTOR_CODE}"
    VOORINFRA_PINCODE: "${VOORINFRA_PINCODE}"
  networks:
    - ownpilot-network
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "python", "-c", "import httpx; httpx.get('http://localhost:8766/health')"]
    interval: 30s
    timeout: 10s
    retries: 3
```

#### Adım 1.6: MCP Server Test
```bash
# Container çalışıyor mu?
docker ps | grep voorinfra-mcp

# MCP endpoint erişilebilir mi? (container içinden veya network'ten)
curl -X POST http://voorinfra-mcp:8766/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Beklenen: 12 tool listesi
```

---

### FAZ 2: OWNPILOT MCP KAYDI + TRIGGER (S35 devamı)

#### Adım 2.1: OwnPilot'a MCP Server Kaydet
```bash
# OwnPilot API key'i bul:
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot \
  -c "SELECT value FROM settings WHERE key='gateway_api_keys' LIMIT 1;" 2>/dev/null
# VEYA: docker exec ownpilot env | grep API_KEY

# MCP server kaydı:
curl -X POST http://localhost:8080/api/v1/mcp/servers \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "voorinfra",
    "displayName": "Voorinfra Planbord MCP",
    "transport": "streamable-http",
    "url": "http://voorinfra-mcp:8766/mcp",
    "enabled": true,
    "autoConnect": true
  }'

# Bağlantı kontrolü:
curl http://localhost:8080/api/v1/mcp/servers \
  -H "Authorization: Bearer <API_KEY>"
# Beklenen: status: "connected", toolCount: 12
```

#### Adım 2.2: Schedule Trigger Oluştur (sor_queue poll)
```bash
# 60s'de bir sor_queue'yu işleyen trigger:
curl -X POST http://localhost:8080/api/v1/triggers \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SOR Queue Processor",
    "description": "Her 60s sor_queue pending kayitlari Voorinfra API ile upload eder",
    "type": "schedule",
    "config": {
      "cron": "* * * * *",
      "timezone": "Europe/Amsterdam"
    },
    "action": {
      "type": "tool",
      "payload": {
        "toolId": "mcp.voorinfra.mega_sor_workflow",
        "input": {
          "mode": "queue",
          "limit": 10
        }
      }
    },
    "enabled": true
  }'
```

**NOT:** `mega_sor_workflow` MCP tool'u zaten tüm pipeline'ı yönetiyor (login → search → upload). Eğer bu tool sor_queue'yu okumuyorsa, alternatif yaklaşım için Bölüm 5'e bak.

#### Adım 2.3: Paralel Test (Cron DA çalışıyor — dual monitoring)
```bash
# sor_queue durumu izle:
watch -n 5 'docker exec ownpilot-postgres psql -U ownpilot -d ownpilot \
  -c "SELECT status, COUNT(*) FROM sor_queue GROUP BY status;"'

# trigger_history izle:
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot \
  -c "SELECT trigger_name, status, error, duration_ms, fired_at FROM trigger_history ORDER BY fired_at DESC LIMIT 20;"

# 5-7 gün DUAL monitoring → her iki sistem de çalışıyor
# Duplicate upload kontrolü yapılmalı
```

---

### FAZ 3: CRON DECOMMİSSİON (S35 sonu veya S36)

```bash
# PRE-FLIGHT: Pending kayıt OLMAMALI
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot \
  -c "SELECT COUNT(*) FROM sor_queue WHERE status='pending';"
# Beklenen: 0

# Cron'u durdur:
systemctl --user stop sor-upload.timer
systemctl --user disable sor-upload.timer

# 7 gün daha monitor et, sorun yoksa:
# cron script'i arşivle (silme!):
mv ~/scripts/sor-upload-cron.py ~/scripts/sor-upload-cron.py.ARCHIVED_$(date +%Y%m%d)
```

---

## 5. KRITIK NOTLAR VE RISKLER

### 5.1 mega_sor_workflow vs. Özel Trigger

`mega_sor_workflow` MCP tool'u **Voorinfra DB/queue'yu** yönetiyor (SQLite tabanlı), OwnPilot'un `sor_queue` tablosunu değil.

Bu durumda 2 seçenek:

**Seçenek A: OwnPilot trigger → MCP tool aracılığıyla sor_queue okuma**
- Trigger → `upload_sor` tool'una message_id + binary data geç
- Tool Voorinfra'ya upload et
- OwnPilot trigger'ı sor_queue'yu poll etmeli

**Seçenek B: MCP tool'a sor_queue erişimi ver**
- VoorinfraAPIServer MCP'ye OwnPilot DB connection string ekle
- Tool kendi içinde sor_queue okuyup, FOR UPDATE SKIP LOCKED yapıp işler
- Bu daha temiz ama DB coupling yaratır

**Tavsiye: Seçenek A** — loose coupling, OwnPilot trigger logic sahip olur.

**Örnek Trigger Action (Seçenek A):**
```
Trigger her 60s:
1. OwnPilot internal API'yi çağır: GET /api/v1/sor-queue/pending (yoksa doğrudan DB query)
2. Her pending kayıt için: GET /api/v1/channels/messages/:id/media/0 → binary
3. MCP tool çağır: mcp.voorinfra.upload_sor(opdracht_id, filename, file_bytes)
4. Sonuca göre sor_queue güncelle
```

Ancak OwnPilot trigger action'larında bu kadar karmaşık logic yok. **Daha pratik:**
- Yeni bir `chat` action trigger: AI'a "sor_queue'yu işle" talimatı ver
- AI mcp.voorinfra araçlarını kullanır
- Ama bu non-deterministik

**En temiz çözüm:** MCP tool'a minimal bir yeni araç ekle:
```python
# Klona eklenecek (orijinale değil!):
@server.tool()
async def process_ownpilot_sor_queue(
    ownpilot_api_url: str,
    ownpilot_api_key: str,
    limit: int = 10
) -> dict:
    """OwnPilot sor_queue'dan pending kayıtları alıp Voorinfra'ya upload eder."""
    # 1. OwnPilot API'den pending kayıtları al
    # 2. Her biri için media binary al
    # 3. Voorinfra'ya upload et
    # 4. Sonucu OwnPilot API'ye bildir (status=done/error)
```
Bu tool, S35'te klona eklenecek.

### 5.2 Idempotency Garantisi

```sql
-- sor_queue tablosunda UNIQUE(message_id) var — duplicate koruması mevcut
-- FOR UPDATE SKIP LOCKED kullanımı zorunlu
-- MCP tool bunu implement etmeli
```

### 5.3 Session / Cookie Yönetimi

VoorinfraAPIServer her restart'ta re-login yapıyor. Docker container restart = re-login. Bu normal, session ~1 saat yaşıyor. Sorun değil.

### 5.4 Migration Güvenliği

**ASLA** orijinale dokunma:
```
/home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/  ← ORIJINAL, READONLY
/home/ayaz/projects/voorinfra-mcp-ownpilot/                   ← KLON, burada çalış
```

Claude Code'daki MCP config değişmeyecek — orijinal stdio MCP hâlâ çalışmaya devam edecek.

---

## 6. MEVCUT SİSTEM DURUMU (S34 Sonu)

| Bileşen | Durum |
|---------|-------|
| OwnPilot container | UP (port 8080, QR scan yapıldı, WhatsApp bağlı) |
| OwnPilot DB | UP (sor_queue tablosu VAR, 3 pending kayıt) |
| PG trigger (trg_enqueue_sor) | AKTİF |
| Python cron (sor-upload-cron.py) | AKTİF (systemd timer, 60s) — henüz durdurulmadı |
| VoorinfraAPIServer MCP (orijinal) | Claude Code'da AKTİF (stdio) |
| Docker image (ownpilot) | rebuild edildi (sha: 02cf7453), schema.ts kalıcı |
| Docker image (voorinfra-mcp) | YOK — S35'te oluşturulacak |
| Bridge | UP (port 9090) |

### Yapılan S34 İşleri
- sor-upload-cron.py: hardcoded IP → `os.environ.get("OWNPILOT_DB_DSN")` ✅
- systemd service: `Environment=OWNPILOT_DB_DSN=...` eklendi ✅
- OwnPilot Docker rebuild (sha: 02cf7453) ✅
- Registry push ✅
- Container restart, WhatsApp QR scan ✅
- 7 specialist agent araştırması tamamlandı ✅
- Mimari karar alındı: MCP + streamable-http + hybrid queue ✅

---

## 7. S35 BAŞLANGIÇ KONTROL LİSTESİ

```bash
# 1. Sistem durumu:
docker ps | grep -E "ownpilot|voorinfra"
curl -s http://localhost:8080/health
curl -s http://localhost:9090/ping

# 2. sor_queue durumu:
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot \
  -c "SELECT status, COUNT(*) FROM sor_queue GROUP BY status;"

# 3. Cron hâlâ çalışıyor mu?
systemctl --user status sor-upload.timer

# 4. Orijinal MCP hâlâ untouched:
diff -r /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/api/ \
        /home/ayaz/projects/voorinfra-mcp-ownpilot/api/ 2>/dev/null || echo "Klon henüz yapılmadı"
```

---

## 8. REFERANS DOSYALARI

| Dosya | İçerik |
|-------|--------|
| `SESSION_HANDOFF_2026-03-07-S33.md` | Bridge bug'ları (resolveIntent, spawn_cc async, GSD) |
| `SESSION_HANDOFF_2026-03-07-S33-A-DOCKER.md` | Docker rebuild planı (TAMAMLANDI) |
| Bu dosya | VoorinfraAPIServer MCP → OwnPilot entegrasyonu |

---

## 9. BAŞARI KRİTERLERİ (FAZ 1-3 SONUNDA)

| Kriter | Doğrulama |
|--------|-----------|
| Orijinal MCP dokunulmamış | `diff` ile compare |
| Klon Docker image çalışıyor | `docker ps`, port 8766 erişilebilir |
| OwnPilot'ta 12 MCP tool görünüyor | `/api/v1/mcp/servers` → toolCount: 12 |
| Schedule trigger 60s'de çalışıyor | `trigger_history` tablosunda kayıtlar |
| sor_queue pending → done akıyor | `SELECT status, COUNT(*) FROM sor_queue` |
| Python cron decommission edildi | `systemctl --user status sor-upload.timer` → inactive |
| Duplicate upload olmadı | Voorinfra'da çift kayıt yok |
| WhatsApp bağlı | OwnPilot UI channel status |
