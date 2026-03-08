# SOR Media Recovery Runbook

**Date:** 2026-03-08  
**Branch:** fix/whatsapp-440-reconnect-loop  
**Status:** Production-verified ✅

---

## Problem Statement

WhatsApp SOR files (.sor) sent to group JIDs were stored as metadata-only
in DB (no binary data). After container rebuild, some files entered a
"phantom" state: `local_path` set in DB, but file missing from disk AND
`data` field NULL. PG trigger (`trg_enqueue_sor`) requires `data IS NOT NULL`,
so these files never reached `sor_queue` → never uploaded to Voorinfra.

**Root cause categories found:**

| Category | Description | Count |
|----------|-------------|-------|
| Phantom files | local_path in DB, disk file lost on container rebuild, data=NULL | 18 |
| Metadata-only (has mediaKey) | History sync stored metadata only, no binary | ~20 |
| Metadata-only (no mediaKey) | Key never obtained, Baileys RC9 bug | 13+ |

---

## Architecture: Download Chain

### 1. `downloadMediaWithRetry()` (whatsapp-api.ts:1976)

Primary download function. Wraps Baileys `downloadMediaMessage`.

```typescript
private async downloadMediaWithRetry(msg: WAMessage): Promise<Uint8Array | undefined>
```

- **Step 1:** Direct CDN download via `downloadMediaMessage()`
- **Step 2:** On 410/404 → retry (Baileys RC9 bug: automatic reuploadRequest
  never triggers because it checks `error.status` but Boom sets
  `output.statusCode`. We handle this explicitly in `retryMediaFromMetadata`)

### 2. `retryMediaFromMetadata()` (whatsapp-api.ts:954)

Key method for recovering expired CDN media using stored DB metadata.

```typescript
async retryMediaFromMetadata(params: {
  messageId: string;
  remoteJid: string;
  participant?: string;
  fromMe?: boolean;
  mediaKey: string;       // base64-encoded — MUST convert to Uint8Array!
  directPath: string;
  url: string;
  mimeType?: string;
  filename?: string;
  fileLength?: number;
}): Promise<{ data: Uint8Array; size: number; ... }>
```

**Algorithm:**
1. `mediaKey` base64 → `Buffer` → `new Uint8Array(buffer)` ← **CRITICAL**
2. Reconstruct minimal WAMessage proto (documentMessage format)
3. Try direct download (always fails for expired URLs — expected)
4. Explicit `sock.updateMediaMessage()` with 30s timeout → asks sender's
   phone to re-upload file to WhatsApp CDN
5. Download with fresh URL

**Why Uint8Array is critical:** Baileys crypto functions (`hkdf`) require
Uint8Array. Passing a Buffer causes silent decrypt failure.

### 3. `writeSorToDisk()` (whatsapp-api.ts:1403)

Writes binary to `/app/data/sor-files/{messageId}.sor`. Returns `local_path`.

### 4. PG Trigger `trg_enqueue_sor`

Fires AFTER INSERT OR UPDATE on `channel_messages`. Conditions:
- `direction = 'inbound'`
- `content ILIKE '%.sor'`
- `attachments->0->>'data' IS NOT NULL`  ← **binary must be in DB**
- `metadata->>'jid' = '120363423491841999@g.us'`  ← configured JID

`ON CONFLICT (message_id) DO NOTHING` — existing queue entries not reset.

---

## Recovery Endpoint

```
POST /api/v1/channels/:channelId/recover-media
Authorization: Bearer bypass   (AUTH_TYPE=none + ui_password_hash set)
Content-Type: application/json
```

**Body:**
```json
{
  "groupJid": "120363423491841999@g.us",
  "limit": 50,
  "throttleMs": 3000,
  "syncWaitMs": 20000,
  "skipSync": false,
  "dryRun": false
}
```

**Pipeline:**
1. Query `channel_messages` where `attachments->0->>'data' IS NULL`
2. If `totalNeedsKey > 0` → `fetchGroupHistory(groupJid, 50)` → wait `syncWaitMs`
3. Re-query → filter to those with `mediaKey`
4. Batch download via `retryMediaFromMetadata()` with `throttleMs` gap
5. On success: save `base64(binary)` to `attachments[0].data` via `updateAttachments()`
6. PG trigger fires → `sor_queue` entry created → Voorinfra upload

**Concurrency lock:** 5-minute TTL per channel. One recovery at a time.
If interrupted (curl killed), server continues in background. Lock held
until completion or TTL expiry.

**Safety limits:**
- `limit`: capped at 50
- `throttleMs`: min 2000ms (ban protection)
- `syncWaitMs`: 1000–30000ms

---

## Authentication Workaround

OwnPilot uses `AUTH_TYPE=none` (env) but a UI password is configured
(`ui_password_hash` in settings table). This causes `uiSessionMiddleware`
to block all `/api/v1/*` requests without auth header.

**Solution:** Any non-empty `Authorization` header bypasses the UI session
check. Since `AUTH_TYPE=none`, no token validation occurs.

```bash
curl -H "Authorization: Bearer bypass" http://localhost:8080/api/v1/...
```

**Code path:** `packages/gateway/src/middleware/ui-session.ts:39-51`
```typescript
if (isPasswordConfigured()) {
  const hasAuthHeader = c.req.header('Authorization');
  if (!hasAuthHeader && !hasApiKey) {
    return apiError(c, { code: 'UNAUTHORIZED' }, 401);
  }
  // Falls through to API auth middleware — skipped because AUTH_TYPE=none
}
```

---

## Recovery Session Results (2026-03-08)

### Batches Run

| Batch | Group JID | OK | FAIL | Notes |
|-------|-----------|-----|------|-------|
| 1 | 120363423491841999@g.us | 36 | 14 | 13 SOR + 23 non-SOR downloaded |
| 2 | 120363423491841999@g.us | ~28 | ~22 | Ran in background after interrupt |
| 3 | 120363423491841999@g.us | 37 | 13 | 7 SOR + non-SOR |
| 4 | 120363423491841999@g.us | 37 | 13 | Same 7 NOT_FOUND SOR repeatedly blocked |
| DM | 31633196146@s.whatsapp.net | 0 | 10 | All failed — phone offline |
| DM2 | 120363401899881787@g.us | 10 | 0 | Non-SOR files |

### Final Binary Download Status

| Status | Count | % |
|--------|-------|---|
| ✅ Binary in DB | **181** | **86.2%** |
| ❌ NOT_FOUND (sender's phone deleted) | 7 | 3.3% |
| ❌ Re-upload failed (phone offline) | 5 | 2.4% |
| ❌ No mediaKey (permanently lost) | 17 | 8.1% |
| **Total SOR messages** | **210** | |

### Permanently Unrecoverable Files

**NOT_FOUND (mediaKey stored, but sender's phone no longer has file):**
```
2321VP_5_V1.SOR   — 2025-11-18 — 120363423491841999@g.us
2321TM_7_V1.SOR   — 2025-11-18 — 120363423491841999@g.us
2321TM_17_V1.SOR  — 2025-11-18 — 120363423491841999@g.us
2162BT_30_V1.SOR  — 2025-11-21 — 120363423491841999@g.us
2162GM_56_V1.SOR  — 2025-11-21 — 120363423491841999@g.us
2162VJ_7_V1.SOR   — 2025-11-21 — 120363423491841999@g.us
2162XX_27_V1.SOR  — 2025-11-21 — 120363423491841999@g.us
```

**No mediaKey (history sync failed to retrieve):**
226GA_36, 2266GD_41, 226GA_38, 2266HX_18, 2266HZ_37, 2266HE_8 (2025-12-02),
2726TL_101, 2313TP_40, 2313TR_60, 2181CS_5, 2181GE_19, 2181LH_27,
2182CM_144 (2025-12-03), 2313ZL_19, 2575PR_78 (2025-12-11, DM),
2324AW-7/2423AW-9 (2026-02-16, DM), 2324HZ_33 (2026-03-01, DM)

---

## Post-Recovery: sor_queue Reset Required

Files downloaded via `recover-media` may already have `sor_queue` entries
with `status='error'` and `retry_count=3` from earlier failed attempts
(when binary was missing). The trigger's `ON CONFLICT DO NOTHING` prevents
re-insertion. Reset them manually:

```sql
UPDATE sor_queue sq
SET status = 'pending',
    retry_count = 0,
    error = NULL,
    updated_at = NOW()
FROM channel_messages cm
WHERE sq.message_id = cm.id
  AND sq.status = 'error'
  AND sq.error LIKE 'attachments[0].data missing%'
  AND cm.attachments->0->>'data' IS NOT NULL
  AND cm.attachments->0->>'data' != '';
```

---

## Running Recovery (Quick Reference)

```bash
# Check lock status
curl -s -X POST http://localhost:8080/api/v1/channels/channel.whatsapp/recover-media \
  -H "Authorization: Bearer bypass" -H "Content-Type: application/json" \
  -d '{"groupJid":"120363423491841999@g.us","limit":1,"dryRun":true}' | jq .

# Run batch (repeat until all downloaded)
curl -s -m 400 -X POST http://localhost:8080/api/v1/channels/channel.whatsapp/recover-media \
  -H "Authorization: Bearer bypass" -H "Content-Type: application/json" \
  -d '{
    "groupJid": "120363423491841999@g.us",
    "limit": 50,
    "throttleMs": 3000,
    "syncWaitMs": 20000,
    "skipSync": false
  }' | jq '{ok: .data.succeeded, fail: .data.failed, needsData: .data.pipeline.totalNeedsData}'

# Check remaining SOR without binary
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "
SELECT content, to_char(created_at,'YYYY-MM-DD') as sent, metadata->>'jid' as jid,
  metadata->'document'->>'mediaKey' IS NOT NULL as has_key
FROM channel_messages
WHERE channel_id='channel.whatsapp'
  AND (content ILIKE '%.sor' OR metadata->'document'->>'filename' ILIKE '%.sor')
  AND (attachments->0->>'data' IS NULL OR attachments->0->>'data'='')
ORDER BY created_at;"
```

---

## Key Learnings

1. **Baileys RC9 bug:** `downloadMediaMessage` never auto-triggers
   `reuploadRequest` because it checks `error.status` (undefined) instead
   of `error.output.statusCode`. Must call `sock.updateMediaMessage()`
   explicitly.

2. **mediaKey MUST be Uint8Array:** `Buffer.from(base64, 'base64')` gives
   a Buffer. Pass as `new Uint8Array(buffer)` to Baileys crypto functions.

3. **History sync is async:** `fetchGroupHistory()` triggers delivery via
   `messaging-history.set` event. Must wait (syncWaitMs) before re-querying.

4. **Volume persistence:** `/app/data/sor-files/` MUST be on a named Docker
   volume. If not, files are lost on container rebuild.

5. **NOT_FOUND means permanent loss:** If `updateMediaMessage()` returns
   NOT_FOUND, the sender's WhatsApp has already deleted the file locally.
   No recovery path exists.

6. **sor_queue ON CONFLICT:** Once a message is in sor_queue (even as error),
   the PG trigger won't re-insert it. Manual reset needed after recovery.
