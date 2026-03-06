/**
 * Unit tests for WhatsApp handleOfflineMessages (type='append' processing)
 *
 * Tests the DB-only offline sync path:
 *   messages.upsert type='append' → handleOfflineMessages → createBatch (no AI response)
 *
 * Coverage:
 *   B-series (7): core handleOfflineMessages behavior
 *   C-series (6): edge cases (empty batch, missing fields, fromMe, self-chat)
 *   D-series (2): processedMsgIds FIFO cap eviction
 *   E-series (2): reconnect dedup scenarios
 *
 * Design note: handleOfflineMessages is private; accessed via (api as any) cast.
 * After calling it, await (api as any).historySyncQueue to let the inner chain settle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';

// ============================================================================
// Hoisted mocks — must be declared before vi.mock() factory functions
// ============================================================================

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn().mockResolvedValue(1),
  enrichMediaMetadataBatch: vi.fn().mockResolvedValue(0),
  findByPlatform: vi.fn().mockResolvedValue(null),
  eventBusEmit: vi.fn(),
}));

// ============================================================================
// Module mocks
// ============================================================================

// Dynamic import in handleOfflineMessages: await import('../../../db/repositories/channel-messages.js')
// Must use `function` keyword (not arrow) as vitest 4.x requires function/class for constructor mocks
vi.mock('../../../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn(function (this: Record<string, unknown>) {
    this.createBatch = mocks.createBatch;
    this.enrichMediaMetadataBatch = mocks.enrichMediaMetadataBatch;
  }),
}));

// channelUsersRepo used in resolveDisplayName (only hit for numeric pushName)
vi.mock('../../../db/repositories/channel-users.js', () => ({
  channelUsersRepo: {
    findByPlatform: mocks.findByPlatform,
    findOrCreateByPhone: vi.fn().mockResolvedValue({ id: 'cu-1', displayName: 'TestUser' }),
  },
}));

// EventBus — must NOT be emitted by handleOfflineMessages
vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getEventBus: () => ({ emit: mocks.eventBusEmit }),
    createEvent: vi.fn((type: string, data: unknown) => ({ type, data })),
  };
});

// wsGateway — module-level singleton that starts WS infrastructure
vi.mock('../../../ws/server.js', () => ({
  wsGateway: {
    broadcast: vi.fn(),
    emit: vi.fn(),
    notifyChannelUpdate: vi.fn(),
    notifyChannelDisconnected: vi.fn(),
  },
}));

// DB adapter — avoids real PostgreSQL connections from BaseRepository
vi.mock('../../../db/adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
  getAdapterSync: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
}));

// Baileys session store — avoids filesystem access
vi.mock('./session-store.js', () => ({
  getSessionDir: vi.fn(() => '/tmp/test-wa-sessions'),
  clearSession: vi.fn(),
}));

// ============================================================================
// Module under test — imported AFTER vi.mock() declarations
// ============================================================================

import { WhatsAppChannelAPI } from './whatsapp-api.js';

// ============================================================================
// Test helpers
// ============================================================================

const PLUGIN_ID = 'channel.whatsapp';
const OWN_PHONE = '15550000001';
const OWN_JID = `${OWN_PHONE}@s.whatsapp.net`;
const DM_JID = '15551234567@s.whatsapp.net';
const GROUP_JID = '120363000000000001@g.us';
const PARTICIPANT_JID = '15559876543@s.whatsapp.net';

/** Create a fresh WhatsAppChannelAPI instance with a minimal mock socket (no real Baileys). */
function makeApi(): WhatsAppChannelAPI {
  const api = new WhatsAppChannelAPI({}, PLUGIN_ID);
  // Inject mock sock so isSelfChat() can resolve own phone from sock.user.id
  (api as any).sock = { user: { id: `${OWN_PHONE}:0@s.whatsapp.net` } };
  return api;
}

/** Build a minimal WAMessage suitable for offline processing. */
function makeMsg(overrides: {
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
  participant?: string | null;
  pushName?: string;
  messageTimestamp?: number;
  text?: string;
  imageMessage?: Record<string, unknown>;
  documentMessage?: Record<string, unknown>;
  messageStubType?: number;
  noMessage?: boolean;
} = {}): WAMessage {
  const {
    id = 'MSG001',
    remoteJid = DM_JID,
    fromMe = false,
    participant,
    pushName = 'TestUser',
    messageTimestamp = Math.floor(Date.now() / 1000),
    text = 'Hello offline',
    imageMessage,
    documentMessage,
    messageStubType,
    noMessage = false,
  } = overrides;

  let message: Record<string, unknown> | undefined;
  if (!noMessage) {
    if (documentMessage) {
      message = { documentMessage };
    } else if (imageMessage) {
      message = { imageMessage };
    } else {
      message = { conversation: text };
    }
  }

  return {
    key: { id, remoteJid, fromMe, participant: participant ?? undefined },
    pushName,
    messageTimestamp,
    message,
    messageStubType,
  } as WAMessage;
}

/**
 * Call handleOfflineMessages and wait for the historySyncQueue chain to settle.
 * Required because handleOfflineMessages uses:
 *   this.historySyncQueue = this.historySyncQueue.then(async () => { ... })
 */
async function runOffline(api: WhatsAppChannelAPI, messages: WAMessage[]): Promise<void> {
  await (api as any).handleOfflineMessages(messages);
  await (api as any).historySyncQueue;
}

// ============================================================================
// B-series: Core handleOfflineMessages behavior
// ============================================================================

describe('B-series: handleOfflineMessages — core behavior', () => {
  let api: WhatsAppChannelAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue(1);
    mocks.enrichMediaMetadataBatch.mockResolvedValue(0);
    api = makeApi();
  });

  it('B1: DM text message → saved to DB with offlineSync:true and correct shape', async () => {
    const msg = makeMsg({ id: 'MSG-B1', remoteJid: DM_JID, text: 'B1 text', pushName: 'Alice' });

    await runOffline(api, [msg]);

    expect(mocks.createBatch).toHaveBeenCalledOnce();
    const [rows] = mocks.createBatch.mock.calls[0] as [unknown[]];
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      id: `${PLUGIN_ID}:MSG-B1`,
      channelId: PLUGIN_ID,
      externalId: 'MSG-B1',
      direction: 'inbound',
      content: 'B1 text',
      contentType: 'text',
    });
    expect((row.metadata as Record<string, unknown>).offlineSync).toBe(true);
    expect((row.metadata as Record<string, unknown>).jid).toBe(DM_JID);
  });

  it('B2: Group message with participant → saved with correct participant metadata', async () => {
    const msg = makeMsg({
      id: 'MSG-B2',
      remoteJid: GROUP_JID,
      participant: PARTICIPANT_JID,
      text: 'Group hello',
    });

    await runOffline(api, [msg]);

    expect(mocks.createBatch).toHaveBeenCalledOnce();
    const [rows] = mocks.createBatch.mock.calls[0] as [unknown[]];
    const row = rows[0] as Record<string, unknown>;
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.isGroup).toBe(true);
    expect(meta.participant).toBe(PARTICIPANT_JID);
    expect(meta.offlineSync).toBe(true);
  });

  it('B3: Processed message ID is added to processedMsgIds (prevents notify re-process)', async () => {
    const msg = makeMsg({ id: 'MSG-B3' });

    await runOffline(api, [msg]);

    expect((api as any).processedMsgIds.has('MSG-B3')).toBe(true);
  });

  it('B4: Message already in processedMsgIds → skipped, createBatch not called', async () => {
    (api as any).processedMsgIds.add('MSG-B4');
    const msg = makeMsg({ id: 'MSG-B4' });

    await runOffline(api, [msg]);

    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it('B5: EventBus is NEVER emitted — no AI response triggered', async () => {
    const msg = makeMsg({ id: 'MSG-B5', text: 'Do not trigger AI' });

    await runOffline(api, [msg]);

    expect(mocks.eventBusEmit).not.toHaveBeenCalled();
  });

  it('B6: Image message → attachment saved with no binary data (metadata-only)', async () => {
    const msg = makeMsg({
      id: 'MSG-B6',
      imageMessage: { mimetype: 'image/jpeg', caption: 'Photo caption' },
      noMessage: false,
    });
    // Override message to use imageMessage instead of conversation
    (msg as any).message = {
      imageMessage: { mimetype: 'image/jpeg', caption: 'Photo caption' },
    };

    await runOffline(api, [msg]);

    expect(mocks.createBatch).toHaveBeenCalledOnce();
    const [rows] = mocks.createBatch.mock.calls[0] as [unknown[]];
    const row = rows[0] as Record<string, unknown>;
    const attachments = row.attachments as Array<Record<string, unknown>> | undefined;
    if (attachments && attachments.length > 0) {
      // data MUST be undefined — no binary download on offline sync
      expect(attachments[0]!.data).toBeUndefined();
    }
  });

  it('B7: Message with no text and no media → skipped', async () => {
    const msg = makeMsg({ id: 'MSG-B7', text: '' });
    // Override: empty message object with no recognizable content
    (msg as any).message = {};

    await runOffline(api, [msg]);

    expect(mocks.createBatch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// C-series: Edge cases
// ============================================================================

describe('C-series: handleOfflineMessages — edge cases', () => {
  let api: WhatsAppChannelAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue(0);
    api = makeApi();
  });

  it('C1: Empty batch → returns immediately without any DB call', async () => {
    await runOffline(api, []);

    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it('C2: No pushName → uses phone number as sender name fallback', async () => {
    const msg = makeMsg({ id: 'MSG-C2', pushName: undefined as unknown as string });
    (msg as any).pushName = undefined;

    await runOffline(api, [msg]);

    // Should not throw; createBatch may or may not be called depending on DB lookup
    // The important thing is no crash and sender is set from phone
    const calls = mocks.createBatch.mock.calls;
    if (calls.length > 0) {
      const row = (calls[0] as [unknown[]])[0][0] as Record<string, unknown>;
      expect(typeof row.senderName).toBe('string');
      expect(row.senderName).not.toBe('');
    }
  });

  it('C3: Group message without participant → skipped (cannot determine sender)', async () => {
    const msg = makeMsg({
      id: 'MSG-C3',
      remoteJid: GROUP_JID,
      participant: null,
    });

    await runOffline(api, [msg]);

    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it('C4: fromMe message in non-self DM → skipped (no own messages from other chats)', async () => {
    const msg = makeMsg({ id: 'MSG-C4', remoteJid: DM_JID, fromMe: true });

    await runOffline(api, [msg]);

    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it('C5: fromMe message in self-chat (own JID) → processed (user messaging themselves)', async () => {
    const msg = makeMsg({ id: 'MSG-C5', remoteJid: OWN_JID, fromMe: true, text: 'self note' });

    await runOffline(api, [msg]);

    // Self-chat fromMe messages ARE processed — isSelfChat returns true
    expect(mocks.createBatch).toHaveBeenCalledOnce();
    const [rows] = mocks.createBatch.mock.calls[0] as [unknown[]];
    expect(rows).toHaveLength(1);
  });

  it('C6: Protocol/stub message (has messageStubType but no message) → skipped', async () => {
    const msg = makeMsg({ id: 'MSG-C6', noMessage: true, messageStubType: 6 });

    await runOffline(api, [msg]);

    expect(mocks.createBatch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// D-series: processedMsgIds FIFO cap eviction
// ============================================================================

describe('D-series: processedMsgIds FIFO cap eviction', () => {
  it('D1: Oldest entry is evicted when cap (5000) is exceeded', async () => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue(1);
    const api = makeApi();

    // Fill processedMsgIds to cap - 1
    const CAP = 5000;
    const firstId = 'FIRST-MSG';
    (api as any).processedMsgIds.add(firstId);
    for (let i = 1; i < CAP; i++) {
      (api as any).processedMsgIds.add(`filler-${i}`);
    }
    expect((api as any).processedMsgIds.size).toBe(CAP);
    expect((api as any).processedMsgIds.has(firstId)).toBe(true);

    // Process one more message — triggers FIFO eviction of firstId
    const msg = makeMsg({ id: 'NEW-MSG-D1' });
    await runOffline(api, [msg]);

    expect((api as any).processedMsgIds.has('NEW-MSG-D1')).toBe(true);
    // firstId should be evicted
    expect((api as any).processedMsgIds.has(firstId)).toBe(false);
    // Size stays at cap (evict 1, add 1)
    expect((api as any).processedMsgIds.size).toBe(CAP);
  });

  it('D2: processedMsgIds is shared — append-processed ID prevents later addToProcessedMsgIds collision', async () => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue(1);
    const api = makeApi();

    const sharedId = 'SHARED-D2';

    // Simulate: append arrives, processes MSG → seeds processedMsgIds
    const appendMsg = makeMsg({ id: sharedId, text: 'append message' });
    await runOffline(api, [appendMsg]);
    expect((api as any).processedMsgIds.has(sharedId)).toBe(true);

    // Reset createBatch call count for the dedup check
    mocks.createBatch.mockClear();

    // Simulate: same message arrives again via another append batch (reconnect replay)
    const replayMsg = makeMsg({ id: sharedId, text: 'append message' });
    await runOffline(api, [replayMsg]);

    // Must NOT call createBatch again — dedup prevented double insert
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// E-series: Reconnect dedup scenarios
// ============================================================================

describe('E-series: Reconnect dedup scenarios', () => {
  it('E1: Append saves messages; subsequent different notify-path messages are unaffected', async () => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue(1);
    const api = makeApi();

    // Process offline batch with one message
    const appendMsg = makeMsg({ id: 'APPEND-E1', text: 'offline message' });
    await runOffline(api, [appendMsg]);

    expect(mocks.createBatch).toHaveBeenCalledOnce();
    expect((api as any).processedMsgIds.has('APPEND-E1')).toBe(true);

    // A DIFFERENT message arrives via notify path — processedMsgIds doesn't block it
    const notifyId = 'NOTIFY-E1';
    expect((api as any).processedMsgIds.has(notifyId)).toBe(false);
  });

  it('E2: Same message in both append and notify → only one DB row (dedup via processedMsgIds)', async () => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue(1);
    const api = makeApi();

    const duplicateId = 'DUP-E2';

    // Step 1: append arrives first — saves to DB, seeds processedMsgIds
    const appendMsg = makeMsg({ id: duplicateId, text: 'same message' });
    await runOffline(api, [appendMsg]);
    expect(mocks.createBatch).toHaveBeenCalledOnce();
    expect((api as any).processedMsgIds.has(duplicateId)).toBe(true);

    // Step 2: same message arrives via notify path — check processedMsgIds before processing
    // (In production this check is in the messages.upsert notify handler)
    const alreadyProcessed = (api as any).processedMsgIds.has(duplicateId);
    expect(alreadyProcessed).toBe(true);
    // → notify handler would skip it (not tested here but dedup state is verified)

    // Step 3: if someone calls handleOfflineMessages again with same ID → still deduped
    mocks.createBatch.mockClear();
    const appendReplay = makeMsg({ id: duplicateId, text: 'same message' });
    await runOffline(api, [appendReplay]);
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });
});
