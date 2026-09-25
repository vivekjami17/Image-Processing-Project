import type { Response } from 'express';
import type { Logger } from '../logger.js';
import type { ImageDto } from './imageDto.js';

export type ClientEvent =
  | { type: 'image.updated'; image: ImageDto }
  | { type: 'image.deleted'; id: string }
  | { type: 'resync' };

/** Fan-out of image status changes to connected browsers over Server-Sent Events. */
export class EventHub {
  private clients = new Set<Response>();
  private heartbeat: NodeJS.Timeout;

  constructor(private readonly logger: Logger) {
    // Keeps idle connections open through proxies and load balancers.
    this.heartbeat = setInterval(() => this.write(': ping\n\n'), 25_000);
    this.heartbeat.unref();
  }

  subscribe(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  publish(event: ClientEvent): void {
    this.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }

  private write(chunk: string): void {
    for (const res of this.clients) {
      try {
        res.write(chunk);
      } catch (err) {
        this.logger.debug({ err }, 'dropping SSE client');
        this.clients.delete(res);
      }
    }
  }
}
