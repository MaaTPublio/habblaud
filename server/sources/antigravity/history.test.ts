import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AntigravityHistory } from './history';

describe('AntigravityHistory', () => {
  let tempHome: string;
  const convId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(() => {
    tempHome = join(tmpdir(), `habblaud-test-ag-hist-${Date.now()}`);
    mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('reconhece a conta padrão antigravity', () => {
    const hist = new AntigravityHistory({ home: tempHome });
    expect(hist.hasAccount('antigravity')).toBe(true);
    expect(hist.hasAccount('.claude')).toBe(false);
  });

  it('resolve recusa id de sessão com formato inválido (400)', () => {
    const hist = new AntigravityHistory({ home: tempHome });
    const res = hist.resolve('antigravity', 'invalid-id');
    expect('error' in res && res.status).toBe(400);
  });

  it('resolve recusa conta desconhecida (404)', () => {
    const hist = new AntigravityHistory({ home: tempHome });
    const res = hist.resolve('outra-conta', convId);
    expect('error' in res && res.status).toBe(404);
  });

  it('resolve retorna 404 quando o transcript não existe', () => {
    const hist = new AntigravityHistory({ home: tempHome });
    const res = hist.resolve('antigravity', convId);
    expect('error' in res && res.status).toBe(404);
  });

  it('resolve encontra transcript existente e fornece createParser', () => {
    const agDir = join(tempHome, '.gemini', 'antigravity-cli');
    const logDir = join(agDir, 'brain', convId, '.system_generated', 'logs');
    mkdirSync(logDir, { recursive: true });
    const transcriptFile = join(logDir, 'transcript.jsonl');
    writeFileSync(transcriptFile, '{"step_index":0,"type":"USER_INPUT","content":"oi"}\n');

    const hist = new AntigravityHistory({ home: tempHome });
    const res = hist.resolve('antigravity', convId);
    expect('path' in res).toBe(true);
    if ('path' in res) {
      expect(res.path).toBe(transcriptFile);
      const parser = res.createParser();
      expect(typeof parser.push).toBe('function');
      const entries = parser.push('{"step_index":0,"type":"USER_INPUT","content":"oi"}');
      expect(entries).toHaveLength(1);
    }
  });

  it('list() lê sessões da pasta brain e indica se estão abertas no escritório', async () => {
    const agDir = join(tempHome, '.gemini', 'antigravity-cli');
    const logDir = join(agDir, 'brain', convId, '.system_generated', 'logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'transcript.jsonl'), '{"step_index":0}\n');

    const hist = new AntigravityHistory({
      home: tempHome,
      openAgentOf: (acc, sid) => (acc === 'antigravity' && sid === convId ? 'antigravity:agent-1' : undefined),
    });

    const sessions = await hist.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      account: 'antigravity',
      provider: 'antigravity',
      sessionId: convId,
      open: true,
      agentId: 'antigravity:agent-1',
    });
  });
});
