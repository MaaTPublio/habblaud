import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Office } from '../model/office';
import { NameStore } from '../model/names';
import { tempDir } from '../test/fixtures';
import { RoomActivitySync } from './room-activity';

describe('RoomActivitySync', () => {
  it('cria e atualiza .habblaud/room-activity.md na pasta da sala quando há agentes', () => {
    const tmp = tempDir();
    try {
      const names = new NameStore(join(tmp.dir, 'names.json'));
      const office = new Office({
        names,
        version: '0.8.0',
        startedAt: 1000,
        accounts: () => [],
        sources: () => [],
        accountName: () => undefined,
      });

      const sync = new RoomActivitySync({
        office,
        debounceMs: 10,
        now: () => 2000,
      });

      // Adiciona agente 1 (Antigravity)
      office.addMain({
        id: 'antigravity:conv1',
        provider: 'antigravity',
        account: 'antigravity',
        sessionId: 'conv1',
        cwd: tmp.dir,
        role: 'Agente principal (Antigravity)',
        startedAt: 2000,
        status: 'working',
      });

      // Adiciona agente 2 (Codex)
      office.addMain({
        id: 'codex:thread1',
        provider: 'codex',
        account: 'codex',
        sessionId: 'thread1',
        cwd: tmp.dir,
        role: 'Agente principal (Codex)',
        startedAt: 2000,
        status: 'idle',
      });

      // Adiciona uma atividade
      office.addActivity(
        'antigravity:conv1',
        {
          id: 'act1',
          kind: 'edit',
          icon: '✏️',
          text: 'Editando server/model/rooms.ts',
          tool: 'replace_file_content',
          at: 2010,
        },
        true,
      );

      // Roda a sincronização síncrona
      sync.sync();

      const mdPath = join(tmp.dir, '.habblaud', 'room-activity.md');
      const jsonPath = join(tmp.dir, '.habblaud', 'room-activity.json');

      expect(existsSync(mdPath)).toBe(true);
      expect(existsSync(jsonPath)).toBe(true);
      expect(readFileSync(join(tmp.dir, '.habblaud', '.gitignore'), 'utf8')).toBe('*\n');

      const content = readFileSync(mdPath, 'utf8');
      expect(content).toContain('Habblaud — Atividade da Sala');
      expect(content).toContain('[ANTIGRAVITY]');
      expect(content).toContain('[CODEX]');
      expect(content).toContain('Editando server/model/rooms.ts');

      const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
      expect(json.agents.length).toBe(2);
      expect(json.agents.some((a: any) => a.provider === 'antigravity')).toBe(true);
      expect(json.agents.some((a: any) => a.provider === 'codex')).toBe(true);

      sync.stop();
    } finally {
      tmp.cleanup();
    }
  });
});
