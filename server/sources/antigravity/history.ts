// Histórico do terminal do Google Antigravity (o HistoryProvider 'antigravity', ver sources/source.ts): as conversas
// recentes listadas a partir de conversation_summaries.db e dos transcripts em ~/.gemini/antigravity-cli/brain/<convId>/.system_generated/logs/transcript.jsonl.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type { RecentSession } from '../../../shared/types';
import { errMsg, log } from '../../log';
import { HISTORY_LIMIT, HISTORY_MAX_AGE_MS } from '../history';
import type { HistoryProvider, HistoryResolveResult } from '../source';
import { encodeCwd } from '../watcher';
import { findAntigravityDir, resolveWorkspace } from './db';
import { CONVERSATION_ID_RE } from './live';
import { createAntigravityTerminalParser } from './terminal';
import { tr } from '../../../shared/i18n';

const require = createRequire(import.meta.url);

function getDatabaseSync(): typeof import('node:sqlite').DatabaseSync | undefined {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    return undefined;
  }
}

export interface AntigravityHistoryAccount {
  id: string;
}

export interface AntigravityHistoryOptions {
  home?: string;
  accounts?: () => readonly AntigravityHistoryAccount[];
  /** Agente principal da sessão, se ela ainda estiver aberta no escritório. */
  openAgentOf?: (account: string, sessionId: string) => string | undefined;
  now?: () => number;
  maxAgeMs?: number;
  limit?: number;
}

interface ConversationRow {
  conversation_id: string;
  title?: string;
  preview?: string;
  last_modified_time?: string;
  workspace_uris?: string;
  parent_conversation_id?: string;
}

export class AntigravityHistory implements HistoryProvider {
  readonly provider = 'antigravity' as const;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly limit: number;

  constructor(private readonly opts: AntigravityHistoryOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxAgeMs = opts.maxAgeMs ?? HISTORY_MAX_AGE_MS;
    this.limit = opts.limit ?? HISTORY_LIMIT;
  }

  hasAccount(account: string): boolean {
    if (account === 'antigravity') return true;
    return this.opts.accounts?.().some((a) => a.id === account) ?? false;
  }

  async list(): Promise<RecentSession[]> {
    const dir = findAntigravityDir(this.opts.home ?? homedir());
    if (!dir) return [];

    const now = this.now();
    const sessions: RecentSession[] = [];
    const seenIds = new Set<string>();

    const dbPath = join(dir, 'conversation_summaries.db');
    const DatabaseSync = getDatabaseSync();

    if (DatabaseSync && existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        let rows: ConversationRow[] = [];
        try {
          const stmt = db.prepare(`
            SELECT
              conversation_id,
              title,
              preview,
              last_modified_time,
              workspace_uris,
              parent_conversation_id
            FROM conversation_summaries
            WHERE killed = 0
            ORDER BY last_modified_time DESC
            LIMIT :limit
          `);
          rows = stmt.all({ limit: this.limit * 2 }) as unknown as ConversationRow[];
        } finally {
          db.close();
        }

        for (const row of rows) {
          const convId = row.conversation_id;
          if (!convId || !CONVERSATION_ID_RE.test(convId)) continue;
          if (row.parent_conversation_id) continue; // subagentes ficam de fora
          if (seenIds.has(convId)) continue;

          const transcriptPath = join(dir, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
          let size = 0;
          let mtimeMs = now;
          try {
            const st = await stat(transcriptPath);
            if (!st.isFile()) continue;
            size = st.size;
            mtimeMs = st.mtimeMs;
          } catch {
            continue; // transcript ausente
          }

          let lastAt = row.last_modified_time ? new Date(row.last_modified_time).getTime() : mtimeMs;
          if (Number.isNaN(lastAt) || lastAt <= 0) lastAt = mtimeMs;
          if (now - lastAt > this.maxAgeMs) continue;

          seenIds.add(convId);
          const cwd = resolveWorkspace(row.workspace_uris);
          const agentId = this.opts.openAgentOf?.('antigravity', convId);

          const s: RecentSession = {
            account: 'antigravity',
            provider: 'antigravity',
            sessionId: convId,
            project: cwd,
            projectDir: encodeCwd(cwd),
            title: row.title?.trim() || row.preview?.trim() || undefined,
            lastAt,
            size,
            open: !!agentId,
          };
          if (agentId) s.agentId = agentId;
          sessions.push(s);
        }
      } catch (err) {
        log.warnOnce('antigravity-history-db', tr('Histórico do Antigravity: falha ao ler SQLite ({0}).', [errMsg(err)]));
      }
    }

    // Se o banco não trouxe nada (ou não existe), varre a pasta brain como fallback
    if (sessions.length === 0) {
      const brainDir = join(dir, 'brain');
      try {
        const entries = await readdir(brainDir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory() || !CONVERSATION_ID_RE.test(ent.name)) continue;
          const convId = ent.name;
          if (seenIds.has(convId)) continue;

          const transcriptPath = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
          try {
            const st = await stat(transcriptPath);
            if (!st.isFile() || now - st.mtimeMs > this.maxAgeMs) continue;
            seenIds.add(convId);
            const agentId = this.opts.openAgentOf?.('antigravity', convId);
            const s: RecentSession = {
              account: 'antigravity',
              provider: 'antigravity',
              sessionId: convId,
              projectDir: 'antigravity',
              lastAt: st.mtimeMs,
              size: st.size,
              open: !!agentId,
            };
            if (agentId) s.agentId = agentId;
            sessions.push(s);
          } catch {}
        }
      } catch {}
    }

    return sessions.sort((a, b) => b.lastAt - a.lastAt).slice(0, this.limit);
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    if (!CONVERSATION_ID_RE.test(sessionId)) {
      return { status: 400, error: tr('id de sessão inválido') };
    }
    if (!this.hasAccount(account)) {
      return { status: 404, error: tr('conta desconhecida') };
    }

    const dir = findAntigravityDir(this.opts.home ?? homedir());
    if (!dir) return { status: 404, error: tr('sessão não encontrada') };

    const convId = sessionId.toLowerCase();
    const transcriptPath = join(dir, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');

    try {
      const root = realpathSync(dir);
      const real = realpathSync(transcriptPath);
      if (!real.startsWith(root + sep)) {
        return { status: 404, error: tr('sessão não encontrada') };
      }
      const st = statSync(real);
      if (!st.isFile()) {
        return { status: 404, error: tr('sessão não encontrada') };
      }
      return { path: real, createParser: createAntigravityTerminalParser };
    } catch {
      return { status: 404, error: tr('sessão não encontrada') };
    }
  }
}
