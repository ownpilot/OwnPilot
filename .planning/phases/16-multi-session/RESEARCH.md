# Phase 16 — Multi-Session Architecture Research

**Date:** 2026-04-05
**Branch:** feature/v2-contextual-chat
**Goal:** Determine how to give StatsPanel CompactChat an independent conversation from ChatPage/MiniChat

---

## 1. Current Architecture

### Provider Tree (main.tsx)

```
StrictMode > ErrorBoundary > ThemeProvider > BrowserRouter > AuthProvider
  > WebSocketProvider > ChatProvider > DialogProvider > ToastProvider > App
```

**ChatProvider** wraps the entire app as a single React Context. Every component
that calls `useChatStore()` receives the **same** instance — same messages,
sessionId, provider, model, streaming state, etc.

### Singleton State (useChatStore.tsx)

`ChatProvider` holds ~20 pieces of state via `useState`:

| State | Shared Impact |
|-------|---------------|
| `messages` | All 3 UIs show identical message list |
| `sessionId` / `sessionIdRef` | All 3 UIs share one backend conversation |
| `isLoading` | One send disables input in all 3 UIs |
| `streamingContent` | Streaming text appears in all 3 UIs |
| `provider` / `model` | All 3 UIs use same provider/model |
| `contextPath` | Set by CompactChat, affects ChatPage too |
| `suggestions` | Follow-up chips appear in all 3 UIs |
| `pendingApproval` | Execution approval dialog shared |
| `sessionInfo` | Token/context metrics shared |
| `thinkingConfig` | Thinking mode shared |
| `agentId` / `workspaceId` | Agent/workspace selection shared |

### Consumer Analysis

#### ChatPage (src/pages/ChatPage.tsx)
- **Primary** chat consumer — full-featured with provider selector, agent mode, channel mode, workspace selector, thinking toggle, execution security panel, context bar, setup wizard
- Destructures nearly everything from `useChatStore()`
- Sets provider/model on mount from settings/URL params
- Loads past conversations via `loadConversation()`
- Calls `chatApi.resetContext()` on "New Chat"

#### MiniChat (src/components/MiniChat.tsx)
- Floating chat bubble (bottom-right), hidden on ChatPage (`/`) route and mobile
- **Deliberately shares** state with ChatPage — expanding navigates to `/` and shows same conversation
- Uses: `messages, isLoading, streamingContent, suggestions, sessionInfo, provider, model, sendMessage, cancelRequest, clearMessages, clearSuggestions`
- Has "Expand" button that navigates to ChatPage — seamless handoff is the design intent

#### CompactChat in StatsPanel (src/components/StatsPanel.tsx)
- Embedded in right sidebar "Chat" tab
- Uses: `messages, isLoading, streamingContent, sendMessage, setContextPath`
- **Sets `contextPath`** from `usePageContext()` — this injects `X-Project-Dir` header
- When `contextPath` changes, `setContextPath` **clears all messages and resets session** (line 131-146 of useChatStore.tsx)

### The Problem

1. **CompactChat typing = ChatPage typing.** Sending a message in StatsPanel appears in ChatPage and vice versa.
2. **Context collision.** CompactChat sets `contextPath` for project-aware chat, but this also affects ChatPage/MiniChat conversations.
3. **Loading lock.** If CompactChat is streaming, ChatPage input is disabled (and vice versa).
4. **StatsPanel is contextual** (project-aware coding assistant), while ChatPage is **general-purpose**. They serve different use cases.

---

## 2. Alternatives

### Alternative A: Keep Single Store (Status Quo)

**Description:** StatsPanel Chat = same conversation as ChatPage/MiniChat. All 3 UIs are views into one conversation.

**Pros:**
- Zero implementation work
- No state management complexity
- Message continuity — start in StatsPanel, continue in ChatPage
- Single session = less backend resource usage

**Cons:**
- Context path collision (StatsPanel sets X-Project-Dir, ChatPage doesn't want it)
- Loading lock across UIs
- Can't have a coding question in StatsPanel while a general conversation runs in ChatPage
- `setContextPath` clears all messages — navigating between pages with different contexts loses ChatPage conversation

**Breaking Changes:** None (current behavior)

**Complexity:** 0/10

**Verdict:** Acceptable only if StatsPanel Chat is just a shortcut to ChatPage, not an independent assistant.

---

### Alternative B: createChatStore() Factory — Per-Component Instances

**Description:** Convert `ChatProvider` into a factory that creates independent store instances. Each consumer creates its own store.

```tsx
// Factory pattern
function createChatStore() {
  return { messages: [], sessionId: null, sendMessage: ..., ... };
}

// Usage
const mainStore = createChatStore();   // ChatPage + MiniChat
const sideStore = createChatStore();   // StatsPanel CompactChat
```

**Implementation:**
1. Extract all useState + useCallback logic into a `createChatStore()` function
2. Create two separate Context providers: `MainChatProvider` and `SideChatProvider`
3. Each has its own `messages[]`, `sessionId`, `AbortController`, etc.
4. ChatPage and MiniChat use `useMainChatStore()`
5. CompactChat uses `useSideChatStore()`

**Pros:**
- Full isolation — completely independent conversations
- Each store manages its own provider/model/agent/workspace
- No loading lock across UIs
- Clean separation of concerns

**Cons:**
- **Breaks ChatPage ↔ MiniChat sharing** unless they explicitly share one instance
- Two React Contexts to maintain
- Doubled API state (two sessions, two SSE streams, two AbortControllers)
- Provider/model selection needs duplication or a shared config layer
- ~200 lines of refactoring in useChatStore + main.tsx + all consumers
- Two concurrent backend sessions consume more memory/tokens

**Breaking Changes:**
- Import paths change for all consumers
- MiniChat must be wrapped in same provider as ChatPage
- CompactChat import changes

**Complexity:** 7/10

---

### Alternative C: Hybrid — Same Store, Separate ConversationId Namespaces

**Description:** Single store with a "namespace" concept. Messages are keyed by a namespace ID. ChatPage/MiniChat use `"main"` namespace, CompactChat uses `"sidebar-{contextPath}"` namespace.

```tsx
// Inside ChatProvider
const [conversations, setConversations] = useState<Map<string, ConversationState>>();
const [activeNamespace, setActiveNamespace] = useState('main');
```

**Implementation:**
1. Replace flat state with `Map<namespace, { messages, sessionId, ... }>`
2. `useChatStore(namespace)` returns state for that namespace
3. ChatPage/MiniChat call `useChatStore('main')`
4. CompactChat calls `useChatStore('sidebar')`
5. Provider/model remain shared (global config)
6. `sendMessage` routes to the correct namespace's session

**Pros:**
- Single provider, no duplication of provider tree
- Provider/model selection shared globally
- Namespace isolation for messages, sessionId, loading state
- Can switch namespaces without losing state
- Elegant — one store, multiple conversations

**Cons:**
- Significant refactor of ChatProvider internals (~300 lines)
- Every useState needs to become namespace-aware
- Refs (sessionIdRef, abortControllerRef) need per-namespace management
- Complex mental model — "which namespace am I in?"
- Race conditions if two namespaces send simultaneously (single AbortController won't work)
- Suggestions, extractedMemories, pendingApproval — do these namespace too?
- Overkill for the 2-conversation use case

**Breaking Changes:**
- `useChatStore()` signature changes (optional namespace param)
- All consumers need review for namespace awareness
- Tests need updating

**Complexity:** 8/10

---

### Alternative D: Dedicated SidebarChatStore — Separate Store for StatsPanel Only

**Description:** Create a small, focused `useSidebarChat` hook with its own state, specifically for the StatsPanel CompactChat. ChatPage and MiniChat continue using the existing `useChatStore` unchanged.

```tsx
// New file: hooks/useSidebarChat.tsx
// Minimal store — messages, isLoading, streamingContent, sendMessage
// Uses same provider/model from useChatStore (read-only) or its own defaults
// Has its own sessionId, AbortController, contextPath
```

**Implementation:**
1. Create `useSidebarChat.tsx` — a lightweight standalone hook (~150 lines)
2. It manages its own: `messages`, `sessionId`, `isLoading`, `streamingContent`, `error`
3. It reads provider/model from `useChatStore` (or has its own defaults)
4. It has its own `sendMessage()` that calls `/api/v1/chat` with its own `conversationId`
5. It owns `contextPath` — no longer in useChatStore
6. Wrap StatsPanel in `SidebarChatProvider` in main.tsx (or just Layout.tsx)
7. CompactChat switches from `useChatStore()` to `useSidebarChat()`
8. Remove `contextPath` / `setContextPath` from useChatStore (cleanup)

**Pros:**
- **Minimal blast radius** — useChatStore unchanged, ChatPage/MiniChat unchanged
- Clear ownership: sidebar chat = sidebar store, main chat = main store
- No namespace complexity
- Independent `sessionId` — sidebar has its own backend conversation
- Independent `isLoading` — no loading lock
- `contextPath` lives only where it's needed (sidebar)
- ~150 lines new code, ~20 lines removed from useChatStore
- Easy to test independently
- Provider/model can be inherited or independently configured later

**Cons:**
- Some code duplication (sendMessage SSE logic exists in two places)
  - Mitigation: Extract shared SSE parsing into a utility (optional, ~50 lines)
- Two concurrent backend sessions
- No message continuity between sidebar and main chat
- If user wants to "expand" sidebar chat to full page, needs explicit export/import

**Breaking Changes:**
- CompactChat import changes (useSidebarChat instead of useChatStore)
- `contextPath`/`setContextPath` removed from useChatStore interface
  - Only CompactChat used these — no other consumer affected
- StatsPanel needs SidebarChatProvider wrapper

**Complexity:** 4/10

---

## 3. Decision Matrix

| Criterion | Weight | A (Status Quo) | B (Factory) | C (Namespaces) | D (Dedicated) |
|-----------|--------|----------------|-------------|-----------------|----------------|
| Solves the problem | 30% | 0 | 10 | 10 | 10 |
| Implementation complexity | 25% | 10 | 3 | 2 | 8 |
| Breaking changes | 20% | 10 | 3 | 2 | 8 |
| Maintainability | 15% | 8 | 5 | 4 | 9 |
| Future extensibility | 10% | 2 | 9 | 10 | 6 |
| **Weighted Score** | | **5.6** | **5.9** | **5.4** | **8.6** |

---

## 4. Recommendation: Alternative D (Dedicated SidebarChatStore)

**Why:**

1. **Minimal blast radius.** ChatPage, MiniChat, useChatStore — all unchanged. Only CompactChat in StatsPanel changes its import.

2. **Clean ownership.** `contextPath` belongs to the sidebar (it's set from `usePageContext` which is route-based). Moving it out of the global chat store eliminates the context collision problem.

3. **Right-sized solution.** We need exactly 2 independent conversations. A factory (B) or namespace system (C) is overengineering for this.

4. **Independent loading state.** Sending a message in the sidebar doesn't block the main chat input. This is the #1 UX improvement.

5. **Low risk.** ~150 lines of new code in a self-contained file. If something breaks, it only affects the sidebar chat tab.

6. **SSE duplication is manageable.** The `sendMessage` SSE parsing logic (~100 lines) could optionally be extracted into a shared `parseChatStream()` utility, but even without extraction, maintaining two copies of well-understood code is acceptable.

### Implementation Outline

```
1. Create packages/ui/src/hooks/useSidebarChat.tsx
   - SidebarChatContext + SidebarChatProvider
   - Own state: messages, sessionId, isLoading, streamingContent, error, contextPath
   - Reads provider/model from useChatStore (shared config)
   - Own sendMessage() with SSE streaming
   - Own clearMessages(), cancelRequest()

2. Update packages/ui/src/main.tsx (or Layout.tsx)
   - Add <SidebarChatProvider> wrapping <App> (inside ChatProvider)

3. Update packages/ui/src/components/StatsPanel.tsx
   - CompactChat: import useSidebarChat instead of useChatStore
   - Remove setContextPath dependency from useChatStore
   - ContextBanner stays, reads from useSidebarChat's contextPath

4. Clean up packages/ui/src/hooks/useChatStore.tsx
   - Remove contextPath, setContextPath, setContextPathState
   - Remove contextPath from ChatState interface and ChatStore interface
   - Remove contextPath from sendMessage's dependency array
   - Remove X-Project-Dir header logic (moves to useSidebarChat)

5. Tests
   - New: useSidebarChat.test.tsx (unit tests for the hook)
   - Update: StatsPanel tests (if any reference useChatStore mock)
   - Verify: ChatPage tests unchanged
```

**Estimated scope:** ~200 lines new, ~30 lines removed, 3 files modified + 1 new file.
