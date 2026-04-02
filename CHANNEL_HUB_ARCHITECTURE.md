# Channel Hub 2.0 — Ultra Fast & Private Channel System

## 🎯 Vizyon

"Her kanala tek tıkla bağlan, tüm iletişimlerin private ve güvende olsun."

## 🏗️ Yeni Mimari

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHANNEL HUB 2.0                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  CONNECT     │  │   SECURE     │  │   UNIFIED    │  │   BRIDGE     │   │
│  │   WIZARD     │  │   VAULT      │  │   ROUTER     │  │   ENGINE     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │           │
│         ▼                 ▼                 ▼                 ▼           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    ADAPTER LAYER (Universal)                        │  │
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │  Telegram │ WhatsApp │ Signal │ Discord │ Slack │ Matrix │ Email   │  │
│  │  ─────────┼──────────┼────────┼─────────┼───────┼────────┼────────  │  │
│  │  Webhook  │ WebSocket│ Webhook│ Gateway │ Socket│  Sync  │ IMAP    │  │
│  │  Polling  │   QR     │ Signal │   Bot   │       │        │ SMTP    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🚀 Ana Özellikler

### 1. One-Click Connect Wizard
```typescript
// Kullanıcı sadece bu bilgileri girer:
interface QuickConnectInput {
  platform: 'telegram' | 'whatsapp' | 'signal' | 'discord' | 'slack' | 'matrix';
  credentials: string; // Bot token veya QR scan sonucu
  encryption: boolean; // E2E encryption aç/kapat
}

// Sistem geri kalanını otomatik yapılandırır:
// - Webhook URL (ngrok/cloudflare otomatik)
// - Encryption keys (Signal Protocol)
// - Rate limiting
// - Fallback mekanizmaları
```

### 2. Private Vault (E2E Encryption)
```typescript
// Signal Protocol implementasyonu
interface SecureChannel {
  identityKeyPair: KeyPair;
  preKeys: PreKey[];
  signedPreKey: SignedPreKey;
  sessionStore: SessionStore; // Per-conversation keys
  
  // Her mesaj için:
  encrypt(plaintext: string, recipientId: string): EncryptedMessage;
  decrypt(ciphertext: EncryptedMessage, senderId: string): string;
}
```

### 3. Universal Adapter Pattern
Tüm kanallar aynı API'yi kullanır:
```typescript
interface UniversalChannelAdapter {
  // Bağlantı
  connect(config: ChannelConfig): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
  
  // Mesajlaşma (çift yönlü)
  send(message: OutgoingMessage): Promise<MessageId>;
  onMessage(handler: (msg: IncomingMessage) => void): Unsubscribe;
  
  // Medya & Dosyalar
  sendFile(file: FileUpload): Promise<FileId>;
  downloadFile(fileId: string): Promise<Buffer>;
  
  // Durum
  getStatus(): ChannelStatus;
  getHealth(): HealthMetrics;
}
```

## 📁 Yeni Dosya Yapısı

```
packages/gateway/src/channels/
├── hub/                          # YENİ: Channel Hub 2.0
│   ├── index.ts                  # Ana export
│   ├── types.ts                  # Hub tipleri
│   ├── hub-service.ts            # Merkezi servis
│   ├── connection-wizard.ts      # Hızlı bağlantı wizard
│   └── health-monitor.ts         # Kanal sağlık izleme
│
├── secure/                       # YENİ: E2E Encryption Layer
│   ├── index.ts
│   ├── signal-protocol.ts        # Signal Protocol implementasyonu
│   ├── key-store.ts              # Key management
│   ├── encryptor.ts              # Encryption/decryption
│   └── types.ts
│
├── adapters/                     # MEVCUT: Yeniden düzenle
│   ├── universal-adapter.ts      # YENİ: Temel adapter sınıfı
│   ├── telegram-adapter.ts       # Telegram implementasyonu
│   ├── whatsapp-adapter.ts       # WhatsApp implementasyonu
│   ├── signal-adapter.ts         # YENİ: Signal implementasyonu
│   ├── discord-adapter.ts        # Discord implementasyonu
│   ├── slack-adapter.ts          # Slack implementasyonu
│   ├── matrix-adapter.ts         # YENİ: Matrix implementasyonu
│   └── index.ts
│
├── transport/                    # YENİ: Transport layer
│   ├── webhook-manager.ts        # Webhook yönetimi
│   ├── websocket-manager.ts      # WebSocket yönetimi
│   ├── polling-manager.ts        # Polling yönetimi
│   └── tunnel-service.ts         # Ngrok/Cloudflare otomatik
│
├── routing/                      # MEVCUT: Gelişmiş
│   ├── message-router.ts         # Gelişmesi gerekli
│   ├── ai-routing.ts             # AI-based routing
│   └── bridge-manager.ts         # Kanallar arası köprü
│
├── plugins/                      # MEVCUT: Sadeleştir
│   └── ...                       # Mevcut pluginler
│
└── api/                          # YENİ: REST API Routes
    ├── routes.ts
    ├── wizard-controller.ts
    ├── channels-controller.ts
    └── messages-controller.ts
```

## 🔐 Security Model

### Private Channel Levels
```typescript
type PrivacyLevel = 
  | 'standard'      // Platform'un native encryption'ı
  | 'enhanced'      // OwnPilot E2E encryption (Signal Protocol)
  | 'paranoid';     // E2E + Tor/Proxy + Ephemeral messages

interface PrivateChannel {
  id: string;
  platform: ChannelPlatform;
  privacyLevel: PrivacyLevel;
  encryptionKey?: string; // For 'enhanced' level
  ephemeralTimeout?: number; // For 'paranoid' level (saniye)
  metadataStripping: boolean; // Metadata temizleme
}
```

### Metadata Stripping
Tüm gelen mesajlardan:
- IP adresleri
- Cihaz bilgisi
- Zaman damgaları (normalize edilir)
- Lokasyon verileri
- Platform-specific metadata

## 📊 Implementation Plan

### Phase 1: Core Foundation (Hafta 1-2)
1. [ ] Universal Adapter Framework
2. [ ] Health Monitor service
3. [ ] Connection Wizard API

### Phase 2: Security Layer (Hafta 3-4)
1. [ ] Signal Protocol implementasyonu
2. [ ] Key store & rotation
3. [ ] Encryption/Decryption pipeline

### Phase 3: Transport Layer (Hafta 5-6)
1. [ ] Webhook manager (otomatik URL)
2. [ ] WebSocket manager
3. [ ] Auto-tunnel (ngrok/cloudflare)

### Phase 4: Adapters (Hafta 7-10)
1. [ ] Telegram adapter (refactor)
2. [ ] WhatsApp adapter (refactor)
3. [ ] Signal adapter (yeni)
4. [ ] Discord adapter (refactor)
5. [ ] Slack adapter (refactor)
6. [ ] Matrix adapter (yeni)

### Phase 5: UI Integration (Hafta 11-12)
1. [ ] Channel Hub UI
2. [ ] Connection Wizard UI
3. [ ] Secure chat UI
4. [ ] Health dashboard

## 💡 Hızlı Başlangıç Akışı

```
Kullanıcı "Yeni Kanal Bağla" butonuna tıklar
         │
         ▼
┌─────────────────────────────────┐
│  1. Platform Seçimi             │
│     [Telegram] [WhatsApp]       │
│     [Signal]   [Discord] ...    │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  2. Quick Connect               │
│     Telegram Bot Token: [____]  │
│     ☑️ Private Mode (E2E)        │
│     ☑️ Auto-Tunnel (Webhook)    │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  3. Auto-Configuration          │
│     ✓ Webhook URL oluşturuldu   │
│     ✓ Ngrok tunnel açıldı       │
│     ✓ Encryption keys üretildi  │
│     ✓ Rate limits ayarlandı     │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  4. Ready!                      │
│     Kanal bağlandı ve aktif.    │
│     Tüm mesajlar şifreli.       │
└─────────────────────────────────┘
```

## 🔧 Teknik Detaylar

### Signal Protocol Implementasyonu
```typescript
// packages/gateway/src/channels/secure/signal-protocol.ts

export class SignalProtocol {
  private identityKey: KeyPair;
  private preKeys: Map<number, PreKeyRecord>;
  private sessions: Map<string, SessionCipher>;

  async initialize(): Promise<void> {
    // Identity key generation
    this.identityKey = await generateIdentityKeyPair();
    
    // Pre-keys (one-time use keys)
    this.preKeys = await generatePreKeys(100);
    
    // Signed pre-key (medium-term)
    this.signedPreKey = await generateSignedPreKey(this.identityKey);
  }

  async encryptMessage(
    recipientId: string,
    deviceId: number,
    plaintext: string
  ): Promise<EncryptedMessage> {
    const session = await this.getOrCreateSession(recipientId, deviceId);
    return session.encrypt(plaintext);
  }

  async decryptMessage(
    senderId: string,
    deviceId: number,
    ciphertext: EncryptedMessage
  ): Promise<string> {
    const session = await this.getOrCreateSession(senderId, deviceId);
    return session.decrypt(ciphertext);
  }
}
```

### Universal Adapter Base Class
```typescript
// packages/gateway/src/channels/adapters/universal-adapter.ts

export abstract class UniversalChannelAdapter {
  protected config: ChannelConfig;
  protected status: ChannelStatus = 'disconnected';
  protected healthMonitor: HealthMonitor;
  protected encryption?: SignalProtocol;

  constructor(config: ChannelConfig) {
    this.config = config;
    this.healthMonitor = new HealthMonitor(config.id);
    
    if (config.encryption.enabled) {
      this.encryption = new SignalProtocol();
    }
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(message: OutgoingMessage): Promise<MessageId>;
  abstract onMessage(handler: MessageHandler): Unsubscribe;

  // Universal features
  async sendSecure(recipient: string, text: string): Promise<void> {
    if (!this.encryption) {
      throw new Error('Encryption not enabled');
    }
    const encrypted = await this.encryption.encryptMessage(recipient, 1, text);
    await this.send({
      recipient,
      content: JSON.stringify(encrypted),
      metadata: { encrypted: true }
    });
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  getHealth(): HealthMetrics {
    return this.healthMonitor.getMetrics();
  }
}
```

### Auto-Tunnel Service
```typescript
// packages/gateway/src/channels/transport/tunnel-service.ts

export class TunnelService {
  private ngrok?: NgrokClient;
  private cloudflare?: CloudflareClient;

  async createTunnel(config: TunnelConfig): Promise<TunnelUrl> {
    // Priority 1: Cloudflare (free, permanent URL)
    if (config.cloudflareToken) {
      return this.createCloudflareTunnel(config);
    }
    
    // Priority 2: Ngrok (free tier, temporary URL)
    if (config.ngrokToken) {
      return this.createNgrokTunnel(config);
    }
    
    // Priority 3: Local webhook (development)
    return { url: config.localUrl, temporary: true };
  }

  private async createCloudflareTunnel(config: TunnelConfig): Promise<TunnelUrl> {
    // Cloudflare Quick Tunnel oluştur
    const tunnel = await this.cloudflare.createQuickTunnel({
      localPort: config.port,
      subdomain: `ownpilot-${config.channelId}`.slice(0, 63)
    });
    
    return {
      url: tunnel.url,
      temporary: false,
      expiresAt: null
    };
  }
}
```

## 📱 API Endpoints

```typescript
// POST /api/v1/channels/wizard/quick-connect
// Hızlı kanal bağlantısı
{
  "platform": "telegram",
  "credentials": {
    "bot_token": "123456:ABC..."
  },
  "options": {
    "encryption": true,
    "auto_tunnel": true,
    "webhook_path": "/webhooks/telegram"
  }
}

// Response
{
  "channel_id": "chan_abc123",
  "status": "connected",
  "webhook_url": "https://abc123.ngrok.io/webhooks/telegram",
  "encryption_status": "enabled",
  "public_key": "base64_encoded_identity_key"
}

// POST /api/v1/channels/:id/send
// Güvenli mesaj gönderme
{
  "recipient": "user_id_or_chat_id",
  "text": "Hello, this is encrypted!",
  "encryption": "required" // 'required' | 'preferred' | 'disabled'
}

// GET /api/v1/channels/:id/health
// Kanal sağlık durumu
{
  "status": "healthy",
  "latency_ms": 45,
  "messages_sent": 1234,
  "messages_received": 5678,
  "encryption_active": true,
  "last_error": null
}
```

## 🎨 UI Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚡ Channel Hub                                    [+ New Channel]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔵 Telegram              🟢 WhatsApp              ⚫ Signal    │
│  ├─ Status: Connected     ├─ Status: Connected     ├─ ...      │
│  ├─ Encryption: E2E ✓     ├─ Encryption: E2E ✓                  │
│  ├─ Latency: 45ms         ├─ Latency: 120ms                     │
│  └─ [Disconnect]          └─ [Disconnect]                       │
│                                                                 │
│  🔴 Discord (Error)       🟡 Slack (Connecting)                 │
│  ├─ Error: Webhook fail   ├─ Status: Handshake...               │
│  └─ [Retry]               └─ [Cancel]                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  📊 System Health                                               │
│  ├─ Active Channels: 4/5                                        │
│  ├─ Encrypted Messages: 12,456                                  │
│  └─ Avg Latency: 82ms                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## ✅ Acceptance Criteria

- [ ] Tüm kanallara 60 saniye içinde bağlanabilme
- [ ] E2E encryption ile mesaj gönderme/alma
- [ ] Otomatik webhook tunnel oluşturma
- [ ] Kanal sağlık izleme ve otomatik retry
- [ ] Metadata stripping çalışıyor
- [ ] Çift yönlü (bidirectional) mesajlaşma
- [ ] Kanallar arası bridge/köprü
- [ ] Private mode ile tüm izleri silme

---

**Sonraki Adım:** Bu mimariyi onaylarsan, Phase 1 implementasyonuna başlayacağım.
