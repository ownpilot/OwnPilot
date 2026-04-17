# v2.1 Contextual Chat — Detailed Execution Plan

> Created: 2026-04-06
> Milestone: v2.1 Contextual Chat Full Implementation
> Branch: feature/v2.1-contextual-impl
> Total Phases: 12 (Phase 18-29)
> Estimated effort: ~40-60 hours across 4 waves

---

## Execution Rules

1. **Atomic commits** — Her task kendi commit'ini alir
2. **TDD** — Test yazilabilir task'larda once test, sonra implementasyon
3. **Verification gate** — Her phase sonunda ZORUNLU verification protocol
4. **Wave gate** — Wave'ler arasi gecis ancak onceki wave TAMAMEN PASS ise
5. **Rollback** — Her phase kendi rollback planina sahip
6. **No parallel file edits** — Ayni dosyayi iki task ayni anda DEGISTIRMEZ

---

## Global Pre-Conditions (Milestone Baslangici)

| Check | Command | Expected |
|-------|---------|----------|
| Branch | `git branch --show-current` | `feature/v2-contextual-chat` or new branch |
| tsc UI | `npx tsc --noEmit -p packages/ui/tsconfig.json` | 0 errors |
| tsc Gateway | `npx tsc --noEmit -p packages/gateway/tsconfig.json` | 0 errors |
| vitest UI | `cd packages/ui && npx vitest run` | 141+ PASS |
| vitest Gateway | `cd packages/gateway && npx vitest run` | 16,294+ PASS |
| Docker healthy | `docker ps --filter name=ownpilot` | Up + healthy |
| Bridge UP | `curl -s http://localhost:9090/ping` | `{"pong":true}` |
| v2.0 complete | Phase 11-17 commits exist | 8+ commits on branch |

---

# WAVE 1: Foundation (Parallel — No Dependencies)

---

## Phase 18: Dedicated SidebarChatStore

### Goal
StatsPanel CompactChat icin ChatPage/MiniChat'ten TAMAMEN bagimsiz chat store olustur. Kendi message history, session, streaming state'i.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Phase 13 CompactChat in StatsPanel | `grep "CompactChat" packages/ui/src/components/StatsPanel.tsx` |
| 2 | Phase 16 research: Alternative D | `cat .planning/phases/16-multi-session/RESEARCH.md \| grep "Alternative D"` |
| 3 | useChatStore exports | `grep "export.*useChatStore" packages/ui/src/hooks/useChatStore.tsx` |

### Depends On
- Phase 13 (CompactChat exists)
- Phase 16 research (Alternative D: Dedicated SidebarChatStore)

### Tasks (Ordered)

#### T18.1: Create useSidebarChat.ts hook skeleton
**File:** NEW `packages/ui/src/hooks/useSidebarChat.ts`
**Effort:** ~150 LOC
**Detail:**
```typescript
interface SidebarChatState {
  messages: SidebarMessage[];
  input: string;
  isStreaming: boolean;
  streamingContent: string;
  conversationId: string | null;
  contextPath: string | null;
  contextType: string | null;  // 'workspace' | 'workflow' | etc.
  provider: string;
  model: string;
}

interface SidebarMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  actionData?: unknown;  // per-page action extraction (JSON, config, etc.)
}

// Exports:
export function SidebarChatProvider({ children })
export function useSidebarChat(): SidebarChatState & SidebarChatActions
```
**Actions:**
- `sendMessage(content: string)` — POST /api/v1/chat with sidebar conversationId
- `setContext(path: string | null, type: string | null)` — path degisince: clear messages, null conversationId, new session
- `setProvider(provider: string)` / `setModel(model: string)`
- `cancelStream()` — AbortController.abort()
- `clearMessages()` — manual clear

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json  # 0 errors
```

#### T18.2: Implement SSE streaming in useSidebarChat
**File:** MODIFY `packages/ui/src/hooks/useSidebarChat.ts`
**Detail:**
- `sendMessage()` icinde: `apiClient.stream('/chat', body, { signal })` kullan
- Body: `{ message, provider, model, conversationId: "sidebar-{contextType}-{entityId}-{timestamp}", pageContext: {...} }`
- SSE parsing: `data:` lines → delta/done/error events
- streamingContent accumulation
- Auto-scroll trigger via callback
- **ConversationId namespace:** `sidebar-` prefix (ChatPage'den ayirt etmek icin)

**Pattern Reference:** WorkflowCopilotPanel.tsx L312-432 (handleSend + SSE parsing)

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

#### T18.3: Add SidebarChatProvider to main.tsx provider tree
**File:** MODIFY `packages/ui/src/main.tsx`
**Detail:**
- `<SidebarChatProvider>` eklenmeli, `<ChatProvider>` YANINA (icine degil)
- Provider tree sirasinda ChatProvider'dan SONRA (veya paralel — bagimsiz)
```
<ChatProvider>          ← mevcut (ChatPage + MiniChat)
<SidebarChatProvider>   ← YENi (StatsPanel CompactChat)
```

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
# + Preview'da sayfa yukleniyor (provider hatasi yok)
```

#### T18.4: Wire StatsPanel CompactChat to useSidebarChat
**File:** MODIFY `packages/ui/src/components/StatsPanel.tsx` (~617 LOC)
**Detail:**
- `import { useSidebarChat } from '../hooks/useSidebarChat'`
- CompactChat icindeki `useChatStore()` → `useSidebarChat()` ile degistir
- Mapping: messages, sendMessage, isLoading→isStreaming, streamingContent
- contextPath sync: usePageContext → useSidebarChat.setContext()

**CRITICAL:** useChatStore import'u StatsPanel'den TAMAMEN kaldir. Sadece useSidebarChat kullanilmali.

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
grep "useChatStore" packages/ui/src/components/StatsPanel.tsx  # SIFIR sonuc olmali
```

#### T18.5: Remove contextPath from useChatStore (Phase 15 cleanup)
**File:** MODIFY `packages/ui/src/hooks/useChatStore.tsx` (~682 LOC)
**Detail:**
- Phase 15'te eklenen `contextPath`, `setContextPath` KALDIRILIR
- X-Project-Dir header logic KALDIRILIR (artik sidebar store'da)
- ChatContextType interface'den `contextPath` ve `setContextPath` SIL
- ChatProvider'dan state + function SIL
- **DIKKAT:** ChatPage ve MiniChat'in ETKILENMEDIGINI dogrula

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
grep "contextPath" packages/ui/src/hooks/useChatStore.tsx  # SIFIR sonuc
grep "X-Project-Dir" packages/ui/src/hooks/useChatStore.tsx  # SIFIR sonuc
```

#### T18.6: Export useSidebarChat from hooks barrel
**File:** MODIFY `packages/ui/src/hooks/index.ts`
**Detail:** `export { useSidebarChat, SidebarChatProvider } from './useSidebarChat';`

#### T18.7: Unit tests
**File:** NEW `packages/ui/src/hooks/useSidebarChat.test.ts`
**Tests:**
1. Initial state: messages=[], isStreaming=false, conversationId=null
2. setContext('path', 'workspace'): context set correctly
3. setContext changes: messages cleared, conversationId nulled
4. sendMessage: adds user message to list, sets isStreaming
5. cancelStream: sets isStreaming=false
6. clearMessages: empties array
7. Isolation: useSidebarChat state != useChatStore state

**Verification:**
```bash
cd packages/ui && npx vitest run src/hooks/useSidebarChat.test.ts
```

### Phase 18 Verification Protocol (ZORUNLU)
```bash
# 1. TypeScript
npx tsc --noEmit -p packages/ui/tsconfig.json        # 0 errors

# 2. Unit tests
cd packages/ui && npx vitest run src/hooks/useSidebarChat.test.ts  # ALL PASS

# 3. Regression
cd packages/ui && npx vitest run                       # 141+ PASS (no regression)

# 4. Isolation check
grep "useChatStore" packages/ui/src/components/StatsPanel.tsx  # 0 results
grep "contextPath" packages/ui/src/hooks/useChatStore.tsx      # 0 results

# 5. Preview check
# StatsPanel Chat tab: mesaj gonderebilme
# ChatPage: mesaj gonderebilme, sidebar'dan ETKILENMIYOR
# Sidebar: ChatPage'den ETKILENMIYOR
```

### Rollback
```bash
git revert HEAD~N..HEAD  # (N = commit count for this phase)
# veya: git stash + cherry-pick specific commits
```

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SSE parsing farki | Low | Medium | WorkflowCopilotPanel pattern kopyala |
| Provider tree order | Low | Low | Bagimsiz provider, sira onemli degil |
| useChatStore cleanup regression | Medium | High | grep ile tum referanslari kontrol et |

### Files Modified
| File | Action | LOC Delta |
|------|--------|-----------|
| packages/ui/src/hooks/useSidebarChat.ts | NEW | +150 |
| packages/ui/src/hooks/useSidebarChat.test.ts | NEW | +80 |
| packages/ui/src/hooks/index.ts | MODIFY | +1 |
| packages/ui/src/main.tsx | MODIFY | +3 |
| packages/ui/src/components/StatsPanel.tsx | MODIFY | ±20 |
| packages/ui/src/hooks/useChatStore.tsx | MODIFY | -15 |

---

## Phase 19: Page Copilot Registry

### Goal
Her sidebar section icin context config, suggestions ve actions tanimlayan DEKLARATIF registry. Route'dan otomatik resolution.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Phase 14 usePageContext exists | `ls packages/ui/src/hooks/usePageContext.ts` |
| 2 | sidebar-sections.ts exists | `ls packages/ui/src/constants/sidebar-sections.ts` |
| 3 | API endpoints available | `ls packages/ui/src/api/endpoints/` |

### Depends On
- Phase 14 (usePageContext hook — route detection)

### Tasks (Ordered)

#### T19.1: Define PageCopilotConfig type
**File:** NEW `packages/ui/src/types/page-copilot.ts`
**Detail:**
```typescript
export interface PageCopilotConfig {
  pageType: string;
  resolveContext?: (params: { id?: string }) => Promise<PageContextData>;
  suggestions: string[];
  actions?: PageAction[];
  systemPromptHint?: string;
  preferBridge?: boolean;  // true for path-based pages
}

export interface PageContextData {
  path?: string;             // host-fs path (workspace, coding-agent, claw)
  definition?: unknown;      // workflow JSON, agent config
  tools?: string[];          // available tool names
  metadata?: Record<string, unknown>;
}

export interface PageAction {
  id: string;
  label: string;
  icon: string;  // lucide icon name
  extractFromResponse: (content: string) => unknown | null;  // JSON extract
  handler: (data: unknown, navigate: NavigateFunction) => void;
}
```

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

#### T19.2: Create page-copilot-registry.ts with PATH-BASED pages
**File:** NEW `packages/ui/src/constants/page-copilot-registry.ts`
**Detail:** Workspace, coding-agents, claws icin config:
- resolveContext: API call ile path + metadata fetch
- suggestions: 4-5 context-aware prompt
- preferBridge: true
- systemPromptHint: domain-specific instruction

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

#### T19.3: Add NO-PATH pages to registry
**File:** MODIFY `packages/ui/src/constants/page-copilot-registry.ts`
**Detail:** Workflows, agents, tools, custom-tools, skills, mcp-servers, edge-devices, tasks, notes, goals, habits, memories, bookmarks, contacts, channels icin config:
- resolveContext: API call ile definition/config/list fetch
- suggestions: 3-4 context-aware prompt
- preferBridge: false (veya undefined)
- systemPromptHint: domain-specific instruction

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
# Registry 23 section icin config iceriyor:
node -e "const r=require('./packages/ui/src/constants/page-copilot-registry'); console.log(Object.keys(r.PAGE_COPILOT_REGISTRY).length)"
# Beklenen: >= 20
```

#### T19.4: Create usePageCopilotContext() hook
**File:** NEW `packages/ui/src/hooks/usePageCopilotContext.ts`
**Detail:**
```typescript
export function usePageCopilotContext(): {
  config: PageCopilotConfig | null;
  contextData: PageContextData | null;
  isLoading: boolean;
}
```
- `useLocation()` ile route detect
- Route params parse: `/workspaces?id=X`, `/workflows/X`, etc.
- Registry lookup: route → PageCopilotConfig
- resolveContext() async call (varsa)
- Cache: route+params bazli (ayni sayfa tekrar fetch etme)
- usePageContext() hook'u REUSE (Phase 14) veya GENISLET

**Verification:**
```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

#### T19.5: Export from hooks barrel + type exports
**Files:**
- MODIFY `packages/ui/src/hooks/index.ts`
- MODIFY `packages/ui/src/types/index.ts` (varsa)

#### T19.6: Unit tests
**File:** NEW `packages/ui/src/hooks/usePageCopilotContext.test.ts`
**Tests:**
1. /workspaces route → workspace config returned
2. /workflows route → workflow config returned
3. /tools route → tools config returned
4. Unknown route → null config
5. Config has suggestions array (length >= 3)
6. Path-based config has preferBridge=true
7. No-path config has preferBridge=false/undefined

**Verification:**
```bash
cd packages/ui && npx vitest run src/hooks/usePageCopilotContext.test.ts
```

### Phase 19 Verification Protocol
```bash
# 1. TypeScript
npx tsc --noEmit -p packages/ui/tsconfig.json

# 2. Unit tests
cd packages/ui && npx vitest run src/hooks/usePageCopilotContext.test.ts

# 3. Regression
cd packages/ui && npx vitest run  # 141+ PASS

# 4. Registry completeness
grep -c "pageType:" packages/ui/src/constants/page-copilot-registry.ts  # >= 20

# 5. Preview check
# Farkli sayfalara git → console.log ile dogru config geldigini kontrol
```

### Rollback
```bash
git revert HEAD~N..HEAD
```

### Files Modified
| File | Action | LOC Delta |
|------|--------|-----------|
| packages/ui/src/types/page-copilot.ts | NEW | +50 |
| packages/ui/src/constants/page-copilot-registry.ts | NEW | +300 |
| packages/ui/src/hooks/usePageCopilotContext.ts | NEW | +80 |
| packages/ui/src/hooks/usePageCopilotContext.test.ts | NEW | +60 |
| packages/ui/src/hooks/index.ts | MODIFY | +2 |

---

## Phase 20: Docker Host-FS Setup

### Goal
Container icinden host dosya sistemine bind mount erisimi. Path mapping icin env var'lar.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Docker running | `docker ps` |
| 2 | Container healthy | `docker ps --filter name=ownpilot --format '{{.Status}}'` |
| 3 | HOST-FILESYSTEM-ACCESS.md exists | `ls HOST-FILESYSTEM-ACCESS.md` |

### Depends On
- Nothing (DevOps, tamamen bagimsiz)

### Tasks (Ordered)

#### T20.1: Identify current Docker run command
**Detail:** Mevcut container nasil baslatiliyor? docker-compose mi, docker run mi?
```bash
docker inspect ownpilot-app-zfst6b-ownpilot-1 --format '{{.Config.Image}}'
docker inspect ownpilot-app-zfst6b-ownpilot-1 --format '{{json .Config.Cmd}}'
docker inspect ownpilot-app-zfst6b-ownpilot-1 --format '{{json .Config.Env}}'
docker inspect ownpilot-app-zfst6b-ownpilot-1 --format '{{json .HostConfig.Binds}}'
```
**Bu task output uretir, dosya degistirmez.**

#### T20.2: Create docker-compose.contextual.yml overlay
**File:** NEW `docker-compose.contextual.yml`
**Detail:**
```yaml
# Overlay for contextual chat — adds host-fs bind mount
# Usage: docker compose -f docker-compose.yml -f docker-compose.contextual.yml up -d
services:
  ownpilot:
    volumes:
      - /home/ayaz:/host-home:rw
    environment:
      - OWNPILOT_HOST_FS=/host-home
      - OWNPILOT_HOST_FS_HOST_PREFIX=/home/ayaz
```
**Neden ayri dosya?** Ana docker-compose'u bozmamak icin. Overlay pattern.

**Verification:**
```bash
docker compose -f docker-compose.yml -f docker-compose.contextual.yml config
# YAML syntax valid + volumes gorunuyor
```

#### T20.3: Stop current container + restart with bind mount
**Detail:**
```bash
# Mevcut container bilgilerini kaydet (env vars, image tag, ports)
docker inspect ownpilot-app-zfst6b-ownpilot-1 > /tmp/ownpilot-backup.json

# Yeniden baslat (mevcut yontem — docker run veya compose)
# BU ADIM KULLANICIDAN ONAY GEREKTIRIR — container downtime olacak
```

**CRITICAL:** Bu adim KULLANICIYA sormadan YAPILMAZ. Container restart = kisa downtime.

#### T20.4: Verify bind mount
```bash
# Container icinden host dosyalari gorunuyor mu?
docker exec ownpilot-app-zfst6b-ownpilot-1 ls /host-home/ | head -10
docker exec ownpilot-app-zfst6b-ownpilot-1 ls /host-home/projects/ 2>/dev/null | head -5
docker exec ownpilot-app-zfst6b-ownpilot-1 printenv OWNPILOT_HOST_FS
docker exec ownpilot-app-zfst6b-ownpilot-1 printenv OWNPILOT_HOST_FS_HOST_PREFIX

# Beklenen:
# /host-home/ → host dosyalari listelenir
# OWNPILOT_HOST_FS = /host-home
# OWNPILOT_HOST_FS_HOST_PREFIX = /home/ayaz
```

#### T20.5: Verify container still healthy
```bash
docker ps --filter name=ownpilot --format '{{.Status}}'  # Up + healthy
curl -s http://localhost:8080/api/v1/auth/status | head -5  # API responds
```

### Phase 20 Verification Protocol
```bash
# 1. Bind mount calisiyor
docker exec ownpilot ls /host-home/projects/ 2>/dev/null | head -3

# 2. Env vars dogru
docker exec ownpilot printenv OWNPILOT_HOST_FS         # /host-home
docker exec ownpilot printenv OWNPILOT_HOST_FS_HOST_PREFIX  # /home/ayaz

# 3. Container healthy
docker ps --filter name=ownpilot --format '{{.Status}}'  # healthy

# 4. API calisiyor
curl -s http://localhost:8080/api/v1/auth/status | python3 -c "import sys,json; print(json.load(sys.stdin)['success'])"  # true

# 5. Write test (rw mount)
docker exec ownpilot touch /host-home/.ownpilot-mount-test
ls -la /home/ayaz/.ownpilot-mount-test  # EXISTS
rm /home/ayaz/.ownpilot-mount-test      # cleanup
```

### Rollback
```bash
# Bind mount olmadan eski container'a don
docker stop ownpilot-app-zfst6b-ownpilot-1
# Eski image + config ile yeniden baslat (backup JSON'dan)
```

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Container start fail | Low | High | Backup inspect JSON, eski config'e don |
| Permission issue | Low | Medium | :rw flag + ayni user |
| Disk space | Very Low | Low | Bind mount disk kullanmaz |

### Files Modified
| File | Action | LOC Delta |
|------|--------|-----------|
| docker-compose.contextual.yml | NEW | +10 |

---

# WAVE 1 → WAVE 2 GATE

### Wave 1 Completion Checklist
```bash
# Phase 18
npx tsc --noEmit -p packages/ui/tsconfig.json          # 0 errors
cd packages/ui && npx vitest run                         # ALL PASS
grep "useChatStore" packages/ui/src/components/StatsPanel.tsx  # 0 results

# Phase 19
grep -c "pageType:" packages/ui/src/constants/page-copilot-registry.ts  # >= 20
cd packages/ui && npx vitest run src/hooks/usePageCopilotContext.test.ts  # ALL PASS

# Phase 20
docker exec ownpilot ls /host-home/ | head -3            # files visible
docker exec ownpilot printenv OWNPILOT_HOST_FS           # /host-home
```

**TUMU PASS → Wave 2 baslayabilir**
**HERHANGI BIRI FAIL → DURUR, fix edilir, tekrar kontrol**

---

# WAVE 2: Gateway Pipeline

---

## Phase 21: Gateway Path Mapping

### Goal
Container path ↔ host path donusum utility'si. OWNPILOT_HOST_FS env var'larindan okur.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Phase 20 complete | `docker exec ownpilot printenv OWNPILOT_HOST_FS` |
| 2 | Gateway codebase accessible | `ls packages/gateway/src/` |

### Depends On
- Phase 20 (env vars mevcut olmali)

### Tasks (Ordered)

#### T21.1: Create host-path.ts utility (TDD — test first)
**File:** NEW `packages/gateway/src/utils/host-path.test.ts`
**Tests:**
```typescript
describe('host-path', () => {
  // Env: OWNPILOT_HOST_FS=/host-home, OWNPILOT_HOST_FS_HOST_PREFIX=/home/ayaz

  test('toHostPath: /host-home/projects/x → /home/ayaz/projects/x')
  test('toHostPath: /host-home → /home/ayaz')
  test('toHostPath: /app/data/something → null (not under HOST_FS)')
  test('toHostPath: null input → null')
  test('toHostPath: empty string → null')

  test('toContainerPath: /home/ayaz/projects/x → /host-home/projects/x')
  test('toContainerPath: /root/something → null (not under HOST_PREFIX)')

  test('isHostFsConfigured: true when both env vars set')
  test('isHostFsConfigured: false when HOST_FS missing')
  test('isHostFsConfigured: false when HOST_PREFIX missing')

  test('graceful degradation: no env vars → all functions return null')
  test('trailing slash handling: /host-home/ and /host-home both work')
});
```

#### T21.2: Implement host-path.ts
**File:** NEW `packages/gateway/src/utils/host-path.ts`
**Detail:**
```typescript
const HOST_FS = process.env.OWNPILOT_HOST_FS?.replace(/\/+$/, '');
const HOST_PREFIX = process.env.OWNPILOT_HOST_FS_HOST_PREFIX?.replace(/\/+$/, '');

export function isHostFsConfigured(): boolean {
  return !!HOST_FS && !!HOST_PREFIX;
}

export function toHostPath(containerPath: string | null | undefined): string | null {
  if (!containerPath || !HOST_FS || !HOST_PREFIX) return null;
  const normalized = containerPath.replace(/\/+$/, '');
  if (!normalized.startsWith(HOST_FS)) return null;
  return normalized.replace(HOST_FS, HOST_PREFIX);
}

export function toContainerPath(hostPath: string | null | undefined): string | null {
  if (!hostPath || !HOST_FS || !HOST_PREFIX) return null;
  const normalized = hostPath.replace(/\/+$/, '');
  if (!normalized.startsWith(HOST_PREFIX)) return null;
  return normalized.replace(HOST_PREFIX, HOST_FS);
}
```

**Verification:**
```bash
cd packages/gateway && npx vitest run src/utils/host-path.test.ts  # ALL PASS
npx tsc --noEmit -p packages/gateway/tsconfig.json  # 0 errors
```

### Phase 21 Verification Protocol
```bash
# 1. Tests
cd packages/gateway && npx vitest run src/utils/host-path.test.ts  # 11+ PASS

# 2. TypeScript
npx tsc --noEmit -p packages/gateway/tsconfig.json  # 0 errors

# 3. Regression
cd packages/gateway && npx vitest run  # 16,294+ PASS
```

### Files Modified
| File | Action | LOC Delta |
|------|--------|-----------|
| packages/gateway/src/utils/host-path.ts | NEW | +30 |
| packages/gateway/src/utils/host-path.test.ts | NEW | +60 |

---

## Phase 22: Gateway pageContext Injection

### Goal
context-injection.ts pipeline'ina `## Page Context` section builder eklemek. Chat request body'de `pageContext` field'i kabul etmek.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Phase 21 complete | `ls packages/gateway/src/utils/host-path.ts` |
| 2 | context-injection.ts exists | `ls packages/gateway/src/services/middleware/context-injection.ts` |
| 3 | validation.ts exists | `ls packages/gateway/src/middleware/validation.ts` |

### Depends On
- Phase 21 (path mapping — optional but recommended)

### Tasks (Ordered)

#### T22.1: Add pageContext to chat validation schema
**File:** MODIFY `packages/gateway/src/middleware/validation.ts` (~1115 LOC)
**Detail:**
- Chat body schema'ya `pageContext` optional field ekle:
```typescript
pageContext: z.object({
  pageType: z.string(),
  entityId: z.string().optional(),
  path: z.string().optional(),
  contextData: z.record(z.unknown()).optional(),
  systemPromptHint: z.string().optional(),
}).optional(),
```

**Verification:**
```bash
npx tsc --noEmit -p packages/gateway/tsconfig.json
cd packages/gateway && npx vitest run src/middleware/validation.test.ts
```

#### T22.2: Create buildPageContextSection() function (TDD)
**File:** NEW `packages/gateway/src/services/middleware/page-context-section.test.ts`
**Tests:**
```typescript
test('null pageContext → empty string')
test('pageType only → "## Page Context\nViewing: workspace"')
test('pageType + path → includes working directory')
test('pageType + entityId → includes entity ID')
test('pageType + contextData → includes JSON block')
test('pageType + systemPromptHint → includes hint')
test('full pageContext → all sections present')
test('contextData truncation: >5000 chars → truncated with warning')
```

#### T22.3: Implement buildPageContextSection()
**File:** NEW `packages/gateway/src/services/middleware/page-context-section.ts`
**Detail:**
```typescript
export interface PageContext {
  pageType: string;
  entityId?: string;
  path?: string;
  contextData?: Record<string, unknown>;
  systemPromptHint?: string;
}

export function buildPageContextSection(pageContext: PageContext | undefined): string {
  if (!pageContext?.pageType) return '';

  const parts: string[] = [];
  parts.push('## Page Context');
  parts.push(`The user is currently viewing: **${pageContext.pageType}**`);

  if (pageContext.entityId) parts.push(`Entity: ${pageContext.entityId}`);
  if (pageContext.path) parts.push(`Working directory: \`${pageContext.path}\``);

  if (pageContext.contextData) {
    const json = JSON.stringify(pageContext.contextData, null, 2);
    if (json.length > 5000) {
      parts.push(`\nContext data (truncated):\n\`\`\`json\n${json.slice(0, 5000)}\n...\n\`\`\``);
    } else {
      parts.push(`\nContext data:\n\`\`\`json\n${json}\n\`\`\``);
    }
  }

  if (pageContext.systemPromptHint) parts.push(`\n${pageContext.systemPromptHint}`);

  return '\n\n' + parts.join('\n');
}
```

**Verification:**
```bash
cd packages/gateway && npx vitest run src/services/middleware/page-context-section.test.ts
```

#### T22.4: Integrate into context-injection.ts
**File:** MODIFY `packages/gateway/src/services/middleware/context-injection.ts` (~425 LOC)
**Detail:**
- Import buildPageContextSection
- `const pageContext = ctx.get<PageContext>('pageContext');`
- `const pageContextSuffix = buildPageContextSection(pageContext);`
- DYNAMIC block'a ekle (freshTimeContext'ten SONRA, toolSuggestionSuffix'ten ONCE)
- debugLog'a `page_context` section ekle

**CRITICAL:** Mevcut prompt assembly sirasini BOZMA. Anthropic cache split marker'i korunmali.

**Verification:**
```bash
npx tsc --noEmit -p packages/gateway/tsconfig.json
cd packages/gateway && npx vitest run src/services/middleware/context-injection.test.ts  # regression
```

#### T22.5: Pass pageContext from chat route to pipeline context
**File:** MODIFY `packages/gateway/src/routes/chat.ts` (~806 LOC)
**Detail:**
- Request body'den `pageContext` extract et
- `ctx.set('pageContext', body.pageContext)` — pipeline'a aktar
- Session-based: ilk mesajda gelir, sonrakilerde conversationId'den resolve edilebilir (opsiyonel — ilk iterasyonda her mesajda kabul et)

**Verification:**
```bash
npx tsc --noEmit -p packages/gateway/tsconfig.json
cd packages/gateway && npx vitest run src/routes/chat.test.ts
```

#### T22.6: Store pageContext per conversation (session-based)
**File:** MODIFY `packages/gateway/src/routes/chat.ts` veya `conversation-service.ts`
**Detail:**
- Ilk mesajda pageContext gelirse → conversation metadata olarak kaydet
- Sonraki mesajlarda pageContext gelmezse → kayitlidan yukle
- In-memory Map<conversationId, PageContext> yeterli (DB gerekmez)

**Verification:**
```bash
# Integration test: 2 mesaj gonder, 2.'de pageContext gonderme, hala inject ediliyor mu?
```

### Phase 22 Verification Protocol
```bash
# 1. Unit tests
cd packages/gateway && npx vitest run src/services/middleware/page-context-section.test.ts  # ALL PASS

# 2. Integration
cd packages/gateway && npx vitest run src/services/middleware/context-injection.test.ts  # ALL PASS

# 3. Chat route
cd packages/gateway && npx vitest run src/routes/chat.test.ts  # ALL PASS

# 4. Validation
cd packages/gateway && npx vitest run src/middleware/validation.test.ts  # ALL PASS

# 5. TypeScript
npx tsc --noEmit -p packages/gateway/tsconfig.json  # 0 errors

# 6. Full regression
cd packages/gateway && npx vitest run  # 16,294+ PASS

# 7. Debug endpoint check (manual — container'da)
# POST /api/v1/chat with pageContext → GET /api/v1/debug → system_prompt sections include "page_context"
```

### Files Modified
| File | Action | LOC Delta |
|------|--------|-----------|
| packages/gateway/src/services/middleware/page-context-section.ts | NEW | +40 |
| packages/gateway/src/services/middleware/page-context-section.test.ts | NEW | +50 |
| packages/gateway/src/services/middleware/context-injection.ts | MODIFY | +15 |
| packages/gateway/src/routes/chat.ts | MODIFY | +20 |
| packages/gateway/src/middleware/validation.ts | MODIFY | +10 |

---

## Phase 23: Gateway X-Project-Dir Forwarding

### Goal
pageContext.path varsa → toHostPath() → X-Project-Dir header olarak bridge request'e ekleme.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Phase 21 host-path.ts exists | `ls packages/gateway/src/utils/host-path.ts` |
| 2 | Phase 22 pageContext in pipeline | grep pageContext in chat.ts |
| 3 | agent-cache.ts X-Runtime pattern | `grep "X-Runtime" packages/gateway/src/routes/agent-cache.ts` |

### Depends On
- Phase 21 (toHostPath utility)
- Phase 22 (pageContext available in pipeline)

### Tasks (Ordered)

#### T23.1: Add X-Project-Dir to bridge header injection (TDD)
**File:** MODIFY `packages/gateway/src/routes/agent-cache.ts` (~347 LOC)
**Detail:**
- Mevcut X-Runtime injection pattern'ini KOPYALA:
```typescript
// Existing (line ~245):
if (localProv.name.startsWith('bridge-')) {
  headers['X-Runtime'] = localProv.name.replace('bridge-', '');
}

// NEW — HEMEN ALTINA:
// X-Project-Dir: forward host path to bridge for CWD routing
const pageContext = options?.pageContext;  // passed from chat route
if (pageContext?.path && localProv.name.startsWith('bridge-')) {
  const hostPath = toHostPath(pageContext.path);
  if (hostPath) {
    headers['X-Project-Dir'] = hostPath;
  }
}
```

**DIKKAT:** `loadProviderConfig()` function signature'ina `options?: { pageContext?: PageContext }` eklenmeli. Veya header'i chat route'da ayri inject et.

**Alternative (daha temiz):** chat.ts'de dogrudan provider SDK headers'a ekle:
```typescript
// chat.ts — provider config olusturulurken:
if (isBridgeProvider && pageContext?.path) {
  const hostPath = toHostPath(pageContext.path);
  if (hostPath) providerConfig.headers['X-Project-Dir'] = hostPath;
}
```

#### T23.2: Test X-Project-Dir injection
**File:** MODIFY `packages/gateway/src/routes/agent-cache.test.ts` veya yeni test
**Tests:**
1. Bridge provider + pageContext.path → X-Project-Dir header mevcut
2. Bridge provider + no path → X-Project-Dir header YOK
3. Non-bridge provider + pageContext.path → X-Project-Dir header YOK
4. Path mapping: /host-home/projects/x → /home/ayaz/projects/x
5. HOST_FS not configured → X-Project-Dir header YOK (graceful)

#### T23.3: Verify bridge receives header
**Manual test:**
```bash
# Gateway container'dan bridge'e request → bridge log'da X-Project-Dir gorunuyor mu?
# curl ile direkt test:
curl -s http://localhost:8080/api/v1/chat -X POST \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: <token>" \
  -d '{"message":"test","pageContext":{"pageType":"workspace","path":"/host-home/projects/ownpilot"}}'
# → Bridge log: X-Project-Dir: /home/ayaz/projects/ownpilot
```

### Phase 23 Verification Protocol
```bash
# 1. Unit tests
cd packages/gateway && npx vitest run src/routes/agent-cache.test.ts  # ALL PASS

# 2. TypeScript
npx tsc --noEmit -p packages/gateway/tsconfig.json  # 0 errors

# 3. Full regression
cd packages/gateway && npx vitest run  # 16,294+ PASS

# 4. Bridge integration (manual)
# Send chat with pageContext.path → bridge log shows X-Project-Dir
# Send chat without pageContext.path → bridge log NO X-Project-Dir
```

### Files Modified
| File | Action | LOC Delta |
|------|--------|-----------|
| packages/gateway/src/routes/agent-cache.ts | MODIFY | +15 |
| packages/gateway/src/routes/chat.ts | MODIFY | +5 |
| Test files | MODIFY/NEW | +40 |

---

# WAVE 2 → WAVE 3 GATE

### Wave 2 Completion Checklist
```bash
# Phase 21
cd packages/gateway && npx vitest run src/utils/host-path.test.ts  # ALL PASS

# Phase 22
cd packages/gateway && npx vitest run src/services/middleware/page-context-section.test.ts  # ALL PASS
cd packages/gateway && npx vitest run src/services/middleware/context-injection.test.ts  # ALL PASS

# Phase 23
cd packages/gateway && npx vitest run src/routes/agent-cache.test.ts  # ALL PASS

# FULL gateway regression
cd packages/gateway && npx vitest run  # 16,294+ PASS
npx tsc --noEmit -p packages/gateway/tsconfig.json  # 0 errors
```

---

# WAVE 3: Integration

---

## Phase 24: Hybrid Provider Routing

### Goal
Path olan sayfalarda OTOMATIK bridge provider secimi, path olmayanlarda direkt LLM API. Kullanici manual override yapabilir.

### Pre-Conditions
| # | Check | How |
|---|-------|-----|
| 1 | Phase 18 useSidebarChat | `ls packages/ui/src/hooks/useSidebarChat.ts` |
| 2 | Phase 19 registry preferBridge | `grep "preferBridge" packages/ui/src/constants/page-copilot-registry.ts` |
| 3 | Phase 22-23 gateway pipeline ready | gateway tests PASS |

### Depends On
- Phase 18 (SidebarChatStore — provider state)
- Phase 19 (Registry — preferBridge flag)
- Phase 22-23 (Gateway — pageContext + X-Project-Dir)

### Tasks

#### T24.1: Auto-select provider in useSidebarChat based on registry
**File:** MODIFY `packages/ui/src/hooks/useSidebarChat.ts`
**Detail:**
- usePageCopilotContext() → config.preferBridge
- preferBridge=true → provider = first bridge provider from settings
- preferBridge=false → provider = user's default provider
- User can override via setProvider()

#### T24.2: LLM API path — copilot-style SSE endpoint
**Decision needed:** Sidebar chat no-path pages icin:
- Option A: Mevcut /api/v1/chat endpoint (same pipeline, bridge fallback'siz)
- Option B: Yeni /api/v1/sidebar-chat endpoint (copilot pattern, lighter)
- **Recommended: Option A** — Mevcut pipeline yeterli, pageContext injection zaten calisiyor

#### T24.3: Provider selector UI in CompactChat
**File:** MODIFY `packages/ui/src/components/StatsPanel.tsx`
**Detail:**
- Kucuk dropdown: provider secimi (auto-detected but overrideable)
- "🔗 Bridge (files)" vs "🤖 API (fast)" label'lari

### Phase 24 Verification Protocol
```bash
# 1. TypeScript
npx tsc --noEmit -p packages/ui/tsconfig.json

# 2. Preview test
# /workspaces → sidebar chat → provider = bridge (auto)
# /workflows → sidebar chat → provider = LLM API (auto)
# Manual override: dropdown'dan degistir → calisiyor
```

---

## Phase 25: Per-Page Copilot Prompts

### Goal
Her sayfa turu icin domain-specific system prompt section'lari.

### Depends On
- Phase 24 (hybrid routing calisiyor)

### Tasks

#### T25.1: Workflow copilot prompt — REUSE existing
**Detail:** `workflow-copilot-prompt.ts` zaten 657 LOC, 24 node type dokumante. Bu prompt'u pageContext'e göre inject et (workflow sayfasinda).

#### T25.2: Agent configuration prompt (NEW)
**File:** NEW `packages/gateway/src/routes/page-prompts/agent-copilot-prompt.ts`
**Detail:** ~100 LOC — Agent config best practices, system prompt optimization, tool selection

#### T25.3: Tool/Extension prompt (NEW)
**File:** NEW `packages/gateway/src/routes/page-prompts/tool-copilot-prompt.ts`
**Detail:** ~80 LOC — Code generation patterns, schema, test patterns

#### T25.4: MCP server prompt (NEW)
**File:** NEW `packages/gateway/src/routes/page-prompts/mcp-copilot-prompt.ts`
**Detail:** ~60 LOC — Connection diagnostics, tool discovery

#### T25.5: Prompt router — pageType → prompt builder mapping
**File:** NEW `packages/gateway/src/routes/page-prompts/index.ts`
**Detail:**
```typescript
export function getPageCopilotPrompt(pageType: string, contextData?: unknown): string {
  switch (pageType) {
    case 'workflow': return buildWorkflowCopilotSection(contextData);
    case 'agent': return buildAgentCopilotSection(contextData);
    case 'tool': case 'custom-tool': return buildToolCopilotSection(contextData);
    case 'mcp-server': return buildMcpCopilotSection(contextData);
    default: return '';
  }
}
```

#### T25.6: Integrate into buildPageContextSection()
**File:** MODIFY `page-context-section.ts`
**Detail:** pageType'a gore ek prompt section ekle

### Phase 25 Verification
```bash
# Her prompt icin pratik test:
# 1. Workflow sayfasinda: "HTTP node ekle" → dogru JSON ciktisi
# 2. Agent sayfasinda: "system prompt'u gelistir" → mantikli oneriler
# 3. Tool sayfasinda: "bu tool'u nasil kullanirim?" → dogru schema
# 4. MCP sayfasinda: "neden baglanamiyor?" → diagnostik adimlar
```

---

## Phase 26: UI Polish

### Goal
Sidebar chat UX iyilestirmeleri.

### Depends On
- Phase 18, 19, 24

### Tasks

#### T26.1: Registry-based suggestions in CompactChat
#### T26.2: Per-context action buttons (Apply, Create, Run)
#### T26.3: Context banner improvement (icon + name + path)
#### T26.4: Streaming cancel button (AbortController pattern from Copilot)
#### T26.5: MarkdownContent rendering (replace plain text)
#### T26.6: Provider selector styling

### Phase 26 Verification
```bash
# Preview check — her sayfa icin:
# 1. Dogru suggestions gorunuyor
# 2. Context banner dogru
# 3. Mesaj gonderince markdown render
# 4. Cancel butonu streaming sirasinda gorunuyor
# 5. Provider selector calisiyor
```

---

# WAVE 3 → WAVE 4 GATE

```bash
# Full UI
npx tsc --noEmit -p packages/ui/tsconfig.json       # 0 errors
cd packages/ui && npx vitest run                      # ALL PASS

# Full Gateway
npx tsc --noEmit -p packages/gateway/tsconfig.json   # 0 errors
cd packages/gateway && npx vitest run                 # ALL PASS

# Preview: workspace chat → bridge spawn → dosya listesi yaniti
# Preview: workflow chat → LLM API → workflow JSON yaniti
```

---

# WAVE 4: Quality

## Phase 27-29 plans are similar in structure — abbreviated here.

### Phase 27: Bridge Security
- T27.1: Add realpathSync() to validateProjectDir (TDD)
- T27.2: Add validateProjectDir() to additionalDirs (TDD)
- T27.3: Narrow DEFAULT_PROJECT_DIR
- Verification: symlink test FAIL, additionalDirs blocked, existing tests PASS

### Phase 28: E2E Integration Tests
- T28.1: Workspace flow E2E (Playwright)
- T28.2: Workflow flow E2E
- T28.3: Context switch E2E
- T28.4: Provider routing E2E
- Verification: `npx playwright test e2e/contextual-chat-v2.spec.ts`

### Phase 29: Docker Build + Deploy
- T29.1: Build image with bind mount config
- T29.2: Deploy + verify healthy
- T29.3: Smoke test workspace + workflow chat
- T29.4: Update ROADMAP progress
- Verification: container healthy + chat functional

---

# CROSS-PHASE DEPENDENCY GRAPH

```
Phase 18 ─────────────────────────────────┐
  (SidebarChatStore)                      │
                                          ├──▶ Phase 24 ──▶ Phase 25 ──▶ Phase 26
Phase 19 ─────────────────────────────────┤    (Hybrid)     (Prompts)     (UI Polish)
  (Registry)                              │                                    │
                                          │                                    │
Phase 20 ──▶ Phase 21 ──▶ Phase 22 ──▶ Phase 23                              │
  (Docker)    (PathMap)    (Inject)     (Forward)                              │
                                                                               │
Phase 27 (Bridge Security — PARALEL)                                           │
                                                                               ▼
                                                                         Phase 28 ──▶ Phase 29
                                                                         (E2E Tests)   (Deploy)
```

---

# ESTIMATED TIMELINE

| Wave | Phases | Parallelism | Effort |
|------|--------|-------------|--------|
| Wave 1 | 18, 19, 20 | 3 parallel | ~12h total (4h each) |
| Gate 1 | Verification | Sequential | ~1h |
| Wave 2 | 21, 22, 23 | Sequential | ~10h total |
| Gate 2 | Verification | Sequential | ~1h |
| Wave 3 | 24, 25, 26 | Partial parallel | ~15h total |
| Gate 3 | Verification | Sequential | ~1h |
| Wave 4 | 27, 28, 29 | Partial parallel | ~8h total |
| **TOTAL** | | | **~48h** |
