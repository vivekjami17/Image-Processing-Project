import type { ImageRepository, ImageRow } from '../images/imageRepository.js';
import type { Logger } from '../logger.js';
import type { ImageProcessor } from '../processing/imageProcessor.js';
import type { ObjectStorage } from '../storage/index.js';

export interface JobRunnerOptions {
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
  staleAfterSeconds: number;
  similarityMaxDistance: number;
}

/**
 * Pulls pending images off the Postgres-backed queue and processes them with bounded
 * concurrency. It sleeps until woken by NOTIFY (via `wake()`) or the poll interval
 * elapses, so it reacts instantly to uploads but still recovers if a notification is lost.
 * Run as many worker processes as needed; SKIP LOCKED keeps them from colliding.
 */
export class JobRunner {
  private inFlight = new Set<Promise<void>>();
  private running = false;
  private wakeUp: (() => void) | undefined;
  // Set when wake() arrives while we're busy claiming, so the next sleep is skipped.
  private wakePending = false;
  private staleTimer: NodeJS.Timeout | undefined;
  private loopDone: Promise<void> | undefined;

  constructor(
    private readonly repo: ImageRepository,
    private readonly processor: ImageProcessor,
    private readonly storage: ObjectStorage,
    private readonly options: JobRunnerOptions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.running = true;
    this.staleTimer = setInterval(() => void this.requeueStale(), 60_000);
    void this.requeueStale();
    this.loopDone = this.loop();
  }

  wake(): void {
    if (this.wakeUp) this.wakeUp();
    else this.wakePending = true;
  }

  /** Stop claiming new work and wait for in-flight jobs to finish. */
  async stop(): Promise<void> {
    this.running = false;
    clearInterval(this.staleTimer);
    this.wake();
    await this.loopDone;
    await Promise.allSettled(this.inFlight);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const free = this.options.concurrency - this.inFlight.size;
      let claimed: ImageRow[] = [];
      if (free > 0) {
        try {
          claimed = await this.repo.claimJobs(free);
        } catch (err) {
          this.logger.error({ err }, 'failed to claim jobs');
        }
      }
      for (const job of claimed) this.track(this.run(job));

      // Saturated: wait for a slot to free up. Otherwise we got fewer jobs than we asked
      // for, so the queue is drained: sleep until notified or the poll interval elapses.
      if (this.inFlight.size >= this.options.concurrency) await Promise.race(this.inFlight);
      else await this.sleep(this.options.pollIntervalMs);
    }
  }

  private track(job: Promise<void>): void {
    this.inFlight.add(job);
    void job.finally(() => {
      this.inFlight.delete(job);
      // A freed slot is a reason to look for more work.
      this.wake();
    });
  }

  private async run(job: ImageRow): Promise<void> {
    const log = this.logger.child({ imageId: job.id, attempt: job.attempts });
    const started = performance.now();
    try {
      const result = await this.processor.process(job);
      const row = await this.repo.complete(job.id, result, this.options.similarityMaxDistance);
      if (!row) {
        // Deleted by a user while we were working: don't leave derived files behind.
        await this.storage.delete([result.processedKey, result.thumbnailKey].filter((k): k is string => !!k));
        log.info('image deleted during processing; discarded result');
        return;
      }
      log.info(
        { status: row.status, reasons: row.rejection_reasons.map((r) => r.code), ms: Math.round(performance.now() - started) },
        'image processed',
      );
    } catch (err) {
      log.error({ err }, 'image processing failed');
      await this.repo
        .fail(job.id, err instanceof Error ? err.message : String(err), this.options.maxAttempts)
        .catch((failErr: unknown) => log.error({ err: failErr }, 'could not record failure'));
    }
  }

  private async requeueStale(): Promise<void> {
    try {
      const count = await this.repo.requeueStale(this.options.staleAfterSeconds);
      if (count) this.logger.warn({ count }, 'requeued stale jobs');
    } catch (err) {
      this.logger.error({ err }, 'failed to requeue stale jobs');
    }
  }

  private sleep(ms: number): Promise<void> {
    if (this.wakePending) {
      this.wakePending = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wakeUp = done;
    }).finally(() => {
      this.wakeUp = undefined;
    });
  }
}
