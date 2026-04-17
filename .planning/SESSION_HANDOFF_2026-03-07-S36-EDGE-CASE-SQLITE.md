---
generated_at: 2026-03-07
trigger_reason: explicit_user
protocol_version: v2.6.0
session_number: S36-EDGE-CASE-SQLITE
active_skills: [voorinfra-upload]
pipeline_status: research_complete
files_updated: 0
lessons_added: {errors: 0, golden: 0, edge: 0}
coverage_scope: [edge-case-management, sqlite-architecture, state-machine, dedup, audit-trail, concurrency, gap-analysis]
---

--- HANDOFF META ---
trigger: explicit_user
session: S36-EDGE-CASE-SQLITE | protocol: v2.6.0
active_skills: [voorinfra-upload]
pipeline: research_complete (0 dosya degistirildi — pure analysis)
lessons: errors+0, golden+0, edge+0
coverage: edge-case-management, sqlite-architecture, state-machine, dedup, audit-trail, concurrency, gap-analysis
--- END META ---

YENI SESSION BASLANGICI — Orijinal VoorinfraAPIServer MCP: Edge Case Management & SQLite Mimarisi
Bu session orijinal MCP server'in kalite muhendisligini inceleyip
yeni pipeline'a (OwnPilot/PostgreSQL) nelerin transfer edilmesi gerektigini belirler.
Asagidaki adimlari SIRASYLA uygula — bolum atlama, kisaltma, token tasarrufu YASAK.
NOT: Bu prompt YENI (sifir-context) session icin tasarlandi. Eger mevcut bir
session'i resume ediyorsan (claude --resume), ADIM 1-2 atla, ADIM 3'ten basla.

================================================================================
ADIM 1: AKILLI CONTEXT YUKLEME
================================================================================

Once HANDOFF META blogunu oku (prompt basinda).
- active_skills: [voorinfra-upload]
- trigger: explicit_user
- pipeline: research_complete

--- AUTO-LOADED (zaten context'inde — Read YAPMA, dikkat et) ---
| Dosya | Bu Session'da Degisen |
|-------|----------------------|
| MEMORY.md | Degismedi — referans icin oku |

--- ZORUNLU OKU (context'inde YOK — HEPSINI OKU) ---

1. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/api/sor_manager.py
   TUM DOSYA (325 satir) — Bu handoff'un ANA KONUSU.
   SORManager sinifi: SQLite-backed state machine for SOR file upload lifecycle.
   OZEL DIKKAT:
   - Satir 1-26: Module docstring — state machine diyagrami (pending → uploading → uploaded → archived → error)
   - Satir 50-69: connect() — PRAGMA ayarlari (WAL, synchronous=NORMAL, foreign_keys=ON)
   - Satir 75-117: register_file() — idempotent kayit (INSERT OR IGNORE, SHA-256 hash)
   - Satir 123-140: mark_uploading() — WAL UPDATE-rowcount exclusivity (concurrent guard)
   - Satir 142-161: mark_uploaded() — success + upload_log audit
   - Satir 163-196: mark_error() — retry_count increment + upload_log failure
   - Satir 202-217: get_pending() — max_retries filtresi
   - Satir 232-276: is_mega_registered() + register_mega() — MEGA dedup
   - Satir 278-303: get_stats() — status count aggregation
   - Satir 305-325: get_history() — upload_log ile JOIN

2. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/api/grid_cache.py
   TUM DOSYA (308 satir) — SQLite grid cache + fuzzy search.
   OZEL DIKKAT:
   - Satir 40-58: Grid row schema (32 kolon, TEXT DEFAULT "")
   - Satir 54-59: Indexler (postcode, postcode+huisnummer, huisnummer, straat)
   - Satir 65-81: connect() — PRAGMA + 3 katmanli schema ensure (v1, v2, v3)
   - Satir 90-102: _ensure_schema_v3() — idempotent ALTER TABLE (try/except for duplicate column)
   - Satir 104-112: _ensure_schema_v2() — external SQL dosyasi ile full DDL
   - Satir 114-140: refresh() — DELETE ALL + INSERT OR REPLACE (atomic full replace)
   - Satir 142-180: search() — parameterized query, UPPER() case-insensitive
   - Satir 182-195: query() — read-only guard (write keyword detection)
   - Satir 218-231: is_stale() — TTL-based cache invalidation (default 1 saat)
   - Satir 239-301: fuzzy_search() — 3-tier dedup (prefix_narrow, prefix_wide, huisnummer_only)

3. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/.planning/schema_v2.sql
   TUM DOSYA (437 satir) — Tam SQLite schema tanimi.
   OZEL DIKKAT:
   - Satir 1-26: PRAGMA ayarlari (WAL, synchronous, foreign_keys, temp_store, mmap_size, cache_size, auto_vacuum)
   - Satir 33-43: schema_migrations tablosu (versioned migration tracking)
   - Satir 110-179: sor_files tablosu (25+ kolon, content BLOB, state machine, FK soft linkage)
   - Satir 182-212: Trigger'lar (trg_sor_files_updated_at, uploaded_at, archived_at)
   - Satir 218-229: sor_files indexleri (status, postcode, postcode+huisnummer, created_at, status+created_at)
   - Satir 239-301: mega_registry tablosu (MEGA dedup, 85 kayit, session metadata)
   - Satir 310-340: upload_log tablosu (immutable audit trail)
   - Satir 348-393: Views (v_upload_queue, v_daily_summary, v_mega_with_sor)

4. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/ARCHITECTURE.md
   TUM DOSYA (509 satir) — Genel mimari, API protocol, data flow diyagramlari.
   OZEL DIKKAT:
   - Satir 139-152: Client-side filtering (server-side dhx_filter CALISMAZ!)
   - Satir 170-180: mode=html5 ZORUNLU (upload FAIL olur olmadan)
   - Satir 236-269: Batch upload + skip_if_exists akisi
   - Satir 488-509: Data Layer v2 ozeti (SQLite authoritative source)

5. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/mcp_server_api.py
   SECILI SATIRLAR:
   - Satir 107: UploadResponse Pydantic modeli (already_uploaded, message, error alanlari)
   - Satir 675-782: upload_sor() tool (tekli upload + skip_if_exists + grid check)
   - Satir 810-965: _upload_sor_cached() (pre-fetched grid cache ile upload)
   - Satir 1132-1200: fuzzy_search() tool (3-tier fuzzy)
   - Satir 1210-1370: batch_upload() tool (toplu upload + SORManager entegrasyonu)
   - Satir 2536-2795: process_ownpilot_sor_queue() (yeni tool — karsilastirma icin)

--- ON-DEMAND OKU (derinlestirme gerekirse) ---

1. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/tests/test_sor_manager.py
   → SORManager unit testleri — edge case'lerin test coverage'i
2. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/tests/test_grid_cache.py
   → GridCache unit testleri — fuzzy search, stale detection, read-only guard
3. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/tests/test_sqlite_cache.py
   → SQLite performance testleri
4. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/smoke_test_sqlite.py
   → End-to-end smoke test
5. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/config.py
   → SOR_PARSER, APIConfig, path konfigurasyonu
6. /home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/api/client.py
   → GoConnectAPIClient: login, search_by_address, upload_sor_file, skip_if_exists logic

================================================================================
ADIM 2: DURUM KONTROLU
================================================================================

Bu handoff ARASTIRMA odaklidir — orijinal MCP server'a DOKUNMAZ.
Yine de her iki sistemin de canli oldugunu dogrulamak icin:

# Orijinal MCP server (Claude Code stdio transport — host'ta calisiyor)
# NOT: Bu container degil, dogrudan Python process. ps ile kontrol edilemez.
# Kontrol: Claude Code'da VoorinfraAPIServer araclarini cagirmak
# Otomatik test: mcp__VoorinfraAPIServer__get_status cagrilabilir

# Orijinal SQLite DB
ls -la /home/ayaz/projects/scrapling-workspace/tasks/voorinfra/planbord_cache.db
# Beklenen: Mevcut, boyutu > 1MB (grid_rows + sor_files + upload_log)

# Orijinal SQLite icerik kontrolu
sqlite3 /home/ayaz/projects/scrapling-workspace/tasks/voorinfra/planbord_cache.db "
  SELECT 'sor_files' AS tablo, COUNT(*) AS kayit FROM sor_files
  UNION ALL
  SELECT 'upload_log', COUNT(*) FROM upload_log
  UNION ALL
  SELECT 'mega_registry', COUNT(*) FROM mega_registry
  UNION ALL
  SELECT 'grid_rows', COUNT(*) FROM grid_rows;
"
# Beklenen (tahmini): sor_files ~100+, upload_log ~200+, mega_registry ~85, grid_rows ~1074

# Orijinal SQLite schema version
sqlite3 /home/ayaz/projects/scrapling-workspace/tasks/voorinfra/planbord_cache.db "
  SELECT version, description, applied_at FROM schema_migrations ORDER BY version;
"
# Beklenen: 4 migration (baseline, sor_files, mega_registry, upload_log)

# Yeni pipeline (OwnPilot + Voorinfra MCP container)
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E "ownpilot|voorinfra"
# Beklenen: ownpilot Up (healthy), ownpilot-postgres Up (healthy), voorinfra-mcp Up (healthy)

# Yeni pipeline sor_queue
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "
  SELECT status, COUNT(*) FROM sor_queue GROUP BY status;
"
# Beklenen: done | 3 (veya daha fazla)

Bilinen anomaliler (gormezden gel):
- OwnPilot health "degraded" → Docker sandbox yok, calismayi ETKILEMEZ
- Orijinal SQLite DB'de bazi sor_files status='error' olabilir → bu NORMAL (retry exhausted)

================================================================================
ADIM 3: BU SESSION'IN AMACI
================================================================================

Genel baglam: Orijinal VoorinfraAPIServer MCP, 6 fazli bir gelistirme
surecinden gecmis, olgun bir SQLite-tabanli state machine, dedup,
cache, audit trail ve edge case yonetimi mimarisine sahip. S35'te
yeni pipeline (OwnPilot + PostgreSQL) kuruldu ancak orijinaldeki
bircok kalite muhendisligi patterni yeni pipeline'a TRANSFER EDILMEDI.

Bu session'in TEK ANA HEDEFI:
Orijinal MCP'nin edge case management mimarisini detayli analiz edip,
yeni pipeline'da eksik olan partikulari tanimlamak. Araciyla:

A) Orijinal SQLite mimarisinin tam incelenmesi
   - SORManager state machine (6 durum + gecisler)
   - GridCache mekanizmasi (refresh, stale detection, fuzzy search)
   - Upload_log audit trail (immutable, attempt tracking)
   - MEGA dedup registry (CSV'den migrate edilmis)
   - PRAGMA optimizasyonlari (WAL, mmap, cache_size)
   - Schema migration pattern (schema_migrations tablosu)

B) Orijinal edge case handling pattern'lerin kataloglanmasi
   - Concurrent upload guard (WAL rowcount exclusivity)
   - Duplicate file detection (filename UNIQUE, INSERT OR IGNORE)
   - Planbord-side duplicate check (sor_bestand='ja')
   - Retry limit (retry_count < max_retries)
   - Content integrity (SHA-256 hash)
   - Cache staleness (TTL-based invalidation)
   - Read-only query guard (write keyword detection)
   - Fuzzy search fallback (3-tier)
   - Idempotent schema migration (CREATE IF NOT EXISTS)

C) Yeni pipeline ile gap analizi
   - Hangi edge case pattern'ler mevcut?
   - Hangi pattern'ler eksik?
   - Hangilerinin transfer edilmesi KRITIK/ORTA/DUSUK oncelikli?
   - Transfer icin gereken degisikliklerin tahmini maliyeti

D) Transfer plani olusturma
   - Her eksik pattern icin: hangi dosyada, hangi degisiklik?
   - Oncelik siralamasI
   - Dependency haritasi

Scope sinirlari:
ICINDE:
- Orijinal MCP kodunu OKUMA ve analiz etme (salt okunur)
- SQLite schema inceleme (schema_v2.sql, grid_cache.py, sor_manager.py)
- State machine pattern analizi
- Orijinal test suite'i okuyarak edge case coverage tespiti
- Yeni pipeline (process_ownpilot_sor_queue) ile gap karsilastirmasi
- mcp_server_api.py'deki upload_sor, batch_upload, skip_if_exists logici
- config.py'deki SOR_PARSER, path konfigurasyonu
- Orijinal ARCHITECTURE.md referanslari
DISINDA:
- Orijinal VoorinfraAPIServer MCP kodunu DEGISTIRME (DOKUNMA!)
- Yeni pipeline'da (voorinfra-mcp-ownpilot) kod DEGISTIRME (sadece analiz)
- OwnPilot core kodunu DEGISTIRME
- Docker image rebuild
- Production veritabanina YAZMA
- Orijinal SQLite DB'ye YAZMA

================================================================================
ADIM 4: TAMAMLANAN ARASTIRMA DETAYLARI (REFERANS)
================================================================================

Bu bolum onceki session'daki (S35+) arastirma bulgularini TAMAMEN icerir.
Yeni session bunu BASE olarak kullanacak, yeniden arastirma YAPMAYACAK.

===========================
KATMAN A: SQLITE MIMARI ANALIZI
===========================

--- A.1: PRAGMA Optimizasyonlari ---

Orijinal server'da 2 seviye PRAGMA var:

Seviye 1 — Runtime (GridCache.connect() ve SORManager.connect() tarafindan uygulaniyor):
```python
# grid_cache.py:72-78, sor_manager.py:50-57
self._conn.execute("PRAGMA journal_mode=WAL")
self._conn.execute("PRAGMA synchronous=NORMAL")
self._conn.execute("PRAGMA foreign_keys=ON")
```

Seviye 2 — schema_v2.sql'de DOKUMANTE EDILMIS ama PRAGMA'lar yorum satiri:
```sql
-- PRAGMA journal_mode = WAL;          -- concurrent reads + single writer
-- PRAGMA synchronous   = NORMAL;      -- safe under WAL, faster than FULL
-- PRAGMA foreign_keys  = ON;          -- enforce FK constraints
-- PRAGMA temp_store     = MEMORY;     -- temp tables/indexes in RAM
-- PRAGMA mmap_size      = 268435456;  -- 256 MB memory-mapped I/O
-- PRAGMA cache_size     = -8000;      -- 8 MB page cache (negative = KiB)
-- PRAGMA auto_vacuum    = INCREMENTAL;-- avoid database bloat over time
```

NEDEN YORUM SATIRI: PRAGMA'lar connection-level'dir, DDL dosyasinda
calistirilmaz. Her baglantida runtime'da set edilmeleri gerekir.
Schema dosyasinda sadece dokumantasyon amacli bulunuyorlar.

RUNTIME'DA UYGULANAN 3 PRAGMA:
| PRAGMA | Deger | Neden |
|--------|-------|-------|
| journal_mode=WAL | Write-Ahead Logging | Concurrent read + single writer. Read'ler write'i BLOKLAMAZ |
| synchronous=NORMAL | Normal fsync | WAL altinda guvenli, FULL'den ~2x hizli |
| foreign_keys=ON | FK enforcement | Referans butunlugu (sor_files ↔ upload_log ↔ mega_registry) |

DOKUMANTE EDILMIS AMA UYGULANMAYAN 4 PRAGMA (gelecek optimizasyon):
| PRAGMA | Deger | Etki |
|--------|-------|------|
| temp_store=MEMORY | Gecici tablolar RAM'de | Buyuk sort/join icin performans |
| mmap_size=268435456 | 256MB memory-mapped I/O | Buyuk DB'ler icin read hizi |
| cache_size=-8000 | 8MB page cache | Hot data RAM'de tutulur |
| auto_vacuum=INCREMENTAL | Otomatik vacuum | DB dosya boyutu kontrolu |

YENI PIPELINE KARSILIGI: PostgreSQL'de bunlarin cogu default olarak
aktif (shared_buffers, WAL, autovacuum). Ek konfigurasyona gerek yok.

--- A.2: State Machine (SORManager) ---

Tam state diagram:
```
                    register_file()
                         |
                         v
                    [pending]
                         |
              mark_uploading() — WAL rowcount exclusivity
                    |         |
              success=True  success=False (baskasi aldi)
                    |         |
                    v         (no-op)
               [uploading]
                    |
         upload basarili?  upload basarisiz?
              |                   |
    mark_uploaded()         mark_error()
              |                   |
              v                   v
          [uploaded]          [error]
              |                   |
     (archive step)    retry_count < max_retries?
              |              |            |
              v            EVET          HAYIR
         [archived]     [pending]    (kalici error)
                      (get_pending
                       tekrar doner)

    Ek durum:
    skip_if_exists && sor_bestand='ja' → [skipped]
```

CRITICAL PATTERN: mark_uploading() — WAL Update-Rowcount Exclusivity
```python
def mark_uploading(self, sor_id: int) -> bool:
    cur = self._conn.execute(
        "UPDATE sor_files SET status='uploading' WHERE id=? AND status='pending'",
        (sor_id,),
    )
    self._conn.commit()
    return cur.rowcount == 1
```
Bu pattern NEDEN onemli:
- 2 concurrent process ayni dosyayi almaya calisirsa
- Ilki UPDATE yapar, rowcount=1 alir, dosyayi ISLER
- Ikincisi UPDATE yapar ama WHERE status='pending' artik FALSE
- rowcount=0 doner, return False → ikinci process dosyayi ATLAR
- NO MUTEX, NO LOCK — SQLite WAL mekanizmasi bunu garanti eder

YENI PIPELINE KARSILIGI:
```sql
-- process_ownpilot_sor_queue() satirlar 2577-2585
SELECT ... FROM sor_queue WHERE status = 'pending'
ORDER BY created_at LIMIT %s
FOR UPDATE SKIP LOCKED
```
PostgreSQL'in FOR UPDATE SKIP LOCKED mekanizmasi ayni sonucu verir:
concurrent transaction'lar baska satir alir, lock contention YOK.
BU PATTERN TRANSFER EDILMIS — ama mark_uploading() ara durumu yok,
dogrudan processing → done/error gecisi var.

--- A.3: Content Integrity (SHA-256) ---

```python
# sor_manager.py:98-99
content_hash = hashlib.sha256(content).hexdigest()
content_size = len(content)
```

sor_files tablosunda:
```sql
content         BLOB,           -- raw bytes of the SOR file
content_size    INTEGER DEFAULT 0,
content_hash    TEXT,            -- SHA-256 hex, for integrity
```

BU NE IYI: Ayni isimde farkli icerikli dosya gelirse tespit edilebilir.
Upload sonrasi integrity check yapilabilir. Audit trail'de hash referansi.

YENI PIPELINE: SHA-256 HASH YOK. sor_queue tablosunda content, content_hash,
content_size KOLONLARI YOK. Dosya binary'si channel_messages.attachments
JSONB'de saklaniyor, hash hesaplanMIYOR.

--- A.4: Duplicate Detection (3 Katman) ---

KATMAN 1: Dosya seviyesi (SQLite)
```sql
-- sor_files tablosu
filename TEXT NOT NULL UNIQUE  -- ayni dosya adi 2 kez INSERT edilemez
```
```python
# sor_manager.py:104-106
self._conn.execute(
    """INSERT OR IGNORE INTO sor_files
       (filename, content, content_hash, content_size, ...)
       VALUES (?, ?, ?, ?, ...)""",
    (filename, content, content_hash, content_size, ...),
)
```

KATMAN 2: Planbord seviyesi (remote API)
```python
# mcp_server_api.py:743-752
if skip_if_exists and task.has_sor_file:
    return UploadResponse(
        success=True,
        already_uploaded=True,
        message="Skipped - SOR already uploaded"
    )
```
Planbord grid'deki `sor_bestand` alani "ja" ise SOR zaten yuklu.
Bu BIR DAHA upload etmekten kacinir. REMOTE tarafta duplicate check.

KATMAN 3: MEGA seviyesi (dedup registry)
```python
# sor_manager.py:232-245
def is_mega_registered(self, mega_filename: str) -> bool:
    count = self._conn.execute(
        "SELECT COUNT(*) FROM mega_registry WHERE mega_filename=?",
        (mega_filename,),
    ).fetchone()[0]
    return count > 0
```
MEGA cloud'dan gelen dosyalarin farkli adreslere atanmasi onlenir.

YENI PIPELINE KARSILIGI:
| Katman | Orijinal | Yeni Pipeline | Durum |
|--------|----------|---------------|-------|
| Dosya dedup | filename UNIQUE + INSERT OR IGNORE | UNIQUE(message_id) + ON CONFLICT DO NOTHING | KISMEN — message_id bazli, filename bazli DEGIL |
| Planbord dedup | sor_bestand='ja' check | YOK | EKSIK — duplikasyon RISKI |
| MEGA dedup | mega_registry tablosu | N/A (kaynak WhatsApp, MEGA degil) | UYGULANAMAZ |

--- A.5: Retry Logic ---

```python
# sor_manager.py:163-196
def mark_error(self, sor_id, error_message, http_status=None):
    self._conn.execute("""
        UPDATE sor_files
        SET status='error',
            error_message=?,
            retry_count=retry_count+1,
            last_retry_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=?
    """, (error_message, sor_id))

# sor_manager.py:202-217
def get_pending(self, max_retries=3):
    return self._conn.execute("""
        SELECT * FROM sor_files
        WHERE status IN ('pending', 'error')
          AND retry_count < ?
        ORDER BY created_at ASC
    """, (max_retries,)).fetchall()
```

MEKANIZMA:
1. Upload basarisiz → status='error', retry_count++
2. Sonraki taramada get_pending() error + retry_count < 3 olanlari TEKRAR doner
3. 3 deneme sonrasi dosya kalici error'da kalir (artik get_pending'e dahil edilmez)

YENI PIPELINE: RETRY LIMIT YOK. sor_queue'da retry_count kolonu YOK.
Hata durumunda status='error' set edilir ve KALICI kalir.
Manuel mudahale gerekir (UPDATE sor_queue SET status='pending' WHERE ...).

--- A.6: Audit Trail (upload_log) ---

```sql
CREATE TABLE IF NOT EXISTS upload_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sor_file_id     INTEGER NOT NULL REFERENCES sor_files(id) ON DELETE CASCADE,
    attempt_number  INTEGER NOT NULL DEFAULT 1,
    outcome         TEXT NOT NULL CHECK (outcome IN ('success','failure','skipped')),
    http_status     INTEGER,
    error_message   TEXT,
    response_body   TEXT,
    started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    duration_ms     INTEGER,
    opdracht_id     TEXT,
    planregel_id    TEXT,
    session_note    TEXT
);
```

IMMUTABLE: Bu tabloya sadece INSERT yapilir, UPDATE/DELETE YOK.
Her upload denemesi (basarili, basarisiz, atlanan) ayri kayit.
sor_files MEVCUT DURUMU tutar, upload_log TUM GECMISI tutar.

Ornek kullanim:
```python
# sor_manager.py:157-161
self._conn.execute(
    "INSERT INTO upload_log (sor_file_id, outcome, http_status) VALUES (?, 'success', ?)",
    (sor_id, http_status),
)
```

YENI PIPELINE KARSILIGI:
OwnPilot'ta trigger_history tablosu var ama:
- trigger_history trigger FIRE'ini kaydeder (tool cagrisini), dosya bazinda DEGIL
- 10 dosya tek fire'da islense bile tek trigger_history kaydi
- HTTP status, response_body, per-file duration SAKLANMIYOR
- sor_queue.error alani son hatayi tutar ama GECMISI tutmaz

--- A.7: Cache Staleness + Fuzzy Search ---

STALE DETECTION:
```python
# grid_cache.py:218-231
def is_stale(self, max_age_seconds=3600):
    meta = self.get_meta()
    if meta["last_refresh"] is None:
        return True
    last = datetime.fromisoformat(meta["last_refresh"])
    age = (datetime.now() - last).total_seconds()
    return age > max_age_seconds
```
Grid verisi 1 saatten eski ise stale → refresh gerekli.
Refresh: tum grid_rows DELETE + yeniden INSERT (atomic).

FUZZY SEARCH (3 Tier):
```python
# grid_cache.py:239-301
def fuzzy_search(self, postcode, huisnummer, teknisyen=None):
    # Tier 1: prefix_narrow — postcode[:4]% + huisnummer (tum sonuclar)
    # Tier 2: prefix_wide — postcode[:2]% + huisnummer (max 10)
    # Tier 3: huisnummer_only — sadece huisnummer (max 15)
    # Her tier: dedup (ROW_NUMBER OVER PARTITION BY), plandatum DESC sirali
```

NEDEN 3 TIER:
- SOR dosya adlarindaki postcode HATALI olabilir (yazim hatasi, takas)
- Exact match bulunamazsa, yakin postcode'lar denenir
- Son cozum: sadece huisnummer ile (nadir ama faydalI)

YENI PIPELINE KARSILIGI:
process_ownpilot_sor_queue()'da fuzzy search YOK:
```python
# mcp_server_api.py:2734-2735
opdracht_id = await client.get_opdracht_id(postcode, huisnummer, toevoeging)
```
Exact match bulunamazsa → error. Fuzzy fallback YOK.
Orijinalde ise fuzzy_search tool AYRI olarak mevcut ve batch_upload icinde de kullaniliyor.

--- A.8: Read-Only Query Guard ---

```python
# grid_cache.py:182-195
_WRITE_KEYWORDS = {"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "REPLACE", "TRUNCATE"}

def query(self, sql, params=()):
    first_word = sql.strip().split()[0].upper() if sql.strip() else ""
    if first_word in _WRITE_KEYWORDS:
        raise ValueError(f"read-only queries only, got: {first_word}")
    return self._conn.execute(sql, params).fetchall()
```

Bu, MCP tool olarak expose edilen query_grid aracinin SQL injection'a karsi
basit ama ETKILI korumasI. Claude Code veya baska bir client rasgele SQL
gonderebilir — write operasyonlari bloklanir.

YENI PIPELINE: Uygulanamaz — yeni pipeline'da freeform SQL query tool yok.

--- A.9: Schema Migration Pattern ---

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    checksum    TEXT
);

INSERT OR IGNORE INTO schema_migrations (version, description, applied_at) VALUES
    (1, 'Baseline: grid_rows + cache_meta', '2026-03-01T00:00:00.000Z'),
    (2, 'sor_files table + triggers + indexes', ...),
    (3, 'mega_registry table (CSV migration)', ...),
    (4, 'upload_log audit trail + views', ...);
```

Her migration:
- Monotonic version numara
- Idempotent DDL (CREATE IF NOT EXISTS)
- Applied_at timestamp
- Optional checksum (integrity)

YENI PIPELINE: OwnPilot kendi migration sistemi var (schema.ts'deki
MIGRATIONS_SQL). Ama sor_queue tablosu schema.ts'e HARDCODED (migration
yok, dogrudan CREATE TABLE).

--- A.10: SQLite Convenience Views ---

```sql
-- Upload queue view (pending + error under retry limit)
CREATE VIEW IF NOT EXISTS v_upload_queue AS
SELECT sf.*, gr.opdracht_id AS grid_opdracht_id, gr.opleverstatus
FROM sor_files sf
LEFT JOIN grid_rows gr ON UPPER(gr.postcode) = UPPER(sf.postcode)
  AND gr.huisnummer = sf.huisnummer
  AND UPPER(COALESCE(gr.toevoeging,'')) = UPPER(COALESCE(sf.toevoeging,''))
WHERE sf.status IN ('pending', 'error') AND sf.retry_count < 3;

-- Daily summary view
CREATE VIEW IF NOT EXISTS v_daily_summary AS
SELECT date(created_at) AS day, status, COUNT(*) AS count
FROM sor_files GROUP BY date(created_at), status;

-- MEGA enriched view
CREATE VIEW IF NOT EXISTS v_mega_with_sor AS
SELECT mr.*, sf.status AS sor_status, sf.uploaded_at, sf.error_message AS sor_error
FROM mega_registry mr LEFT JOIN sor_files sf ON mr.sor_file_id = sf.id;
```

v_upload_queue VIEW OZELLIKLE DEGERLI: sor_files + grid_rows JOIN ile
pending dosyalarin grid bilgisini tek sorguda gosterir.

YENI PIPELINE: View yok. sor_queue tablosu tek basina, channel_messages
ile JOIN yapilmiyor (sadece tool icinde query time'da).

===========================
KATMAN B: GAP ANALIZI — ORIJINAL VS YENI PIPELINE
===========================

| # | Edge Case Pattern | Orijinal (SQLite) | Yeni Pipeline (PostgreSQL) | Gap Durumu | Transfer Onceligi |
|----|-------------------|-------------------|---------------------------|------------|-------------------|
| 1 | Concurrent upload guard | WAL + UPDATE rowcount | FOR UPDATE SKIP LOCKED | TRANSFER EDILMIS | N/A (tamamlandi) |
| 2 | File-level dedup | filename UNIQUE + INSERT OR IGNORE | UNIQUE(message_id) + ON CONFLICT DO NOTHING | KISMEN — message_id bazli, filename bazli degil | DUSUK |
| 3 | Planbord-side dedup (sor_bestand) | skip_if_exists + has_sor_file check | YOK | EKSIK — duplikasyon riski | YUKSEK |
| 4 | Retry limit | retry_count < max_retries(3) | YOK — kalici error | EKSIK — manuel mudahale gerekli | ORTA |
| 5 | Content integrity (SHA-256) | hashlib.sha256(content).hexdigest() | YOK | EKSIK | ORTA |
| 6 | Audit trail (per-file) | upload_log tablosu (immutable, attempt_number) | trigger_history (per-trigger, per-file degil) | EKSIK — granularity farki | ORTA |
| 7 | Fuzzy search fallback | 3-tier (prefix_narrow, prefix_wide, huisnummer_only) | YOK — sadece exact + regex fallback | KISMEN EKSIK | DUSUK |
| 8 | Cache staleness (TTL) | is_stale(max_age_seconds=3600) | N/A (her fire'da fresh API call) | FARKLI YAKLASIM — cache yok, her seferinde live | N/A |
| 9 | Read-only query guard | write keyword detection | N/A (freeform SQL tool yok) | UYGULANAMAZ | N/A |
| 10 | Schema migration tracking | schema_migrations tablosu | OwnPilot MIGRATIONS_SQL (farkli mekanizma) | FARKLI YAKLASIM | N/A |
| 11 | Idempotent file registration | INSERT OR IGNORE on filename | N/A (sor_queue message_id bazli) | FARKLI YAKLASIM | N/A |
| 12 | MEGA dedup | mega_registry tablosu | N/A (kaynak WhatsApp, MEGA degil) | UYGULANAMAZ | N/A |
| 13 | Intermediate state (uploading) | pending → uploading → uploaded | pending → processing → done | TRANSFER EDILMIS (farkli isim) | N/A |
| 14 | Auto-update timestamps | SQLite trigger (trg_sor_files_updated_at) | processed_at SET (manual) | KISMEN — sadece processed_at | DUSUK |
| 15 | Content storage | BLOB (raw binary in SQLite) | base64 in JSONB (channel_messages) | FARKLI — base64 overhead | DUSUK |
| 16 | Filename resolution fallback | SOR_PARSER.parse() + regex fallback | SOR_PARSER.parse() + regex fallback | TRANSFER EDILMIS | N/A |

===========================
KATMAN C: TRANSFER PLANI (ONCELIK SIRALI)
===========================

--- YUKSEK ONCELIK (duplikasyon/veri kaybi riski) ---

TRANSFER-1: Planbord-side duplicate check (sor_bestand='ja')
  Hedef dosya: /home/ayaz/projects/voorinfra-mcp-ownpilot/mcp_server_api.py
  Konum: process_ownpilot_sor_queue(), satir ~2733 (grid search sonrasi)
  Degisiklik:
  ```python
  # Grid search sonrasi, upload ONCESI:
  # Mevcut grid result'tan sor_bestand kontrol et
  grid_row = await client.search_by_address(postcode, huisnummer)
  if grid_row and grid_row.has_sor_file:
      with conn:
          with conn.cursor() as cur:
              cur.execute(
                  "UPDATE sor_queue SET status = 'done', processed_at = NOW() WHERE id = %s",
                  (row_id,),
              )
      detail["status"] = "skipped"
      detail["message"] = "SOR already uploaded on Planbord (sor_bestand=ja)"
      results["skipped"] += 1
      results["details"].append(detail)
      continue
  ```
  Tahmini maliyet: ~15 satir kod degisikligi
  Risk: DUSUK (grid search zaten yapiliyor, ek sorgu yok)
  Bagimlilik: client.search_by_address() veya client.get_opdracht_id() zaten grid data donduruyorsa

--- ORTA ONCELIK (operasyonel iyilestirme) ---

TRANSFER-2: Retry limit (retry_count + max_retries)
  Hedef: sor_queue tablosuna retry_count kolonu ekleme
  Degisiklik:
  ```sql
  -- OwnPilot DB'de:
  ALTER TABLE sor_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sor_queue ADD COLUMN last_retry_at TIMESTAMP;
  ```
  ```python
  # process_ownpilot_sor_queue()'da:
  # Error durumunda:
  cur.execute("""
      UPDATE sor_queue
      SET status = 'error', error = %s, retry_count = retry_count + 1, last_retry_at = NOW()
      WHERE id = %s
  """, (err, row_id))

  # Pending query'de:
  cur.execute("""
      SELECT ... FROM sor_queue
      WHERE status IN ('pending', 'error')
        AND retry_count < %s
      ...
  """, (max_retries,))
  ```
  Tahmini maliyet: ALTER TABLE + ~10 satir kod
  Risk: DUSUK (geriye uyumlu, mevcut satirlar retry_count=0 alir)
  Bagimlilik: Yok

TRANSFER-3: Content integrity (SHA-256)
  Hedef: process_ownpilot_sor_queue()'da base64 decode sonrasi hash hesaplama
  Degisiklik:
  ```python
  # base64 decode sonrasi (satir ~2672):
  file_bytes = base64.b64decode(data_b64)
  content_hash = hashlib.sha256(file_bytes).hexdigest()
  detail["content_hash"] = content_hash
  detail["content_size"] = len(file_bytes)
  ```
  Tahmini maliyet: 3 satir kod
  Risk: SIFIR (sadece loglama, akisi DEGISTIRMEZ)
  Bagimlilik: Yok

TRANSFER-4: Per-file audit trail
  Hedef: sor_queue'ya veya ayri sor_upload_log tablosuna per-file kayit
  Degisiklik:
  ```sql
  -- OwnPilot DB'de:
  CREATE TABLE IF NOT EXISTS sor_upload_log (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      sor_queue_id TEXT NOT NULL REFERENCES sor_queue(id),
      outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','skipped')),
      http_status INTEGER,
      error_message TEXT,
      content_hash TEXT,
      content_size INTEGER,
      opdracht_id TEXT,
      duration_ms INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  ```
  Tahmini maliyet: DDL + ~20 satir INSERT kodu
  Risk: DUSUK (ek tablo, mevcut akisi DEGISTIRMeZ)
  Bagimlilik: TRANSFER-3 (content_hash)

--- DUSUK ONCELIK (nice-to-have) ---

TRANSFER-5: Fuzzy search fallback
  Orijinaldeki 3-tier fuzzy search MCP tool olarak zaten mevcut (fuzzy_search).
  Yeni pipeline'da fuzzy kullanilmiyor cunku tool dogrudan API call yapiyor.
  Grid cache + offline fuzzy search yeni pipeline'in mimarisine UYMUYOR
  (her fire'da live API call yapiliyor, cache yok).
  KARAR: Transfer GEREKSIZ — farkli mimari.

TRANSFER-6: SOR magic bytes validation
  Degisiklik (3 satir):
  ```python
  file_bytes = base64.b64decode(data_b64)
  if file_bytes[:4] != b'\x4d\x61\x70\x00':
      err = f"Invalid SOR file: magic bytes mismatch (got {file_bytes[:4].hex()})"
      # ... error handling
  ```
  Tahmini maliyet: 3 satir
  Risk: SIFIR
  Bagimlilik: Yok

================================================================================
ADIM 4.5: DEVAM EDEN GOREVLER (TaskList Snapshot)
================================================================================

Bu handoff ARASTIRMA odaklidir — tamamlanmamis implementation gorevi yoktur.
Asagidakiler ANALIZ SONUCU ONERILEN gorevlerdir:

| # | Subject | Status | Priority | Estimated Cost | Description |
|---|---------|--------|----------|---------------|-------------|
| T1 | sor_bestand duplicate check | PROPOSED | YUKSEK | ~15 satir | Planbord'da zaten yuklu mu kontrol et |
| T2 | retry_count + max_retries | PROPOSED | ORTA | ALTER TABLE + ~10 satir | 3 deneme sonra kalici error |
| T3 | SHA-256 content hash | PROPOSED | ORTA | ~3 satir | Integrity verification |
| T4 | sor_upload_log audit table | PROPOSED | ORTA | DDL + ~20 satir | Per-file immutable audit trail |
| T5 | Fuzzy search fallback | REJECTED | N/A | N/A | Farkli mimari — uygulanamaz |
| T6 | SOR magic bytes check | PROPOSED | DUSUK | ~3 satir | Binary format validation |

Dependency chain: T3 → T4 (T4 T3'e bagli, content_hash kullanir)
Diger gorevler bagimsiz.

================================================================================
ADIM 5: SESSION BOYUNCA AKTIF TETIKLEYICILER
================================================================================

--- MAKRO SCOPE INJECTION (TUM SUB-AGENT'LAR ICIN ZORUNLU) ---

Her sub-agent spawn edildiginde Task prompt'una ADIM 3'teki ICINDE/DISINDA scope
sinirlarini INJECT ET.

SCOPE SINIRI:
ICINDE: Orijinal MCP kod okuma/analiz, SQLite schema inceleme, state machine
        pattern analizi, test coverage tespiti, gap karsilastirmasi, transfer plani
DISINDA: Orijinal MCP koduna DOKUNMA, yeni pipeline'da kod DEGISTIRME,
         Docker rebuild, production DB'ye YAZMA, orijinal SQLite'a YAZMA

--- SUB-AGENT SPAWN TETIKLEYICILERI ---

| Kosul | Aksiyon |
|-------|---------|
| 3+ dosya paralel okunacak | Her dosya icin ayri Read agent |
| Test coverage analizi | tests/ dizinindeki tum test dosyalarini paralel okuma |
| Orijinal vs yeni pipeline karsilastirma | 2 agent: orijinal kod analizi + yeni kod analizi |
| Transfer plani detaylandirilacak | Her TRANSFER-N icin ayri implementation spec agent |

--- VALIDATION TEST CASE TETIKLEYICILERI ---

| Kosul | Aksiyon |
|-------|---------|
| Gap analizi tamamlandiginda | Gap tablosunu tum edge case'ler icin guncelle |
| Transfer plani yazildiginda | Her degisiklik icin geriye uyumluluk kontrolu |
| Orijinal test suite okundu | Test coverage matriksi cikar (hangi edge case hangi test dosyasinda) |

================================================================================
ADIM 6: PARALEL YURUTULECEK ISLER
================================================================================

| Task # | Alan | Analiz Gorevi | Bagimsiz mi? | Priority |
|--------|------|---------------|-------------|----------|
| A | SORManager deep dive | State machine tam analizi + test coverage | EVET | P1 |
| B | GridCache deep dive | Cache + fuzzy + stale analizi + test coverage | EVET | P1 |
| C | upload_log analizi | Audit trail pattern detayi + ornek veri | EVET | P1 |
| D | Yeni pipeline gap filling | process_ownpilot_sor_queue satir satir analiz | EVET | P1 |
| E | Test suite coverage | tests/ dizini tam tarama → edge case coverage matrisi | EVET | P2 |

A, B, C, D, E hepsi bagimsiz — 5 paralel agent spawn edilebilir.

================================================================================
ADIM 7: GUVENLIK NOTU (EYLEM YOK, BILGI AMACLI)
================================================================================

1. ORIJINAL MCP SERVER SALT OKUNUR: Bu session'da orijinal MCP koduna
   ASLA yazma yapilmaz. Tum analiz Read + Grep ile.

2. ORIJINAL SQLITE DB SALT OKUNUR: planbord_cache.db sadece SELECT ile
   sorgulanir, INSERT/UPDATE/DELETE YASAK.

3. CREDENTIALS: .env dosyasinda Voorinfra API credentials var.
   Bu dosyayi OKUMA, referans verme veya loglama YASAK.
   Sadece .env.example format bilgisi kullanilabilir.

4. ORIJINAL MCP + YENI PIPELINE PARALEL CALISIYOR:
   - Orijinal: Claude Code stdio transport (host process)
   - Yeni: Docker container (streamable-http transport)
   - Ikisi de ayni Voorinfra API'ye baglanir — duplicate upload RISKI
   - Bu risk ADIM 4 KATMAN B'de belgelenmis (Gap #3: sor_bestand check eksik)

================================================================================
ADIM 8: REFERANSLAR
================================================================================

Kritik dosyalar (ORIJINAL MCP — SALT OKUNUR):

/home/ayaz/projects/scrapling-workspace/tasks/voorinfra-api/
  api/sor_manager.py          → SORManager state machine (325 satir)
  api/grid_cache.py           → GridCache + fuzzy search (308 satir)
  api/client.py               → GoConnectAPIClient (1449 satir)
  api/parser.py               → GridParser, SORParser
  mcp_server_api.py           → ANA SERVER (~3100 satir), tum MCP tool'lar
  config.py                   → SOR_PARSER, APIConfig, path config
  .planning/schema_v2.sql     → Tam SQLite schema (437 satir)
  ARCHITECTURE.md             → Genel mimari (509 satir)
  README.md                   → Quick start
  CHANGELOG.md                → Version history

Test dosyalari (ORIJINAL):
  tests/test_sor_manager.py   → SORManager unit testleri
  tests/test_grid_cache.py    → GridCache unit testleri
  tests/test_sqlite_cache.py  → SQLite performance testleri
  tests/test_mcp_server.py    → MCP server testleri
  tests/test_mcp_integration.py → MCP integration testleri
  tests/test_batch_processor.py → Batch processing testleri
  tests/test_e2e.py           → End-to-end testleri
  tests/test_schema.py        → Schema validation testleri
  tests/test_migration.py     → Migration testleri
  tests/test_perf_sor_manager.py → Performance testleri
  smoke_test_sqlite.py        → Smoke test

Yeni pipeline (KARSILASTIRMA ICIN — SALT OKUNUR):
/home/ayaz/projects/voorinfra-mcp-ownpilot/
  mcp_server_api.py           → process_ownpilot_sor_queue() satirlar 2536-2795
  api/client.py               → upload_file_bytes()
  config.py                   → env var override'lar
  Dockerfile                  → Container tanimi

OwnPilot DB:
  sor_queue tablosu: id, message_id (UNIQUE), channel_id, filename, status, error, created_at, processed_at
  trigger_history: fired_at, result, duration_ms (per-trigger, per-file DEGIL)

SQLite DB (ORIJINAL — SALT OKUNUR):
  /home/ayaz/projects/scrapling-workspace/tasks/voorinfra/planbord_cache.db
  Tablolar: grid_rows, cache_meta, sor_files, mega_registry, upload_log, schema_migrations
  Views: v_upload_queue, v_daily_summary, v_mega_with_sor

================================================================================
ADIM 9: BASARININ TANIMI
================================================================================

Session sonunda su sorulara KANITA DAYALI cevabin olmali:

| Soru | Kabul Edilebilir Kanit |
|------|------------------------|
| Orijinal state machine tam belgelendi mi? | 6 durum + tum gecisler + guard kosullari + kod referanslari |
| SQLite PRAGMA etkileri aciklandi mi? | Her PRAGMA icin ne yapiyor, neden, PostgreSQL karsiligi |
| Tum edge case pattern'ler kataloglandi mi? | Minimum 10 pattern, her biri icin: ne, nasil, nerede, test coverage |
| Gap analizi tamamlandi mi? | 15+ satirlik karsilastirma tablosu, her pattern icin orijinal/yeni/gap durumu |
| Transfer plani olusturuldu mu? | Oncelik sirali gorev listesi, her biri icin: hedef dosya, degisiklik, maliyet, risk, bagimlilik |
| Test coverage matrisi cikarildi mi? (opsiyonel) | tests/ taramasi → hangi edge case hangi test'te cover ediliyor |
| Orijinal SQLite gercek veri istatistikleri alinabildi mi? (opsiyonel) | sqlite3 SELECT COUNT(*) sonuclari |

================================================================================
ADIM 10: ACIK KARARLAR
================================================================================

1. TRANSFER ONCELIGI:
   - YUKSEK: sor_bestand duplicate check (T1) — duplikasyon riski GERCEK
   - ORTA: retry_count (T2), SHA-256 (T3), audit_log (T4) — operasyonel kalite
   - DUSUK: magic bytes (T6) — integrity, ama SOR dosyalari zaten filtered
   - REJECTED: fuzzy search (T5) — mimari uyumsuz

2. IMPLEMENTATION STRATEJISI:
   - Secenek A: Tum transferleri tek session'da yap (S37)
     + Avantaj: Tek Docker rebuild, tek test dongusu
     - Dezavantaj: Buyuk degisiklik, rollback zor
   - Secenek B: Katmanli — S37'de T1+T6 (dusuk maliyet, yuksek deger), S38'de T2+T3+T4
     + Avantaj: Kucuk adimlar, kolay rollback
     - Dezavantaj: 2 Docker rebuild
   - Tavsiye: Secenek B (incremental, daha guvenli)

3. AUDIT TRAIL YAKLASIMI:
   - Secenek A: sor_queue tablosuna ek kolonlar (retry_count, content_hash, duration_ms)
     + Basit, tek tablo
     - Gecmis kaybolur (UPDATE ustune yazar)
   - Secenek B: Ayri sor_upload_log tablosu (immutable, orijinaldeki gibi)
     + Tam gecmis, orjinale sadik
     - Ek tablo, DDL degisikligi
   - Tavsiye: Secenek B (orijinaldeki pattern KANITLANMIS)

4. GRID SEARCH CACHING:
   - Orijinal: SQLite grid_rows cache (40K+ satir), stale detection, fuzzy search
   - Yeni: Cache YOK, her upload icin live API call
   - Soru: Grid cache eklemek deger mi?
   - Analiz: Her trigger fire'da max 10 dosya isleniyor. Her dosya icin ayri grid search
     yapiliyor ama Voorinfra API hizli (~1s). 10 dosya icin ~10s ek sure.
     Grid cache ile bu ~0.1s'e duser ama complexity artar.
   - Karar: ERTELENDI — mevcut hiz yeterli. 50+ dosya/fire olursa yeniden degerlendir.

---
BASLA! Context'i yukle (ADIM 1), servisleri kontrol et (ADIM 2),
sonra master goal'e (ADIM 3) gore calis.
ADIM 5'teki tetikleyiciler SESSION BOYUNCA AKTIF — surekli uygula.
Token tasarrufu YAPMA. Detayli, kapsamli, otonom calis.
---
