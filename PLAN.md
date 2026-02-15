# OwnPilot Codebase Review - Remediation Plan

**Tarih:** 2026-02-14
**Kapsam:** ~140,000 LOC | 566 TS + 76 TSX dosya | 5 paket (core, gateway, ui, cli, channels)
**Toplam Bulgu:** 125 (17 CRITICAL, 42 HIGH, 48 MEDIUM, 18 LOW)

---

## Skorlar (Mevcut Durum)

| Metrik | Skor | Hedef |
|--------|------|-------|
| Güvenlik | 3/10 | 7/10 |
| Kod Sağlığı | 5/10 | 7/10 |
| Bakım Kolaylığı | 5/10 | 7/10 |
| Test Kapsamı | ~45% | ~65% |
| Ölü Kod | ~6,200 satır | 0 |

---

## Faz 1: Güvenlik Sıkılaştırma [CRITICAL]

### 1.1 Default Auth `none` + Sunucu `0.0.0.0`'a Bağlanıyor

**Sorun:** Tüm API route'ları (database admin, code execution, file operations, AI inference dahil) out-of-the-box olarak kimlik doğrulaması olmadan erişilebilir. Sunucu tüm network interface'lerine bağlanıyor.

**Dosyalar:**
- `packages/gateway/src/app.ts` satır 84-86 — `auth: { type: 'none' }`
- `packages/gateway/src/server.ts` satır 91 — `AUTH_TYPE ?? 'none'`
- `packages/gateway/src/server.ts` satır 106 — `HOST ?? '0.0.0.0'`

**Nasıl Düzeltilecek:**
1. `server.ts`'de `HOST` default'unu `127.0.0.1` yap
2. `AUTH_TYPE` default'unu `api-key` yap
3. İlk başlatmada rastgele API key oluştur ve `data/` dizinine kaydet
4. `AUTH_TYPE=none` + non-loopback adres kombinasyonunda startup'ta loud warning bas
5. `.env.example`'ı güncelle

**Başarı Kriteri:**
- [ ] Temiz kurulumda API key olmadan hiçbir endpoint'e erişilemiyor
- [ ] `HOST` default'u `127.0.0.1`
- [ ] İlk başlatmada oluşturulan API key konsola yazdırılıyor
- [ ] `none` + `0.0.0.0` kombinasyonunda WARNING log'u basılıyor

---

### 1.2 `new Function()` Code Injection (3 Lokasyon)

**Sorun:** Calculator tool'ları `new Function()` kullanıyor. Bu, global Node.js scope'unda çalışır, herhangi bir sandbox'ta değil. Regex tabanlı input filtreleme prototype chain traversal ile bypass edilebilir: `Math.constructor("return process")()`.

**Dosyalar:**
- `packages/core/src/agent/tools.ts` satır 2019-2026 — Ana calculator tool
- `packages/gateway/src/plugins/init.ts` satır 637-671 — Plugin calculator (denylist yaklaşımı)
- `packages/core/src/plugins/examples/calculator-plugin.ts` satır 88-92 — Örnek plugin

**Nasıl Düzeltilecek:**
1. Her üç lokasyonda `new Function()` kullanımını kaldır
2. Güvenli bir math expression parser fonksiyonu yaz veya `mathjs`'in evaluate modunu kullan (sadece aritmetik, trigonometri, logaritma izin ver)
3. `evaluateMathExpression(expr: string): number | Error` şeklinde shared bir utility oluştur (`packages/core/src/utils/math-eval.ts`)
4. Üç lokasyonda bu utility'yi kullan

**Başarı Kriteri:**
- [ ] Codebase'de `new Function` üretim kodunda (test hariç) sıfır kullanım
- [ ] `2 + 3 * 4` → `14` doğru çalışıyor
- [ ] `Math.constructor("return process")()` → hata dönüyor
- [ ] `__proto__`, `constructor`, `prototype` içeren ifadeler reddediliyor
- [ ] Trigonometri ve logaritma (`sin(pi/2)`, `log(100)`) çalışıyor

---

### 1.3 Path Traversal: `resolveWorkspacePath()` Eksik Trailing Separator

**Sorun:** `startsWith` kontrolü trailing path separator olmadan yapılıyor. `/app/workspace-evil/malicious.txt`, `workspacePath` `/app/workspace` iken kontrolü geçiyor. Bu fonksiyon 12+ tool executor tarafından kullanılıyor.

**Dosya:** `packages/core/src/agent/tools.ts` satır 861-871

```typescript
// MEVCUT (hatalı):
if (!resolvedPath.startsWith(workspacePath)) { return null; }

// HEDEFLENen:
if (!resolvedPath.startsWith(workspacePath + path.sep) && resolvedPath !== workspacePath) { return null; }
```

**Nasıl Düzeltilecek:**
1. `resolvedPath.startsWith(workspacePath + path.sep)` olarak değiştir
2. `resolvedPath === workspacePath` durumunu da izin ver (root dizin erişimi)
3. Aynı pattern'i kullanan diğer dosyaları kontrol et:
   - `packages/core/src/agent/tools/file-system.ts` — burada doğru yapılmış mı bak
   - `packages/gateway/src/workspace/file-workspace.ts` — burada doğru (`+ sep` kullanıyor)

**Başarı Kriteri:**
- [ ] `resolveWorkspacePath('../outside')` → `null` dönüyor
- [ ] `resolveWorkspacePath('../../etc/passwd')` → `null` dönüyor
- [ ] Workspace adı başka bir dizinin prefix'i olduğunda (`workspace` vs `workspace-evil`) → `null`
- [ ] Normal dosya erişimi (`notes/todo.md`) çalışmaya devam ediyor
- [ ] Birim test'ler eklendi

---

### 1.4 WebSocket Kimlik Doğrulaması Yok

**Sorun:** WebSocket bağlantıları kimlik doğrulaması gerektirmiyor. Default boş `allowedOrigins` her kaynağa izin veriyor. Herhangi bir client chat, agent config, workspace komutları gönderebilir.

**Dosya:** `packages/gateway/src/ws/server.ts` satır 64, 71-73, 183-205

**Nasıl Düzeltilecek:**
1. WebSocket upgrade handler'ında query parameter veya Authorization header'dan API key/JWT doğrulaması ekle
2. `allowedOrigins` boş olduğunda sadece localhost'a izin ver (mevcut: herkese izin veriyor)
3. Auth başarısız olduğunda 401 ile bağlantıyı reddet

```typescript
// Hedeflenen pattern:
private handleUpgrade(request, socket, head) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token') ?? request.headers['authorization']?.replace('Bearer ', '');
  if (!this.validateAuth(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // ... mevcut upgrade logic
}
```

**Başarı Kriteri:**
- [ ] Token olmadan WebSocket bağlantısı reddediliyor (401)
- [ ] Geçerli token ile bağlantı çalışıyor
- [ ] Boş `allowedOrigins` durumunda sadece localhost kabul ediliyor
- [ ] Mevcut UI WebSocket bağlantısı çalışmaya devam ediyor (token eklenerek)

---

### 1.5 SSRF: `download_file` URL Doğrulaması Yok

**Sorun:** `web-fetch.ts`'de `isBlockedUrl()` koruması var ama `download_file` tool'u raw `fetch()` yapıyor. Cloud metadata endpoint'leri (`169.254.169.254`) ve internal servisler erişilebilir.

**Dosya:** `packages/core/src/agent/tools/file-system.ts` satır 607-617

**Nasıl Düzeltilecek:**
1. `web-fetch.ts`'deki `isBlockedUrl()` fonksiyonunu shared bir utility'ye taşı (veya import et)
2. `download_file` executor'ında `fetch()` çağrısından önce `isBlockedUrl(url)` kontrolü ekle
3. Blocked URL'ler için anlamlı hata mesajı dön

**Başarı Kriteri:**
- [ ] `download_file({ url: 'http://169.254.169.254/latest/meta-data/' })` → hata
- [ ] `download_file({ url: 'http://localhost:8080/api/v1/config-services' })` → hata
- [ ] `download_file({ url: 'http://10.0.0.1/internal' })` → hata
- [ ] `download_file({ url: 'https://example.com/file.pdf' })` → çalışıyor
- [ ] Private IP aralıkları blocked: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `127.x.x.x`

---

### 1.6 SQL Injection: INTERVAL String Interpolation

**Sorun:** `olderThanDays` doğrudan SQL string'ine interpolate ediliyor. TypeScript `number` tipi runtime'da garanti sağlamıyor.

**Dosyalar:**
- `packages/gateway/src/db/repositories/chat.ts` satır 313
- `packages/gateway/src/db/adapters/postgres-adapter.ts` satır 124-126

**Nasıl Düzeltilecek:**

**chat.ts:**
```typescript
// MEVCUT (hatalı):
`WHERE updated_at < NOW() - INTERVAL '${olderThanDays} days'`

// HEDEF:
`WHERE updated_at < NOW() - make_interval(days => $2)`, [this.userId, olderThanDays]
// veya:
`WHERE updated_at < NOW() - ($2 || ' days')::interval`, [this.userId, olderThanDays]
```

**postgres-adapter.ts:**
```typescript
// MEVCUT (hatalı):
dateSubtract(column: string, amount: number, unit: string): string {
  return `${column} - INTERVAL '${amount} ${unit}'`;
}

// HEDEF:
dateSubtract(column: string, amount: number, unit: 'days' | 'hours' | 'minutes'): { sql: string; param: number } {
  if (!Number.isFinite(amount)) throw new Error('Invalid amount');
  // parameterized olarak dön, call site'ta param listesine eklensin
}
```

Alternatif olarak `dateSubtract` içinde `Number.isFinite(amount)` runtime doğrulaması ekle ve `column`'u allowlist'e karşı kontrol et.

**Başarı Kriteri:**
- [ ] `olderThanDays` parameterized query ile gönderiliyor
- [ ] `dateSubtract()` fonksiyonunda `amount` runtime'da doğrulanıyor (`Number.isFinite`)
- [ ] `column` parametresi allowlist'e karşı kontrol ediliyor
- [ ] `unit` parametresi sadece izin verilen değerleri kabul ediyor
- [ ] Mevcut testler geçiyor

---

### 1.7 Hardcoded Fallback Secret'lar (3 Lokasyon)

**Sorun:** Kaynak kodda statik fallback değerler var. Her kurulumda aynı encryption key, aynı DB password, aynı memory salt.

**Dosyalar:**
- `packages/gateway/src/db/repositories/oauth-integrations.ts` satır 100 — `'dev-only-insecure-key'`
- `packages/gateway/src/db/adapters/types.ts` satır 159 — `'ownpilot_secret'`
- `packages/core/src/memory/index.ts` satır 298 — `'change-this-in-production'`

**Nasıl Düzeltilecek:**
1. Her üç lokasyonda: `NODE_ENV=production` ise fallback'i reddet, hata fırlat
2. Development modunda: ilk başlatmada rastgele secret oluştur, `data/.secrets.json`'a kaydet, sonraki başlatmalarda oradan oku
3. `.env.example`'daki değerleri `your-secure-value-here` gibi placeholder'lara değiştir

**Başarı Kriteri:**
- [ ] `NODE_ENV=production` + secret tanımlanmamış → sunucu başlamayı reddediyor
- [ ] Development modunda otomatik oluşturulan secret `data/.secrets.json`'da saklanıyor
- [ ] `.env.example`'da gerçek secret değerleri yok
- [ ] Mevcut testler geçiyor (test ortamı kendi secret'larını sağlıyor)

---

### 1.8 Streaming Chat Endpoint Rate Limiting'den Muaf

**Sorun:** Sistemdeki en pahalı endpoint (her istek AI model inference tetikler, token başına para harcar) rate limiting'den muaf.

**Dosya:** `packages/gateway/src/app.ts` satır 82

```typescript
excludePaths: ['/health', '/api/v1/health', '/api/v1/chat/stream'],
//                                          ^^^^^^^^^^^^^^^^^^^^^^^^ BUNU KALDIR
```

**Nasıl Düzeltilecek:**
1. `/api/v1/chat/stream`'i `excludePaths`'ten kaldır
2. AI inference endpoint'leri için ayrı, daha sıkı rate limit ekle (ör: 10 concurrent, dakikada max 30 istek)

**Başarı Kriteri:**
- [ ] `/api/v1/chat/stream` rate limiting'e tabi
- [ ] Normal kullanımda (dakikada 5-10 mesaj) rate limit tetiklenmiyor
- [ ] Flood saldırısında (saniyede 10+ istek) 429 dönüyor

---

### 1.9 X-Forwarded-For ile Rate Limiting Bypass

**Sorun:** Rate limiter `X-Forwarded-For` header'ına koşulsuz güveniyor. Herhangi bir client sahte IP ile rate limit'i bypass edebilir.

**Dosya:** `packages/gateway/src/middleware/rate-limit.ts` satır 81-85

**Nasıl Düzeltilecek:**
1. `TRUSTED_PROXY` environment variable'ı ekle
2. Sadece trusted proxy arkasındayken `X-Forwarded-For`'a güven
3. Aksi halde gerçek bağlantı IP'sini kullan

**Başarı Kriteri:**
- [ ] `TRUSTED_PROXY` tanımlı değilse `X-Forwarded-For` göz ardı ediliyor
- [ ] `TRUSTED_PROXY=true` ise `X-Forwarded-For`'un ilk IP'si kullanılıyor
- [ ] Sahte `X-Forwarded-For` header'ı rate limit'i bypass edemiyor

---

### 1.10 Database Admin Route'ları Korumasız

**Sorun:** Database backup, restore, export, import, VACUUM, TRUNCATE TABLE endpoint'leri auth'suz erişilebilir (1.1 ile bağlantılı ama ayrı katman gerekiyor).

**Dosya:** `packages/gateway/src/app.ts` satır 214

**Nasıl Düzeltilecek:**
1. Database route'larına ayrı admin middleware guard'ı ekle
2. Bu guard, global auth'tan bağımsız olarak çalışsın
3. `ADMIN_API_KEY` veya sadece localhost erişimi ile korunsun

**Başarı Kriteri:**
- [ ] Database endpoint'leri admin key olmadan 403 dönüyor
- [ ] Global auth `none` olsa bile database route'ları korumalı
- [ ] Backup/restore/export çalışmaya devam ediyor (doğru key ile)

---

## Faz 2: Güvenilirlik [CRITICAL/HIGH]

### 2.1 Graceful Shutdown Yok — `process.exit(0)` In-Flight İstekleri Öldürüyor

**Sorun:** `process.exit(0)` hiçbir cleanup çağırmadan Node.js process'ini hemen sonlandırıyor. WebSocket bağlantıları, DB sorguları, timer'lar, SSE stream'leri anında ölüyor.

**Dosyalar:**
- `packages/cli/src/commands/server.ts` satır 134-141 — `process.exit(0)`
- `packages/gateway/src/server.ts` — Hiç `process.on` handler'ı yok

**Nasıl Düzeltilecek:**
1. `server.ts`'de `createGracefulShutdown()` fonksiyonu oluştur:
   ```typescript
   async function gracefulShutdown(signal: string) {
     log.info(`Received ${signal}, shutting down gracefully...`);
     // 1. Yeni bağlantıları kabul etmeyi durdur
     httpServer.close();
     // 2. WebSocket gateway'i kapat
     await wsGateway.stop();
     // 3. Trigger engine'i durdur
     await triggerEngine?.stop();
     // 4. Rate limiter'ları temizle
     stopAllRateLimiters();
     // 5. Plugin runtime'ı kapat
     await pluginRuntime?.shutdown();
     // 6. DB bağlantı pool'unu drain et
     await dbAdapter.close();
     // 7. In-flight isteklerin tamamlanması için timeout
     setTimeout(() => process.exit(0), 5000);
   }
   process.on('SIGINT', () => gracefulShutdown('SIGINT'));
   process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
   ```
2. `cli/server.ts`'deki `process.exit(0)` çağrısını kaldır, aynı graceful shutdown pattern'ini kullan

**Başarı Kriteri:**
- [ ] SIGINT/SIGTERM'de cleanup log mesajları görünüyor
- [ ] WebSocket bağlantıları düzgün kapatılıyor
- [ ] Timer'lar (trigger engine, rate limiters, approval cleanup) temizleniyor
- [ ] DB pool drain ediliyor
- [ ] 5 saniye timeout sonrası process çıkıyor

---

### 2.2 Global `unhandledRejection` / `uncaughtException` Handler'ları Yok

**Sorun:** Node.js 22+'da default `--unhandled-rejections=throw`. Tek bir unhandled promise rejection sunucuyu hiçbir diagnostic output olmadan crash eder.

**Dosya:** `packages/gateway/src/server.ts`

**Nasıl Düzeltilecek:**
```typescript
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Promise Rejection', { reason, promise });
  // Production'da crash etme, ama logla
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception — shutting down', { error });
  gracefulShutdown('uncaughtException');
});
```

**Başarı Kriteri:**
- [ ] Unhandled rejection'lar loglanıyor ama sunucu crash etmiyor
- [ ] Uncaught exception'lar loglaniyor VE graceful shutdown tetikleniyor
- [ ] Her iki handler `server.ts`'in `main()` fonksiyonunda kayıtlı

---

### 2.3 Tool Timeout Timer Leak (Başarıda Temizlenmiyor)

**Sorun:** Tool execution'da `Promise.race` kullanılıyor ama timeout timer'ı tool başarılı olduğunda temizlenmiyor. Her tool çağrısı bir dangling timer sızdırıyor.

**Dosya:** `packages/core/src/agent-executor/index.ts` satır 417-423

**Nasıl Düzeltilecek:**
```typescript
// MEVCUT (hatalı):
const result = await Promise.race([
  this.toolRegistry.execute(toolName, args, toolContext),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Tool '${toolName}' timed out`)), timeoutMs)
  ),
]);

// HEDEF:
let timer: NodeJS.Timeout;
const result = await Promise.race([
  this.toolRegistry.execute(toolName, args, toolContext),
  new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool '${toolName}' timed out`)), timeoutMs);
  }),
]).finally(() => clearTimeout(timer));
```

**Referans:** Doğru pattern `packages/gateway/src/plans/executor.ts` satır 518-547'de var.

**Başarı Kriteri:**
- [ ] `clearTimeout` her tool çağrısından sonra çağrılıyor (başarı ve hata durumunda)
- [ ] `finally` bloğu timer'ı temizliyor
- [ ] Mevcut tool execution testleri geçiyor

---

### 2.4 TriggerEngine Overlapping Schedule Execution (Mutex Yok)

**Sorun:** `processScheduleTriggers()` poll aralığından uzun sürerse, sonraki interval önceki tamamlanmadan çalışıyor. Aynı trigger'lar çift çalıştırılıyor.

**Dosya:** `packages/gateway/src/triggers/engine.ts` satır 114-120, 332-338

**Nasıl Düzeltilecek:**
```typescript
private isProcessingSchedule = false;

private async processScheduleTriggers(): Promise<void> {
  if (this.isProcessingSchedule) return; // overlap guard
  this.isProcessingSchedule = true;
  try {
    const dueTriggers = await this.triggerService.getDueTriggers(this.config.userId);
    // Bağımsız trigger'ları paralel çalıştır:
    await Promise.allSettled(dueTriggers.map(t => this.executeTrigger(t)));
  } finally {
    this.isProcessingSchedule = false;
  }
}
```

Aynı pattern `processConditionTriggers()` için de uygulanmalı.

**Başarı Kriteri:**
- [ ] Overlapping çağrılar engelleniyor (`isProcessing` guard)
- [ ] Bağımsız trigger'lar `Promise.allSettled` ile paralel çalıyor
- [ ] Tek bir trigger'ın hatası diğerlerini engellemiyor

---

### 2.5 Channel Session Creation Race Condition

**Sorun:** Telegram kullanıcısı hızlı iki mesaj gönderirse, her ikisi de `findActive` null döner ve duplicate conversation/session oluşturur.

**Dosya:** `packages/gateway/src/channels/service-impl.ts` satır 525-556

**Nasıl Düzeltilecek:**
1. Per-user/per-chat lock mekanizması ekle (in-memory Map<string, Promise>)
2. Aynı chat için concurrent session creation'ları serialize et

```typescript
private sessionLocks = new Map<string, Promise<void>>();

private async withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = this.sessionLocks.get(key);
  const execute = async () => {
    if (existing) await existing;
    return fn();
  };
  const promise = execute();
  this.sessionLocks.set(key, promise.then(() => {}).catch(() => {}));
  try { return await promise; } finally {
    if (this.sessionLocks.get(key) === promise.then(() => {}).catch(() => {})) {
      this.sessionLocks.delete(key);
    }
  }
}
```

**Başarı Kriteri:**
- [ ] Aynı chat'e concurrent mesajlar tek session oluşturuyor
- [ ] Farklı chat'ler birbirini bloklamıyor
- [ ] Lock memory leak yapmıyor (kullanım sonrası temizleniyor)

---

### 2.6 PluginRuntime.shutdown() `Promise.all` Kullanıyor (Fail-Fast)

**Sorun:** Bir plugin'in `stop()` metodu hata fırlatırsa, diğer plugin'lerin cleanup'ı iptal ediliyor.

**Dosya:** `packages/core/src/plugins/runtime.ts` satır 658-661

**Nasıl Düzeltilecek:**
```typescript
// MEVCUT:
await Promise.all(promises);

// HEDEF:
const results = await Promise.allSettled(promises);
const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  log.warn(`${failures.length} plugins failed to shut down cleanly`);
}
```

**Başarı Kriteri:**
- [ ] `Promise.allSettled` kullanılıyor
- [ ] Bir plugin'in hatası diğerlerinin shutdown'ını engellemiyor
- [ ] Başarısız shutdown'lar loglanıyor

---

### 2.7 ApprovalManager Singleton Replacement Timer Leak

**Sorun:** `getApprovalManager(config)` config ile çağrıldığında eski instance'ın `cleanupInterval`'ı temizlenmiyor. Eski timer sonsuza kadar çalışıyor.

**Dosya:** `packages/gateway/src/autonomy/approvals.ts` satır 413-441

**Nasıl Düzeltilecek:**
```typescript
export function getApprovalManager(config?: ApprovalManagerConfig): ApprovalManager {
  if (!managerInstance || config) {
    if (managerInstance) {
      managerInstance.dispose(); // ← Timer'ı temizle
    }
    managerInstance = new ApprovalManager(config);
  }
  return managerInstance;
}
```

`ApprovalManager`'a `dispose()` metodu ekle: `clearInterval(this.cleanupInterval)`.

**Başarı Kriteri:**
- [ ] `dispose()` metodu mevcut ve `clearInterval` çağırıyor
- [ ] Yeni instance oluşturulurken eski instance'ın timer'ı temizleniyor
- [ ] Pending action'lar da uygun şekilde reject/expire ediliyor

---

### 2.8 Settings Cache Race Condition

**Sorun:** `loadCache()` Map referansını tamamen değiştiriyor. Concurrent `set()` çağrısı eski Map'e yazıyor, yeni Map'te kaybolmuş oluyor.

**Dosya:** `packages/gateway/src/db/repositories/settings.ts` satır 50-103

**Nasıl Düzeltilecek:**
1. `loadCache()` içinde Map referansını değiştirmek yerine mevcut Map'i `clear()` + yeniden doldur
2. Veya `set()` içinde cache'e yazmadan önce `cacheInitialized` kontrolü yap ve gerekirse bekle

```typescript
private async loadCache(): Promise<void> {
  const rows = await this.query<SettingRow>('SELECT * FROM settings');
  settingsCache.clear(); // referansı değiştirme, temizle
  for (const row of rows) {
    settingsCache.set(row.key, safeParseJSON(row.value));
  }
  cacheInitialized = true;
}
```

**Başarı Kriteri:**
- [ ] Map referansı `loadCache()` sırasında değişmiyor
- [ ] Concurrent `set()` + `loadCache()` veri kaybı yapmıyor
- [ ] Mevcut testler geçiyor

---

## Faz 3: Performans [CRITICAL/HIGH]

### 3.1 File-Based UsageTracker'ı Kaldır

**Sorun:** Her chat mesajında 100K record'luk (~20MB) JSON dosyası diske yazılıyor. Gateway'de zaten DB-backed `CostsRepository` var. Bu tracker gereksiz, tehlikeli (concurrent yazma corruption), ve 50-100MB heap tüketiyor.

**Dosyalar:**
- `packages/core/src/costs/index.ts` satır 877-924, 940-966, 1165-1174
- İlgili: `packages/gateway/src/db/repositories/costs.ts` (zaten var!)

**Nasıl Düzeltilecek:**
1. `UsageTracker` class'ını basitleştir: sadece DB-backed `CostsRepository`'ye delegat et
2. `records` in-memory array'ini kaldır
3. `saveRecords()` / `loadRecords()` dosya I/O'sunu kaldır
4. `getUsage()`, `getSummary()` etc. metotlarını DB query'lere yönlendir
5. `BudgetManager.getStatus()` artık 3 full scan yerine DB aggregate query'leri kullansın

**Başarı Kriteri:**
- [ ] Dosya bazlı `saveRecords()` / `loadRecords()` yok
- [ ] In-memory `records` array'i yok
- [ ] Cost sorguları DB'den geliyor
- [ ] Heap kullanımı ~50-100MB azalıyor
- [ ] Chat mesajları başına disk I/O yok
- [ ] Mevcut cost API endpoint'leri çalışmaya devam ediyor

---

### 3.2 Synchronous fs Çağrılarını Async'e Dönüştür (~40 Lokasyon)

**Sorun:** `tools.ts`'deki tüm dosya tool executor'ları sync fs kullanıyor (`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`, `statSync`, `readdirSync`). Event loop'u her tool çağrısında blokluyor.

**Dosya:** `packages/core/src/agent/tools.ts` satır 2040-3740 (~40 çağrı sitesi)

**Nasıl Düzeltilecek:**
1. `import * as fs from 'node:fs'` → `import * as fs from 'node:fs/promises'` + sync için `import { existsSync } from 'node:fs'`
2. Her executor'ı `async` fonksiyon olarak güncelle (zaten `async` ama sync ops kullanıyor)
3. Dönüşüm tablosu:
   - `fs.readFileSync()` → `await fs.readFile()`
   - `fs.writeFileSync()` → `await fs.writeFile()`
   - `fs.existsSync()` → `await fs.access().then(() => true).catch(() => false)` veya try/catch
   - `fs.mkdirSync()` → `await fs.mkdir()`
   - `fs.statSync()` → `await fs.stat()`
   - `fs.readdirSync()` → `await fs.readdir()`
   - `fs.unlinkSync()` → `await fs.unlink()`
   - `fs.renameSync()` → `await fs.rename()`
   - `fs.copyFileSync()` → `await fs.copyFile()`

**Başarı Kriteri:**
- [ ] `tools.ts` üretim kodunda `*Sync` çağrısı yok (import hariç)
- [ ] Tüm dosya tool'ları async I/O kullanıyor
- [ ] Mevcut tool testleri geçiyor
- [ ] Event loop bloklanmıyor (benchmark ile doğrulanabilir)

---

### 3.3 N+1 Query: Goal Steps Sequential Loop

**Sorun:** Her chat isteğinde N aktif goal için N+1 sequential DB query yapılıyor.

**Dosya:** `packages/gateway/src/assistant/orchestrator.ts` satır 111-131

**Nasıl Düzeltilecek:**
```typescript
// MEVCUT (N+1):
for (const goal of goals) {
  const steps = await goalService.getSteps(userId, goal.id);
}

// HEDEF (paralel):
const goalSteps = await Promise.all(
  goals.map(goal => goalService.getSteps(userId, goal.id).catch(() => []))
);
```

Daha iyi: Tek bir SQL query ile tüm goal step'lerini çek (`WHERE goal_id IN (...)`).

**Başarı Kriteri:**
- [ ] N+1 query yerine 1-2 query kullanılıyor
- [ ] `maxGoals: 5` ile ~5-10ms yerine ~5ms (tek query)
- [ ] Mevcut testler geçiyor

---

### 3.4 MODEL_PRICING Linear Scan → Map Lookup

**Sorun:** Her API isteğinde `getModelPricing()` 3 sequential `Array.find()` taraması yapıyor (~50+ kayıt).

**Dosya:** `packages/core/src/costs/index.ts` satır 801-820

**Nasıl Düzeltilecek:**
```typescript
// Bir kez oluştur:
const pricingMap = new Map<string, ModelPricing>();
for (const p of MODEL_PRICING) {
  pricingMap.set(`${p.provider}:${p.modelId}`, p);
}

// O(1) lookup:
export function getModelPricing(provider: AIProvider, modelId: string): ModelPricing | null {
  return pricingMap.get(`${provider}:${modelId}`)
    ?? /* partial match fallback */
    ?? null;
}
```

**Başarı Kriteri:**
- [ ] Exact match O(1) (Map lookup)
- [ ] Partial match sadece cache miss'te yapılıyor
- [ ] Mevcut cost hesaplama testleri geçiyor

---

### 3.5 Missing Composite Index: messages(conversation_id, created_at)

**Sorun:** Mesajlar her zaman `conversation_id` ile filtreleniyor ve `created_at` ile sıralanıyor. Tek sütunlu indexler var ama composite yok.

**Dosya:** `packages/gateway/src/db/schema.ts` satır 1194-1196

**Nasıl Düzeltilecek:**
```sql
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages(conversation_id, created_at);
```

**Başarı Kriteri:**
- [ ] Composite index oluşturulmuş
- [ ] Conversation mesaj yükleme sorgusu EXPLAIN'de filesort göstermiyor

---

### 3.6 Memory/Goal Context İki Kez Çekiliyor

**Sorun:** `createAgentFromRecord()` memory ve goal context'i DB'den çekiyor. Sonra chat handler'ında `buildEnhancedSystemPrompt()` aynı verileri tekrar çekiyor.

**Dosyalar:**
- `packages/gateway/src/routes/agents.ts` satır 984-998
- `packages/gateway/src/routes/chat.ts` satır 1256-1268

**Nasıl Düzeltilecek:**
1. İlk çekilen memory/goal verilerini agent veya context'e attach et
2. `buildEnhancedSystemPrompt()` varsa cached veriyi kullansın, yoksa çeksin

**Başarı Kriteri:**
- [ ] Her chat isteğinde memory/goal DB query'si bir kez çalışıyor
- [ ] ~5 gereksiz DB sorgusu eliminasyonu
- [ ] Mevcut chat testleri geçiyor

---

### 3.7 Agent Cache FIFO → LRU

**Sorun:** Agent cache FIFO eviction kullanıyor. Sık kullanılan default agent, yeni bir agent oluşturulduğunda evict edilebilir.

**Dosya:** `packages/gateway/src/routes/agents.ts` satır 1049-1056

**Nasıl Düzeltilecek:**
Her `get()` çağrısında entry'yi Map'in sonuna taşı (JavaScript Map insertion order koruyor):
```typescript
function getFromCache(key: string): Agent | undefined {
  const agent = agentCache.get(key);
  if (agent) {
    agentCache.delete(key);
    agentCache.set(key, agent); // en sona taşı
  }
  return agent;
}
```

**Başarı Kriteri:**
- [ ] Sık kullanılan agent'lar cache'te kalıyor
- [ ] Nadir kullanılan agent'lar önce evict ediliyor
- [ ] Cache size limiti korunuyor

---

## Faz 4: Kod Kalitesi [HIGH/MEDIUM]

### 4.1 Ölü Kodu Sil (~6,200+ Satır)

**Neler Silinecek:**

| Modül | Satır | Dosya(lar) |
|-------|-------|------------|
| `core/integrations` (tamamı) | 2,162 | `index.ts`, `gmail-client.ts` |
| `core/memory` ölü tool export'ları | ~200 | `index.ts` (createSecureMemoryStore, rememberTool, etc.) |
| `core/notifications` ölü export'lar | ~500 | `index.ts` (COMMON_TEMPLATES, NotificationManager, etc.) |
| `core/plugins/examples` (10 dosya) | ~1,500 | `examples/*.ts` (hiçbiri import edilmiyor) |
| `createPluginRegistry()` factory | ~50 | `plugins/index.ts` |
| `resetEventBus()`, `ILegacyEventBus` | ~30 | `events/` |

**Nasıl:**
1. Her silme işlemi ayrı commit
2. Silmeden önce `grep -r "import.*from.*<module>"` ile consumer olmadığını doğrula
3. İlişkili test mock'larını da temizle
4. Barrel export'lardan kaldır
5. `core/integrations` silinince `google-auth-library` ve `googleapis` dependency'lerini de `core/package.json`'dan kaldır (195MB tasarruf!)

**Başarı Kriteri:**
- [ ] Listelenen modüller/export'lar silinmiş
- [ ] `googleapis` ve `google-auth-library` core'dan kaldırılmış
- [ ] Build başarılı
- [ ] Tüm testler geçiyor
- [ ] `pnpm install` sonrası core paket boyutu ~195MB azalmış

---

### 4.2 Chat.ts Streaming Duplication'ı Birleştir (~700 Satır)

**Sorun:** İki neredeyse aynı streaming implementasyonu var: MessageBus path (285-583) ve Legacy path (762-1163). Her bug fix/feature iki yerde uygulanmalı.

**Dosya:** `packages/gateway/src/routes/chat.ts`

**Nasıl Düzeltilecek:**
1. Shared `StreamingHandler` utility oluştur:
   ```typescript
   interface StreamingConfig {
     sseStream: SSEStreamingApi;
     requestId: string;
     conversationId: string;
     userId: string;
     trace: boolean;
   }
   function createStreamCallbacks(config: StreamingConfig): StreamCallbacks { ... }
   ```
2. Her iki path bu shared utility'yi kullansın
3. Uzun vadede legacy path'i tamamen kaldır (MessageBus path ana yol olsun)

**Başarı Kriteri:**
- [ ] SSE chunk formatting tek bir yerde
- [ ] Tool start/end event'leri tek bir yerde
- [ ] Suggestion extraction tek bir yerde
- [ ] Cost tracking tek bir yerde
- [ ] chat.ts ~700 satır azalmış
- [ ] Mevcut streaming testleri geçiyor

---

### 4.3 tools.ts God File'ı Decompose Et (3,773 Satır)

**Sorun:** Tek dosyada ToolRegistry class'ı, 15+ tool tanımı, 20+ tool executor, workspace path resolution, ve tüm public export'lar karışık.

**Dosya:** `packages/core/src/agent/tools.ts`

**Nasıl Düzeltilecek:**
1. `tools.ts` → Sadece `ToolRegistry` class'ı + re-export'lar (~800 satır)
2. `tools/file-tools.ts` → Dosya tool executor'ları (write_file, read_file, list_files, create_folder, delete_file, move_file)
3. `tools/task-tools.ts` → Task management executor'ları (create_task, list_tasks, update_task, delete_task)
4. `tools/note-tools.ts` → Note executor'ları (create_note, list_notes, search_notes)
5. `tools/bookmark-tools.ts` → Bookmark executor'ları
6. `tools/workspace-utils.ts` → `resolveWorkspacePath`, `getWorkspacePath`, workspace security
7. Her modül kendi tool tanımlarını ve executor'larını barındırsın

**Başarı Kriteri:**
- [ ] `tools.ts` < 1,000 satır (sadece ToolRegistry + registration)
- [ ] Her alt modül < 500 satır
- [ ] Barrel export korunuyor (breaking change yok)
- [ ] Tüm tool testleri geçiyor
- [ ] TypeScript build başarılı

---

### 4.4 Query Parameter Cast'lerini Doğrula (25 Lokasyon)

**Sorun:** Kullanıcı input'u (query string) doğrudan union type'lara cast ediliyor, runtime doğrulama yok.

**Dosyalar:** 25 lokasyon (auth.ts, costs.ts, audit.ts, custom-tools.ts, expenses.ts, model-configs.ts, memories.ts, plugins.ts, productivity.ts, triggers.ts, chat.ts, personal-data.ts)

**Nasıl Düzeltilecek:**
1. Generic helper oluştur:
   ```typescript
   // helpers.ts'e ekle:
   export function validateQueryEnum<T extends string>(
     value: string | undefined,
     allowed: readonly T[],
   ): T | undefined {
     if (value === undefined) return undefined;
     return allowed.includes(value as T) ? (value as T) : undefined;
   }
   ```
2. 25 lokasyonda bu helper'ı kullan:
   ```typescript
   // MEVCUT:
   const period = (c.req.query('period') ?? 'month') as 'day' | 'week' | 'month' | 'year';
   // HEDEF:
   const period = validateQueryEnum(c.req.query('period'), ['day', 'week', 'month', 'year'] as const) ?? 'month';
   ```

**Başarı Kriteri:**
- [ ] 25 lokasyonda runtime doğrulama var
- [ ] Geçersiz değerler `undefined` olarak dönüyor (default'a fallback)
- [ ] `?provider=evil_value` artık business logic'e ulaşamıyor
- [ ] Mevcut API testleri geçiyor

---

### 4.5 `validateBody()` Return Type'ını Zod ile Uyumlu Yap

**Sorun:** `validateBody()` return type'ı schema'nın output type'ına daraltmıyor, manual cast gerekiyor. Schema/type drift riski.

**Dosyalar:** `packages/gateway/src/middleware/validation.ts` ve 5+ kullanım yeri

**Nasıl Düzeltilecek:**
```typescript
// MEVCUT:
export function validateBody(schema: ZodSchema, data: unknown): unknown { ... }
// Kullanım: const body = validateBody(schema, raw) as CreateAgentRequest;

// HEDEF:
export function validateBody<T extends ZodSchema>(schema: T, data: unknown): z.infer<T> { ... }
// Kullanım: const body = validateBody(createAgentSchema, raw); // tip otomatik çıkarılır
```

**Başarı Kriteri:**
- [ ] `validateBody` generic return type kullanıyor
- [ ] `as CreateAgentRequest` gibi manual cast'ler kaldırılmış
- [ ] `as unknown as CreateGoalInput` gibi double cast'ler kaldırılmış
- [ ] TypeScript schema değişikliğinde compile error veriyor (tip güvenliği)
- [ ] Mevcut testler geçiyor

---

### 4.6 `executePersonalDataTool()` Decompose Et (570 Satır, 66 Unsafe Cast)

**Sorun:** Tek fonksiyonda 24 switch case, 66 `as` cast, her case'de repository re-instantiation.

**Dosya:** `packages/gateway/src/routes/personal-data-tools.ts` satır 24-594

**Nasıl Düzeltilecek:**
1. Repository'leri fonksiyon başında bir kez oluştur
2. Her entity için ayrı handler fonksiyonları: `handleTaskTool()`, `handleBookmarkTool()`, `handleNoteTool()`, `handleCalendarTool()`, `handleContactTool()`
3. Zod ile parametre doğrulama (unsafe cast yerine)

**Başarı Kriteri:**
- [ ] Ana fonksiyon < 100 satır (dispatch only)
- [ ] Her handler < 150 satır
- [ ] Repository'ler bir kez oluşturuluyor
- [ ] `as string`, `as number` cast'leri Zod validation ile değiştirilmiş
- [ ] Mevcut testler geçiyor

---

### 4.7 Kalan Inline Error Pattern'lerini Migrate Et (46+ Lokasyon)

**Sorun:** `getErrorMessage()` helper'ı oluşturulmuş ve 127 yerde uygulanmış ama 28+ gateway ve ~18 core lokasyonda hala inline pattern kullanılıyor.

**Nasıl Düzeltilecek:**
1. Gateway'deki 28 lokasyonda `getErrorMessage(err)` kullan
2. Core'da kendi utility'yi oluştur veya shared package'dan import et
3. `grep -rn "instanceof Error ? err.message\|error.message : " packages/` ile tara

**Başarı Kriteri:**
- [ ] `instanceof Error ? *.message :` pattern'i üretim kodunda sıfır
- [ ] Tüm error handling `getErrorMessage()` kullanıyor
- [ ] Build ve testler geçiyor

---

### 4.8 Kullanılmayan Dependency'leri Kaldır

| Dependency | Paket | Neden |
|------------|-------|-------|
| `@hono/zod-validator` | gateway | Hiç import edilmiyor |
| `@ownpilot/gateway` | ui | Hiç import edilmiyor, Turborepo build order'ını bozuyor |
| `googleapis` + `google-auth-library` | core | 4.1'de dead integrations modülü ile birlikte |

**Başarı Kriteri:**
- [ ] `pnpm why <paket>` hiçbir consumer göstermiyor
- [ ] `pnpm install` başarılı
- [ ] Build başarılı
- [ ] Tüm testler geçiyor

---

## Faz 5: Test Kapsamı [MEDIUM]

### 5.1 AI Provider Testleri (2,830 Satır, 0% Kapsam)

**Dosyalar (test yazılacak):**
- `packages/core/src/agent/providers/google.ts` (730 satır)
- `packages/core/src/agent/providers/openai-compatible.ts` (648 satır)
- `packages/core/src/agent/providers/aggregators.ts` (532 satır)
- `packages/core/src/agent/providers/fallback.ts` (477 satır)
- `packages/core/src/agent/providers/router.ts` (443 satır)

**Test Edilecek Senaryolar:**
- Response parsing (normal, error, malformed JSON)
- Streaming chunk handling
- Tool call extraction
- Rate limiting / retry logic
- Error handling (timeout, 401, 429, 500)
- Cost calculation integration

**Başarı Kriteri:**
- [ ] Her provider için en az 10 test
- [ ] Error path'ler test edilmiş
- [ ] Streaming test edilmiş
- [ ] Mock fetch ile external dependency yok

---

### 5.2 WebSocket Server Testleri (811 Satır, 0% Kapsam)

**Dosya:** `packages/gateway/src/ws/server.ts`

**Test Edilecek Senaryolar:**
- Connection establishment (auth varsa — 2.4'ten sonra)
- Message routing (chat:send, channel:connect, etc.)
- Session management (create, heartbeat, timeout, cleanup)
- Broadcast/group messaging
- Max connections limit
- Origin validation
- Error handling (malformed messages, disconnection)

**Başarı Kriteri:**
- [ ] En az 15 test
- [ ] Connection lifecycle test edilmiş
- [ ] Error handling test edilmiş
- [ ] Session timeout/cleanup test edilmiş

---

### 5.3 Channel Service Testleri (860 Satır, 0% Kapsam)

**Dosya:** `packages/gateway/src/channels/service-impl.ts`

**Test Edilecek Senaryolar:**
- Message processing pipeline
- Session creation/reuse (2.5 race fix'ten sonra)
- Error handling in channel responses
- Rate limiting of channel messages
- Channel connect/disconnect lifecycle

**Başarı Kriteri:**
- [ ] En az 12 test
- [ ] Happy path ve error path'ler
- [ ] Session reuse test edilmiş

---

### 5.4 Event Bus Assertion-less Testleri Düzelt

**Sorun:** Bazı test case'lerinde `expect()` çağrısı yok — test her zaman geçiyor.

**Dosyalar:**
- `packages/core/src/events/scoped-bus.test.ts` — 30 test, 22 expect (ratio 0.7)
- `packages/core/src/events/event-bus.test.ts` — 33 test, 27 expect (ratio 0.8)

**Nasıl Düzeltilecek:**
1. Her test'i incele, `expect()` olmayan case'leri bul
2. Her case'e anlamlı assertion ekle
3. `it('should...')` açıklamasıyla uyumlu assertion olduğundan emin ol

**Başarı Kriteri:**
- [ ] Her test case'de en az bir `expect()` var
- [ ] Assertion ratio >= 1.0

---

### 5.5 UI useChat Hook Testleri (285 Satır, 0% Kapsam)

**Dosya:** `packages/ui/src/hooks/useChat.ts`

**Test Edilecek Senaryolar:**
- SSE stream parsing
- Message state management (sending, received, error)
- Tool call display handling
- Abort/cancel functionality
- Error handling (network failure, server error)
- Reconnection logic

**Başarı Kriteri:**
- [ ] En az 10 test
- [ ] SSE parsing test edilmiş
- [ ] Error handling test edilmiş
- [ ] State transitions test edilmiş

---

## Faz 6: Configuration Düzeltmeleri [MEDIUM]

### 6.1 Rate Limit Default Tutarsızlığı (100 / 500 / 1000)

**Sorun:** Üç farklı başlatma yolu farklı default'lar kullanıyor.

**Dosyalar:**
- `packages/cli/src/commands/server.ts` satır 82 — default **100**
- `packages/gateway/src/server.ts` satır 102 — default **1000**
- `packages/gateway/src/config/defaults.ts` satır 104 — constant **500**

**Nasıl Düzeltilecek:** Her iki lokasyonda `RATE_LIMIT_MAX_REQUESTS` constant'ını kullan.

**Başarı Kriteri:**
- [ ] Üç dosya da aynı constant'ı referans ediyor
- [ ] Hangi yoldan başlatılırsa başlatılsın rate limit aynı

---

### 6.2 Postgres Port Log/Bağlantı Uyumsuzluğu

**Sorun:** Log `5432` gösteriyor ama gerçek bağlantı `25432`'ye gidiyor.

**Dosyalar:**
- `packages/gateway/src/server.ts` satır 154 — `'5432'` (log)
- `packages/gateway/src/db/adapters/types.ts` satır 157 — `25432` (bağlantı)

**Nasıl Düzeltilecek:** Her ikisinde de aynı constant veya default değeri kullan.

**Başarı Kriteri:**
- [ ] Log'daki port = bağlantı portu
- [ ] Tek bir yerde tanımlanmış default

---

### 6.3 `skipLibCheck: true` CI'da False Olmalı

**Dosya:** `tsconfig.base.json` satır 22

**Nasıl Düzeltilecek:**
CI `typecheck` script'inde `--skipLibCheck false` flag'i ekle veya `tsconfig.ci.json` oluştur.

**Başarı Kriteri:**
- [ ] CI'da declaration file type error'ları yakalanıyor
- [ ] Local development hızı etkilenmiyor (`skipLibCheck: true` korunuyor)

---

### 6.4 `better-sqlite3` Migration Script'te Var Ama package.json'da Yok

**Dosya:** `packages/gateway/scripts/migrate-to-postgres.ts` satır 20

**Nasıl Düzeltilecek:** `better-sqlite3`'ü devDependencies'e ekle (sadece migration script'i için).

**Başarı Kriteri:**
- [ ] `pnpm run migrate:postgres` çalışıyor
- [ ] `better-sqlite3` devDependencies'de

---

## Özet: İş Sıralaması

| Sıra | Faz | Öğe | Etki | Zorluk |
|------|-----|-----|------|--------|
| 1 | F1 | 1.1 Secure defaults (auth + host) | CRITICAL | Düşük |
| 2 | F1 | 1.2 new Function() → safe math eval | CRITICAL | Orta |
| 3 | F1 | 1.3 Path traversal fix | CRITICAL | Düşük |
| 4 | F1 | 1.4 WebSocket auth | CRITICAL | Orta |
| 5 | F1 | 1.5 SSRF in download_file | CRITICAL | Düşük |
| 6 | F1 | 1.6 SQL injection fix | CRITICAL | Düşük |
| 7 | F1 | 1.7 Hardcoded secrets | CRITICAL | Orta |
| 8 | F1 | 1.8 Rate limit streaming | HIGH | Düşük |
| 9 | F1 | 1.9 X-Forwarded-For trust | HIGH | Düşük |
| 10 | F1 | 1.10 DB admin guard | HIGH | Düşük |
| 11 | F2 | 2.1 Graceful shutdown | CRITICAL | Orta |
| 12 | F2 | 2.2 Global error handlers | CRITICAL | Düşük |
| 13 | F2 | 2.3 Timer leak fix | HIGH | Düşük |
| 14 | F2 | 2.4 Trigger engine mutex | HIGH | Düşük |
| 15 | F2 | 2.5 Channel session race | HIGH | Orta |
| 16 | F2 | 2.6 Promise.allSettled shutdown | HIGH | Düşük |
| 17 | F2 | 2.7 Approval timer leak | MEDIUM | Düşük |
| 18 | F2 | 2.8 Settings cache race | MEDIUM | Düşük |
| 19 | F3 | 3.1 Remove file-based UsageTracker | CRITICAL | Yüksek |
| 20 | F3 | 3.2 Sync fs → async | HIGH | Orta |
| 21 | F3 | 3.3 N+1 goal steps query | HIGH | Düşük |
| 22 | F3 | 3.4 MODEL_PRICING Map | MEDIUM | Düşük |
| 23 | F3 | 3.5 Composite DB index | MEDIUM | Düşük |
| 24 | F3 | 3.6 Double memory/goal fetch | MEDIUM | Orta |
| 25 | F3 | 3.7 FIFO → LRU cache | LOW | Düşük |
| 26 | F4 | 4.1 Delete dead code (~6,200 satır) | HIGH | Düşük |
| 27 | F4 | 4.2 Streaming dedup (~700 satır) | HIGH | Yüksek |
| 28 | F4 | 4.3 tools.ts decompose | HIGH | Yüksek |
| 29 | F4 | 4.4 Query param validation (25 loc) | HIGH | Düşük |
| 30 | F4 | 4.5 validateBody generic | MEDIUM | Düşük |
| 31 | F4 | 4.6 Personal data tool decompose | HIGH | Orta |
| 32 | F4 | 4.7 Error pattern migration (46 loc) | LOW | Düşük |
| 33 | F4 | 4.8 Remove unused deps | MEDIUM | Düşük |
| 34 | F5 | 5.1 Provider tests | HIGH | Yüksek |
| 35 | F5 | 5.2 WebSocket tests | HIGH | Yüksek |
| 36 | F5 | 5.3 Channel service tests | MEDIUM | Orta |
| 37 | F5 | 5.4 Event bus assertion fix | LOW | Düşük |
| 38 | F5 | 5.5 UI useChat tests | MEDIUM | Orta |
| 39 | F6 | 6.1 Rate limit default sync | MEDIUM | Düşük |
| 40 | F6 | 6.2 Postgres port log fix | LOW | Düşük |
| 41 | F6 | 6.3 skipLibCheck CI | LOW | Düşük |
| 42 | F6 | 6.4 better-sqlite3 devDep | LOW | Düşük |

---

## Notlar

- Her düzeltme ayrı commit olmalı
- Her commit mesajı `fix:`, `refactor:`, `perf:`, `test:`, `chore:` prefix'i kullanmalı
- CRITICAL öğeler öncelikli — hiçbir HIGH öğe CRITICAL tamamlanmadan başlamamalı
- Her faz sonunda `pnpm run test && pnpm run build && pnpm run typecheck` çalıştırılmalı
- Güvenlik düzeltmelerinde regression test eklenmeli (exploit senaryosu test ile kanıtlanmalı)
