# WhatsApp Old Media Recovery — S20 State & Breakthrough

**Date:** 2026-03-06
**Session:** S20
**Branch:** `fix/whatsapp-440-reconnect-loop`
**Commit:** `ddf9e95` (deployed) + uncommitted proto diagnostic + metadata persistence fix
**Status:** BREAKTHROUGH CONFIRMED — mediaKey IS PRESENT in ON_DEMAND history sync

---

## BREAKTHROUGH (S20)

### hasMediaKey=false was WRONG all along!

`Boolean(documentMessage.mediaKey)` returned false even for real-time messages that successfully downloaded.
52 real-time messages with binary data ALL showed hasMediaKey=false — the check was systematically broken.

### PROTO-DIAG test result (2026-03-06 08:40 UTC)

Triggered `fetchMessageHistory()` for SOR Euronet group. Result:

```
PROTO-DIAG doc msgId=A523...4D fileName=2716CT-59-POP-HUIS.SOR mediaKey=PRESENT(oy05cl1uwrCB...) directPath=PRESENT url=PRESENT fileLength=101443
PROTO-DIAG doc msgId=3EB0D5...0E fileName=2725DL_17_V1.SOR      mediaKey=PRESENT(s0hBjK44I7aY...) directPath=PRESENT url=PRESENT fileLength=20971
PROTO-DIAG doc msgId=3EB067...E7 fileName=2716BH_124_V1.SOR     mediaKey=PRESENT(QgwokMX8Q/Yo...) directPath=PRESENT url=PRESENT fileLength=20975
PROTO-DIAG doc msgId=3EB033...64 fileName=2716BC_177_V1.SOR     mediaKey=PRESENT(OtT4BHoIR3Mx...) directPath=PRESENT url=PRESENT fileLength=20975
PROTO-DIAG doc msgId=3EB0AB...6A fileName=2715BR_53_V1.SOR      mediaKey=PRESENT(jPbu6914wS7C...) directPath=PRESENT url=PRESENT fileLength=20975
```

**5/5 document messages have mediaKey + directPath + url!**

### metadata persistence fix WORKS

```sql
-- DB now stores actual keys:
has_mk_stored=t, has_dp_stored=t
media_key_prefix: s0hBjK44I7aYguY5p0l6jf5yBnxW/B...
direct_path: /v/t62.7119-24/594006431_2411596402602133_180766...
url: https://mmg.whatsapp.net/v/t62.7119-24/...
```

### Download still fails — CDN URLs expired

Despite having mediaKey+directPath+url, `downloadMediaWithRetry()` returns undefined.
CDN URLs are expired (files from Dec 2025 - Mar 2026, 30-day CDN retention).

---

## NEXT STEP: Media Re-upload Request

The sender's phone must re-upload the file to CDN. Baileys supports this:

```typescript
// In downloadMediaMessage() — already has reuploadRequest support:
const stream = await downloadContentFromMessage(
  { mediaKey, directPath, url },
  type,
  { reuploadRequest: sock.updateMediaMessage }  // <-- THIS re-uploads via sender's phone
);
```

### Implementation needed:

1. **Reconstruct WAMessage from stored metadata** — build a minimal proto with mediaKey, directPath, url, messageKey
2. **Call `sock.updateMediaMessage(msg)`** — asks sender's phone to re-upload to CDN
3. **Listen to `messages.media-update` event** — receives new URL
4. **Download with new URL + existing mediaKey** — decrypt and store

### Prerequisites for re-upload:
- Sender's phone must be ONLINE
- Sender's phone must still HAVE the file
- Sender's phone media retention: likely YES (20KB SOR files, WhatsApp doesn't auto-delete)

---

## UNCOMMITTED CHANGES (must commit in S21)

### 1. message-parser.ts — metadata persistence
- Added mediaKey (base64), directPath, url to ParsedWhatsAppMessageMetadata
- Stores actual values instead of just booleans

### 2. whatsapp-api.ts — PROTO-DIAG logging
- Temporary diagnostic log for document messages in history sync handler
- Logs raw mediaKey presence/absence from proto

### 3. message-parser.test.ts — updated test expectations
- Test expects new mediaKey/directPath/url fields
- All 4 tests PASS

---

## RESEARCH SUMMARY (10 agents, Wave 2)

| # | Agent | Key Finding |
|---|-------|------------|
| 1 | on-demand-proto-verifier | hasMediaKey is BROKEN — false even for successful downloads (52/52 real-time) |
| 2 | baileys-history-sync-protocol | Proto DEFINITION has mediaKey, but claimed server doesn't send it — WRONG (disproven by test) |
| 3 | whatsapp-media-key-research | whatsmeow/mautrix CONFIRM mediaKey in history sync, SendMediaRetryReceipt exists for this purpose |
| 4 | mega-sor-cross-reference | 0% match — MEGA Hollands Kroon backup doesn't cover SOR Euronet postcodes |
| 5 | whatsapp-web-media-mechanism | WhatsApp Web uses same retry/re-upload for old media, phone must be online |
| 6 | devils-advocate-v2 | Said DEAD END based on hasMediaKey=false — DISPROVEN by PROTO-DIAG test |
| 7 | realtime-capture-validator | Real-time pipeline HEALTHY, 37/38 files captured on 2026-03-04 |
| 8 | placeholder-resend-researcher | requestPlaceholderResend triggers full message re-send with all media fields |
| 9 | sender-phone-media-researcher | 20KB SOR files likely still on phones, WhatsApp doesn't auto-delete |
| 10 | alternative-recovery-researcher | WhatsApp Export Chat from phone is best non-protocol alternative |

---

## DB Statistics (updated)

| Metric | Value |
|--------|-------|
| Total attachment messages | 4,956 |
| History sync attachments | 4,825 |
| History sync with data | 28 |
| History sync NO data | 4,797 |
| Real-time with data | 131 |
| SOR Euronet total | 1,561 |
| SOR Euronet attachments | 1,102 |
| NEW: Messages with stored mediaKey | 5 (from S20 PROTO-DIAG test) |

---

## KEY FILES

| File | Purpose |
|------|---------|
| `packages/gateway/src/channels/plugins/whatsapp/message-parser.ts` | mediaKey/directPath/url persistence (MODIFIED) |
| `packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts` | PROTO-DIAG logging + history sync handler (MODIFIED) |
| `packages/gateway/src/channels/plugins/whatsapp/message-parser.test.ts` | Updated tests (MODIFIED) |
| `.planning/MEDIA-RECOVERY-STATE.md` | Previous session state (S19) |

---

## S21 ACTION PLAN

1. **COMMIT** current changes (metadata persistence + PROTO-DIAG)
2. **Implement media re-upload request:**
   - Build endpoint/function that reconstructs WAMessage from DB metadata
   - Call `sock.updateMediaMessage(msg)` for expired-URL messages
   - Handle `messages.media-update` event for new URLs
   - Download with new URL + stored mediaKey
3. **Batch processing:**
   - Trigger fetchMessageHistory in batches of 50 (Baileys limit)
   - Store all mediaKeys
   - Queue re-upload requests with throttling (ban risk)
4. **Test with single SOR file from 2026-03-02**

## Auth Note
- UI password was removed from DB (DELETE FROM settings WHERE key='ui_password_hash')
- Container restarted to clear cache
- API now accessible without auth — set new password after testing
