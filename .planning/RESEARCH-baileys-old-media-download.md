# Research: Downloading Old Media from WhatsApp History Sync Messages

**Researched:** 2026-03-06
**Domain:** WhatsApp media protocol, Baileys library internals
**Confidence:** HIGH (based on Baileys source code analysis + community evidence + whatsmeow cross-reference)

---

## VERDICT: CONDITIONALLY YES -- But With Significant Limitations

**Can we download old media from WhatsApp history sync messages?**

**YES, IF** the phone (primary device) still has the media file locally AND is online.
**NO, IF** the media has been deleted from the phone, or the phone is offline.

The mechanism is `sock.updateMediaMessage()` (media retry/reupload request), BUT it requires the original `mediaKey` from the proto message -- which OwnPilot currently does NOT store in the database.

---

## Question 1: WhatsApp CDN URL Expiry

**Confidence: HIGH**

| Context | Expiry Time | Source |
|---------|------------|--------|
| WhatsApp CDN (mmg.whatsapp.net) for delivered media | Deleted shortly after all recipients download | WhatsApp FAQ, Quora answers |
| WhatsApp CDN for undelivered media | ~30 days | WhatsApp server retention policy |
| WhatsApp Business Cloud API media URLs | 5 minutes | Official Meta docs |
| directPath-based URLs (multi-device) | Days to weeks (varies, no official spec) | Community observation |

**Key finding from Baileys source code** (line 396-399 of messages-media.js):
```javascript
const DEF_HOST = 'mmg.whatsapp.net';
export const getUrlFromDirectPath = (directPath) => `https://${DEF_HOST}${directPath}`;
export const downloadContentFromMessage = async ({ mediaKey, directPath, url }, type, opts = {}) => {
    const isValidMediaUrl = url?.startsWith('https://mmg.whatsapp.net/');
    const downloadUrl = isValidMediaUrl ? url : getUrlFromDirectPath(directPath);
```

The `downloadContentFromMessage` function can use EITHER `url` or `directPath`. If the full URL is expired, but `directPath` is available, it reconstructs the URL. However, **both point to the same CDN resource** -- if the media is purged from CDN, neither works.

**After expiry:** HTTP 404 or 410 (Gone). The media is permanently removed from WhatsApp's CDN.

**Can they be refreshed?** NOT directly. You cannot "refresh" a CDN URL. Instead, you must request the **phone to re-upload** the media, which generates a NEW directPath/URL.

---

## Question 2: mediaKey + directPath Re-download

**Confidence: HIGH (verified from Baileys source)**

### How downloadContentFromMessage Works

From `messages-media.js` lines 397-405:

```javascript
export const downloadContentFromMessage = async ({ mediaKey, directPath, url }, type, opts = {}) => {
    const isValidMediaUrl = url?.startsWith('https://mmg.whatsapp.net/');
    const downloadUrl = isValidMediaUrl ? url : getUrlFromDirectPath(directPath);
    if (!downloadUrl) {
        throw new Boom('No valid media URL or directPath present in message', { statusCode: 400 });
    }
    const keys = await getMediaKeys(mediaKey, type);
    return downloadEncryptedContent(downloadUrl, keys, opts);
};
```

**Required fields:**
1. `mediaKey` -- the AES encryption key (random 32 bytes generated at send time)
2. `directPath` OR `url` -- the CDN location
3. `type` -- media type string (e.g., 'document', 'image', 'video', 'audio')

**Can you re-download after CDN expiry?** NO. Even if you have `mediaKey` and `directPath`, the file is gone from the CDN. The `mediaKey` is only used for DECRYPTION of the downloaded encrypted blob -- it does not grant any authentication or access rights to the CDN.

**The mediaKey is permanent** -- it never changes for a given message. But the CDN content behind `directPath` is temporary.

---

## Question 3: History Sync Media Limitations

**Confidence: HIGH (verified from Baileys source + OwnPilot code)**

### What history sync messages contain

From `history.js` (lines 9-19), history sync works by:
1. Downloading an encrypted blob from WhatsApp (using `downloadContentFromMessage` with type `md-msg-hist`)
2. Inflating (decompressing) the blob
3. Decoding as `proto.HistorySync` protobuf

The decoded `HistorySync` contains full `proto.IWebMessageInfo` messages, which for document messages include:

```protobuf
// From WAProto.proto - DocumentMessage fields include:
optional string url = 1;
optional string mimetype = 2;
optional string title = 3;
optional bytes fileSha256 = 4;
optional uint64 fileLength = 5;
optional uint32 pageCount = 6;
optional bytes mediaKey = 7;
optional string fileName = 8;
optional bytes fileEncSha256 = 9;
optional string directPath = 10;
// ... more fields
```

**CRITICAL FINDING:** History sync messages DO include `mediaKey`, `directPath`, `url`, `fileSha256`, and `fileEncSha256` in the protobuf. WhatsApp sends the FULL message proto during history sync.

**HOWEVER:** The CDN URLs in these messages are already expired by the time you receive them (the messages are days/weeks/months old). The `mediaKey` is valid but the CDN content is gone.

### What OwnPilot currently stores

From `message-parser.ts` (lines 118-127), OwnPilot's `extractWhatsAppMessageMetadata` only stores:
- `filename`, `mimeType`, `size`
- `hasMediaKey` (boolean -- NOT the actual key!)
- `hasUrl` (boolean)
- `hasDirectPath` (boolean)

**OwnPilot does NOT store:**
- The actual `mediaKey` (Uint8Array)
- The actual `directPath` (string)
- The actual `url` (string)
- `fileSha256` / `fileEncSha256`

This means even if we implement media retry, **we cannot do it for already-stored messages** because the crypto material was discarded.

---

## Question 4: Re-requesting History Sync

**Confidence: HIGH (verified from Baileys source)**

### fetchMessageHistory (On-Demand History Sync)

From `messages-recv.js` lines 37-51:

```javascript
const fetchMessageHistory = async (count, oldestMsgKey, oldestMsgTimestamp) => {
    const pdoMessage = {
        historySyncOnDemandRequest: {
            chatJid: oldestMsgKey.remoteJid,
            oldestMsgFromMe: oldestMsgKey.fromMe,
            oldestMsgId: oldestMsgKey.id,
            oldestMsgTimestampMs: oldestMsgTimestamp,
            onDemandMsgCount: count
        },
        peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND
    };
    return sendPeerDataOperationMessage(pdoMessage);
};
```

**This sends a Peer Data Operation request to the PHONE** asking it to package and upload more history. The phone responds asynchronously via a new `messaging-history.set` event with `syncType = ON_DEMAND`.

**Will this get media?** The phone packages the messages including their proto fields (mediaKey, directPath, url). But the CDN URLs will STILL be expired -- you get the message metadata again, not the media binary.

**Can we use this + media retry?** YES, theoretically:
1. `fetchMessageHistory()` to get the full proto (with `mediaKey`)
2. Then `updateMediaMessage()` to request the phone to re-upload the actual media binary

### requestPlaceholderResend

From `messages-recv.js` lines 53-76:

```javascript
const requestPlaceholderResend = async (messageKey) => {
    const pdoMessage = {
        placeholderMessageResendRequest: [{ messageKey }],
        peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.PLACEHOLDER_MESSAGE_RESEND
    };
    // ... sends to phone
};
```

This requests the phone to resend a specific message by its key. The response arrives via `messages.upsert` with the full `proto.WebMessageInfo`. This could also provide the `mediaKey` needed for media retry.

---

## Question 5: WhatsApp Web Protocol for Media Re-download

**Confidence: HIGH (verified from Baileys + whatsmeow source)**

### The Media Retry Receipt Protocol

From `messages-media.js` lines 576-662, the `encryptMediaRetryRequest` function:

```javascript
export const encryptMediaRetryRequest = async (key, mediaKey, meId) => {
    const recp = { stanzaId: key.id };
    const recpBuffer = proto.ServerErrorReceipt.encode(recp).finish();
    const iv = Crypto.randomBytes(12);
    const retryKey = await getMediaRetryKey(mediaKey);
    const ciphertext = aesEncryptGCM(recpBuffer, retryKey, iv, Buffer.from(key.id));
    const req = {
        tag: 'receipt',
        attrs: {
            id: key.id,
            to: jidNormalizedUser(meId),
            type: 'server-error'
        },
        content: [
            { tag: 'encrypt', attrs: {}, content: [
                { tag: 'enc_p', attrs: {}, content: ciphertext },
                { tag: 'enc_iv', attrs: {}, content: iv }
            ]},
            { tag: 'rmr', attrs: {
                jid: key.remoteJid,
                from_me: (!!key.fromMe).toString(),
                participant: key.participant || undefined
            }}
        ]
    };
    return req;
};
```

**How it works:**
1. Sends a `receipt` stanza with `type: 'server-error'` to the WhatsApp server
2. The server forwards this to the PRIMARY DEVICE (phone)
3. Phone sees a "server error receipt" and re-uploads the media from its local storage
4. Phone sends back a `MediaRetryNotification` with a NEW `directPath`
5. Baileys decrypts the notification and updates the message's URL

**Result types** (from proto):
- `SUCCESS` (0) -- new directPath available, status 200
- `DECRYPTION_ERROR` (1) -- status 412
- `NOT_FOUND` (2) -- media not on phone anymore, status 404
- `GENERAL_ERROR` (3) -- status 418

### The updateMediaMessage Function

From `messages-send.js` lines 840-881:

```javascript
updateMediaMessage: async (message) => {
    const content = assertMediaContent(message.message);
    const mediaKey = content.mediaKey;  // REQUIRES mediaKey from original message!
    const meId = authState.creds.me.id;
    const node = await encryptMediaRetryRequest(message.key, mediaKey, meId);
    // ... sends node, waits for response, updates directPath + url
}
```

**CRITICAL:** `updateMediaMessage` requires:
1. `message.key` -- {id, remoteJid, fromMe, participant}
2. `message.message` -- the FULL proto message content with `mediaKey` field

Without `mediaKey`, this function CANNOT work. The `mediaKey` is used both for the retry request encryption AND for decrypting the re-uploaded media.

---

## Question 6: Baileys downloadMediaMessage Requirements

**Confidence: HIGH (verified from source)**

### downloadMediaMessage (high-level)

From `messages.js` lines 790-835:

```javascript
export const downloadMediaMessage = async (message, type, options, ctx) => {
    // On 404/410, calls ctx.reuploadRequest(message) then retries download
    // Internally calls downloadContentFromMessage({ mediaKey, directPath, url }, mediaType)
};
```

**Required fields in the message proto:**
1. `mediaKey` (Uint8Array) -- MANDATORY for decryption
2. `directPath` (string) OR `url` (string) -- for CDN location
3. Media type is auto-detected from message content type (documentMessage, imageMessage, etc.)

**Can it work with just messageId + remoteJid?** NO. It absolutely REQUIRES the full message proto with `mediaKey`. There is no server-side lookup by message ID.

---

## Question 7: Alternative Approaches

### Approach A: updateMediaMessage (Media Retry Receipt)

**How:** Reconstruct a WAMessage proto with `mediaKey` and call `sock.updateMediaMessage()`

**Requirements:**
- Active WhatsApp connection (sock)
- Full message proto with `mediaKey`, `message.key` (id, remoteJid, fromMe, participant)
- Phone must be ONLINE and have media locally

**Feasibility for our case:** NOT POSSIBLE for existing DB records -- we did not store `mediaKey`. POSSIBLE for future messages if we store the raw proto.

**Ban risk:** LOW -- this is a standard WhatsApp Web protocol operation. Rate limit: unknown, but should be done conservatively (1 request per few seconds).

### Approach B: requestPlaceholderResend + updateMediaMessage

**How:**
1. Call `sock.requestPlaceholderResend({ id: messageId, remoteJid: groupJid, fromMe: false, participant: senderJid })` to get the full proto back
2. When response arrives via `messages.upsert`, extract `mediaKey` from the proto
3. Call `sock.updateMediaMessage(fullMessage)` to request media re-upload

**Requirements:**
- `messageKey` (id, remoteJid, fromMe, participant) -- we DO have these in DB
- Phone must be ONLINE for both steps

**Feasibility:** POTENTIALLY POSSIBLE. This is the most promising approach. The phone should resend the full message proto including `mediaKey`, which we can then use for media retry.

**Risks:**
- `requestPlaceholderResend` is designed for placeholder/undecryptable messages, not for re-fetching media keys. It MAY not return the full media proto for messages that were already successfully received.
- Rate limiting: has a 5-second delay built in + 15-second timeout before marking phone as offline
- **Ban risk:** MEDIUM -- making 1000+ placeholder resend requests in sequence is unusual behavior. Should be heavily rate-limited.

### Approach C: fetchMessageHistory + downloadMediaWithRetry

**How:**
1. Call `sock.fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp)` for the SOR Euronet group
2. Handle the `messaging-history.set` (ON_DEMAND) response
3. For each message in the response, immediately try to download media (CDN URLs will be expired)
4. The `reuploadRequest: sock.updateMediaMessage` option in `downloadMediaMessage` will automatically trigger media retry

**Requirements:**
- We need one message key from the group as an anchor (we have this in DB)
- Phone must be ONLINE
- Messages arrive in batches, may need multiple calls

**Feasibility:** MOST PROMISING. This combines on-demand history sync (which gives us the full proto with `mediaKey`) with automatic media retry (which requests the phone to re-upload).

**Risks:**
- Baileys RC bug risk (v7.0.0-rc.9) -- on-demand history sync may be unstable
- Phone must have the media files locally (for files sent months ago, phone may have auto-cleaned them)
- Rate limiting: should be done in small batches (10-20 messages per request)
- **Ban risk:** LOW-MEDIUM -- on-demand history sync is a standard feature, but doing it repeatedly for the same group could be flagged

### Approach D: Ask Senders to Resend

**How:** Ask MazluM, Sinan, and Yassin to resend the SOR files in the WhatsApp group

**Feasibility:** Guaranteed to work for recent files. For 1000+ files spanning months, this is impractical.

### Approach E: Download from Phone Directly

**How:** If the files are still on the phone's storage, export them directly (WhatsApp Media folder on Android, or use a file manager)

**Feasibility:** Depends on phone storage and auto-cleanup settings.

---

## Recommended Strategy

### Phase 1: Fix for FUTURE messages (immediate)
1. Store the RAW proto message (or at minimum: `mediaKey`, `directPath`, `url`, `fileSha256`) in the metadata JSONB field
2. Download media immediately when history sync arrives (already implemented, but fails for expired URLs)
3. When download fails, STILL store the crypto material for later retry

### Phase 2: Retry for EXISTING messages (requires code changes)
1. Use `fetchMessageHistory()` to re-request the SOR Euronet group history
2. This returns full protos with `mediaKey`
3. For each document message, attempt `downloadMediaMessage()` with `reuploadRequest: sock.updateMediaMessage`
4. If phone has the media: SUCCESS (new URL generated, media downloaded)
5. If phone does NOT have media: `NOT_FOUND` error -- media is permanently lost

### Phase 3: Batch retry endpoint
Build an API endpoint that:
1. Takes a list of message IDs
2. Uses `requestPlaceholderResend()` to get full protos
3. Attempts media download with retry
4. Stores downloaded binary data
5. Rate-limits to ~1 request per 5 seconds

---

## Risk Assessment

| Approach | Reliability | Ban Risk | Complexity | Best For |
|----------|------------|----------|------------|----------|
| A: updateMediaMessage | HIGH (if have mediaKey) | LOW | LOW | Future messages |
| B: placeholderResend + updateMedia | MEDIUM | MEDIUM | MEDIUM | Known message IDs |
| C: fetchMessageHistory + auto-retry | MEDIUM-HIGH | LOW-MEDIUM | MEDIUM | Batch re-download |
| D: Ask senders to resend | HIGH | NONE | NONE | Small batches |
| E: Phone export | HIGH | NONE | LOW | If phone has files |

---

## Critical Data We Do NOT Have (for existing messages)

| Field | In DB? | Needed For |
|-------|--------|------------|
| `mediaKey` | NO (only `hasMediaKey: true`) | Decryption + retry request |
| `directPath` | NO (only `hasDirectPath: true`) | CDN URL construction |
| `url` | NO (only `hasUrl: true`) | Direct download |
| `fileSha256` | NO | Verification |
| `messageId` | YES | Message identification |
| `remoteJid` | YES | Chat identification |
| `participant` | YES (as sender phone) | Sender identification |
| `timestamp` | YES | Anchor for history sync |

**Bottom line:** For the ~1000 existing messages with `data=null`, we CANNOT use Approach A. We MUST use Approach B or C to first re-obtain the `mediaKey` from the phone.

---

## Sources

### Primary (HIGH confidence)
- Baileys v7.0.0-rc.9 source: `lib/Utils/messages-media.js` -- downloadContentFromMessage, encryptMediaRetryRequest, decryptMediaRetryData
- Baileys v7.0.0-rc.9 source: `lib/Socket/messages-send.js` -- updateMediaMessage (lines 840-881)
- Baileys v7.0.0-rc.9 source: `lib/Socket/messages-recv.js` -- fetchMessageHistory, requestPlaceholderResend
- Baileys v7.0.0-rc.9 source: `lib/Utils/history.js` -- downloadHistory, processHistoryMessage
- Baileys v7.0.0-rc.9 source: `lib/Utils/messages.js` -- downloadMediaMessage
- Baileys v7.0.0-rc.9 source: `WAProto/WAProto.proto` -- PeerDataOperationRequestMessage, HistorySyncOnDemandRequest, PlaceholderMessageResendRequest
- OwnPilot source: `packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts` -- downloadMediaWithRetry, history sync handler
- OwnPilot source: `packages/gateway/src/channels/plugins/whatsapp/message-parser.ts` -- extractWhatsAppMessageMetadata

### Secondary (MEDIUM confidence)
- [whatsmeow mediaretry.go](https://github.com/tulir/whatsmeow/blob/main/mediaretry.go) -- Go implementation confirms same protocol
- [Baileys Issue #507](https://github.com/WhiskeySockets/Baileys/issues/507) -- Media reupload bug (closed/fixed)
- [Baileys Wiki - History Sync](https://baileys.wiki/docs/socket/history-sync/)
- [Vonage WhatsApp media retention](https://api.support.vonage.com/hc/en-us/articles/4408701311380)

### Tertiary (LOW confidence)
- [Quora - WhatsApp server media retention](https://www.quora.com/How-long-does-WhatsApp-keep-the-delivered-data-like-images-etc-in-the-server) -- ~30 day retention claim
- [WAHA issue #1544](https://github.com/devlikeapro/waha/issues/1544) -- Direct history fetch limitations
