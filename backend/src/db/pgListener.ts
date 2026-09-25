import { EventEmitter } from 'node:events';
import pg from 'pg';
import type { Logger } from '../logger.js';

/**
 * A dedicated connection for LISTEN (pooled connections can't hold subscriptions).
 * Reconnects with backoff; emits `notification` (channel, payload) and `reconnect`,
 * the latter so consumers can catch up on anything missed while disconnected.
 */
export class PgListener extends EventEmitter<{
  notification: [channel: string, payload: string];
  reconnect: [];
}> {
  private client: pg.Client | undefined;
  private stopped = false;
  private retryMs = 500;

  constructor(
    private readonly connectionString: string,
    private readonly channels: string[],
    private readonly logger: Logger,
  ) {
    super();
  }

  async start(): Promise<void> {
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => this.emit('notification', msg.channel, msg.payload ?? ''));
    client.on('error', (err) => {
      this.logger.warn({ err }, 'pg listener connection error');
      void this.scheduleReconnect(client);
    });
    client.on('end', () => void this.scheduleReconnect(client));

    await client.connect();
    for (const channel of this.channels) await client.query(`LISTEN ${pg.escapeIdentifier(channel)}`);
    this.client = client;
    this.retryMs = 500;
  }

  private async scheduleReconnect(failed: pg.Client): Promise<void> {
    if (this.stopped || this.client !== failed) return;
    this.client = undefined;
    while (!this.stopped) {
      await new Promise((r) => setTimeout(r, this.retryMs));
      try {
        await this.connect();
        this.logger.info('pg listener reconnected');
        this.emit('reconnect');
        return;
      } catch (err) {
        this.retryMs = Math.min(this.retryMs * 2, 30_000);
        this.logger.warn({ err, retryMs: this.retryMs }, 'pg listener reconnect failed');
      }
    }
  }
}
