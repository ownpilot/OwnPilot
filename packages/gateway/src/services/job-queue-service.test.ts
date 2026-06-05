import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the jobs repository ──
// claimJob hands out unique jobs until `available` is exhausted, then null.

let available = 0;
let claimed = 0;

const mockRepo = {
  claimJob: vi.fn(async (queue: string) => {
    if (available <= 0) return null;
    available--;
    claimed++;
    return {
      id: `job-${claimed}`,
      name: 'test',
      queue,
      priority: 0,
      payload: {},
      attempts: 0,
      maxAttempts: 3,
      status: 'active',
    };
  }),
  complete: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  create: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../db/repositories/jobs.js', () => ({
  getJobsRepository: () => mockRepo,
}));

const { JobQueueService } = await import('./job-queue-service.js');

// ── Concurrency tracking handler ──

let currentConcurrent = 0;
let maxConcurrent = 0;
let gates: Array<() => void> = [];

const blockingHandler = async () => {
  currentConcurrent++;
  maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
  await new Promise<void>((resolve) => gates.push(resolve));
  currentConcurrent--;
  return {};
};

beforeEach(() => {
  vi.clearAllMocks();
  available = 0;
  claimed = 0;
  currentConcurrent = 0;
  maxConcurrent = 0;
  gates = [];
});

describe('JobQueueService pollWorker concurrency', () => {
  it('never exceeds the worker concurrency cap when polls overlap', async () => {
    // Plenty of jobs waiting — enough that an unguarded race could claim well
    // past the cap (2×concurrency or more).
    available = 50;

    const service = new JobQueueService();
    const worker = {
      id: 'w1',
      queue: 'workflow_nodes',
      concurrency: 4,
      handler: blockingHandler,
      activeJobs: new Set<string>(),
      stopped: false,
      polling: false,
    };

    // Three overlapping pollWorker invocations reproduce the real race: the
    // 1 Hz pollAll tick, the immediate start poll, and a finally re-poll can
    // all run against the same worker while claimJob is mid-await.
    await Promise.all([
      (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
        worker
      ),
      (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
        worker
      ),
      (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
        worker
      ),
    ]);

    // Flush the executeJob microtasks so every started handler has incremented.
    await new Promise((r) => setTimeout(r, 20));

    // The worker must hold no more than `concurrency` jobs in flight.
    expect(maxConcurrent).toBeLessThanOrEqual(4);
    expect(worker.activeJobs.size).toBeLessThanOrEqual(4);

    // Cleanup: stop and release the blocked handlers.
    worker.stopped = true;
    gates.forEach((g) => g());
    await new Promise((r) => setTimeout(r, 0));
  });

  it('claims exactly up to concurrency from a single poll', async () => {
    available = 50;

    const service = new JobQueueService();
    const worker = {
      id: 'w2',
      queue: 'q',
      concurrency: 3,
      handler: blockingHandler,
      activeJobs: new Set<string>(),
      stopped: false,
      polling: false,
    };

    await (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
      worker
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(worker.activeJobs.size).toBe(3);
    expect(maxConcurrent).toBe(3);

    worker.stopped = true;
    gates.forEach((g) => g());
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('JobQueueService error resilience', () => {
  type Svc = {
    executeJob: (w: RunningWorkerLike, j: Record<string, unknown>) => Promise<void>;
    pollWorker: (w: RunningWorkerLike) => Promise<void>;
  };
  interface RunningWorkerLike {
    id: string;
    queue: string;
    concurrency: number;
    handler: () => Promise<Record<string, unknown>>;
    activeJobs: Set<string>;
    stopped: boolean;
    polling: boolean;
  }
  const makeWorker = (over: Partial<RunningWorkerLike> = {}): RunningWorkerLike => ({
    id: 'w',
    queue: 'q',
    concurrency: 2,
    handler: async () => ({}),
    activeJobs: new Set<string>(),
    stopped: false,
    polling: false,
    ...over,
  });
  const job = { id: 'job-x', name: 'test', queue: 'q', payload: {} };

  it('executeJob does not reject when repo.complete throws', async () => {
    mockRepo.complete.mockRejectedValueOnce(new Error('db down'));
    const svc = new JobQueueService() as unknown as Svc;
    // Resolves (not rejects); falls back to repo.fail for retry.
    await expect(svc.executeJob(makeWorker(), job)).resolves.toBeUndefined();
    expect(mockRepo.fail).toHaveBeenCalledWith('job-x', 'db down');
  });

  it('executeJob does not reject when repo.fail also throws (no unhandled rejection)', async () => {
    mockRepo.complete.mockRejectedValueOnce(new Error('complete failed'));
    mockRepo.fail.mockRejectedValueOnce(new Error('fail failed'));
    const svc = new JobQueueService() as unknown as Svc;
    await expect(svc.executeJob(makeWorker(), job)).resolves.toBeUndefined();
  });

  it('frees the slot via finally even when the job handler + persistence throw', async () => {
    available = 1;
    mockRepo.complete.mockRejectedValueOnce(new Error('complete failed'));
    const svc = new JobQueueService() as unknown as Svc;
    const worker = makeWorker({ concurrency: 2, handler: async () => ({}) });
    await svc.pollWorker(worker);
    // Let executeJob + its finally settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(worker.activeJobs.size).toBe(0);
  });

  it('startWorker immediate poll does not emit an unhandled rejection when claimJob throws', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      mockRepo.claimJob.mockRejectedValueOnce(new Error('claim db error'));
      const svc = new JobQueueService();
      const stop = svc.startWorker(async () => ({}), { queue: 'q', name: 'w-claimthrow' });
      // Drain microtasks + a macrotask so any rejection would have surfaced.
      await new Promise((r) => setTimeout(r, 20));
      stop();
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
