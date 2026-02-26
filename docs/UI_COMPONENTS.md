# UI Components Reference

Comprehensive documentation of the OwnPilot frontend -- a React 19 single-page application providing the user interface for the privacy-first AI assistant platform.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Provider Hierarchy](#provider-hierarchy)
4. [Routing Structure](#routing-structure)
5. [Type System](#type-system)
6. [Hooks](#hooks)
   - [useWebSocket](#usewebsocket)
   - [useTheme](#usetheme)
   - [useChat](#usechat)
   - [useChatStore](#usechatstore)
7. [Components](#components)
   - [Layout](#layout)
   - [ChatInput](#chatinput)
   - [MessageList](#messagelist)
   - [CodeBlock](#codeblock)
   - [ToolExecutionDisplay](#toolexecutiondisplay)
   - [ToolPicker](#toolpicker)
   - [TraceDisplay](#tracedisplay)
   - [StatsPanel](#statspanel)
   - [TimelineView](#timelineview)
   - [DebugInfoModal](#debuginfomodal)
   - [ErrorBoundary](#errorboundary)
   - [ConfirmDialog](#confirmdialog)
   - [DynamicConfigForm](#dynamicconfigform)
   - [FileBrowser](#filebrowser)
   - [WorkspaceSelector](#workspaceselector)
   - [AIBriefingCard](#aibriefingcard)
   - [AIModelsTab](#aimodelstab)
   - [IntegrationsTab](#integrationstab)
   - [MediaSettingsTab](#mediasettingstab)
   - [ProvidersTab](#providerstab)
   - [icons](#icons)
8. [Pages](#pages)
   - [ChatPage](#chatpage)
   - [DashboardPage](#dashboardpage)
   - [Data Pages](#data-pages)
   - [AI Pages](#ai-pages)
   - [System Pages](#system-pages)
   - [Settings Pages](#settings-pages)
   - [Additional Pages](#additional-pages)
9. [State Management](#state-management)
10. [Real-Time Communication](#real-time-communication)
11. [Streaming Architecture](#streaming-architecture)
12. [Theming](#theming)
13. [Component Hierarchy Diagram](#component-hierarchy-diagram)

---

## Tech Stack

| Technology           | Version | Purpose                            |
| -------------------- | ------- | ---------------------------------- |
| React                | 19      | UI framework                       |
| React DOM            | 19      | DOM rendering                      |
| React Router DOM     | 7       | Client-side routing                |
| Vite                 | 7       | Build tool and dev server          |
| Tailwind CSS         | 4       | Utility-first styling              |
| prism-react-renderer | latest  | Syntax highlighting in code blocks |
| TypeScript           | 5.7     | Static type checking               |

---

## Architecture Overview

```
+--------------------------------------------------------------+
|  StrictMode                                                   |
|  +----------------------------------------------------------+|
|  | ErrorBoundary                                             ||
|  | +--------------------------------------------------------+|
|  | | ThemeProvider                                           ||
|  | | +------------------------------------------------------+|
|  | | | BrowserRouter                                        ||
|  | | | +----------------------------------------------------+|
|  | | | | WebSocketProvider                                   ||
|  | | | | +--------------------------------------------------+|
|  | | | | | ChatProvider                                     ||
|  | | | | | +------------------------------------------------+|
|  | | | | | | DialogProvider                                 ||
|  | | | | | | +----------------------------------------------+|
|  | | | | | | | App (Routes)                                 ||
|  | | | | | | | +--------------------------------------------+|
|  | | | | | | | | Layout                                    ||
|  | | | | | | | | +------ Sidebar (nav)                     ||
|  | | | | | | | | +------ <Outlet /> (page content)         ||
|  | | | | | | | | +------ StatsPanel (right sidebar)        ||
+--------------------------------------------------------------+
```

The application is wrapped in a strict nesting of providers. The order matters because inner providers may depend on outer ones. The `ChatProvider` sits inside `WebSocketProvider` so it can potentially leverage the WebSocket connection. The `DialogProvider` wraps the App so that any component in the tree -- pages or components -- can call `useDialog()` to show confirmation and alert dialogs.

### Entry Point

**File:** `packages/ui/src/main.tsx`

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <WebSocketProvider>
            <ChatProvider>
              <DialogProvider>
                <App />
              </DialogProvider>
            </ChatProvider>
          </WebSocketProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
```

---

## Provider Hierarchy

The application uses six layers of providers, each supplying a distinct concern:

| Layer | Provider            | Context Hook                           | Purpose                                                  |
| ----- | ------------------- | -------------------------------------- | -------------------------------------------------------- |
| 1     | `ErrorBoundary`     | n/a (class component)                  | Catches unhandled React errors globally                  |
| 2     | `ThemeProvider`     | `useTheme()`                           | Dark/light/system theme management                       |
| 3     | `BrowserRouter`     | `useNavigate()`, `useLocation()`, etc. | Client-side routing                                      |
| 4     | `WebSocketProvider` | `useGateway()`                         | Shared WebSocket connection to gateway                   |
| 5     | `ChatProvider`      | `useChatStore()`                       | Global chat state that persists across navigation        |
| 6     | `DialogProvider`    | `useDialog()`                          | Async confirm/alert dialogs replacing `window.confirm()` |

---

## Routing Structure

**File:** `packages/ui/src/App.tsx`

All routes are nested under a single `<Layout />` component that provides the sidebar navigation, main content area, and stats panel. The root route (`/`) renders the `ChatPage` as the index route. Unknown routes are redirected to `/` via a catch-all `<Navigate to="/" replace />`.

### Route Map

| Path                      | Page Component      | Navigation Group   |
| ------------------------- | ------------------- | ------------------ |
| `/`                       | `ChatPage`          | Main               |
| `/dashboard`              | `DashboardPage`     | Main               |
| `/inbox`                  | `InboxPage`         | Main               |
| `/tasks`                  | `TasksPage`         | Data               |
| `/notes`                  | `NotesPage`         | Data               |
| `/calendar`               | `CalendarPage`      | Data               |
| `/contacts`               | `ContactsPage`      | Data               |
| `/bookmarks`              | `BookmarksPage`     | Data               |
| `/expenses`               | `ExpensesPage`      | Data               |
| `/custom-data`            | `CustomDataPage`    | Data               |
| `/data-browser`           | `DataBrowserPage`   | Data               |
| `/memories`               | `MemoriesPage`      | AI                 |
| `/goals`                  | `GoalsPage`         | AI                 |
| `/triggers`               | `TriggersPage`      | AI                 |
| `/plans`                  | `PlansPage`         | AI                 |
| `/autonomy`               | `AutonomyPage`      | AI                 |
| `/agents`                 | `AgentsPage`        | System             |
| `/tools`                  | `ToolsPage`         | System             |
| `/custom-tools`           | `CustomToolsPage`   | System             |
| `/plugins`                | `PluginsPage`       | System             |
| `/workspaces`             | `WorkspacesPage`    | System             |
| `/models`                 | `ModelsPage`        | System             |
| `/costs`                  | `CostsPage`         | System             |
| `/logs`                   | `LogsPage`          | System             |
| `/settings`               | `SettingsPage`      | Settings           |
| `/settings/config-center` | `ConfigCenterPage`  | Settings           |
| `/settings/api-keys`      | `ApiKeysPage`       | Settings           |
| `/settings/providers`     | `ProvidersPage`     | Settings           |
| `/settings/ai-models`     | `AIModelsPage`      | Settings           |
| `/settings/integrations`  | `IntegrationsPage`  | Settings           |
| `/settings/media`         | `MediaSettingsPage` | Settings           |
| `/settings/system`        | `SystemPage`        | Settings           |
| `/profile`                | `ProfilePage`       | Bottom             |
| `*`                       | `Navigate to="/"`   | Catch-all redirect |

---

## Type System

**File:** `packages/ui/src/types/index.ts`

The core types shared across the application:

### `Message`

Represents a single chat message (user, assistant, or system).

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string; // ISO 8601
  toolCalls?: ToolCall[]; // Tools invoked during this response
  provider?: string; // AI provider used (e.g., "openai")
  model?: string; // Model used (e.g., "gpt-4o")
  trace?: TraceInfo; // Execution trace for debugging
  isError?: boolean; // Marks error messages for retry logic
}
```

### `ToolCall`

A single tool invocation within a message.

```typescript
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}
```

### `TraceInfo`

Comprehensive execution trace data attached to assistant messages. Captures everything that happened during request processing.

```typescript
interface TraceInfo {
  duration: number; // Total processing time in ms
  toolCalls: Array<{
    // Detailed tool call records
    name: string;
    success: boolean;
    duration?: number;
    error?: string;
    arguments?: Record<string, unknown>;
    result?: string;
  }>;
  modelCalls: Array<{
    // LLM API call records
    provider?: string;
    model?: string;
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    duration?: number;
  }>;
  autonomyChecks: Array<{
    // Autonomy gate results
    tool: string;
    approved: boolean;
    reason?: string;
  }>;
  dbOperations: { reads: number; writes: number };
  memoryOps: { adds: number; recalls: number };
  triggersFired: string[];
  errors: string[];
  events: Array<{
    // Chronological event log
    type: string;
    name: string;
    duration?: number;
    success?: boolean;
  }>;
  request?: {
    // Outbound LLM request info
    provider: string;
    model: string;
    endpoint: string;
    messageCount: number;
    tools?: string[];
  };
  response?: {
    // LLM response metadata
    status: 'success' | 'error';
    contentLength?: number;
    finishReason?: string;
    rawResponse?: unknown;
  };
  retries?: Array<{
    // Retry attempts (if any)
    attempt: number;
    error: string;
    delayMs: number;
  }>;
}
```

### `ApiResponse<T>`

Standardized API response envelope used across all REST endpoints.

```typescript
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { requestId: string; timestamp: string; processingTime?: number };
}
```

### `ChatResponse`

The data payload returned from `POST /api/v1/chat`.

```typescript
interface ChatResponse {
  id?: string;
  message?: string;
  response: string;
  conversationId: string;
  toolCalls?: ToolCall[];
  model?: string;
  trace?: TraceInfo;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string;
}
```

### `StreamChunk`

Individual chunk in a streamed response.

```typescript
interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}
```

---

## Hooks

### useWebSocket

**File:** `packages/ui/src/hooks/useWebSocket.tsx`

Manages the WebSocket connection to the OwnPilot gateway for real-time communication. Provides both the raw hook and a React context-based provider for shared access.

#### Exports

| Export                   | Type      | Description                                             |
| ------------------------ | --------- | ------------------------------------------------------- |
| `useWebSocket(options?)` | Hook      | Creates a new WebSocket connection (internal use)       |
| `WebSocketProvider`      | Component | Context provider sharing one connection across the tree |
| `useGateway()`           | Hook      | Accesses the shared WebSocket connection from context   |

#### `UseWebSocketOptions`

```typescript
interface UseWebSocketOptions {
  url?: string; // Default: auto-detected from current host
  reconnect?: boolean; // Default: true
  reconnectDelay?: number; // Default: 3000ms
  maxReconnectAttempts?: number; // Default: 5
}
```

#### `UseWebSocketResult`

```typescript
interface UseWebSocketResult {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  sessionId: string | null; // Set from connection:ready event
  send: <T>(type: string, payload: T) => void; // Send typed message
  subscribe: <T>(event: string, handler: (data: T) => void) => () => void;
  connect: () => void;
  disconnect: () => void;
}
```

#### Behavior

- Auto-connects on mount via `useEffect`.
- Reconnects automatically on close (up to `maxReconnectAttempts`).
- Supports wildcard subscriptions via `subscribe('*', handler)`.
- URL auto-detects protocol (`ws:` / `wss:`) and host from `window.location`.
- Messages are JSON-encoded with `{ type, payload, timestamp }` structure.
- On receiving `connection:ready`, extracts `sessionId` from payload.

---

### useTheme

**File:** `packages/ui/src/hooks/useTheme.tsx`

Manages dark/light/system theme preferences with persistence and system theme detection.

#### Exports

| Export          | Type      | Description                        |
| --------------- | --------- | ---------------------------------- |
| `ThemeProvider` | Component | Wraps app to provide theme context |
| `useTheme()`    | Hook      | Access and control theme           |

#### Interface

```typescript
type Theme = 'system' | 'light' | 'dark';

interface ThemeContextType {
  theme: Theme; // User's selected preference
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark'; // Actual applied theme after resolving "system"
}
```

#### Behavior

- Persists preference in `localStorage` under key `"theme"`.
- Adds/removes `dark` class on `document.documentElement` for Tailwind dark mode.
- When set to `"system"`, listens to `prefers-color-scheme` media query changes.
- Resolves the theme on mount so there is no flash of incorrect theme.

---

### useChat

**File:** `packages/ui/src/hooks/useChat.ts`

A local (non-context) hook for managing chat state within a single component. Provides the full chat lifecycle: sending messages, SSE streaming, progress tracking, error handling, and retry logic.

This hook is distinct from `useChatStore` -- it creates independent local state rather than sharing state globally. It is available for use cases where isolated chat state is needed (e.g., embedded chat widgets).

#### `UseChatOptions`

```typescript
interface UseChatOptions {
  provider?: string;
  model?: string;
  agentId?: string;
  workspaceId?: string;
  onProgress?: (event: ProgressEvent) => void;
}
```

#### `UseChatReturn`

```typescript
interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  provider: string;
  model: string;
  agentId: string | null;
  workspaceId: string | null;
  streamingContent: string; // Accumulated text during streaming
  progressEvents: ProgressEvent[]; // Tool execution progress updates
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  cancelRequest: () => void;
}
```

#### `ProgressEvent`

Received during SSE streaming to report tool execution progress.

```typescript
interface ProgressEvent {
  type: 'status' | 'tool_start' | 'tool_end';
  message?: string;
  tool?: { id: string; name: string; arguments?: Record<string, unknown> };
  result?: { success: boolean; preview: string; durationMs: number };
  data?: Record<string, unknown>;
  timestamp: string;
}
```

---

### useChatStore

**File:** `packages/ui/src/hooks/useChatStore.tsx`

The global chat store providing persistent chat state across page navigation. Chat continues in the background when the user navigates away from the ChatPage and resumes when they return.

#### Exports

| Export           | Type      | Description                       |
| ---------------- | --------- | --------------------------------- |
| `ChatProvider`   | Component | Context provider wrapping the app |
| `useChatStore()` | Hook      | Accesses the global chat state    |

#### `ChatStore` interface (extends `ChatState`)

```typescript
interface ChatStore {
  // State
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  provider: string;
  model: string;
  agentId: string | null;
  workspaceId: string | null;
  streamingContent: string;
  progressEvents: ProgressEvent[];

  // Actions
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (content: string, directTools?: string[]) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  cancelRequest: () => void;
}
```

#### Key Differences from `useChat`

| Feature         | `useChat`             | `useChatStore`                                 |
| --------------- | --------------------- | ---------------------------------------------- |
| Scope           | Local to component    | Global across app                              |
| Navigation      | State lost on unmount | State persists                                 |
| Direct tools    | Not supported         | Supports `directTools` parameter               |
| Tool catalog    | Not managed           | Sends `includeToolList: true` on first message |
| AbortController | Cleaned up on unmount | Persists across navigation                     |

#### Streaming Flow

1. User calls `sendMessage(content, directTools?)`.
2. Previous in-flight request is aborted if active.
3. User message is added to `messages` array.
4. `POST /api/v1/chat` is called with `stream: true`.
5. Response is processed as SSE (`text/event-stream`):
   - `data.type === 'status' | 'tool_start' | 'tool_end'` -- added to `progressEvents`.
   - `data.delta` -- accumulated into `streamingContent`.
   - `data.done === true` -- final response constructed with accumulated content, tool calls, trace.
6. On completion, `streamingContent` is cleared and a final `Message` is appended to `messages`.
7. On error, an error `Message` is appended and `lastFailedMessage` is stored for retry.

---

## Components

### Layout

**File:** `packages/ui/src/components/Layout.tsx`

The root layout component that structures the entire application UI. All pages render inside this layout via React Router's `<Outlet />`.

#### Structure

```
+----+----------------------------------+--------+
|    |                                  |        |
| S  |         <Outlet />               | Stats  |
| I  |        (Page Content)            | Panel  |
| D  |                                  |        |
| E  |                                  |        |
| B  |                                  |        |
| A  |                                  |        |
| R  |                                  |        |
|    |                                  |        |
+----+----------------------------------+--------+
 56px         flex-1 (fluid)             64/256px
```

#### Props

None. Uses `<Outlet />` for child routing.

#### Navigation Groups

The sidebar organizes navigation into main items and collapsible groups:

**Main Items** (always visible):

- Chat (`/`)
- Dashboard (`/dashboard`)
- Inbox (`/inbox`)

**Collapsible Groups:**

| Group    | ID         | Items                                                                            |
| -------- | ---------- | -------------------------------------------------------------------------------- |
| Data     | `data`     | Tasks, Notes, Calendar, Contacts, Bookmarks, Expenses, Custom Data, Data Browser |
| AI       | `ai`       | Memories, Goals, Triggers, Plans, Autonomy                                       |
| System   | `system`   | Agents, Tools, Custom Tools, Plugins, Workspaces, Models, Costs, Logs            |
| Settings | `settings` | Config Center, API Keys, Providers, AI Models, Integrations, Media, System       |

**Bottom Items:**

- Profile (`/profile`)

#### Internal Components

- `NavItemLink` -- Renders a single nav item with `<NavLink>` for active state detection. Uses `end` prop on root (`/`) to prevent matching all routes.
- `CollapsibleGroup` -- Renders a collapsible section with chevron toggle. Auto-highlights when any child route is active.

#### State

- `isStatsPanelCollapsed` (boolean) -- Controls right sidebar collapse.
- `openGroups` (Record<string, boolean>) -- Tracks which nav groups are expanded. Initializes based on current URL path.

#### Footer

Shows a green status dot with "Connected" text.

---

### ChatInput

**File:** `packages/ui/src/components/ChatInput.tsx`

The message input area with textarea, attachment chips, tool picker, and send/stop buttons.

#### Props

```typescript
interface ChatInputProps {
  onSend: (message: string, directTools?: string[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string; // Default: 'Type a message...'
}
```

#### Features

- **Auto-resizing textarea** -- Height adjusts to content up to 200px max.
- **Enter to send** -- Shift+Enter for newline.
- **Attachment chips** -- Resources selected via `ToolPicker` appear as colored chips above the textarea.
- **Context injection** -- Selected attachments are appended as hidden context blocks to the message, stripped from display by `MessageList`.
- **Direct tool registration** -- Tool/custom-tool attachments are extracted as `directTools` names and passed to `onSend`.
- **Send/Stop toggle** -- Shows Send button normally, Stop button when loading.

#### Chip Colors by Resource Type

| Type           | Color   | Label      |
| -------------- | ------- | ---------- |
| `tool`         | Blue    | "tool"     |
| `custom-tool`  | Primary | "custom"   |
| `custom-data`  | Emerald | "data"     |
| `builtin-data` | Amber   | "built-in" |

---

### MessageList

**File:** `packages/ui/src/components/MessageList.tsx`

Renders the list of chat messages as styled bubbles with markdown parsing, tool call displays, and trace information.

#### Props

```typescript
interface MessageListProps {
  messages: Message[];
  onRetry?: () => void;
  canRetry?: boolean;
}
```

#### Message Bubble Features

- **Role differentiation** -- User messages appear right-aligned with primary color gradient avatar. Assistant messages appear left-aligned with purple-indigo gradient avatar.
- **Markdown rendering** -- Parses and renders:
  - Fenced code blocks (` ```language ... ``` `) via `CodeBlock`
  - Inline code (`` `code` ``)
  - Bold (`**text**`)
  - Italic (`*text*`)
  - Links (`[text](url)`)
- **Context stripping** -- Hidden context blocks (`[ATTACHED CONTEXT...]` and `[TOOL CATALOG...]`) are stripped from display but the original content is preserved for copying.
- **Copy button** -- Appears on hover, copies the visible (stripped) content.
- **Timestamp** -- Displayed on hover in `HH:MM` format.
- **Error messages** -- Styled with red background and error border. Show a Retry button on the last error message.
- **Tool call display** -- Renders `ToolExecutionDisplay` for messages with tool calls, merging data from both `message.toolCalls` and `message.trace.toolCalls`.
- **Trace display** -- Renders `TraceDisplay` for assistant messages that include trace information.

---

### CodeBlock

**File:** `packages/ui/src/components/CodeBlock.tsx`

Renders syntax-highlighted code with Prism, including a header bar with language badge, copy, download, and optional execute buttons.

#### Props

```typescript
interface CodeBlockProps {
  code: string;
  language?: string; // Default: 'plaintext'
  filename?: string; // Shown in header if provided
  showLineNumbers?: boolean; // Default: true
  maxHeight?: string; // Default: '400px'
  onExecute?: () => void; // Shows Play button if provided
  isExecuting?: boolean; // Default: false
}
```

#### Features

- Uses `prism-react-renderer` with VS Dark theme.
- Language normalization map (e.g., `ts` -> `typescript`, `py` -> `python`).
- Line number gutter with separator.
- Line highlight on hover.
- Copy to clipboard with checkmark feedback.
- Download as file with auto-detected extension.
- Optional execute button with pulse animation during execution.

#### Supported Language Aliases

| Alias               | Mapped To    |
| ------------------- | ------------ |
| `js`                | `javascript` |
| `ts`                | `typescript` |
| `py`                | `python`     |
| `rb`                | `ruby`       |
| `sh`, `shell`       | `bash`       |
| `yml`               | `yaml`       |
| `md`                | `markdown`   |
| `plaintext`, `text` | `plain`      |

---

### ToolExecutionDisplay

**File:** `packages/ui/src/components/ToolExecutionDisplay.tsx`

Renders a list of tool call cards showing the status, arguments, and results of each tool invocation.

#### Props

```typescript
interface ToolExecutionDisplayProps {
  toolCalls: ToolCall[];
  onRerun?: (toolCall: ToolCall) => void;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
  error?: string;
}
```

#### Card Layout

Each tool call is rendered as an expandable card:

- **Header** -- Status icon (color-coded), formatted tool name, category badge, duration, expand/collapse chevron.
- **Arguments section** -- Collapsible JSON view via `CodeBlock`.
- **Result section** -- Smart rendering based on tool type:
  - `read_file` -- Shows file path and syntax-highlighted content.
  - `list_directory` -- Shows file listing with directory/file icons and sizes.
  - `execute_*` / `compile_code` -- Shows stdout (green), stderr (red), result, exit code.
  - `fetch_web_page` / `http_request` -- Shows status badge, URL, title, body content.
  - `search_web` -- Shows clickable search results with titles, URLs, snippets.
  - **Default** -- JSON code block.

#### Tool Categories

Tools are auto-categorized by name pattern:

| Pattern                                      | Category       |
| -------------------------------------------- | -------------- |
| `read_*`, `write_*`, `*file*`, `*directory*` | File System    |
| `execute_*`, `*compile*`, `*package*`        | Code Execution |
| `*http*`, `*web*`, `*fetch*`, `*api*`        | Web & API      |
| Everything else                              | Other          |

---

### ToolPicker

**File:** `packages/ui/src/components/ToolPicker.tsx`

A popover resource picker that lets users attach tools, custom data tables, and built-in data sources to their chat messages. Opens from a "+" button next to the textarea.

#### Props

```typescript
interface ToolPickerProps {
  onSelect: (attachment: ResourceAttachment) => void;
  disabled?: boolean;
}
```

#### `ResourceAttachment`

```typescript
type ResourceType = 'tool' | 'custom-tool' | 'custom-data' | 'builtin-data';

interface ResourceAttachment {
  name: string;
  displayName?: string;
  internalName?: string;
  type: ResourceType;
  toolInstructions: string; // Pre-built context block for LLM injection
}
```

#### Tabs

| Tab           | Sources                       | Fetched From                                                                |
| ------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Tools         | Built-in tools + custom tools | `GET /api/v1/tools?grouped=true` + `GET /api/v1/custom-tools?status=active` |
| Custom Data   | User-created data tables      | `GET /api/v1/custom-data/tables`                                            |
| Built-in Data | Hard-coded data sources       | Static list (tasks, bookmarks, notes, calendar, contacts, memories, goals)  |

#### Features

- Search with multi-word matching across name, description, category.
- Items grouped by category with sorted display.
- Color-coded icons per resource type (blue, primary, emerald, amber).
- Keyboard support (Escape to close, click outside to close).
- Auto-focus search input on open.
- For tools: fetches full JSON Schema parameters and embeds them in the instruction block.
- For custom data: generates CRUD tool instructions with the internal table name.
- For built-in data: uses hard-coded tool instruction templates.

---

### TraceDisplay

**File:** `packages/ui/src/components/TraceDisplay.tsx`

Collapsible debug information panel shown below assistant messages. Displays a summary bar and expandable sections for all trace data.

#### Props

```typescript
interface TraceDisplayProps {
  trace: TraceInfo;
}
```

#### Summary Bar (always visible)

Shows quick stats inline:

- Duration (ms)
- Tool calls (successful/total)
- Token usage (input/output)
- Blocked autonomy checks count
- Retry count
- Error count
- "Logs" button to open `DebugInfoModal`

#### Expanded Sections

| Section         | Shows When                  | Content                                                       |
| --------------- | --------------------------- | ------------------------------------------------------------- |
| Tool Calls      | `toolCalls.length > 0`      | Per-tool success/fail, name, duration, expandable args/result |
| Model Calls     | `modelCalls.length > 0`     | Provider/model, token counts (in/out), duration               |
| Autonomy Checks | `autonomyChecks.length > 0` | Approved/blocked status per tool with reason                  |
| Operations      | DB or memory ops > 0        | DB reads/writes, memory adds/recalls badges                   |
| Triggers Fired  | `triggersFired.length > 0`  | Trigger name badges                                           |
| Errors          | `errors.length > 0`         | Red error messages                                            |
| Request         | `request` exists            | Provider, model, endpoint, message count, tool list           |
| Response        | `response` exists           | Status, finish reason, content length                         |
| Retries         | `retries.length > 0`        | Attempt number, delay, error                                  |
| All Events      | `events.length > 0`         | Chronological event timeline with status dots                 |

---

### StatsPanel

**File:** `packages/ui/src/components/StatsPanel.tsx`

Right sidebar dashboard showing real-time statistics. Collapsible between full (256px) and icon-only (48px) modes.

#### Props

```typescript
interface StatsPanelProps {
  isCollapsed: boolean;
  onToggle: () => void;
}
```

#### Data Sources (fetched on mount, refreshed every 30 seconds)

| API Endpoint              | Data                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/summary`     | Personal data counts (tasks, notes, calendar, contacts, bookmarks) |
| `GET /api/v1/costs/usage` | Token usage and costs (daily/monthly)                              |
| `GET /api/v1/providers`   | Configured provider count                                          |
| `GET /api/v1/models`      | Available model count                                              |

#### Sections

1. **Personal Data** -- Tasks (with overdue/due-today alerts), Notes, Events, Contacts, Bookmarks.
2. **API Usage** -- Tokens today, cost today, monthly cost with token count.
3. **System** -- Configured providers count, available models count.

#### Collapsed Mode

Shows icon-only indicators: overdue task alert, task count, token count.

---

### TimelineView

**File:** `packages/ui/src/components/TimelineView.tsx`

A vertical timeline visualization showing today's events, tasks, and triggers in chronological order. Used on the Dashboard page.

#### Props

None. Self-contained component that fetches its own data.

#### Data Source

`GET /api/v1/dashboard/data` -- Returns daily briefing data including:

- `tasks.dueToday` and `tasks.overdue`
- `calendar.todayEvents`
- `triggers.scheduledToday`

#### Timeline Items

Each item has a type (`event`, `task`, `trigger`), time, and visual treatment:

| Type    | Icon         | Color (future)   | Color (past) |
| ------- | ------------ | ---------------- | ------------ |
| Event   | Calendar     | Primary (blue)   | Muted        |
| Task    | CheckCircle2 | Success (green)  | Muted        |
| Trigger | Zap          | Warning (yellow) | Muted        |

Overdue tasks are styled with error (red) colors.

Items are sorted chronologically and rendered with a connecting vertical line between them.

---

### DebugInfoModal

**File:** `packages/ui/src/components/DebugInfoModal.tsx`

A full-screen modal providing deep inspection of execution traces. Opened from the "Logs" button in `TraceDisplay`.

#### Props

```typescript
interface DebugInfoModalProps {
  trace: TraceInfo;
  onClose: () => void;
}
```

#### Tabs

| Tab                | Content                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Overview           | Stats grid (duration, tokens, tool calls, model calls), error list, retry list, autonomy checks |
| Tool Calls         | Expandable list with arguments, results, errors. Expand All / Collapse All controls             |
| Model Calls        | Per-model token breakdown (input/output/total) with duration                                    |
| Events             | Chronological event list with expandable tool call details                                      |
| Request / Response | Provider, model, endpoint, message count, tools list, response status                           |
| Raw JSON           | Full trace JSON with copy button, character count                                               |

#### Features

- Nearly full-screen (95vw x 90vh, max 1400px).
- Close on Escape key or backdrop click.
- Copy All button in header (copies entire trace as JSON).
- Per-section copy buttons for arguments and results.

---

### ErrorBoundary

**File:** `packages/ui/src/components/ErrorBoundary.tsx`

A React class component that catches unhandled JavaScript errors in the component tree and displays a fallback UI.

#### Props

```typescript
interface Props {
  children: ReactNode;
  fallback?: ReactNode; // Optional custom fallback
}
```

#### Default Fallback

Renders a centered error page with:

- Warning triangle icon
- "Something went wrong" heading
- Error message display
- Expandable stack trace (via `<details>`)
- "Go Home" button (navigates to `/`)
- "Reload Page" button

---

### ConfirmDialog

**File:** `packages/ui/src/components/ConfirmDialog.tsx`

An async dialog system that replaces native `window.confirm()` and `window.alert()` with styled modals. Uses the promise pattern so callers can `await` the result.

#### Exports

| Export           | Type      | Description                            |
| ---------------- | --------- | -------------------------------------- |
| `DialogProvider` | Component | Wraps app to manage dialog state       |
| `useDialog()`    | Hook      | Returns `{ confirm, alert }` functions |

#### Usage

```typescript
const { confirm, alert } = useDialog();

// Confirm dialog
const shouldDelete = await confirm({
  title: 'Delete Item',
  message: 'Are you sure you want to delete this item?',
  variant: 'danger',
  confirmText: 'Delete',
});
if (!shouldDelete) return;

// Alert dialog
await alert('Item deleted successfully');
```

#### `DialogOptions`

```typescript
interface DialogOptions {
  title?: string; // Default: 'Confirm' or 'Notice'
  message: string;
  confirmText?: string; // Default: 'Confirm', 'Delete' (danger), or 'OK' (alert)
  cancelText?: string; // Default: 'Cancel'
  variant?: 'default' | 'danger';
}
```

#### Features

- Backdrop click to cancel.
- Escape key to cancel, Enter key to confirm.
- Auto-focus on confirm button.
- Danger variant shows red warning icon and red confirm button.
- Alert variant shows only OK button (no cancel).
- Animated entrance (fade + scale).

---

### DynamicConfigForm

**File:** `packages/ui/src/components/DynamicConfigForm.tsx`

Generates form fields dynamically from a schema definition. Used in settings pages to render configuration forms for providers and services.

#### Props

```typescript
interface DynamicConfigFormProps {
  schema: ConfigFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}
```

#### `ConfigFieldDefinition`

```typescript
interface ConfigFieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'number' | 'boolean' | 'select' | 'json';
  required?: boolean;
  defaultValue?: unknown;
  envVar?: string; // Shows env var name as helper text
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>; // For 'select' type
  order?: number; // Sort order
}
```

#### Field Types

| Type      | Renders As                | Special Behavior                                       |
| --------- | ------------------------- | ------------------------------------------------------ |
| `string`  | `<input type="text">`     | Standard text input                                    |
| `secret`  | `<input type="password">` | Toggle show/hide button (Eye/EyeOff icons)             |
| `url`     | `<input type="url">`      | URL validation                                         |
| `number`  | `<input type="number">`   | Converts to `Number` on change                         |
| `boolean` | Toggle switch             | Styled as accessible switch with `role="switch"`       |
| `select`  | `<select>`                | Renders options from `options` array                   |
| `json`    | `<textarea>`              | Monospace font, JSON validation on blur, error display |

---

### FileBrowser

**File:** `packages/ui/src/components/FileBrowser.tsx`

A dual-pane file browser with directory listing on the left and file preview on the right.

#### Props

```typescript
interface FileBrowserProps {
  initialPath?: string; // Default: '~'
  onFileSelect?: (file: FileItem) => void;
  onFileOpen?: (file: FileItem, content: string) => void;
}
```

#### Features

- **Navigation toolbar** -- Home button, up button, refresh button, breadcrumb path, search input.
- **Directory listing** -- Fetches via `POST /api/v1/tools/list_directory/execute`. Sorted with directories first.
- **File preview** -- Fetches via `POST /api/v1/tools/read_file/execute`. Renders in `CodeBlock` with auto-detected language.
- **File type coloring** -- TypeScript (blue), JavaScript (yellow), Python (green), JSON (orange), HTML (red), CSS (purple).
- **Search filter** -- Client-side filename filtering.
- **Download and Edit buttons** -- In the preview header (Edit is placeholder).

---

### WorkspaceSelector

**File:** `packages/ui/src/components/WorkspaceSelector.tsx`

A dropdown selector for managing workspaces (sandboxed environments for code execution).

#### Props

```typescript
interface WorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
}
```

#### Features

- Lists workspaces from `GET /api/v1/workspaces`.
- Auto-selects first workspace if none selected.
- Shows workspace name, description, storage usage (file count, bytes).
- Create new workspace modal (name + optional description).
- Delete workspace with inline confirmation.
- Download workspace as ZIP.
- Active workspace shown with open folder icon.

---

### AIBriefingCard

**File:** `packages/ui/src/components/AIBriefingCard.tsx`

An AI-generated daily briefing card displayed at the top of the Dashboard page. Supports both cached retrieval and live streaming generation.

#### Props

None. Self-contained component.

#### Features

- **Model selector** -- Dropdown to choose which AI provider/model generates the briefing. Persisted in `localStorage`.
- **Streaming generation** -- Real-time text streaming with cursor animation via SSE from `GET /api/v1/dashboard/briefing/stream`.
- **Cached loading** -- Initial load uses `GET /api/v1/dashboard/briefing` which may return cached results.
- **Refresh button** -- Forces regeneration with streaming.
- **Collapsible content** -- Click header to expand/collapse.

#### Briefing Content

| Section               | Description                                  |
| --------------------- | -------------------------------------------- |
| Summary               | Natural language overview of the day         |
| Priorities            | Numbered list of today's top priorities      |
| Insights              | Bullet points with analysis and observations |
| Suggested Focus Areas | Recommended areas to concentrate on          |

---

### AIModelsTab

**File:** `packages/ui/src/components/AIModelsTab.tsx`

Tab component for managing AI model configurations within the settings area.

---

### IntegrationsTab

**File:** `packages/ui/src/components/IntegrationsTab.tsx`

Tab component for managing OAuth integrations and third-party service connections.

---

### MediaSettingsTab

**File:** `packages/ui/src/components/MediaSettingsTab.tsx`

Tab component for configuring media provider settings (image generation, storage, etc.).

---

### ProvidersTab

**File:** `packages/ui/src/components/ProvidersTab.tsx`

Tab component for configuring AI providers (API keys, endpoints, enabled status).

---

### icons

**File:** `packages/ui/src/components/icons.tsx`

A centralized module exporting all SVG icon components used throughout the application. Icons are implemented as React functional components accepting a `className` prop for sizing and coloring via Tailwind classes.

#### Exported Icons (partial list)

`MessageSquare`, `Inbox`, `Bot`, `Wrench`, `Cpu`, `DollarSign`, `Settings`, `UserCircle`, `LayoutDashboard`, `CheckCircle2`, `FileText`, `Calendar`, `Users`, `Bookmark`, `Database`, `Table`, `Brain`, `Target`, `Zap`, `ListChecks`, `Shield`, `Puzzle`, `HardDrive`, `ChevronDown`, `ChevronRight`, `ChevronUp`, `Activity`, `Code`, `Receipt`, `Key`, `Globe`, `Server`, `Image`, `Link`, `Container`, `Send`, `StopCircle`, `X`, `Plus`, `Search`, `Copy`, `Check`, `RefreshCw`, `Download`, `Play`, `User`, `Folder`, `FolderOpen`, `File`, `Home`, `Edit`, `Eye`, `EyeOff`, `Clock`, `XCircle`, `AlertTriangle`, `AlertCircle`, `Sparkles`, `Lightbulb`, `Focus`, `PanelRight`, `Hash`, `TrendingUp`, `ExternalLink`, `Trash2`, and more.

---

## Pages

### ChatPage

**File:** `packages/ui/src/pages/ChatPage.tsx`

The primary chat interface and default landing page (`/`).

#### Data Flow

```
ChatPage
  |
  +-- useChatStore()       <-- Global chat state
  |
  +-- useSearchParams()    <-- URL params (?agent=...&provider=...&model=...)
  |
  +-- WorkspaceSelector    <-- Workspace selection
  |
  +-- MessageList          <-- Message display
  |     +-- MessageBubble
  |           +-- CodeBlock
  |           +-- ToolExecutionDisplay
  |           +-- TraceDisplay
  |                 +-- DebugInfoModal
  |
  +-- ChatInput            <-- Message input
        +-- ToolPicker     <-- Resource picker
```

#### Initialization Logic

On mount, ChatPage fetches three API endpoints in parallel:

1. `GET /api/v1/models` -- Available models and configured providers.
2. `GET /api/v1/providers` -- Provider names for display.
3. `GET /api/v1/settings` -- Default provider/model preferences.

Provider/model selection priority:

1. URL parameter `?agent=<id>` -- Fetches agent, uses agent's provider/model (resolves "default" to actual values).
2. URL parameters `?provider=...&model=...` -- Direct selection.
3. Settings defaults -- From `GET /api/v1/settings`.
4. Fallback -- First configured provider and its first model.

#### Features

- **Provider/Model dropdown** -- Groups models by provider, shows recommendations.
- **Agent mode** -- When launched with `?agent=<id>`, displays agent name with bot icon.
- **New Chat** -- Clears messages, resets agent, calls `POST /api/v1/chat/reset-context`.
- **Streaming display** -- Shows progress events (status, tool_start, tool_end) and streaming text with cursor.
- **Empty state** -- Welcome message with example prompts categorized as General, Code Execution, and Tools & Search.
- **Demo mode warning** -- Shown when no providers are configured.

---

### DashboardPage

**File:** `packages/ui/src/pages/DashboardPage.tsx`

Overview dashboard showing personal data stats, AI briefing, timeline, and quick actions.

#### Components Used

- `AIBriefingCard` -- AI-generated daily briefing at the top.
- `TimelineView` -- Today's timeline of events, tasks, and triggers.
- Stats grid -- Linked cards showing pending tasks, overdue items, notes, bookmarks, events, contacts.
- Quick actions -- Buttons linking to Add Task, New Note, Add Bookmark, Schedule Event, New Goal.
- Task progress -- Progress bar showing completion percentage.

#### Data Source

`GET /api/v1/summary` -- Returns aggregated counts for tasks, notes, bookmarks, calendar, contacts.

---

### Data Pages

All data pages follow a consistent pattern: fetch data from REST API, display in a table or card layout, and provide CRUD operations.

| Page              | Path            | API Endpoint          | Purpose                                          |
| ----------------- | --------------- | --------------------- | ------------------------------------------------ |
| `TasksPage`       | `/tasks`        | `/api/v1/tasks`       | Task management with status, priority, due dates |
| `NotesPage`       | `/notes`        | `/api/v1/notes`       | Note creation and editing                        |
| `CalendarPage`    | `/calendar`     | `/api/v1/calendar`    | Calendar event management                        |
| `ContactsPage`    | `/contacts`     | `/api/v1/contacts`    | Contact directory                                |
| `BookmarksPage`   | `/bookmarks`    | `/api/v1/bookmarks`   | URL bookmarks                                    |
| `ExpensesPage`    | `/expenses`     | `/api/v1/expenses`    | Expense tracking                                 |
| `CustomDataPage`  | `/custom-data`  | `/api/v1/custom-data` | Custom data table management                     |
| `DataBrowserPage` | `/data-browser` | Various               | Unified data browser across all tables           |

---

### AI Pages

| Page           | Path        | Purpose                                              |
| -------------- | ----------- | ---------------------------------------------------- |
| `MemoriesPage` | `/memories` | View and manage AI persistent memories               |
| `GoalsPage`    | `/goals`    | Long-term goal tracking and progress                 |
| `TriggersPage` | `/triggers` | Event-based automation triggers                      |
| `PlansPage`    | `/plans`    | Multi-step execution plans                           |
| `AutonomyPage` | `/autonomy` | Autonomy settings, trigger management, plan overview |

---

### System Pages

| Page               | Path             | Purpose                                                          |
| ------------------ | ---------------- | ---------------------------------------------------------------- |
| `AgentsPage`       | `/agents`        | Agent configuration (name, provider, model, tools)               |
| `ToolsPage`        | `/tools`         | Built-in tool browser with schema, code, and test tabs           |
| `CustomToolsPage`  | `/custom-tools`  | User-created tools with JavaScript code                          |
| `CodingAgentsPage` | `/coding-agents` | External AI coding CLI sessions (Claude Code, Codex, Gemini CLI) |
| `PluginsPage`      | `/plugins`       | Plugin management                                                |
| `ExtensionsPage`   | `/extensions`    | User extension bundles with custom tools and configs             |
| `SkillsPage`       | `/skills`        | AgentSkills.io SKILL.md instruction packages                     |
| `WorkspacesPage`   | `/workspaces`    | Workspace management (create, delete, download)                  |
| `ModelsPage`       | `/models`        | AI model browser                                                 |
| `CostsPage`        | `/costs`         | AI cost analytics and token usage                                |
| `LogsPage`         | `/logs`          | Request and debug log viewer                                     |

---

### Settings Pages

All settings pages are under `/settings/*` and provide configuration for the system:

| Page                       | Path                       | Purpose                                             |
| -------------------------- | -------------------------- | --------------------------------------------------- |
| `SettingsPage`             | `/settings`                | Settings hub / overview                             |
| `ConfigCenterPage`         | `/settings/config-center`  | Unified config management with `DynamicConfigForm`  |
| `ApiKeysPage`              | `/settings/api-keys`       | API key management                                  |
| `ProvidersPage`            | `/settings/providers`      | AI provider configuration                           |
| `AIModelsPage`             | `/settings/ai-models`      | Model configuration                                 |
| `CodingAgentSettingsPage`  | `/settings/coding-agents`  | Coding agent provider config and API key management |
| `CliToolsSettingsPage`     | `/settings/cli-tools`      | CLI tool discovery, per-tool policy management      |
| `ModelRoutingPage`         | `/settings/model-routing`  | Per-process model selection with fallback chains    |
| `McpServersPage`           | `/settings/mcp-servers`    | MCP server connections with preset quick-add        |
| `ConnectedAppsPage`        | `/settings/connected-apps` | OAuth integrations (Composio)                       |
| `ToolGroupsPage`           | `/settings/tool-groups`    | Tool group visibility and assignments               |
| `WorkflowToolSettingsPage` | `/settings/workflow-tools` | Workflow tool configuration                         |
| `SecurityPage`             | `/settings/security`       | UI authentication and password management           |
| `SystemPage`               | `/settings/system`         | System-level configuration, database backup/restore |

---

### Additional Pages

| Page          | Path       | Purpose                    |
| ------------- | ---------- | -------------------------- |
| `InboxPage`   | `/inbox`   | Read-only channel messages |
| `ProfilePage` | `/profile` | User profile               |
| `AboutPage`   | `/about`   | System info and version    |
| `LoginPage`   | `/login`   | UI authentication          |

---

### New Components (Coding Agents / CLI Tools)

| Component       | Source                         | Purpose                                                                 |
| --------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `XTerminal`     | `components/XTerminal.tsx`     | Full xterm.js terminal emulator for interactive coding agent sessions   |
| `MiniTerminal`  | `components/MiniTerminal.tsx`  | Lightweight terminal viewer for auto-mode coding agent output streaming |
| `AutoModePanel` | `components/AutoModePanel.tsx` | Coding agent auto-mode execution panel with provider selector           |

---

## State Management

OwnPilot uses a **React Context + Hooks** pattern rather than external state management libraries like Redux.

### State Architecture

```
Global Providers (main.tsx)
  |
  +-- ThemeContext          (useTheme)
  |     Theme preference, resolved theme, localStorage sync
  |
  +-- WebSocketContext      (useGateway)
  |     Connection status, sessionId, send/subscribe functions
  |
  +-- ChatContext           (useChatStore)
  |     Messages, streaming content, progress events,
  |     provider/model/agent/workspace selection,
  |     AbortController for request cancellation
  |
  +-- DialogContext         (useDialog)
        Confirm/alert dialog queue with promise resolution

Page-Level State (useState in each page)
  |
  +-- Local data (fetched on mount)
  +-- Form state
  +-- UI state (modals, selections, filters)
```

### Key Patterns

1. **Chat state persists across navigation** -- The `ChatProvider` is at the app root, so chat messages, streaming state, and the AbortController survive page navigation. When a user navigates away from Chat and returns, everything is intact.

2. **Each page manages its own data** -- Pages fetch data from REST APIs in `useEffect` on mount and manage local state with `useState`. No global data cache.

3. **No Redux or external store** -- All state is managed through React's built-in hooks and context.

4. **AbortController for cancellation** -- Both `useChat` and `useChatStore` use `AbortController` to cancel in-flight fetch requests. The store version persists the controller across navigation.

---

## Real-Time Communication

### WebSocket Connection

The `WebSocketProvider` establishes a single WebSocket connection on app mount:

```
Browser  ----ws://{host}/ws---->  Gateway Server
```

#### Message Format

```typescript
interface WSMessage<T = unknown> {
  type: string; // Event type (e.g., "connection:ready", "chat:update")
  payload: T; // Event-specific data
  timestamp: string; // ISO 8601
  correlationId?: string;
}
```

#### Connection Lifecycle

1. **Mount** -- `useWebSocket` auto-connects.
2. **Open** -- Status becomes `connected`.
3. **Ready** -- Gateway sends `connection:ready` with `sessionId`.
4. **Messages** -- Parsed and dispatched to subscribers by `type`.
5. **Close** -- Auto-reconnect with exponential backoff (3s delay, max 5 attempts).
6. **Error** -- Status becomes `error`.
7. **Unmount** -- Connection closed, timers cleared.

#### Subscription Pattern

```typescript
const ws = useGateway();

useEffect(() => {
  const unsubscribe = ws.subscribe<MyPayload>('event:type', (data) => {
    // Handle event
  });
  return unsubscribe;
}, [ws]);
```

Wildcard subscriptions (`'*'`) receive all events with `{ type, payload }` wrapper.

---

## Streaming Architecture

Chat responses use **Server-Sent Events (SSE)** over HTTP, not WebSocket. This is by design: SSE provides reliable ordered delivery for the request-response pattern of chat, while WebSocket handles bidirectional real-time updates.

### SSE Flow

```
Browser                                Gateway
  |                                       |
  |-- POST /api/v1/chat {stream: true} -->|
  |                                       |
  |<-- Content-Type: text/event-stream ---|
  |                                       |
  |<-- event: progress                    |
  |    data: {"type":"status",...}         |
  |                                       |
  |<-- event: progress                    |
  |    data: {"type":"tool_start",...}     |
  |                                       |
  |<-- event: progress                    |
  |    data: {"type":"tool_end",...}       |
  |                                       |
  |<-- event: chunk                       |
  |    data: {"delta":"Hello",...}         |
  |                                       |
  |<-- event: chunk                       |
  |    data: {"delta":" world",...}        |
  |                                       |
  |<-- event: done                        |
  |    data: {"done":true,"toolCalls":[...|
  |           ,"trace":{...}}             |
  |                                       |
```

### SSE Event Types

| Event Data Field             | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `data.type === 'status'`     | Status message (e.g., "Processing...")                        |
| `data.type === 'tool_start'` | Tool execution beginning (includes tool name and args)        |
| `data.type === 'tool_end'`   | Tool execution complete (includes success, preview, duration) |
| `data.delta`                 | Text content chunk to append                                  |
| `data.done === true`         | Stream complete; includes final `toolCalls`, `usage`, `trace` |
| `data.error`                 | Error occurred during processing                              |

### Cancellation

Requests can be cancelled at any time via `AbortController.abort()`. The `cancelRequest()` function in `useChatStore` handles cleanup:

1. Aborts the fetch request.
2. Clears `isLoading` state.
3. Clears `streamingContent` and `progressEvents`.
4. Nullifies the controller reference.

---

## Theming

### Tailwind Dark Mode

The application uses Tailwind CSS v4 with class-based dark mode. The `ThemeProvider` adds or removes the `dark` class on `<html>`.

### Color Convention

All components use semantic color classes that resolve differently in light/dark mode:

| Token Pattern                                           | Example         | Purpose              |
| ------------------------------------------------------- | --------------- | -------------------- |
| `bg-bg-primary` / `dark:bg-dark-bg-primary`             | Main background | Primary background   |
| `bg-bg-secondary` / `dark:bg-dark-bg-secondary`         | Cards, sidebar  | Secondary background |
| `bg-bg-tertiary` / `dark:bg-dark-bg-tertiary`           | Input fields    | Tertiary background  |
| `text-text-primary` / `dark:text-dark-text-primary`     | Headings        | Primary text         |
| `text-text-secondary` / `dark:text-dark-text-secondary` | Labels          | Secondary text       |
| `text-text-muted` / `dark:text-dark-text-muted`         | Timestamps      | Muted text           |
| `border-border` / `dark:border-dark-border`             | Dividers        | Border color         |
| `text-primary`                                          | Accent color    | Brand primary        |
| `text-success`                                          | Green           | Success states       |
| `text-error`                                            | Red             | Error states         |
| `text-warning`                                          | Yellow/amber    | Warning states       |
| `text-info`                                             | Blue            | Info states          |

---

## Component Hierarchy Diagram

```
main.tsx
  StrictMode
    ErrorBoundary
      ThemeProvider
        BrowserRouter
          WebSocketProvider
            ChatProvider
              DialogProvider
                App
                  Routes
                    Layout
                    |
                    +-- Sidebar
                    |   +-- NavItemLink (x N)
                    |   +-- CollapsibleGroup (x 4)
                    |       +-- NavItemLink (x N)
                    |
                    +-- <Outlet />
                    |   |
                    |   +-- ChatPage (/)
                    |   |   +-- WorkspaceSelector
                    |   |   +-- MessageList
                    |   |   |   +-- MessageBubble (x N)
                    |   |   |       +-- CodeBlock (x N)
                    |   |   |       +-- ToolExecutionDisplay
                    |   |   |       |   +-- ToolCallCard (x N)
                    |   |   |       |       +-- CodeBlock
                    |   |   |       |       +-- ToolResultDisplay
                    |   |   |       +-- TraceDisplay
                    |   |   |           +-- TraceSection (x N)
                    |   |   |           +-- EventsSection
                    |   |   |           +-- DebugInfoModal
                    |   |   +-- ChatInput
                    |   |       +-- ToolPicker
                    |   |
                    |   +-- DashboardPage (/dashboard)
                    |   |   +-- AIBriefingCard
                    |   |   +-- TimelineView
                    |   |
                    |   +-- ConfigCenterPage (/settings/config-center)
                    |   |   +-- DynamicConfigForm
                    |   |
                    |   +-- [other pages...]
                    |
                    +-- StatsPanel
                        +-- StatCard (x N)
```

---

## Component Exports

**File:** `packages/ui/src/components/index.ts`

```typescript
export { Layout } from './Layout';
export { ChatInput } from './ChatInput';
export { MessageList } from './MessageList';
export { CodeBlock } from './CodeBlock';
export { ToolExecutionDisplay } from './ToolExecutionDisplay';
export { FileBrowser } from './FileBrowser';
export * from './icons';
export { DialogProvider, useDialog } from './ConfirmDialog';
export { DebugInfoModal } from './DebugInfoModal';
```

Note: Not all components are re-exported from the barrel file. Some (like `ToolPicker`, `TraceDisplay`, `StatsPanel`, `TimelineView`, `WorkspaceSelector`, `AIBriefingCard`, settings tabs) are imported directly where used.

**File:** `packages/ui/src/hooks/index.ts`

```typescript
export * from './useWebSocket';
```

Note: `useTheme`, `useChat`, and `useChatStore` are imported directly by consumers rather than through the barrel export.
