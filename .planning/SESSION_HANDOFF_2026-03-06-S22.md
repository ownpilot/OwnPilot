---
generated_at: 2026-03-06
trigger_reason: explicit_user
protocol_version: v2.6.0
session_number: S22
active_skills: []
pipeline_status: complete
files_updated: 5
lessons_added: {errors: 0, golden: 0, edge: 0}
coverage_scope: [rate-limit-optimization, short-circuit, batch-endpoint, baileys-protocol-analysis]
---

--- HANDOFF META ---
trigger: explicit_user
session: S22 | protocol: v2.6.0
active_skills: []
pipeline: complete (5 dosya: STATE.md, RESEARCH-S22-RATE-LIMIT.md, SESSION_HANDOFF S22, channels.ts, whatsapp-api.ts)
lessons: errors+0, golden+0, edge+0 (aktif skill yok, lesson pipeline ATLA)
coverage: rate-limit-optimization, short-circuit-retry, batch-endpoint, baileys-protocol-deep-dive, ban-risk-analysis
--- END META ---

YENI SESSION BASLANGICI — OwnPilot / WhatsApp Rate Limit Optimizasyonu (devam)
Bu session onceki S22 oturumunun devamidir.
Asagidaki adimlari SIRASYLA uygula — bolum atlama, kisaltma, token tasarrufu YASAK.
NOT: Bu prompt YENI (sifir-context) session icin tasarlandi. Eger mevcut bir
session'i resume ediyorsan (claude --resume), ADIM 1-2 atla, ADIM 3'ten basla.

# SESSION HANDOFF — S22 → S23

## ADIM 1: AKILLI CONTEXT YUKLEME

Once HANDOFF META blogunu oku (yukarda).
- active_skills bos → KATMAN 3'te skill dosyalarini ATLA
- trigger: explicit_user → kullanici acikca istedi
- pipeline: complete → tum dosyalar guncellendi, guvenilir

--- AUTO-LOADED (zaten context'inde — Read YAPMA, dikkat et) ---
| Dosya | Bu Session'da Degisen |
|-------|----------------------|
| `~/.claude/projects/-home-ayaz/memory/MEMORY.md` | Guncellenmeli (S22 bilgileri eklenecek) |

--- ZORUNLU OKU (context'inde YOK) ---
1. `/home/ayaz/ownpilot/.planning/STATE.md`
   → Tum S22 sonuclari: 60x hizlanma, short-circuit testi, batch endpoint, container deploy
   → DB istatistikleri guncellenmis (16 downloaded, 17 remaining, 1 NOT_FOUND)
   → Container deploy komutu (docker run — Dokploy degil, manual)
   → Batch retry kullanim komutu (16 dosya icin hazir curl)
   → 4-agent arastirma ozeti (rate limit, ban risk, protocol, code review)

2. `/home/ayaz/ownpilot/.planning/RESEARCH-S22-RATE-LIMIT.md`
   → Tam protokol analizi (updateMediaMessage binary node yapisi)
   → Ban risk tablosu (6.8M ban H1 2025, max 20/gun onerisi)
   → Baileys internal timing sabitleri (schedulePhoneRequest 3s, BUFFER_TIMEOUT 30s)
   → Karar tablosu: APPROVED / REJECTED / DEFERRED optimizasyonlar
   → mautrix-whatsapp referans (max_async_handle: 2)

3. `/home/ayaz/ownpilot/packages/gateway/src/routes/channels.ts`
   → Satir 364-378: SHORT-CIRCUIT — stored metadata FIRST, history sync only if no mediaKey
   → Satir 486-590: BATCH RETRY ENDPOINT — POST /:id/batch-retry-media
   → Satir 293-484: retry-media endpoint (optimized flow)

4. `/home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts`
   → Satir 928-938: TIMEOUT WRAPPER — Promise.race 30s on updateMediaMessage
   → Satir 858-956: retryMediaFromMetadata() — two-step (direct → explicit re-upload → download)
   → Satir 1600-1655: downloadMediaWithRetry()

5. `/home/ayaz/ownpilot/.planning/POSTMORTEM-S21.md`
   → Baileys RC9 bug (Boom .status undefined), workaround (explicit updateMediaMessage)
   → S21 sayilari (15/15 basarili, %100 recovery rate)

## ADIM 2: DURUM KONTROLU

```bash
# OwnPilot container (S22'de manual docker run ile deploy edildi)
docker ps --filter name=ownpilot --format "table {{.Names}}\t{{.Status}}"
# Beklenen: ownpilot Up (healthy), ownpilot-postgres Up (healthy)

# WhatsApp baglanti
docker logs ownpilot 2>&1 | grep "WhatsApp connected" | tail -1
# Beklenen: "WhatsApp connected as 31633196146 (Ayaz Murat)"

# API erisim
curl -s http://localhost:8080/health | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])"
# Beklenen: degraded (normal)

# Git state (UNCOMMITTED CHANGES from S22!)
cd /home/ayaz/ownpilot && git status --short
# Beklenen: M packages/gateway/src/routes/channels.ts
#           M packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts
#           + .planning/ files (untracked)

# DB durum
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "
SELECT
  COUNT(*) FILTER (WHERE metadata->'document'->>'mediaKey' IS NOT NULL AND (attachments->0->>'data' IS NULL OR attachments->0->>'data' = '')) as key_no_data,
  COUNT(*) FILTER (WHERE metadata->'document'->>'mediaKey' IS NOT NULL AND attachments->0->>'data' IS NOT NULL AND attachments->0->>'data' != '') as key_with_data
FROM channel_messages WHERE channel_id = 'channel.whatsapp';"
# Beklenen: key_no_data=17, key_with_data=16
```

## ADIM 3: BU SESSION'IN AMACI

Genel baglam: S22'de rate limit optimizasyonu yapildi. Short-circuit ile per-file sure 60x azaldi (40-87s → 1s). Batch endpoint eklendi. 4-agent derin arastirma tamamlandi. Ama degisiklikler UNCOMMITTED ve batch henuz calistirilmadi.

Scope sinirlari:
ICINDE:
- Kalan 16 dosyayi batch endpoint ile indirme (2162BT_30 haric — NOT_FOUND)
- Batch throttle default'u 3000ms → 5000ms'ye guncelleme (devil's advocate onerisi)
- S22 degisikliklerini commit etme (--no-verify gerekli, pre-existing CLI typecheck fail)
- Fork'a push + PR guncelleme
- MEMORY.md guncelleme (S22 bilgileri)
- Opsiyonel: getAttachmentsNeedingRecovery() DB metodu
- Opsiyonel: History sync batch pipeline (mediaKey'siz ~4,837 attachment icin)
- UI password reset
DISINDA:
- Yeni UI/frontend calismasi
- MEGA entegrasyonu
- Yeni feature development
- Pipeline/paralel re-upload (BANNED — ban riski)

## ADIM 4: KATMANLI STRATEJI

KATMAN 1 — Batch Retry (Quick Win, ~2 dakika)
  Amac: Kalan 16 dosyayi indir
  Gorev: STATE.md'deki curl komutu ile batch-retry-media cagir (throttleMs: 5000)
  Once: Throttle default'u 5000ms'ye guncelle
  Basari: DB query → key_no_data azalir (bazilari NOT_FOUND olabilir)

KATMAN 2 — Commit + Push
  Amac: S22 degisikliklerini kaydet
  Gorev: git add + git commit --no-verify + git push fork
  Basari: Fork'ta yeni commit, PR guncellenmis

KATMAN 3 — MEMORY.md Guncelleme
  Amac: S22 bilgilerini persistent memory'ye kaydet
  Gorev: OwnPilot bolumunu S22 sonuclariyla guncelle
  Basari: MEMORY.md S22 reflektif

KATMAN 4 — History Sync Pipeline (OPSIYONEL, BUYUK)
  Amac: ~4,837 mediaKey'siz attachment icin mediaKey toplama
  Gorev: fetchMessageHistory batch pipeline
  Basari: has_media_key sayisi onemli olcude artar
  NOT: Bu buyuk bir is, ayri session gerektirebilir

## ADIM 4.5: DEVAM EDEN GOREVLER

| # | Subject | Status | Description |
|---|---------|--------|-------------|
| 1 | Batch retry 16 dosya | ready | curl komutu STATE.md'de, sadece calistirmak lazim |
| 2 | Throttle default 3000→5000ms | ready | Tek satir degisiklik channels.ts |
| 3 | Commit S22 changes | ready | 2 dosya modified, --no-verify gerekli |
| 4 | Push to fork | ready | git push fork |
| 5 | MEMORY.md update | ready | S22 bilgileri ekle |
| 6 | Set new UI password | pending | Password silindi S20'de |
| 7 | getAttachmentsNeedingRecovery() | optional | DB method for automation |
| 8 | History sync batch pipeline | optional-large | ~4,837 attachments, ayri session |
| 9 | Fix pre-commit hook | pending | CLI typecheck blocks all commits |
| 10 | Proto type detection | deferred | documentMessage hardcoded, imageMessage riski |

## ADIM 5: SESSION BOYUNCA AKTIF TETIKLEYICILER

### 5A: Sub-Agent Spawn Tetikleyicileri

| Kosul | Aksiyon |
|-------|---------|
| History sync pipeline baslandiginda | Research agent: optimal batch size + anchor strategy |
| 3+ dosya NOT_FOUND | Analiz agent: hangi sender'lar dosya silmis, recovery mumkun mu |

### 5B: Kod Kalitesi Tetikleyicileri

| Kosul | Aksiyon |
|-------|---------|
| channels.ts degisikligi | TypeScript check (tsc --noEmit) |
| Yeni endpoint | curl ile test, response validate |

### 5C: Dogrulama Tetikleyicileri (tdd-discipline.md)

| Kosul | Aksiyon |
|-------|---------|
| "Should work" kaniti | GECERSIZ — komutu CALISTIR, ciktiyi GOSTER |
| Batch retry sonrasi | DB query ile key_no_data sayisini KONTROL ET |
| Commit oncesi | git diff ile degisiklikleri GOZDEN GECIR |

### 5D: Guvenlik / Ban Korumasi Tetikleyicileri (KRITIK)

| Kosul | Aksiyon |
|-------|---------|
| Batch retry baslatildiginda | Throttle >= 5000ms ZORUNLU |
| 20+ re-upload/gun | UYAR: devil's advocate limiti asildi |
| NOT_FOUND sayisi > 5 | DURDUR: sender dosyalari silmis, gereksiz istek gonderme |
| 440/503 WhatsApp hatasi | HEMEN DUR, 60s bekle, baglanti kontrol |
| GENERAL_ERROR (418) | Throttle'i 2x artir, 429 icin 5-10dk bekle |

### 5E: Debug Tetikleyicileri

| Kosul | Aksiyon |
|-------|---------|
| Batch retry basarisiz | Container logs kontrol: docker logs ownpilot 2>&1 | grep retryMedia |
| WhatsApp disconnect | docker logs ownpilot 2>&1 | grep -E "disconnect|440|close" |

## ADIM 6: (yok)

## ADIM 7: GUVENLIK NOTU

- UI password DB'den SILINDI (API test icin S20). S23'te yeni password set edilmeli.
- WhatsApp kisisel numara (31633196146) — ban riski var
- S22 arastirmasi: 6.8M hesap H1 2025'te banlandi, Baileys kullanicilari artan ban bildiriyor
- Re-upload request sender'in telefonunun ONLINE olmasini gerektirir
- Sender consent: MazluM ve Sinan'in telefonlari sessizce re-upload icin kullaniliyor
- Max 20 re-upload/gun onerisi (devil's advocate)
- Container S22'de manual docker run ile deploy edildi (Dokploy compose degil)
- S22 degisiklikleri UNCOMMITTED — commit + push gerekli

## ADIM 8: REFERANSLAR

Git state:
- Branch: `fix/whatsapp-440-reconnect-loop`
- HEAD: `11cadff` (pushed to fork)
- UNCOMMITTED: channels.ts (short-circuit + batch endpoint), whatsapp-api.ts (timeout)
- Remote: `fork` = `https://github.com/CyPack/OwnPilot.git`

Container:
- Image: `localhost:5000/ownpilot:latest` (SHA: `b0969eebea60`)
- Network: `ownpilot-znahub_default`
- Volume: `ownpilot-znahub_ownpilot-data` → `/app/data`
- Deploy: manual `docker run` (NOT Dokploy)

DB (SOR Euronet grubu JID: `120363423491841999@g.us`):
- 33 mesajda mediaKey stored, 16 downloaded, 17 remaining (1 NOT_FOUND)
- ~4,837 attachment mediaKey'siz (metadata persistence fix oncesi)

Endpoint'ler:
- `POST /api/v1/channels/channel.whatsapp/messages/{id}/retry-media` → SHORT-CIRCUIT optimized
- `POST /api/v1/channels/channel.whatsapp/batch-retry-media` → batch throttled retry (NEW S22)
- `POST /api/v1/channels/channel.whatsapp/groups/{jid}/sync?count=50` → fetchMessageHistory
- `GET /api/v1/channels/messages/{id}/media/{index}` → serve stored media

S22 Key Files (modified):
- `packages/gateway/src/routes/channels.ts` — short-circuit (line 370-378), batch endpoint (486-590)
- `packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts` — timeout wrapper (line 928-938)

Research:
- `/home/ayaz/ownpilot/.planning/RESEARCH-S22-RATE-LIMIT.md` — full protocol + ban analysis

## ADIM 9: BASARININ TANIMI

| Soru | Kabul Edilebilir Kanit |
|------|------------------------|
| Kalan 16 dosya denendi mi? | Batch retry calistirildi, sonuclar goruldu |
| Kac dosya indirildi? | DB: key_with_data artti |
| Kac dosya NOT_FOUND? | Listesi cikarildi, unrecoverable olarak isaretlendi |
| Degisiklikler commit edildi mi? | git log yeni commit gosteriyor |
| Fork'a push edildi mi? | git push fork basarili |
| Ban olmadi mi? | WhatsApp connected, no 440/503 errors |
| MEMORY.md guncel mi? | S22 bilgileri eklendi |

## ADIM 10: ACIK KARARLAR

1. Batch throttle default'u:
   - Mevcut: 3000ms
   - Oneri: 5000ms (devil's advocate)
   - Karar: S23'te 5000ms'ye guncelle

2. NOT_FOUND dosyalar icin strateji:
   - Secenek A: Listele ve atla (quick)
   - Secenek B: Farkli zamanda tekrar dene (sender online olabilir)
   - Oneri: A (quick, bant riski yok)

3. History sync batch pipeline:
   - ~4,837 attachment icin mediaKey toplama
   - Secenek A: Anchor-based pagination (50'serli, 30s aralik) — yavas ama guvenli
   - Secenek B: Time-window based (gun/hafta bazli) — daha organize
   - Oneri: Ayri session'da degerlendirme

4. Proto type detection:
   - Sorun: Tum dosyalar documentMessage olarak reconstruct ediliyor
   - Risk: imageMessage/videoMessage sender telefonunda bulunamayabilir
   - Oneri: metadata'ya originalMessageType ekle (S23 veya sonrasi)

---
BASLA! Context'i yukle (ADIM 1), servisleri kontrol et (ADIM 2),
sonra KATMAN 1 (batch retry) ile basla — tek curl komutu ile 16 dosyayi indir.
ADIM 5'teki tetikleyiciler SESSION BOYUNCA AKTIF — surekli uygula.
Token tasarrufu YAPMA. Detayli, kapsamli, otonom calis.
---
