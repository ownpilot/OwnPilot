---
generated_at: 2026-03-07
trigger_reason: explicit_user
protocol_version: v2.6.0
session_number: S36-BINARY-FLOW
active_skills: [voorinfra-upload, dokploy-manage]
pipeline_status: research_complete
files_updated: 0
lessons_added: {errors: 0, golden: 0, edge: 0}
coverage_scope: [binary-format-analysis, data-flow-pipeline, serialization, encoding, storage-architecture]
---

--- HANDOFF META ---
trigger: explicit_user
session: S36-BINARY-FLOW | protocol: v2.6.0
active_skills: [voorinfra-upload, dokploy-manage]
pipeline: research_complete (0 dosya degistirildi — pure analysis)
lessons: errors+0, golden+0, edge+0
coverage: binary-format-analysis, data-flow-pipeline, serialization, encoding, storage-architecture
--- END META ---

YENI SESSION BASLANGICI — SOR Binary Data Flow: WhatsApp'tan Voorinfra'ya Format Gecis Analizi
Bu session S35 sonrasindaki arastirma bulgularini derinlestirmek icindir.
Asagidaki adimlari SIRASYLA uygula — bolum atlama, kisaltma, token tasarrufu YASAK.
NOT: Bu prompt YENI (sifir-context) session icin tasarlandi. Eger mevcut bir
session'i resume ediyorsan (claude --resume), ADIM 1-2 atla, ADIM 3'ten basla.

================================================================================
ADIM 1: AKILLI CONTEXT YUKLEME
================================================================================

Once HANDOFF META blogunu oku (prompt basinda).
- active_skills: [voorinfra-upload, dokploy-manage]
- trigger: explicit_user
- pipeline: research_complete

--- AUTO-LOADED (zaten context'inde — Read YAPMA, dikkat et) ---
| Dosya | Bu Session'da Degisen |
|-------|----------------------|
| MEMORY.md | Degismedi — referans icin oku |

--- ZORUNLU OKU (context'inde YOK) ---

1. /home/ayaz/ownpilot/packages/gateway/src/db/repositories/channel-messages.ts
   SATIR 1-72: ChannelMessageAttachment interface + serializeAttachments() fonksiyonu
   BU DOSYA KRITIK: Binary'nin base64'e donusturuldugu TEK yer.
   Ozel dikkat: Uint8Array/Buffer → Buffer.from().toString('base64') donusumu
   Size hesabi: a.data.length (orijinal byte boyutu, inflate ONCESI)

2. /home/ayaz/ownpilot/packages/gateway/src/db/schema.ts
   SATIRLER:
   - 90-103: channel_messages tablo sema (attachments JSONB kolonu)
   - 984-995: sor_queue tablo sema (status state machine)
   - 1685-1709: enqueue_sor_message() PG trigger fonksiyonu
   - 2131-2132: sor_queue indexleri
   OZEL DIKKAT:
   - Trigger kosulu: direction='inbound' AND content ILIKE '%.sor' AND attachments->0->>'data' IS NOT NULL
   - Bu kosul base64 data'nin MEVCUT oldugunu dogruluyor — data NULL olan mesajlar ATLANIR

3. /home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts
   SATIRLER:
   - 1849-1880: downloadMediaWithRetry() — Baileys downloadMediaMessage() wrapper
   - 1705-1715: History sync handler — binary indirilMEZ, sadece metadata
   OZEL DIKKAT:
   - Real-time mesajlar: binary var (downloadMediaMessage → Buffer)
   - History sync mesajlar: binary YOK (CDN URL expired → data=null)
   - retryMediaFromMetadata(): expired URL recovery mekanizmasi

4. /home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/message-parser.ts
   SATIRLER:
   - 26-34: WhatsAppDocumentMetadata interface (mediaKey, directPath, url, hasMediaKey)
   - 129-152: SOR dosyasi parse — mediaKey Uint8Array → base64 donusumu
   OZEL DIKKAT:
   - mediaKey raw Uint8Array olarak geliyor, base64'e cevriliyor, metadata'da saklaniyor
   - mediaKey != dosya icerigi — AES-256-CBC sifreleme anahtari

5. /home/ayaz/projects/voorinfra-mcp-ownpilot/mcp_server_api.py
   SATIRLER 2536-2795: process_ownpilot_sor_queue() tool
   OZEL DIKKAT:
   - Satir 2617-2621: channel_messages'tan attachments JSONB okuma
   - Satir 2655: attachments[0].get("data") — base64 string
   - Satir 2672: base64.b64decode(data_b64) → file_bytes (ham binary)
   - Satir 2765: client.upload_file_bytes(opdracht_id, filename, file_bytes) — multipart upload
   - Satir 2688-2689: filename resolution: name → filename → content (fallback zinciri)

--- ON-DEMAND OKU (derinlestirme gerekirse) ---

1. /home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/WHATSAPP-GUIDE.md
   → Media Recovery Pipeline bolumu (satir ~268+): CDN URL expire, reupload, retry stratejisi
2. /home/ayaz/projects/voorinfra-mcp-ownpilot/api/client.py
   → upload_file_bytes() metodu — multipart/form-data POST detaylari
3. /home/ayaz/projects/voorinfra-mcp-ownpilot/config.py
   → SOR_PARSER.parse() fonksiyonu — filename → postcode + huisnummer + toevoeging

================================================================================
ADIM 2: DURUM KONTROLU
================================================================================

Bu handoff ARASTIRMA odaklidir — production sistemlerde degisiklik YAPTIRMAZ.
Yine de pipeline'in canli oldugunu dogrulamak icin:

# OwnPilot ve Voorinfra MCP Container
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E "ownpilot|voorinfra"
# Beklenen: ownpilot Up (healthy), ownpilot-postgres Up (healthy), voorinfra-mcp Up (healthy)

# Son SOR queue durumu
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "
  SELECT status, COUNT(*) FROM sor_queue GROUP BY status ORDER BY status;
"
# Beklenen: done | 3 (veya daha fazla yeni SOR geldiyse)

# Son basarili upload zamani
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "
  SELECT filename, status, processed_at
  FROM sor_queue WHERE status='done'
  ORDER BY processed_at DESC LIMIT 5;
"

# Son channel_messages'ta SOR dosyasi var mi?
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "
  SELECT id, content, direction,
         jsonb_array_length(COALESCE(attachments, '[]'::jsonb)) AS att_count,
         CASE WHEN attachments->0->>'data' IS NOT NULL THEN 'HAS_BINARY' ELSE 'NO_BINARY' END AS binary_status,
         created_at
  FROM channel_messages
  WHERE content ILIKE '%.sor'
  ORDER BY created_at DESC LIMIT 10;
"
# OZEL DIKKAT: binary_status kolonu — HAS_BINARY olan satirlar sor_queue'ya girmis olmali
# NO_BINARY olanlar history sync'ten gelmis, data=null — trigger ATLAMIS (DOGRU DAVRANIS)

Bilinen anomaliler (gormezden gel):
- OwnPilot health "degraded" → Docker sandbox yok, calismayi ETKILEMEZ
- History sync mesajlarda data=null → Beklenen davranis, CDN URL expired

================================================================================
ADIM 3: BU SESSION'IN AMACI
================================================================================

Genel baglam: WhatsApp'tan gelen SOR (fiber olcum, Bellcore format) dosyalari
birden fazla format donusumundan gecerek OwnPilot PostgreSQL'de depolanip
oradan Voorinfra GoConnectIT Planbord'a yukleniyor. Bu handoff, pipeline
boyunca verinin hangi formatta, nerede, nasil depolandigini analiz eder.

Bu session'in TEK ANA HEDEFI:
Binary data flow pipeline'indaki her node'u anlayip, darbogazlari/riskleri/
optimizasyon firsatlarini tespit etmek. Araciyla:

A) Format donusum haritasi cikarma (Uint8Array → base64 → JSONB → bytes → multipart)
B) Her node'daki boyut inflate/deflate'i olcme
C) Data loss riskleri (null data, corrupt base64, truncated binary)
D) Performans darbogazlari (base64 overhead, JSONB TOAST, psycopg2 memory)
E) Iyilestirme onerileri (bytea kolonu, streaming, batch optimize)

Scope sinirlari:
ICINDE:
- channel_messages.attachments JSONB yapisinin analizi
- serializeAttachments() fonksiyonunun davranisi
- PG trigger'in binary data varlik kontrolu
- process_ownpilot_sor_queue()'daki base64 decode akisi
- Baileys downloadMediaMessage() → Buffer → Uint8Array donusum zinciri
- Real-time vs history sync mesajlardaki binary farki
- mediaKey vs dosya icerigi ayrimi
- Boyut analizi: ham binary vs base64 vs JSONB TOAST compressed
- Multipart upload formatinin beklentileri
DISINDA:
- Orijinal VoorinfraAPIServer MCP'ye DOKUNMA
- OwnPilot core kodunu DEGISTIRME
- Voorinfra GoConnectIT backend'ine DOKUNMA
- Docker image rebuild (sadece bug varsa)
- sor_queue state machine degisiklikleri

================================================================================
ADIM 4: TAMAMLANAN ARASTIRMA DETAYLARI (REFERANS)
================================================================================

Bu bolum onceki session'daki (S35+) arastirma bulgularini TAMAMEN icerir.
Yeni session bunu BASE olarak kullanacak, yeniden arastirma YAPMAYACAK.

--- NODE 1: WhatsApp CDN → Baileys ---

Kaynak: whatsapp-api.ts:1849-1880

Format: WhatsApp mesaj geldiginde, media icerigi WhatsApp CDN sunucularinda
sifrelenmis olarak saklanir. Her dosya AES-256-CBC ile sifrelidir ve sifre
cozme icin per-message "mediaKey" gerekir.

Baileys'in downloadMediaMessage() fonksiyonu:
  1. CDN URL'den sifrelenmis veriyi indirir
  2. mediaKey ile sifre cozer
  3. Node.js Buffer olarak dondurur

Kod akisi:
```typescript
// whatsapp-api.ts:1854
const buffer = await downloadMediaMessage(msg, 'buffer', {}, downloadOptions);
// Buffer → Uint8Array donusumu
if (Buffer.isBuffer(buffer)) {
  return new Uint8Array(buffer);
}
```

Girdi formati: Sifreli binary (CDN'de)
Cikti formati: Uint8Array (Node.js RAM'de, sifre cozulmus ham SOR)

KRITIK EDGE CASE: History sync mesajlarinda CDN URL suresi dolmus olabilir.
Bu durumda downloadMediaMessage() BASARISIZ olur, data=null/undefined kalir.
PG trigger (trg_enqueue_sor) data IS NOT NULL kontrolu ile bu mesajlari
OTOMATIK OLARAK ATLAR — bu dogru davranis.

--- NODE 2: Baileys → serializeAttachments() ---

Kaynak: channel-messages.ts:44-72

Bu fonksiyon OwnPilot'un attachment serialization katmani. Binary veriyi
JSON-compatible formata cevirir:

```typescript
export function serializeAttachments(attachments) {
  return attachments.map((a) => {
    let dataStr: string | undefined;
    if (a.data instanceof Uint8Array || Buffer.isBuffer(a.data)) {
      dataStr = Buffer.from(a.data as Uint8Array).toString('base64');
    } else if (typeof a.data === 'string') {
      dataStr = a.data; // zaten base64 string ise dokunma
    }
    return {
      type: a.type,
      url: a.url ?? '',
      name: a.name,
      mimeType: a.mimeType,
      filename: a.filename,
      data: dataStr,
      size: a.size ?? (a.data ? (a.data as Uint8Array).length : undefined),
    };
  });
}
```

Girdi: Uint8Array veya Buffer (ham binary)
Cikti: string (base64 encoded)

BOYUT ETKISI: Base64 encoding her 3 byte'i 4 karaktere cevirir.
  - 28 KB SOR → ~37.3 KB base64 string (%33 inflate)
  - 100 KB SOR → ~133 KB base64 string

DIKKAT: size alani orijinal byte boyutunu (inflate ONCESI) kaydeder.
  Bu, dosyanin gercek boyutunu bilmek icin faydali.

--- NODE 3: serializeAttachments() → PostgreSQL JSONB ---

Kaynak: schema.ts:90-103

channel_messages tablosu:
```sql
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender_id TEXT,
  sender_name TEXT,
  content TEXT,        -- SOR dosyasi icin: filename ("1104GV_367_V1.SOR")
  content_type TEXT,
  attachments JSONB,   -- [{"type":"document","data":"TWFwAA...","filename":"..."}]
  reply_to_id TEXT,
  conversation_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Depolanan JSONB yapisi (gercek ornek):
```json
[
  {
    "type": "document",
    "url": "https://mmg.whatsapp.net/v/t62.7118-24/...",
    "name": "1104GV_367_V1.SOR",
    "mimeType": "application/octet-stream",
    "filename": "1104GV_367_V1.SOR",
    "data": "TWFwAAQAAwAAAGhSQ1NEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa...",
    "size": 28672
  }
]
```

STORAGE MEKANIZMASI:
  - PostgreSQL JSONB binary formatta saklar (JSON text degil)
  - JSONB TOAST mekanizmasi: >2KB veri otomatik compress + out-of-line storage
  - Base64 string JSONB icinde TOAST compressed saklaniyor
  - Tahmini disk boyutu: 28KB SOR → ~37KB base64 → ~25-30KB TOAST compressed
  - TOAST compression base64'un predict edilebilir karakter dagilimini exploit eder

PERFORMANS NOTU:
  - JSONB parse: her okumada tum array deserialize edilir (sadece ilk element gerekse bile)
  - attachments->0->>'data' operasyonu: JSONB icinden tek alan cikarma — verimli
  - Ama buyuk data alanli JSONB satirlarinda TOAST decompress maliyeti var

--- NODE 4: PG Trigger (trg_enqueue_sor) ---

Kaynak: schema.ts:1685-1709

```sql
CREATE OR REPLACE FUNCTION enqueue_sor_message() RETURNS trigger AS $$
BEGIN
  IF NEW.direction = 'inbound'
     AND NEW.content ILIKE '%.sor'
     AND COALESCE(NEW.attachments, '[]'::jsonb) != '[]'::jsonb
     AND NEW.attachments->0->>'data' IS NOT NULL
     AND COALESCE(NEW.metadata, '{}')::jsonb->>'jid' = '120363423491841999@g.us'
  THEN
    INSERT INTO sor_queue(id, message_id, channel_id, filename)
    VALUES (gen_random_uuid()::text, NEW.id, NEW.channel_id, NEW.content)
    ON CONFLICT (message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

TRIGGER BINARY TASIMAZ — sadece referans (message_id) kaydeder.
sor_queue tablosu:
```sql
CREATE TABLE IF NOT EXISTS sor_queue (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id   TEXT NOT NULL,      -- → channel_messages.id (FK benzeri, ama explicit FK yok)
  channel_id   TEXT NOT NULL,
  filename     TEXT NOT NULL,      -- channel_messages.content'ten alinir
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending', 'processing', 'done', 'error')),
  error        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  UNIQUE(message_id)               -- idempotency: ayni mesaj 2 kez kuyruga giremez
);
```

KRITIK FILTRE KONTROLLERI:
  1. direction = 'inbound' → sadece gelen mesajlar
  2. content ILIKE '%.sor' → dosya adi .sor ile bitiyor
  3. attachments != '[]' → en az 1 attachment var
  4. attachments->0->>'data' IS NOT NULL → BIRINCI attachment'ta binary data VAR
  5. metadata->>'jid' = '120363423491841999@g.us' → SADECE Sor Euronet grubundan
  6. ON CONFLICT (message_id) DO NOTHING → ayni mesaj tekrar islenemez

EDGE CASE: History sync mesajlarinda data=null oldugu icin kosul #4 basarisiz olur
ve trigger sor_queue'ya INSERT YAPMAZ. Bu DOGRU davranistir.

--- NODE 5: process_ownpilot_sor_queue() Tool ---

Kaynak: mcp_server_api.py:2536-2795

Binary geri-cozme akisi:
```python
# 1. DB'den attachment oku (JSONB → Python dict/list)
cur.execute("""
    SELECT content, COALESCE(attachments, '[]'::jsonb) AS attachments
    FROM channel_messages WHERE id = %s
""", (message_id,))
msg_row = cur.fetchone()

# 2. Ilk attachment'in data alanini al
attachments = msg_row["attachments"]  # psycopg2 JSONB → Python list
data_b64 = attachments[0].get("data")  # base64 string

# 3. Base64 decode → ham binary
file_bytes = base64.b64decode(data_b64)  # bytes objesi

# 4. Filename resolution (fallback zinciri)
att_name = attachments[0].get("name") or attachments[0].get("filename") or msg_row["content"]
filename = Path(att_name).name if att_name else msg_row["content"]

# 5. SOR filename parse → postcode + huisnummer
parsed = SOR_PARSER.parse(filename)

# 6. Grid search → opdracht_id
opdracht_id = await client.get_opdracht_id(postcode, huisnummer, toevoeging)

# 7. Upload
upload_result = await client.upload_file_bytes(opdracht_id, filename, file_bytes)
```

MEMORY PROFILI:
  - psycopg2 tum JSONB'yi RAM'e yukler (base64 string dahil)
  - base64.b64decode() ek kopya olusturur (base64 + decoded ayni anda RAM'de)
  - 28KB SOR icin: ~37KB (base64) + ~28KB (decoded) = ~65KB RAM/dosya
  - Limit=10 icin: ~650KB RAM — sorun degil
  - Ama 1MB+ SOR dosyalari icin: ~2.6MB RAM/dosya — limit azaltilmali

--- NODE 6: Upload (Multipart) ---

Kaynak: api/client.py (upload_file_bytes metodu)

GoConnectIT Planbord backend'e multipart/form-data olarak gonderiliyor:
```
POST /tfc/views/opdrachten/connectors/conn_file_upload.php?opdrachtid=456&mode=html5
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
Cookie: PHPSESSID=xxx

------WebKitFormBoundary...
Content-Disposition: form-data; name="file"; filename="1104GV_367_V1.SOR"
Content-Type: application/octet-stream

[raw binary bytes — SOR dosyasinin ham icerigi]
------WebKitFormBoundary...--
```

Girdi: Python bytes objesi (base64'ten decoded, ham SOR binary)
Cikti: HTTP multipart (ham binary olarak gonderilir, tekrar encode YAPILMAZ)

KRITIK: mode=html5 parametresi OLMADAN upload BASARISIZ olur.
DHX Vault konfigurasyonu: max 1 dosya, max 25MB.

--- FORMAT GECIS OZET TABLOSU ---

| # | Node | Konum | Format | 28KB SOR Boyutu | 100KB SOR Boyutu |
|---|------|-------|--------|-----------------|------------------|
| 1 | WhatsApp CDN | Ag (HTTPS) | AES-256-CBC sifreli binary | ~28 KB + overhead | ~100 KB + overhead |
| 2 | Baileys download | RAM (Node.js) | Buffer / Uint8Array | 28 KB | 100 KB |
| 3 | serializeAttachments | RAM (Node.js) | base64 string | ~37 KB (+33%) | ~133 KB (+33%) |
| 4 | PostgreSQL JSONB | Disk (TOAST) | base64 in JSONB compressed | ~25-30 KB | ~90-100 KB |
| 5 | PG trigger | N/A | Referans (message_id) | 0 KB (sadece UUID) | 0 KB (sadece UUID) |
| 6 | psycopg2 read | RAM (Python) | base64 string (Python str) | ~37 KB | ~133 KB |
| 7 | base64.b64decode | RAM (Python) | bytes (ham binary) | 28 KB | 100 KB |
| 8 | httpx multipart | Ag (HTTPS) | raw binary in multipart | ~28 KB + headers | ~100 KB + headers |

--- BILINEN DATA LOSS RISKLERI ---

| Risk | Trigger | Mevcut Koruma | Eksik Koruma |
|------|---------|---------------|--------------|
| History sync: data=null | CDN URL expired | PG trigger #4 filtresi | Recovery: retryMediaFromMetadata() VAR ama manuel |
| Corrupt base64 | RAM corruption, encoding bug | base64.b64decode try/catch → sor_queue status=error | Content hash yok (orijinal MCP'de SHA-256 var) |
| Truncated binary | Network interrupt | Baileys buffer integrity | SOR magic bytes kontrolu yok |
| Duplicate upload | WhatsApp reconnect, tekrar gelen mesaj | sor_queue UNIQUE(message_id) + ON CONFLICT DO NOTHING | Planbord'da sor_bestand='ja' kontrolu YOK |
| Buyuk dosya OOM | >10MB SOR (nadir) | limit=10 batch | Per-dosya boyut limiti yok |

--- POTANSIYEL IYILESTIRMELER ---

| # | Iyilestirme | Maliyet | Etki | Oncelik |
|---|-------------|---------|------|---------|
| 1 | SOR magic bytes kontrolu (4d617000) | Dusuk (4 byte check) | Data integrity | ORTA |
| 2 | Content hash (SHA-256) pipeline boyunca | Dusuk | Integrity verification | ORTA |
| 3 | sor_bestand='ja' check (Planbord'da zaten var mi?) | Orta (grid search gerekli) | Duplicate prevention | YUKSEK |
| 4 | bytea kolonu (base64 yerine) | Yuksek (schema degisikligi) | ~33% storage tasarrufu | DUSUK |
| 5 | Streaming decode (buyuk dosyalar icin) | Orta | Memory efficiency | DUSUK |
| 6 | Per-trigger retry limit (sor_queue'da retry_count) | Dusuk | Hata yonetimi | ORTA |

================================================================================
ADIM 4.5: DEVAM EDEN GOREVLER (TaskList Snapshot)
================================================================================

Bu handoff ARASTIRMA odaklidir — acik implementation gorevi yoktur.

| # | Subject | Status | BlockedBy | Description |
|---|---------|--------|-----------|-------------|
| 1 | Binary integrity check | PROPOSED | - | SOR magic bytes (4d617000) kontrolu ekle |
| 2 | Content hash propagation | PROPOSED | - | SHA-256 hash sor_queue'ya veya channel_messages'a ekle |
| 3 | Duplicate upload prevention | PROPOSED | - | Planbord grid'den sor_bestand='ja' kontrolu |
| 4 | Retry limit for sor_queue | PROPOSED | - | retry_count + max_retries kolonu |

NONE of these are in-progress. They are proposals from the analysis.

================================================================================
ADIM 5: SESSION BOYUNCA AKTIF TETIKLEYICILER
================================================================================

--- MAKRO SCOPE INJECTION (TUM SUB-AGENT'LAR ICIN ZORUNLU) ---

Her sub-agent spawn edildiginde Task prompt'una ADIM 3'teki ICINDE/DISINDA scope
sinirlarini INJECT ET.

SCOPE SINIRI:
ICINDE: Binary format analizi, data flow tracing, serialization inceleme,
        storage mekanizma olcumu, encoding/decoding profili, risk tespiti
DISINDA: Orijinal VoorinfraAPIServer'a dokunma, OwnPilot core koduna dokunma,
         Docker image rebuild, sor_queue state machine degisikligi, production
         veriye yazma

--- SUB-AGENT SPAWN TETIKLEYICILERI ---

| Kosul | Aksiyon |
|-------|---------|
| Gercek boyut olcumu gerekli (TOAST compressed vs raw) | Bash ile pg_column_size() sorgusu |
| psycopg2 memory profili istenirse | Python memory_profiler ile test script |
| Baileys Buffer→Uint8Array donusumu incelenecekse | message-parser.ts + whatsapp-api.ts paralel okuma |
| Orijinal MCP'deki SHA-256 flow ile karsilastirma | sor_manager.py + mcp_server_api.py paralel okuma |

--- VALIDATION TEST CASE TETIKLEYICILERI ---

| Kosul | Aksiyon |
|-------|---------|
| Base64 round-trip dogrulanacak | DB'den base64 oku → decode → SOR magic bytes kontrol → boyut dogrula |
| TOAST compression ratio olcumu | pg_column_size(attachments) vs octet_length(attachments::text) |
| Buyuk SOR dosya testi | Mevcut en buyuk SOR'u bul, memory profilini cikart |

================================================================================
ADIM 6: PARALEL YURUTULECEK ISLER
================================================================================

Bu arastirma odakli session'da asagidaki analizler PARALEL yurutulabilir:

| Task # | Alan | Analiz Gorevi | Bagimsiz mi? | Priority |
|--------|------|---------------|-------------|----------|
| A | PostgreSQL | TOAST compression ratio olcumu (pg_column_size) | EVET | P1 |
| B | Pipeline | SOR magic bytes dogrulama (mevcut dosyalar) | EVET | P1 |
| C | Karsilastirma | Orijinal vs Yeni pipeline gap analizi | EVET | P2 |
| D | Memory | psycopg2 + base64 RAM profili (limit=10 senaryo) | EVET | P3 |

Hepsi bagimsiz — 4 paralel agent spawn edilebilir.

================================================================================
ADIM 7: GUVENLIK NOTU (EYLEM YOK, BILGI AMACLI)
================================================================================

Binary data flow'da asagidaki guvenlik noktalari mevcut:

1. BASE64 IN JSONB: Binary veri JSON icerisinde saklandigi icin, SQL injection
   riski yok (JSONB parameterized). Ancak base64 string manipule edilirse
   corrupt binary uretebilir — decode sonrasi integrity check onerilir.

2. TOAST TRANSPARENCY: PostgreSQL TOAST mekanizmasi binary'yi compress eder ama
   sifreleMEZ. DB dump'inda base64 data acik metin olarak gorunur. SOR dosyalari
   hassas musteri verisi icerebilir (adres, fiber olcum).

3. CREDENTIALS IN TRANSIT: Voorinfra API'ye login PHPSESSID cookie ile
   yapiliyor. Docker container icinde HTTP (sifreli degil). Ama container'lar
   ayni Docker network'te (ownpilot-znahub_default) — risk DUSUK.

4. MEMORY RESIDUE: base64.b64decode() sonrasi orijinal base64 string Python
   garbage collector'a birakilir ama hemen silinmez. Hassas veriler RAM'de
   gecici olarak iki kopya halinde bulunabilir.

5. DATA'NIN NULL OLMASI: History sync mesajlarinda binary data bulunmuyor.
   Bu mesajlar sor_queue'ya girmiyor (PG trigger filtresi). Ama channel_messages
   tablosunda data=null satirlar var — bunlar retryMediaFromMetadata() ile
   sonradan doldurulabilir.

================================================================================
ADIM 8: REFERANSLAR
================================================================================

Kritik dosyalar (NODE SIRASI ile):

NODE 1 - WhatsApp → Baileys:
/home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts
  → downloadMediaWithRetry() satirlar 1849-1880
  → History sync handler satirlar 1705-1715
  → retryMediaFromMetadata() satirlar 940-970

NODE 2 - Serialization:
/home/ayaz/ownpilot/packages/gateway/src/db/repositories/channel-messages.ts
  → ChannelMessageAttachment interface satirlar 10-22
  → serializeAttachments() satirlar 44-72
  → ChannelMessageAttachmentInput type satirlar 108-115
  → create() satirlar 130-135 (serialized INSERT)
  → createBatch() satirlar 640-660 (batch INSERT, ON CONFLICT DO NOTHING)
  → enrichMediaMetadata() satirlar 278-282 (retry sonrasi binary ekleme)

NODE 3 - PostgreSQL Storage:
/home/ayaz/ownpilot/packages/gateway/src/db/schema.ts
  → channel_messages table satirlar 90-103
  → sor_queue table satirlar 984-995
  → enqueue_sor_message() trigger satirlar 1685-1709
  → sor_queue indexes satirlar 2131-2132

NODE 4 - Message Parser:
/home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/message-parser.ts
  → WhatsAppDocumentMetadata satirlar 13-35
  → mediaKey processing satirlar 129-152

NODE 5 - Voorinfra MCP Tool:
/home/ayaz/projects/voorinfra-mcp-ownpilot/mcp_server_api.py
  → process_ownpilot_sor_queue() satirlar 2536-2795
  → base64 decode satirlar 2671-2672
  → filename resolution satirlar 2688-2689
  → upload satirlar 2764-2765

NODE 6 - Upload Client:
/home/ayaz/projects/voorinfra-mcp-ownpilot/api/client.py
  → upload_file_bytes() metodu (multipart POST)
  → GoConnectIT backend URL: https://voorinfra.connectsoftware.nl

Referans dokumanlari:
/home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/WHATSAPP-GUIDE.md
  → Media Recovery Pipeline bolumu (satir ~268+)
/home/ayaz/projects/voorinfra-mcp-ownpilot/ARCHITECTURE.md
  → VoorinfraAPIServer genel mimari (v2.2.0 — ORIJINAL referans)

Docker / Network:
- Container: voorinfra-mcp (port 8766), ownpilot (port 8080), ownpilot-postgres (5432)
- Network: ownpilot-znahub_default (shared)
- Image: localhost:5000/voorinfra-mcp:latest

OwnPilot DB (ownpilot-postgres, user=ownpilot, db=ownpilot):
- channel_messages: attachments JSONB (base64 data icinde)
- sor_queue: status state machine (pending/processing/done/error)
- UNIQUE(message_id): idempotency constraint

Bellcore SOR format:
- Magic bytes: 4d 61 70 00 (ASCII "Map\0")
- Binary format: header + data blocks + trace data
- Tipik boyut: 5KB - 200KB (cogu 20-50KB arasi)

================================================================================
ADIM 9: BASARININ TANIMI
================================================================================

Session sonunda su sorulara KANITA DAYALI cevabin olmali:

| Soru | Kabul Edilebilir Kanit |
|------|------------------------|
| Her node'daki format donusumu belgelendi mi? | 6-node format gecis tablosu, her biri icin girdi/cikti formati + boyut |
| TOAST compression ratio olculdu mu? | pg_column_size() sorgu sonucu (gercek veri uzerinde) |
| Data loss riskleri tanimlandi mi? | Risk tablosu: risk, trigger, mevcut koruma, eksik koruma |
| Orijinal MCP ile karsilastirma yapildi mi? | Gap tablosu: edge case, orijinal cozum, yeni pipeline durumu |
| Iyilestirme onerileri siralandI mi? | Maliyet/etki/oncelik tablosu |
| Magic bytes dogrulamasi yapildi mi? (opsiyonel) | DB'den en az 1 SOR'un ilk 4 byte'ini decode edip 4d617000 gosterme |

================================================================================
ADIM 10: ACIK KARARLAR
================================================================================

1. BYTEA VS BASE64-IN-JSONB:
   - Mevcut: Binary → base64 string → JSONB icinde saklaniyor
   - Alternatif: Ayri bytea kolonu (channel_messages.binary_data BYTEA)
   - Avantaj: ~33% disk tasarrufu, dogrudan binary okuma (base64 decode gereksiz)
   - Dezavantaj: Schema degisikligi, mevcut tum attachment'lari migrate etme, OwnPilot core degisikligi
   - Karar: ERTELENDI — mevcut boyutlar (20-50KB) sorun DEGIL. 1MB+ dosyalar gelirse yeniden degerlendir.

2. SOR MAGIC BYTES KONTROLU:
   - Mevcut: Yok — dosya adina guveniliyor (.sor uzantisi)
   - Onerilen: base64 decode sonrasi ilk 4 byte = 0x4d617000 mi kontrol et
   - Maliyet: Tek satirlik Python kodu
   - Karar: Implement etmeye deger, dusuk maliyet/yuksek guvenilirlik. S37'de yapilabilir.

3. CONTENT HASH PROPAGATION:
   - Orijinal MCP: SHA-256 hash sor_files tablosunda
   - Yeni pipeline: Hash YOK
   - Onerilen: process_ownpilot_sor_queue()'da decode sonrasi hashlib.sha256() ekle,
     sor_queue'ya content_hash kolonu ekle (ALTER TABLE)
   - Karar: ERTELENDI — suan icin gerek yok ama auditability icin iyi olur.

4. DUPLICATE UPLOAD PREVENTION:
   - Orijinal MCP: Planbord grid'deki sor_bestand='ja' kontrolu
   - Yeni pipeline: BU KONTROL YOK — sadece sor_queue status'una bakiliyor
   - Risk: Ayni SOR dosyasi Planbord'a birden fazla kez yuklenebilir
     (ornegin sor_queue manual reset veya WhatsApp grubunda ayni dosya tekrar gonderilirse)
   - Karar: ORTA ONCELIK — grid search zaten yapiliyor, sor_bestand check eklemek
     sadece birkaç satirlik degisiklik. S37'de yapilabilir.

---
BASLA! Context'i yukle (ADIM 1), servisleri kontrol et (ADIM 2),
sonra master goal'e (ADIM 3) gore calis.
ADIM 5'teki tetikleyiciler SESSION BOYUNCA AKTIF — surekli uygula.
Token tasarrufu YAPMA. Detayli, kapsamli, otonom calis.
---
