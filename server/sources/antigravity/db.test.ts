import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../test/fixtures';
import { AntigravityDbWatcher, findAntigravityDir, resolveWorkspace, type DiscoveredSession } from './db';
import { createAntigravityTerminalParser } from './terminal';

const require = createRequire(import.meta.url);

describe('AntigravityDbWatcher & TerminalParser', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;

  beforeEach(() => {
    tmp = tempDir();
    home = tmp.dir;
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('resolveWorkspace trata caminhos locais e file://', () => {
    expect(resolveWorkspace(JSON.stringify(['file:///home/user/project']))).toBe('/home/user/project');
    expect(resolveWorkspace(JSON.stringify(['file:///C:/Users/user/project']))).toBe('C:/Users/user/project');
    expect(resolveWorkspace('caminho-invalido', '/fallback')).toBe('/fallback');
    expect(resolveWorkspace(undefined, '/fallback')).toBe('/fallback');
  });

  it('findAntigravityDir encontra .gemini/antigravity-cli ou .gemini/antigravity', () => {
    expect(findAntigravityDir(home)).toBeUndefined();
    const dir = join(home, '.gemini', 'antigravity-cli');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'conversation_summaries.db'), '');
    expect(findAntigravityDir(home)).toBe(dir);
  });

  it('detecta sessões e acha o transcript.jsonl', () => {
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync | undefined;
    try {
      DatabaseSync = require('node:sqlite').DatabaseSync;
    } catch {
      return;
    }
    if (!DatabaseSync) return;

    const agDir = join(home, '.gemini', 'antigravity-cli');
    mkdirSync(agDir, { recursive: true });
    const dbPath = join(agDir, 'conversation_summaries.db');

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        status TEXT,
        agent_name TEXT,
        parent_conversation_id TEXT,
        workspace_uris TEXT,
        not_fully_idle INTEGER,
        killed INTEGER,
        last_modified_time TEXT,
        last_user_input_time TEXT,
        step_count INTEGER
      )
    `);

    const convId = 'conv-test-1234';
    db.prepare(`
      INSERT INTO conversation_summaries (
        conversation_id, title, status, agent_name, parent_conversation_id, workspace_uris, not_fully_idle, killed, last_modified_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      convId,
      'Minha Sessão Agente',
      'CASCADE_RUN_STATUS_RUNNING',
      'Antigravity',
      null,
      JSON.stringify(['file:///home/ana/projeto']),
      1,
      0
    );
    db.close();

    const brainDir = join(agDir, 'brain', convId, '.system_generated', 'logs');
    mkdirSync(brainDir, { recursive: true });
    const transcriptPath = join(brainDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, '{"type":"USER_INPUT","step_index":0,"content":"Olá agy"}\n');

    const discovered: DiscoveredSession[] = [];
    const watcher = new AntigravityDbWatcher({
      home,
      now: () => Date.now(),
      onSession: (s) => discovered.push(s),
    });

    expect(watcher.isAvailable).toBe(true);
    watcher.poll();

    expect(discovered).toHaveLength(1);
    expect(discovered[0].convId).toBe(convId);
    expect(discovered[0].title).toBe('Minha Sessão Agente');
    expect(discovered[0].cwd).toBe('/home/ana/projeto');
    expect(discovered[0].status).toBe('working');

    expect(watcher.transcriptPathOf(convId)).toBe(transcriptPath);
    expect(watcher.transcriptPathOf('inexistente')).toBeUndefined();
  });

  it('createAntigravityTerminalParser interpreta linhas de transcript', () => {
    const parser = createAntigravityTerminalParser();

    const userInput = JSON.stringify({
      type: 'USER_INPUT',
      step_index: 0,
      content: 'Crie uma função fibonacci',
      created_at: '2026-10-15T12:00:00Z',
    });
    const promptEntries = parser.push(userInput);
    expect(promptEntries).toHaveLength(1);
    expect(promptEntries[0].kind).toBe('user');
    expect((promptEntries[0] as { text: string }).text).toBe('Crie uma função fibonacci');

    const modelResponse = JSON.stringify({
      type: 'PLANNER_RESPONSE',
      step_index: 1,
      thinking: 'Vou usar recursão com memorização...',
      content: 'Aqui está a implementação.',
      tool_calls: [
        { name: 'write_file', args: { path: 'fib.ts', content: 'function fib() {}' } },
      ],
      created_at: '2026-10-15T12:00:01Z',
    });
    const modelEntries = parser.push(modelResponse);
    expect(modelEntries).toHaveLength(3);
    expect(modelEntries.map((e) => e.kind)).toEqual(['thinking', 'tool', 'assistant']);
  });
});
