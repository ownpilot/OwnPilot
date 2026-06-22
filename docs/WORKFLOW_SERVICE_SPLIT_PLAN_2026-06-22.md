# WorkflowService Split Plan — 2026-06-22

## Scope

Target module: `packages/gateway/src/services/workflow/workflow-service.ts`.

Current size: 1068 LOC.

Goal: split runtime orchestration, resume handling, execution locking, jobified level polling, and public service facade into smaller modules without changing public imports or behavior.

## Current dependency graph

```text
workflow-service.ts
  ├─ db/repositories/workflows/index.ts
  │    ├─ createWorkflowsRepository()
  │    ├─ WorkflowNode / WorkflowEdge / NodeResult / WorkflowLog types
  │    └─ log persistence: createLog, updateLog, getLog, markRun
  ├─ @ownpilot/core/services
  │    ├─ getServiceRegistry()
  │    └─ IToolService
  ├─ @ownpilot/core/types
  │    └─ sleep()
  ├─ utils/common.ts
  │    └─ getErrorMessage()
  ├─ dag-utils.ts
  │    ├─ topologicalSort()
  │    ├─ getDownstreamNodes()
  │    ├─ getForEachBodyNodes()
  │    └─ computeSkippedNodes()
  ├─ workflow-dispatch.ts
  │    ├─ dispatchNode()
  │    ├─ executeWithRetryAndTimeout()
  │    ├─ ApprovalPauseError
  │    ├─ DispatchCallbacks
  │    ├─ nodeDataField()
  │    └─ nodeDataRecord()
  ├─ workflow-node-job-handler.ts
  │    └─ enqueueWorkflowLevel()
  ├─ foreach-executor.ts
  │    └─ executeForEachNode()
  └─ types.ts
       └─ WorkflowProgressEvent
```

## Responsibility map

### `workflow-service.ts` currently owns

1. Public facade and singleton:
   - `WorkflowService`
   - `getWorkflowService()`
   - constructor options
   - service registry lookup for tool service

2. Execution lifecycle:
   - load workflow
   - create/update workflow log
   - acquire/release active execution lock
   - emit progress events
   - final status calculation
   - mark workflow as run

3. DAG runtime:
   - remove trigger nodes
   - topological level traversal
   - alias map construction
   - ForEach body-node precomputation
   - skipped-node propagation
   - branch handling for condition/switch nodes
   - global error handler recovery

4. Resume runtime:
   - load paused log
   - restore saved node outputs
   - inject approval decision result
   - skip completed nodes
   - continue topological execution

5. Job queue bridge:
   - enqueue level via `enqueueWorkflowLevel()`
   - poll persisted workflow log until level completion
   - abort/timeout handling

6. Cancellation:
   - `activeExecutions: Map<string, AbortController>`
   - `cancelExecution()`
   - `isRunning()`

## Proposed target structure

```text
packages/gateway/src/services/workflow/
  workflow-service.ts          # public facade + singleton only
  execution-locks.ts           # active execution lock registry
  runtime-context.ts           # derived execution context builders
  runtime.ts                   # execute workflow from scratch
  resume-runtime.ts            # resume approval-paused workflow
  level-runner.ts              # topological level execution helpers
  jobified-level-runner.ts     # enqueue/poll persistent job level execution
  finalization.ts              # final status, duration, log updates
```

Keep `workflow-service.ts` exporting `WorkflowService` and `getWorkflowService()` so existing imports remain stable.

## Proposed module responsibilities

### `execution-locks.ts`

Owns the map of active workflow executions.

```ts
export class WorkflowExecutionLocks {
  tryAcquire(workflowId: string): AbortController | null;
  release(workflowId: string): void;
  cancel(workflowId: string): boolean;
  isRunning(workflowId: string): boolean;
}
```

Why: isolates cancellation semantics and prevents lock leaks during setup failures.

### `runtime-context.ts`

Builds derived runtime data used by both execute and resume paths.

```ts
export interface WorkflowRuntimeContext {
  executableNodes: WorkflowNode[];
  levels: string[][];
  nodeMap: Map<string, WorkflowNode>;
  forEachBodyNodeSet: Set<string>;
  aliasToNodeId: Map<string, string>;
  errorHandlerNode?: WorkflowNode;
  errorHandlerContinueOnSuccess: boolean;
}
```

Why: `execute()` and `resumeFromApproval()` currently duplicate this setup.

### `level-runner.ts`

Owns one topological level execution in inline mode.

Responsibilities:

- skip already completed nodes
- skip ForEach body nodes outside ForEach execution
- skip error handler during normal path
- dispatch normal nodes through `dispatchNode()`
- execute ForEach nodes through `executeForEachNode()`
- propagate condition/switch skipped branches
- apply global error handler recovery

Why: the core loop is currently embedded twice and is the hardest part to review.

### `jobified-level-runner.ts`

Owns persistent job queue execution for a level.

Responsibilities:

- call `enqueueWorkflowLevel()`
- poll `repo.getLog(logId)`
- detect all nodes completed/skipped/errored
- honor abort signal
- enforce `jobifiedMaxWaitMs`

Why: this is a distinct persistence/polling concern and already has a clean boundary.

### `runtime.ts`

Owns `execute()` from scratch.

Inputs:

```ts
(workflowId, userId, options, onProgress, toolService, dispatchCallbacks, locks);
```

Outputs: `Promise<WorkflowLog>`.

Responsibilities:

- create workflow log
- update setup status
- run levels
- handle `ApprovalPauseError`
- map cancellation vs failure
- finalize log

### `resume-runtime.ts`

Owns approval resume.

Responsibilities:

- validate paused log
- inject approval result
- reject path finalization
- acquire execution lock
- resume from saved node outputs
- reuse `runtime-context.ts`, `level-runner.ts`, and `finalization.ts`

Why: resume is behaviorally close to execute, but has approval-specific entry and saved-state rules.

### `workflow-service.ts`

After split, keep only:

- constructor options
- `getToolService()` facade
- `execute()` delegates to `runWorkflow()`
- `resumeFromApproval()` delegates to `resumeWorkflowFromApproval()`
- `cancelExecution()` delegates to locks
- `isRunning()` delegates to locks
- singleton `getWorkflowService()`

Expected size after split: 150–250 LOC.

## Dependency direction rules

```text
workflow-service.ts
  → runtime.ts
  → resume-runtime.ts
  → execution-locks.ts

runtime.ts / resume-runtime.ts
  → runtime-context.ts
  → level-runner.ts
  → jobified-level-runner.ts
  → finalization.ts

level-runner.ts
  → workflow-dispatch.ts
  → foreach-executor.ts
  → dag-utils.ts

jobified-level-runner.ts
  → workflow-node-job-handler.ts
```

Forbidden dependencies:

- `workflow-dispatch.ts` must not import `workflow-service.ts`.
- `level-runner.ts` must not know about `WorkflowService` class internals.
- `jobified-level-runner.ts` must not mutate service lock state.
- `runtime-context.ts` must remain pure and side-effect free.

## Characterization test plan

Existing `workflow-service.test.ts` already covers a broad surface. Before splitting, add or confirm focused tests for the behavior below.

### P0 tests — must exist before extraction

1. **Lock cleanup on setup failure**
   - Setup: `repo.updateLog()` throws before main runtime loop.
   - Assert: `isRunning(workflowId)` returns false afterward.

2. **Cancel maps final status to `cancelled`**
   - Setup: start execution, abort active controller.
   - Assert: final log update status is `cancelled`, not `failed`.

3. **Approval pause is not treated as failure**
   - Setup: approval node causes `ApprovalPauseError`.
   - Assert: final log remains `awaiting_approval` and runtime returns paused log.

4. **Resume approved path preserves saved node outputs**
   - Setup: paused log with a completed upstream node.
   - Assert: completed upstream node is not re-executed.

5. **Resume rejected path finalizes failed immediately**
   - Setup: approval result `rejected`.
   - Assert: log status `failed`, error `Approval rejected`, no level execution.

6. **ForEach body nodes are skipped outside ForEach runtime**
   - Setup: DAG with `forEachNode` body nodes.
   - Assert: body nodes get `skipped` unless run by `executeForEachNode()`.

7. **Condition false branch skip propagation**
   - Setup: condition node returns `branchTaken: 'true'`.
   - Assert: false-handle downstream nodes are skipped.

8. **Switch not-taken branches are skipped**
   - Setup: switch node returns a specific branch.
   - Assert: all other case/default branches are skipped.

9. **Global error handler can recover**
   - Setup: normal node errors, error handler succeeds, `continueOnSuccess` true.
   - Assert: workflow continues and does not fail solely on recovered error.

10. **Jobified level timeout reports pending node IDs**
    - Setup: persisted log never receives one node result.
    - Assert: thrown error includes pending count and IDs.

### P1 tests — add during extraction

1. `buildWorkflowRuntimeContext()` unit tests:
   - filters trigger nodes
   - builds alias map
   - identifies ForEach body nodes
   - detects error handler and `continueOnSuccess`

2. `WorkflowExecutionLocks` unit tests:
   - acquire once, reject second acquire
   - cancel aborts and returns true
   - release removes lock
   - cancel missing returns false

3. `runJobifiedLevel()` unit tests:
   - resolves when all persisted results exist
   - abort throws cancellation error
   - timeout includes pending node IDs

4. `finalizeWorkflowLog()` unit tests:
   - errors imply `failed`
   - no errors imply `completed`
   - duration includes prior paused duration on resume

## Extraction phases

### ✅ Phase 1 — WorkflowExecutionLocks (DONE)

- Extracted `WorkflowExecutionLocks` class to `execution-locks.ts`
- `tryAcquire`/`release`/`cancel`/`isRunning` over a `Map<string, AbortController>`
- `workflow-service.ts` now delegates to a private `locks` instance
- Tests updated: mock `execution-locks.js` via `vi.hoisted` + `vi.mock`; seed `testLocks` map for isolation tests

### ✅ Phase 2 — Dispatch context types (DONE)

- Moved `DispatchNodeContext` and `DispatchCallbacks` from `workflow-dispatch.ts` to `workflow-context.ts`
- `workflow-dispatch.ts` re-exports both for backward compatibility
- Removed unused imports (`WorkflowLog`, `IToolService`) from `workflow-dispatch.ts`

### Phase 3 — Jobified level runner

1. Move `jobifiedExecuteLevel()` into `jobified-level-runner.ts`.
2. Pass polling intervals explicitly.
3. Keep existing behavior and error strings.

Rollback: restore private method.

### Phase 4 — Inline level runner

1. Extract one-level execution helper.
2. Keep branch skip/error handler behavior identical.
3. Run full `workflow-service.test.ts` after each small move.

Rollback: restore loop from git.

### Phase 5 — Execute/resume runtime split

1. Move execute-from-scratch into `runtime.ts`.
2. Move approval resume into `resume-runtime.ts`.
3. Leave `WorkflowService` as public facade.

Rollback: keep facade delegates small so each runtime file can be reverted independently.

## Verification commands

Run after each phase:

```bash
pnpm --filter @ownpilot/gateway typecheck
pnpm --filter @ownpilot/gateway test -- src/services/workflow/workflow-service.test.ts src/services/workflow/foreach-executor.test.ts src/services/workflow/node-executors.test.ts src/routes/workflow/index.test.ts
```

Run before final commit:

```bash
pnpm --filter @ownpilot/gateway test
pnpm --filter @ownpilot/gateway lint
```

## Exit criteria

- `workflow-service.ts` under 300 LOC.
- Public imports unchanged: `WorkflowService` and `getWorkflowService` still exported from `./workflow-service.js` and `./index.js`.
- Existing workflow route/service tests pass.
- New helper modules have unit tests.
- No circular import from helper modules back into `workflow-service.ts`.
- Behavior of approval pause/resume, cancellation, branch skipping, ForEach, and error handler recovery remains unchanged.
