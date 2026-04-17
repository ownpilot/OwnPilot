# S22 Research — WhatsApp Media Re-upload Rate Limit Deep Analysis

**Date:** 2026-03-06
**Method:** 4 parallel specialist agents + manual Baileys source code analysis
**Scope:** updateMediaMessage throttling, ban risk, protocol analysis, optimization design

---

## 1. Protocol Analysis — updateMediaMessage Internals

### What happens when `sock.updateMediaMessage(msg)` is called:

```
Bot                          WhatsApp Server              Sender's Phone
 |                                |                            |
 |-- receipt (server-error) ----->|                            |
 |   tag: receipt                 |                            |
 |   type: server-error           |-- re-upload request ------>|
 |   contains:                    |                            |
 |     <encrypt>                  |                            |
 |       enc_p: AES-GCM(stanzaId)|                            |
 |       enc_iv: 12 random bytes |                            |
 |     </encrypt>                 |                            |
 |     <rmr                       |                            |
 |       jid: remoteJid          |                            |
 |       from_me: bool           |<-- media + new directPath--|
 |       participant: jid />     |                            |
 |                                |                            |
 |<-- messages.media-update ------|                            |
 |   contains:                    |                            |
 |     encrypted MediaRetryNotif  |                            |
 |     new directPath             |                            |
 |                                |                            |
 |-- HTTP GET mmg.whatsapp.net -->|   (CDN download)           |
 |<-- encrypted media file -------|                            |
 |                                |                            |
 | decrypt with original mediaKey |                            |
 | (AES-256-CBC + HMAC-SHA256)    |                            |
```

### Key Protocol Details

- **Binary node type:** `receipt` with `type="server-error"` — NOT a message
- **Encryption:** AES-GCM with HKDF-derived key from original `mediaKey`
  - HKDF info: `'WhatsApp Media Retry Notification'`
  - Key length: 32 bytes
  - IV: 12 random bytes
  - AAD: message ID (for authenticated encryption)
- **Recipient:** `to: myJid` (sent to self, NOT to another user)
- **Baileys source comment (line 597-598):** "this encrypt node is actually pretty useless — the media is returned even without this node"
- **No timeout in Baileys:** `bindWaitForEvent` uses `promiseTimeout(timeoutMs, ...)`. When `timeoutMs` is undefined (not passed), there is NO timeout. Waits forever until connection close.
- **Event matching:** `update.find(c => c.key.id === message.key.id)` — multiple concurrent calls are safe (each filters by unique message ID)

### Response Types

| ResultType | Status Code | Meaning |
|-----------|-------------|---------|
| SUCCESS | 200 | New directPath + url available |
| DECRYPTION_ERROR | 412 | Sender phone couldn't decrypt request |
| NOT_FOUND | 404 | Media file not found on sender's phone |
| GENERAL_ERROR | 418 | Generic failure (could indicate throttling) |

---

## 2. Rate Limit Analysis

### WhatsApp's Known Rate Limit Mechanisms

| Mechanism | Domain | Evidence |
|-----------|--------|----------|
| 429 rate-overlimit IQ error | Protocol-level | Baileys Issues #2008, matterbridge #1844 |
| Account behavior scoring | All operations | WhatsApp Help Center, 6.8M bans H1 2025 |
| TLS fingerprint detection | Connection-level | Baileys mimics WA Web but imperfect |
| Operation pattern detection | Aggregate | Uniform intervals flagged as bot behavior |

### Comparison: Different Operations

| Operation | Rate Limit | Risk Level |
|-----------|-----------|------------|
| Message sending | HIGHEST (8/min, 200/hr documented) | CRITICAL |
| fetchMessageHistory | MEDIUM (self-imposed 30s) | HIGH |
| updateMediaMessage (media retry receipt) | UNKNOWN (no documented limit) | MEDIUM-HIGH |
| downloadMediaMessage (CDN HTTP) | LOW (CDN designed for concurrent) | LOW |
| Read receipts | VERY LOW | VERY LOW |

### Industry Reference: mautrix-whatsapp

The most mature Baileys-equivalent (whatsmeow) bridge:
- `max_async_handle: 2` for concurrent media retry responses
- Supports `local_time` batch scheduling (e.g., "run at 3 AM")
- No explicit per-request delay, but limits concurrency

---

## 3. Ban Risk Assessment (Devil's Advocate Findings)

### Recent Ban Statistics
- **H1 2025:** 6.8 million accounts banned globally
- **Baileys Issue #1869:** Wave of bans affecting even 3-year-old bots
- **Baileys Issue #2309:** Bans specifically for status uploads from production servers
- **January 2026:** AI chatbot policy crackdown increased enforcement

### Ban Trigger Analysis for This Use Case

| Trigger | Relevance | Risk |
|---------|-----------|------|
| Third-party app detection (Baileys) | HIGH | Already active risk |
| Uniform operation intervals | HIGH | Automated retry loop |
| Rapid protocol-level operations | HIGH | Multiple updateMediaMessage |
| Datacenter IP | MEDIUM | Home server (residential IP = lower risk) |
| Bulk messaging | LOW | We're NOT sending messages |
| User reports | LOW | Not spamming anyone |

### Ban Recovery

| Type | Duration | Recovery |
|------|----------|----------|
| Temporary | 24-72h | Wait, DO NOT reconnect |
| Permanent | Forever | Appeal via app (10-30% success rate) |
| Impact | — | ALL history, groups, contacts LOST |

### Recommended Safe Limits

| Batch Size | Interval | Daily Max | Risk Level |
|-----------|----------|-----------|------------|
| 1-18 files | 5s | 20 | LOW-MEDIUM |
| 19-50 files | 10s + jitter | 30 | MEDIUM |
| 50-100 files | 15s + jitter | 40 | HIGH |
| 100+ files | 30s + jitter | 50 | VERY HIGH |

---

## 4. Optimization Analysis — What We Did

### Problem
```
retry-media endpoint (for stored-mediaKey messages):
  1. api.retryMediaDownload() → FAIL (cache miss, ~instant)
  2. fetchGroupHistoryFromAnchor() → 30s RATE LIMIT + 12s poll (WASTED)
  3. tryStoredMetadataReupload() → SUCCESS in ~1.5s (LAST RESORT)
Total: 40-87 seconds per file
```

### Solution: Short-circuit
```
retry-media endpoint (optimized):
  1. api.retryMediaDownload() → FAIL (cache miss, ~instant)
  2. tryStoredMetadataReupload() → SUCCESS in ~1.5s (NOW FIRST)
  3. history sync only if NO stored mediaKey
Total: ~1-2 seconds per file (60x improvement)
```

### Evidence from S21 Logs (actual timing data)

| File | retryMediaFromMetadata duration | Gap between files (old) |
|------|-------------------------------|------------------------|
| 2725DL_17_V1.SOR | 1.4s | 41s |
| 2716CT-59-POP-HUIS.SOR | 1.1s | 64s |
| 2716BH_124_V1.SOR | 1.1s | 47s |
| 2715BR_53_V1.SOR | 1.0s | 87s |
| Average | **~1.5s** | **~55s** |

### Evidence from S22 Tests

| Test | Duration | Result |
|------|----------|--------|
| 2162BT_30_V1.SOR (NOT_FOUND) | 327ms | Sender deleted file |
| week 47 dag 5.zip (SUCCESS) | 1.06s | 59,659 bytes downloaded |

---

## 5. Decisions Made

### APPROVED
1. **Short-circuit optimization** — Skip history sync when mediaKey in DB. SAFE, no WhatsApp protocol change.
2. **30s timeout on updateMediaMessage** — Prevents infinite hang. Sender offline = clean error.
3. **Batch endpoint** — Sequential + throttle. Simple JSON response (not SSE).

### REJECTED
1. **Pipeline (parallel re-upload requests)** — BANNED. Burst detection risk + sender phone overload.
2. **Reducing throttle below 3s** — Too aggressive for personal account.
3. **SSE progress streaming** — Unnecessary complexity for <50 file batches.

### DEFERRED
1. **Batch throttle default increase** — 3000ms → 5000ms (devil's advocate recommendation). Do in S23.
2. **Proto type detection** — All files reconstructed as `documentMessage`. If original was `imageMessage`, may fail. Need to store original message type in metadata.
3. **getAttachmentsNeedingRecovery() DB method** — Query messages needing recovery by mediaKey + no data. Useful for automation.
4. **Sender consent** — Senders unknowingly have phones used for re-upload. Ethically should inform them.

---

## 6. Baileys Internal Timing Constants (from source)

| Constant | Value | Purpose |
|----------|-------|---------|
| BUFFER_TIMEOUT | 30s | Event batch auto-flush |
| Event Flush Delay | 100ms | Batch similar events |
| retryRequestDelayMs | 250ms | Delay between message retries |
| schedulePhoneRequest | 3000ms | Delay before phone re-upload request |
| connectTimeoutMs | 20s | WebSocket connection timeout |
| keepAliveIntervalMs | 30s | Keep-alive pings |
| defaultQueryTimeoutMs | 60s | Default query timeout |
| MAX_RETRIES | 5 | Maximum message retry attempts |
| UPLOAD_TIMEOUT | 30s | Pre-key upload timeout |
| MIN_UPLOAD_INTERVAL | 5s | Minimum between pre-key uploads |

---

## Sources

- Baileys v7.0.0-rc.9 source: messages-send.js, messages-media.js, messages-recv.js, generics.js
- [Baileys Issue #1869 — High number of bans](https://github.com/WhiskeySockets/Baileys/issues/1869)
- [Baileys Issue #2309 — Status upload ban](https://github.com/WhiskeySockets/Baileys/issues/2309)
- [Baileys Issue #2008 — 429 rate-overlimit](https://github.com/WhiskeySockets/Baileys/issues/2008)
- [mautrix-whatsapp example config](https://github.com/element-hq/mautrix-whatsapp) — max_async_handle: 2
- [WhatsApp Help Center — About account bans](https://faq.whatsapp.com/465883178708358)
- [baileys-antiban](https://github.com/kobie3717/baileys-antiban) — messaging rate limits
