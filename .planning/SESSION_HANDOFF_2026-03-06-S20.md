---
generated_at: 2026-03-06
trigger_reason: mid_task
protocol_version: v2.6.0
session_number: S20
active_skills: []
pipeline_status: partial
files_updated: 1
lessons_added: {errors: 0, golden: 0, edge: 0}
coverage_scope: [whatsapp-media-recovery]
---

# SESSION HANDOFF — S20 → S21

## ADIM 1: AKILLI CONTEXT YUKLEME

─── ZORUNLU OKU (context'inde YOK) ───
1. `/home/ayaz/ownpilot/.planning/MEDIA-RECOVERY-STATE-S20.md`
   → BUTUN S20 bulguları, PROTO-DIAG sonuçları, 10 agent rapor özeti, S21 action plan
   → [HANDOFF'TA OLUSTURULDU: S20 breakthrough + next steps]

2. `/home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts`
   → Satır 358-380: PROTO-DIAG logging (document messages)
   → Satır 688-790: fetchGroupHistory + fetchGroupHistoryFromAnchor
   → Satır 792-870: retryMediaDownload
   → Satır 238-249: getMessage callback

3. `/home/ayaz/ownpilot/packages/gateway/src/channels/plugins/whatsapp/message-parser.ts`
   → TÜMÜ: mediaKey/directPath/url artık gerçek değerler olarak saklanıyor (base64)

4. `/home/ayaz/ownpilot/packages/gateway/src/routes/channels.ts`
   → Satır 244-433: retry-media endpoint
   → Satır 989-1028: group sync endpoint

## ADIM 2: DURUM KONTROLU

```bash
# OwnPilot container (AUTH_TYPE=none, UI password SILINDI)
docker ps --filter name=ownpilot --format "table {{.Names}}\t{{.Status}}"
# Beklenen: ownpilot Up (healthy), ownpilot-postgres Up (healthy)

# WhatsApp bağlantı
docker logs ownpilot --tail 5 2>&1 | grep -i 'whatsapp\|connect'
# Beklenen: "WhatsApp connected as 31633196146"

# API erişim (password silindi, auth bypass)
curl -s http://localhost:8080/health | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])"
# Beklenen: degraded (normal)
```

## ADIM 3: BU SESSION'IN AMACI

Genel bağlam: OwnPilot WhatsApp gateway'i Baileys 7.0.0-rc.9 ile çalışıyor. Ownpilot kurulmadan ÖNCE SOR Euronet grubuna gönderilen ~1000+ SOR dosyasının binary data'sı history sync ile geldi ama indirilmedi. S20'de 10 specialist agent araştırması ve PROTO-DIAG testi ile **mediaKey'in ON_DEMAND history sync'te MEVCUT** olduğu kanıtlandı. Eski `Boolean(mediaKey)` kontrolü sistematik olarak yanlıştı. CDN URL'leri expired olduğu için download başarısız, ama artık mediaKey elimizde ve `sock.updateMediaMessage()` ile sender'ın telefonundan re-upload isteyebiliriz.

Bu session'ın TEK ANA HEDEFI:
**2026-03-02'den (veya öncesinden) bir SOR dosyasının binary data'sını indirmek — media re-upload request mekanizmasını implement ederek.**

Scope sınırlar:
ICINDE:
- Uncommitted değişiklikleri commit et (message-parser.ts, whatsapp-api.ts, test)
- `sock.updateMediaMessage()` ile media re-upload request implement et
- DB'deki stored mediaKey+directPath+url'den WAMessage reconstruct et
- `messages.media-update` event handler ekle
- Batch fetchMessageHistory → tüm mediaKey'leri topla
- Tek bir SOR dosyası indir ve doğrula
DISINDA:
- Yeni UI/frontend çalışması
- Başka grup/chat'lerle ilgilenme
- MEGA entegrasyonu (bu session değil)

## ADIM 4: KATMANLI STRATEJI

KATMAN 1 — Commit & Deploy
  Amaç: Mevcut değişiklikleri kaydet
  Görev: 3 modified dosyayı commit et (metadata persistence + PROTO-DIAG + test update)
  Başarı: `git log --oneline -1` yeni commit gösterir, `pnpm exec vitest run message-parser.test.ts` 4/4 PASS

KATMAN 2 — Media Re-upload Request Implementation
  Amaç: Expired CDN URL'li mesajlar için sender'ın telefonundan yeni URL iste
  Görev:
  - DB'den mediaKey+directPath+url oku
  - WAMessage proto reconstruct et (minimal: documentMessage with mediaKey, directPath, url + message key)
  - `sock.updateMediaMessage(reconstructedMsg)` çağır
  - `messages.media-update` event'ini dinle → yeni URL al
  - Yeni URL + mevcut mediaKey ile `downloadContentFromMessage()` çağır
  - Binary data'yı DB'ye kaydet
  Başarı: Tek bir SOR dosyası binary data olarak DB'de

KATMAN 3 — Batch Recovery Pipeline
  Amaç: Tüm eski SOR dosyalarının mediaKey'lerini topla
  Görev:
  - fetchMessageHistory() loop (50'şerli batch, 30s rate limit)
  - Her batch'te mediaKey'leri DB'ye kaydet
  - Re-upload queue: throttled (ban riski)
  Başarı: X/1000+ dosya indirilebilir durumda

## ADIM 4.5: DEVAM EDEN GOREVLER

| # | Subject | Status | Description |
|---|---------|--------|-------------|
| 1 | Commit metadata persistence changes | pending | 3 dosya modified: message-parser.ts, whatsapp-api.ts, message-parser.test.ts |
| 2 | Implement media re-upload request | pending | sock.updateMediaMessage + messages.media-update handler |
| 3 | Download single SOR file from 2026-03-02 | pending | End-to-end test: fetch history → get mediaKey → re-upload → download |
| 4 | Batch fetchMessageHistory pipeline | pending | 50'şerli batch, tüm mediaKey'leri DB'ye kaydet |
| 5 | Set new UI password | pending | Password silindi for API testing, needs reset |

## ADIM 5: SESSION BOYUNCA AKTIF TETIKLEYICILER

| Koşul | Aksiyon |
|-------|---------|
| 3+ bağımsız iş akışı tespit edildi | Her akışa 1 agent spawn et |
| Arastirma + uygulama + dogrulama birlikte | Explore + general-purpose + code-reviewer paralel |
| Mimari karar verilecek | Devil's advocate agent spawn |
| 50+ satır kod değişikliği | code-reviewer agent spawn |
| Test + kod aynı anda yazılacak | 2 paralel agent (TDD) |
| "Should work" kanıtı | GECERSIZ — komutu CALISTIR, ciktiyi GOSTER |

## ADIM 6: (yok)

## ADIM 7: GUVENLIK NOTU

- UI password DB'den SİLİNDİ (API test için). S21'de yeni password set edilmeli.
- WhatsApp kişisel numara (31633196146) — ban riski var, throttle zorunlu
- Re-upload request sender'ın telefonunun ONLINE olmasını gerektirir
- 20KB SOR dosyaları sender'ın telefonunda büyük ihtimalle hala var (WhatsApp otomatik silmez)

## ADIM 8: REFERANSLAR

Kritik dosyalar:
- `packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts` → Ana WhatsApp handler (1500+ satır)
- `packages/gateway/src/channels/plugins/whatsapp/message-parser.ts` → Media metadata extraction (140 satır)
- `packages/gateway/src/routes/channels.ts` → REST API routes (retry-media, group sync)
- `.planning/MEDIA-RECOVERY-STATE-S20.md` → Tüm araştırma bulguları + 10 agent rapor

Git state:
- Branch: `fix/whatsapp-440-reconnect-loop`
- HEAD: `ddf9e95` (son commit)
- Uncommitted: message-parser.ts, whatsapp-api.ts, message-parser.test.ts (metadata persistence + PROTO-DIAG)
- Remote: `fork` = `https://github.com/CyPack/OwnPilot.git`

DB (SOR Euronet grubu JID: `120363423491841999@g.us`):
- 4,956 attachment mesaj, 4,797 NO_DATA
- 5 mesajda mediaKey stored (S20 PROTO-DIAG testi)
- Örnek mesaj IDs (mediaKey var): `3EB0D5BB2405341320AF0E` (2725DL_17_V1.SOR), `3EB0673A4A352060697DE7` (2716BH_124_V1.SOR)

Endpoint'ler:
- `POST /api/v1/channels/channel.whatsapp/groups/{jid}/sync?count=50` → fetchMessageHistory trigger (202)
- `POST /api/v1/channels/:id/messages/:messageId/retry-media` → media retry
- `GET /api/v1/channels/messages/:id/media/:index` → serve stored media

Baileys key functions:
- `sock.updateMediaMessage(msg)` → re-upload request to sender's phone
- `downloadContentFromMessage({mediaKey, directPath, url}, type)` → download + decrypt
- `sock.ev.on('messages.media-update', ...)` → re-upload response handler

S20 PROTO-DIAG kanıt (5/5 mediaKey PRESENT):
```
fileName=2716CT-59-POP-HUIS.SOR mediaKey=PRESENT(oy05cl1uwrCB...)
fileName=2725DL_17_V1.SOR       mediaKey=PRESENT(s0hBjK44I7aY...)
fileName=2716BH_124_V1.SOR      mediaKey=PRESENT(QgwokMX8Q/Yo...)
fileName=2716BC_177_V1.SOR      mediaKey=PRESENT(OtT4BHoIR3Mx...)
fileName=2715BR_53_V1.SOR       mediaKey=PRESENT(jPbu6914wS7C...)
```

## ADIM 9: BASARININ TANIMI

| Soru | Kabul Edilebilir Kanıt |
|------|------------------------|
| Metadata persistence çalışıyor mu? | DB query: `metadata->'document'->>'mediaKey' IS NOT NULL` → 5+ satır |
| Re-upload request gönderilebiliyor mu? | Container logu: `updateMediaMessage` çağrısı + response |
| Tek SOR dosyası indirilebildi mi? | `GET /media/:index` → HTTP 200 + Content-Type: application/octet-stream + 20KB body |
| Binary data DB'de mi? | `attachments->0->>'data' IS NOT NULL` → HAS_DATA |

## ADIM 10: ACIK KARARLAR

1. Re-upload request başarısız olursa (sender phone offline/dosya silinmiş):
   - Seçenek A: WhatsApp Export Chat — sender'dan grubun chat export'unu iste (ZIP + medya)
   - Seçenek B: Sender'lara "telefonunuzdaki WhatsApp Documents klasöründen SOR'ları Google Drive'a yükleyin" de
   - Seçenek C: requestPlaceholderResend() dene (farklı mekanizma, full message re-send)

2. Batch throttling stratejisi:
   - Seçenek A: 50 mesaj/30s (Baileys rate limit) + 1 re-upload/5s
   - Seçenek B: Daha agresif ama ban riski yüksek

───────────────────────────────────────────────
BASLA! Context'i yükle (ADIM 1), servisleri kontrol et (ADIM 2),
sonra master goal'e (ADIM 3) göre çalış.
ADIM 5'teki tetikleyiciler SESSION BOYUNCA AKTİF — sürekli uygula.
Token tasarrufu YAPMA. Detaylı, kapsamlı, otonom çalış.
───────────────────────────────────────────────
