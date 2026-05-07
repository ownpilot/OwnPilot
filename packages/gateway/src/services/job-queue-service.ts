/**
 * JobQueueService — enqueue jobs and manage the worker pool.
 * Wraps JobsRepository with pg-boss-compatible API.
 *
 * Workers use FOR UPDATE SKIP LOCKED to claim jobs without contention,
 * enabling horizontal scaling across multiple gateway instances.
 */

import { randomUUID } from 'node:crypto';
import { getLog } from './log.js';
import { getJobsRepository, type CreateJobInput, type JobRecord } from '../db/repositories/jobs.js';

const log = getLog('JobQueueService');

const DEFAULT_QUEUE = 'default';
const SYSTEM_QUEUE = 'system';

export interface EnqueueOptions {
  queue?: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
}

export type JobHandler = (job: JobRecord) => Promise<Record<string, unknown>>;

export interface WorkerOptions {
  queue?: string;
  concurrency?: number;
  name?: string;
}

interface RunningWorker {
  id: string;
  queue: string;
  concurrency: number;
  handler: JobHandler;
  activeJobs: Set<string>;
  stopped: boolean;
}

/**
 * JobQueueService — singleton service for enqueueing and workers.
 *
 * Usage:
 *   const queue = JobQueueService.getInstance();
 *
 *   // Enqueue a job
 *   await queue.enqueue('workflow_node', { nodeId: 'node_1', runId: 'run_123' });
 *
 *   // Start a worker
 *   queue.startWorker('workflow_node', async (job) => {
 *     console.log('Executing', job.payload);
 *     return { result: 'ok' };
 *   });
 */
export class JobQueueService {
  private static _instance: JobQueueService | null = null;
  private workers: Map<string, RunningWorker> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private repo = getJobsRepository();

  static getInstance(): JobQueueService {
    if (!JobQueueService._instance) {
      JobQueueService._instance = new JobQueueService();
    }
    return JobQueueService._instance;
  }

  /**
   * Enqueue a job for async processing.
   */
  async enqueue(
    name: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {}
  ): Promise<string> {
    const jobInput: CreateJobInput = {
      id: randomUUID(),
      name,
      queue: options.queue ?? DEFAULT_QUEUE,
      priority: options.priority ?? 0,
      payload,
      maxAttempts: options.maxAttempts ?? 3,
      runAfter: options.runAfter ?? new Date(),
    };
    const job = await this.repo.create(jobInput);
    log.debug('Job enqueued', { jobId: job.id, name, queue: job.queue });
    return job.id;
  }

  /**
   * Enqueue a high-priority system job.
   */
  async enqueueSystem(name: string, payload: Record<string, unknown> = {}): Promise<string> {
    return this.enqueue(name, payload, { queue: SYSTEM_QUEUE, priority: 100 });
  }

  /**
   * Start a worker that polls for jobs and executes them.
   */
  startWorker(handler: JobHandler, options: WorkerOptions = {}): () => void {
    const queue = options.queue ?? DEFAULT_QUEUE;
    const concurrency = options.concurrency ?? 4;
    const workerId = options.name ?? `worker_${randomUUID().slice(0, 8)}`;

    const worker: RunningWorker = {
      id: workerId,
      queue,
      concurrency,
      handler,
      activeJobs: new Set(),
      stopped: false,
    };

    this.workers.set(workerId, worker);
    log.info('Worker started', { workerId, queue, concurrency });

    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => this.pollAll(), 1000);
    }

    // Trigger first poll immediately
    this.pollWorker(worker);

    // Return stop function
    return () => this.stopWorker(workerId);
  }

  private stopWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    worker.stopped = true;
    this.workers.delete(workerId);
    log.info('Worker stopped', { workerId });
    if (this.workers.size === 0 && this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.workers.values())
        .filter(w => !w.stopped)
        .map(w => this.pollWorker(w))
    );
  }

  private async pollWorker(worker: RunningWorker): Promise<void> {
    if (worker.stopped) return;
    if (worker.activeJobs.size >= worker.concurrency) return;

    const availableSlots = worker.concurrency - worker.activeJobs.size;
    for (let i = 0; i < availableSlots; i++) {
      if (worker.stopped) break;
      const job = await this.repo.claimJob(worker.queue, 0);
      if (!job) break;

      worker.activeJobs.add(job.id);
      this.executeJob(worker, job).finally(() => {
        worker.activeJobs.delete(job.id);
        this.pollWorker(worker);
      });
    }
  }

  private async executeJob(worker: RunningWorker, job: JobRecord): Promise<void> {
    const logCtx = { workerId: worker.id, jobId: job.id, name: job.name };
    log.debug('Job started', logCtx);

    try {
      const result = await worker.handler(job);
      await this.repo.complete(job.id, result);
      log.debug('Job completed', { ...logCtx });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn('Job failed', { ...logCtx, error });
      await this.repo.fail(job.id, error);
    }
  }

  /**
   * Get queue statistics for monitoring.
   */
  async getStats(queue?: string) {
    return this.repo.getStats(queue);
  }

  /**
   * Stop all workers gracefully.
   */
  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    for (const [id] of this.workers) {
      this.stopWorker(id);
    }
    log.info('JobQueueService shut down');
  }
}