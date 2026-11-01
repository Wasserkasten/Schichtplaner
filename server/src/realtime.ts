import type { FastifyReply } from 'fastify';
import type { DB } from './db.js';
import type { UserRow } from './auth.js';
import { Permissions } from './permissions.js';

interface Client {
  reply: FastifyReply;
  user: UserRow;
  perms: Permissions;
  gen: number;
}

/**
 * Live-Aktualisierung per Server-Sent Events.
 * Jede Änderung wird an alle verbundenen Clients verteilt – gefiltert und
 * maskiert entsprechend der Berechtigungen des jeweiligen Empfängers.
 */
export class RealtimeHub {
  private clients = new Set<Client>();
  private gen = 0;

  constructor(private db: DB) {}

  add(reply: FastifyReply, user: UserRow): () => void {
    const c: Client = { reply, user, perms: new Permissions(this.db, user), gen: this.gen };
    this.clients.add(c);
    return () => this.clients.delete(c);
  }

  /** Nach Änderungen an Rechten/Teams aufrufen: Berechtigungen werden neu berechnet. */
  invalidate(): void {
    this.gen++;
  }

  get size(): number {
    return this.clients.size;
  }

  /** `build` liefert pro Empfänger die Nutzlast oder null (= nicht senden). */
  broadcast(event: string, build: (perms: Permissions, user: UserRow) => unknown | null): void {
    for (const c of this.clients) {
      if (c.gen !== this.gen) {
        const fresh = this.db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(c.user.id) as
          | UserRow
          | undefined;
        if (!fresh) {
          c.reply.raw.end();
          this.clients.delete(c);
          continue;
        }
        c.user = fresh;
        c.perms = new Permissions(this.db, fresh);
        c.gen = this.gen;
      }
      const payload = build(c.perms, c.user);
      if (payload == null) continue;
      c.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }
}
