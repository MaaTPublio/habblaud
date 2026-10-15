// Observador passivo do banco SQLite do Antigravity (conversation_summaries.db).
// Descobre sessões ativas automaticamente mesmo sem nenhum hook instalado.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus } from '../../../shared/types';
import { errMsg, log } from '../../log';
import { normalizeCwd } from '../../model/rooms';

const require = createRequire(import.meta.url);

function getDatabaseSync(): typeof import('node:sqlite').DatabaseSync | undefined {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    return undefined;
  }
}

export function findAntigravityDir(home: string = homedir()): string | undefined {
  for (const candidate of ['.gemini/antigravity-cli', '.gemini/antigravity']) {
    const dir = join(home, candidate);
    if (existsSync(join(dir, 'conversation_summaries.db')) || existsSync(join(dir, 'brain'))) return dir;
  }
  return undefined;
}

export function resolveWorkspace(raw: unknown, fallback: string = process.cwd()): string {
  try {
    if (typeof raw === 'string') {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list[0]) {
        let uri = String(list[0]);
        if (uri.startsWith('file:///')) {
          uri = uri.slice(7);
          if (/^\/[A-Za-z]:/.test(uri)) uri = uri.slice(1);
        } else if (uri.startsWith('file://')) {
          uri = uri.slice(7);
        }
        return normalizeCwd(decodeURIComponent(uri));
      }
    }
  } catch {}
  return normalizeCwd(fallback);
}

export interface DiscoveredSession {
  convId: string;
  title?: string;
  cwd: string;
  status: AgentStatus;
  lastModifiedAt: number;
  isSub: boolean;
  parentId?: string;
}

export interface AntigravityDbWatcherOptions {
  home?: string;
  pollMs?: number;
  now?: () => number;
  onSession: (session: DiscoveredSession) => void;
}

interface ConversationRow {
  conversation_id: string;
  title?: string;
  status?: string;
  agent_name?: string;
  parent_conversation_id?: string;
  workspace_uris?: string;
  not_fully_idle?: number;
  killed?: number;
  last_modified_time?: string;
  last_user_input_time?: string;
}

export class AntigravityDbWatcher {
  readonly antigravityDir: string | undefined;
  private readonly dbPath: string | undefined;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly opts: AntigravityDbWatcherOptions) {
    this.antigravityDir = findAntigravityDir(opts.home);
    this.dbPath = this.antigravityDir ? join(this.antigravityDir, 'conversation_summaries.db') : undefined;
    this.now = opts.now ?? Date.now;
  }

  get isAvailable(): boolean {
    return !!this.dbPath && existsSync(this.dbPath);
  }

  start(): void {
    if (!this.isAvailable) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 2_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  transcriptPathOf(convId: string): string | undefined {
    if (!this.antigravityDir) return undefined;
    const p = join(this.antigravityDir, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
    return existsSync(p) ? p : undefined;
  }

  poll(): void {
    if (this.stopped || !this.dbPath || !existsSync(this.dbPath)) return;
    const DatabaseSync = getDatabaseSync();
    if (!DatabaseSync) return;

    let rows: ConversationRow[] = [];
    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const stmt = db.prepare(`
          SELECT
            conversation_id,
            title,
            status,
            agent_name,
            parent_conversation_id,
            workspace_uris,
            not_fully_idle,
            killed,
            last_modified_time,
            last_user_input_time
          FROM conversation_summaries
          WHERE killed = 0 AND (not_fully_idle = 1 OR last_modified_time > datetime('now', '-2 hours'))
          ORDER BY last_modified_time DESC
          LIMIT 25
        `);
        rows = stmt.all() as unknown as ConversationRow[];
      } finally {
        db.close();
      }
    } catch (err) {
      log.warnOnce('antigravity-db-poll', `AntigravityDbWatcher: falha ao ler SQLite (${errMsg(err)}).`);
      return;
    }

    for (const row of rows) {
      const convId = row.conversation_id;
      if (!convId) continue;
      const isSub = Boolean(row.parent_conversation_id);
      const isWorking = row.not_fully_idle === 1 || row.status === 'CASCADE_RUN_STATUS_RUNNING';
      const status: AgentStatus = isWorking ? 'working' : 'idle';
      const cwd = resolveWorkspace(row.workspace_uris);
      const lastModifiedAt = row.last_modified_time ? new Date(row.last_modified_time).getTime() : this.now();

      this.opts.onSession({
        convId,
        title: row.title || undefined,
        cwd,
        status,
        lastModifiedAt,
        isSub,
        parentId: row.parent_conversation_id || undefined,
      });
    }
  }
}
