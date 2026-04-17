# WhatsApp Media Recovery for Old Messages - Research

**Researched:** 2026-03-06
**Domain:** WhatsApp media protocol, CDN retention, re-upload mechanisms
**Confidence:** HIGH (protocol architecture), MEDIUM (specific tool capabilities)

## Summary

We have ~1000 old WhatsApp messages (SOR files) in the "Sor Euronet" group that were received via Baileys history sync WITHOUT binary data. The core problem is that WhatsApp CDN URLs expire after ~30 days, and history sync delivers message metadata (including mediaKey, directPath) but the CDN blobs are already gone by the time we try to download.

The research reveals that WhatsApp has a **media re-upload mechanism** where a companion device (Baileys/WhatsApp Web) can request the **primary phone** to re-upload expired media to the CDN. This is the `updateMediaMessage` / `reuploadRequest` flow in Baileys. However, this mechanism has known bugs (Issue #507: decryption failures after reupload) and requires the phone to still have the media locally. For group messages sent by OTHER people, the phone may NOT have the original file -- only the sender's phone does.

**Primary recommendation:** Use a Chrome extension (WA Media Downloader Pro) for immediate bulk recovery via WhatsApp Web, then fix Baileys pipeline to download media in real-time going forward.

## 1. WhatsApp Media Architecture

### How Media Storage Works

| Component | Description | Confidence |
|-----------|-------------|------------|
| Upload | Sender encrypts media with random AES key, uploads to WhatsApp CDN | HIGH |
| Metadata | Message protobuf contains: `mediaKey`, `url` (CDN), `directPath`, `fileSha256`, `fileEncSha256`, `mediaKeyTimestamp` | HIGH |
| E2E | Media is AES-256-CBC encrypted client-side before upload; server never sees plaintext | HIGH |
| CDN retention | ~30 days for delivered media, up to 30 days for undelivered | HIGH |
| Deletion trigger | After all recipients download, or after 30-day TTL expires | MEDIUM |

### CDN URL Lifecycle

1. **Fresh (0-30 days):** Direct download via `url` or `directPath` works
2. **Expired (30+ days):** Returns HTTP 410 Gone or 404 Not Found
3. **Purged:** Media blob removed from CDN entirely; no URL will work

**Source:** [WhatsApp Privacy Policy](https://www.whatsapp.com/legal/privacy-policy), [WhatsApp Help Center](https://faq.whatsapp.com/820124435853543)

### Key Insight: mediaKey Persists, CDN Blob Does Not

The `mediaKey` (decryption key) is part of the message protobuf and persists forever in history sync data. But the encrypted blob on the CDN is temporary. Having the key without the blob is useless for direct download.

## 2. Media Re-Upload Protocol

### How It Works (Multi-Device)

```
Companion Device (Baileys)          WhatsApp Server          Primary Phone
        |                                |                        |
        |-- downloadMediaMessage() ----->|                        |
        |<---- HTTP 410 Gone -----------|                        |
        |                                |                        |
        |-- updateMediaMessage(msg) ---->|                        |
        |                                |-- re-upload request -->|
        |                                |<-- re-encrypts+uploads-|
        |                                |                        |
        |<---- new URL + keys ----------|                        |
        |-- download new URL ---------->|                        |
        |<---- encrypted blob ----------|                        |
        |-- decrypt with new keys                                |
```

### Critical Limitation for Group Messages

The re-upload request goes to **YOUR phone** (the primary device linked to Baileys). Your phone can only re-upload media that IT has locally. For group messages:

- **Messages YOU sent:** Your phone has the original file -- re-upload works
- **Messages OTHERS sent:** Your phone only has the file IF it was auto-downloaded to your phone's storage. If auto-download was off, or if the phone's WhatsApp cleared its cache, the file is GONE

This is the fundamental blocker: the ~1000 SOR files were sent by other group members (Sahip Ismail, MazluM, Sinan, Yassin). Your phone may or may not have downloaded them.

### Baileys Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| `downloadMediaMessage()` with retry | Working | Already implemented in OwnPilot |
| `reuploadRequest` option | Working | Passes `sock.updateMediaMessage` |
| `updateMediaMessage()` direct call | Buggy | Issue #507: decryption failures |
| History sync media download | Broken | "Message payload not found in cache" for old messages |

**Source:** [Baileys Issue #507](https://github.com/WhiskeySockets/Baileys/issues/507), [Baileys README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md)

### The "cache" Problem

When Baileys reports "Message payload not found in cache for retry," it means the message protobuf (with mediaKey, url, etc.) was NOT stored in Baileys' internal message store when the history sync event fired. The `getMessage` callback in socket config must return stored messages for retry/reupload to work. OwnPilot stores messages in PostgreSQL but the `getMessage` callback may not be wired to return them.

## 3. Feasibility Matrix

| Method | Complexity | Reliability | Ban Risk | Speed | Cost |
|--------|-----------|-------------|----------|-------|------|
| A. Chrome Extension (WA Media Downloader Pro) | LOW | HIGH | NONE | ~1hr for 1000 files | Free/PRO ~$5 |
| B. Fix Baileys reupload pipeline | HIGH | LOW-MEDIUM | NONE | Days of dev | Free |
| C. WhatsApp Web + Playwright automation | MEDIUM | MEDIUM | MEDIUM | Hours | Free |
| D. whatsapp-web.js library | MEDIUM-HIGH | MEDIUM | LOW | Days of dev | Free |
| E. Manual WhatsApp phone export | LOW | HIGH | NONE | Hours (manual) | Free |
| F. Ask group members to resend | LOW | HIGH | NONE | Days (social) | Free |
| G. whatsmeow (Go library) | HIGH | LOW | LOW | Days of dev | Free |

## 4. Detailed Method Analysis

### A. Chrome Extension: WA Media Downloader Pro (RECOMMENDED)

**What:** Chrome extension that runs on web.whatsapp.com, scans chat messages, and bulk-downloads all media/documents.

**How it works:**
1. Open web.whatsapp.com in Chrome
2. Navigate to "Sor Euronet" group
3. Extension scans messages (has "Deep Scan" for long chats)
4. Select file types (documents/SOR files)
5. Download as ZIP with smart filenames (date, chat name, original filename)

**Key features:**
- Date range filter (PRO version)
- Deep Scan for very long chats (tens of thousands of messages)
- Smart filenames preserve original document names
- All processing runs locally in browser (no server upload)
- Supports: PDF, DOCX, XLSX, TXT, ZIP and more

**Why this works for our case:**
- WhatsApp Web requests media from your phone via the native re-upload mechanism
- The phone triggers the download/re-upload transparently
- Files that your phone has locally will be served
- Files that the CDN still has will be served directly
- No API/protocol knowledge needed

**Limitations:**
- Free version: 25 files per download
- PRO version needed for bulk (removes limits)
- Files truly deleted from ALL devices + CDN = unrecoverable
- Requires Chrome browser session open
- Extension rating: 4.3/5 stars

**Source:** [Chrome Web Store](https://chromewebstore.google.com/detail/wa-media-downloader-pro/ifbnofcpgmmnbollmkjpckdpjcadfnie)

### B. Fix Baileys Reupload Pipeline

**What:** Wire the `getMessage` callback to return stored messages from PostgreSQL, enabling the reupload mechanism.

**Why it likely won't work for OLD messages:**
1. The `updateMediaMessage` has known decryption bugs (Issue #507, closed April 2025 but unclear if fixed in RC9)
2. For group messages from others, your phone needs the file locally
3. History sync messages may not have complete protobuf for reupload
4. Even if fixed, only works for messages where your phone cached the media

**When it IS useful:** Preventing future data loss. If `getMessage` returns proper protobufs, real-time message retries will work better.

### C. WhatsApp Web + Playwright Automation

**What:** Automate a browser session on web.whatsapp.com to scroll through the group, click on each document, and save it.

**Complexity:** Medium -- need to handle WhatsApp Web's React-based UI, lazy loading, scroll pagination.

**Ban risk:** Medium -- WhatsApp can detect automated browser interactions. Mitigate with human-like delays (10-30s between actions).

**Advantage over Chrome extension:** Fully programmable, can cross-reference with DB to download only missing files.

**Disadvantage:** More complex, more risk, essentially building what the Chrome extension already does.

### D. whatsapp-web.js Library

**What:** Node.js library that runs WhatsApp Web in Puppeteer.

**Relevant features:**
- `downloadMedia()` on message objects
- `downloadEvenIfExpensive: true` flag (internal, triggers phone re-upload)
- Can iterate through group messages programmatically

**Issues:**
- `downloadMedia()` can hang indefinitely on expired media (Issue #3829)
- Fix in v1.34.3 for expired media promise resolution
- Same fundamental limitation: phone must have the file

### E. Manual WhatsApp Phone Export

**What:** Use WhatsApp's built-in "Export chat" feature from the phone app.

**Limits:**
- 10,000 messages with media per export
- Group chat export available
- Files bundled as ZIP
- **NEW (April 2025):** "Advanced Chat Privacy" can block exports if enabled by group admin

**Drawback:** May not include very old media if phone storage was cleared.

### F. Ask Group Members to Resend

**What:** Ask the SOR file senders to re-share the files.

**Reality:** These are work documents (SOR files from Euronet). The senders (Sahip Ismail, MazluM, Sinan, Yassin) likely still have them. But social overhead is high for ~1000 files.

**Hybrid approach:** Use Chrome extension for bulk recovery, then ask senders only for the remaining unrecoverable files.

### G. whatsmeow (Go Library)

**What:** Go-based WhatsApp Web API by tulir.

**Media handling:** Has `DownloadAny()` and media download functions. Defines specific errors: `ErrMediaDownloadFailedWith410`. Has `AutomaticMessageRerequestFromPhone` for message decryption retries.

**Same limitation:** No magic bypass for expired CDN + missing local phone copy.

## 5. Recommended Approach (Step-by-Step)

### Phase 1: Immediate Recovery (Chrome Extension) -- 1-2 hours

1. Install "WA Media Downloader Pro" Chrome extension
2. Open web.whatsapp.com, authenticate with QR
3. Navigate to "Sor Euronet" group
4. Use Deep Scan to crawl entire chat history
5. Filter for document types (SOR files)
6. Download as ZIP with date-based filenames
7. Cross-reference downloaded files with DB (`channel_messages` where `data IS NULL`)
8. Import recovered files into DB via OwnPilot media endpoint

### Phase 2: Fix Forward Pipeline -- 2-4 hours

1. Wire `getMessage` callback in Baileys socket config to query PostgreSQL
2. Ensure real-time message handler downloads media immediately (already implemented)
3. Add monitoring/alerting for `downloadMediaWithRetry` failures
4. Deploy updated OwnPilot container

### Phase 3: Gap Filling -- as needed

1. For any files NOT recovered by Chrome extension:
   - Check if senders' phones still have the files
   - Ask specific senders to re-share specific missing files
2. For future-proofing:
   - Implement a daily media audit job that checks for `data IS NULL` rows
   - Auto-retry download for messages < 30 days old

## 6. Common Pitfalls

### Pitfall 1: Assuming updateMediaMessage Will Recover Everything
**What goes wrong:** Developers spend days fixing the reupload pipeline, only to find most group media is unrecoverable because the primary phone never cached it.
**Prevention:** Use browser-based approach first (Chrome extension), which leverages WhatsApp's own native media serving.

### Pitfall 2: Running Automated WhatsApp Web Scripts Too Fast
**What goes wrong:** Account gets flagged/banned for bot-like behavior.
**Prevention:** Use Chrome extensions (designed to work within WhatsApp's expectations) rather than raw Playwright scripts.

### Pitfall 3: Not Downloading Media in Real-Time
**What goes wrong:** Relying on history sync for media, which often arrives without binary data.
**Prevention:** Always download media immediately in the `messages.upsert` handler. Never defer media download.

### Pitfall 4: Confusing "mediaKey exists" with "media is downloadable"
**What goes wrong:** Assuming that because history sync provides mediaKey/directPath/url, the media can be downloaded.
**Prevention:** mediaKey is the decryption key (permanent), but the CDN blob is temporary (~30 days). Both are needed.

## 7. DB Integration Plan

### Matching Downloaded Files to DB Rows

```sql
-- Find all SOR attachment rows without binary data
SELECT id, created_at, sender_name,
       attachments->0->>'filename' as filename,
       attachments->0->>'mimeType' as mimetype,
       length(attachments->0->>'data') as data_len
FROM channel_messages
WHERE metadata->>'jid' = '120363423491841999@g.us'
  AND content_type = 'attachment'
  AND (attachments->0->>'data' IS NULL OR attachments->0->>'data' = '')
ORDER BY created_at;
```

### Backfill Strategy

After downloading files via Chrome extension:
1. Match files by filename + approximate timestamp
2. Base64-encode file content
3. UPDATE `channel_messages` SET `attachments[0].data` = base64_content WHERE matched

## Sources

### Primary (HIGH confidence)
- [WhatsApp Privacy Policy](https://www.whatsapp.com/legal/privacy-policy) -- CDN retention ~30 days
- [WhatsApp E2E Encryption Help](https://faq.whatsapp.com/820124435853543) -- encryption architecture
- [Baileys README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md) -- updateMediaMessage usage
- [Baileys Issue #507](https://github.com/WhiskeySockets/Baileys/issues/507) -- reupload decryption bug
- [Baileys History Sync docs](https://baileys.wiki/docs/socket/history-sync/) -- history sync behavior
- [Meta Engineering: Multi-Device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/) -- multi-device architecture

### Secondary (MEDIUM confidence)
- [whatsapp-web.js Issue #752](https://github.com/pedroslopez/whatsapp-web.js/issues/752) -- media past cache limits
- [WA Media Downloader Pro](https://chromewebstore.google.com/detail/wa-media-downloader-pro/ifbnofcpgmmnbollmkjpckdpjcadfnie) -- Chrome extension capabilities
- [WABetaInfo: re-download deleted media](https://wabetainfo.com/whatsapp-allows-to-redownload-deleted-media/) -- re-download feature

### Tertiary (LOW confidence)
- WhatsApp CDN exact retention varies by region and message type -- 30 days is approximate
- `downloadEvenIfExpensive` / `rmrReason` parameters -- internal WhatsApp Web API, poorly documented

## Metadata

**Confidence breakdown:**
- Media architecture & CDN retention: HIGH -- multiple official + verified sources
- Re-upload protocol flow: HIGH -- confirmed by Baileys source code + Meta engineering blog
- Group message limitation (phone must have file): MEDIUM -- inferred from protocol, not explicitly documented
- Chrome extension reliability: MEDIUM -- user reviews + feature description, not personally tested
- Baileys reupload bug status in RC9: LOW -- Issue #507 closed but fix not verified in current version

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (WhatsApp protocol changes rarely)
