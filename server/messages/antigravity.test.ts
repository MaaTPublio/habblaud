// Mensagens ao Antigravity: o `agy --conversation <convId> --prompt <texto>`,
// findAgyBin (HABBLAUD_AGY_BIN ou PATH), e o registro MessageRegistry com o entregador
// do Antigravity (executando agy diretamente, uma mensagem por vez por agente).
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import {
  AGY_TIMEOUT_MS,
  antigravityArgs,
  createAntigravityPromptRunner,
  findAgyBin,
  type AntigravityPromptJob,
  type AntigravityPromptResult,
} from './antigravity';
import { MessageRegistry, type SendResult } from './registry';

setQuiet(true);

const CONV_ID = '0199b0c0-1234-7abc-8def-0123456789ab';
const MAIN = `antigravity:${CONV_ID}`;

function sent(r: SendResult): string {
  if (!('message' in r)) throw new Error(`recusada: ${JSON.stringify(r)}`);
  return r.message.id;
}

describe('antigravity prompt runner (funções utilitárias)', () => {
  it('antigravityArgs: monta os argumentos corretos para o agy', () => {
    expect(antigravityArgs(CONV_ID, 'meu comando')).toEqual([
      '--conversation',
      CONV_ID,
      '--prompt',
      'meu comando',
    ]);
  });

  it('findAgyBin: acha pelo HABBLAUD_AGY_BIN se existir e for executável, ou pelo PATH', () => {
    expect(findAgyBin({ HABBLAUD_AGY_BIN: 'caminho/falso/nao_existe' })).toBeUndefined();
    expect(findAgyBin({ PATH: '' })).toBeUndefined();
  });

  it('createAntigravityPromptRunner: valida id da conversa antes de executar', async () => {
    const run = createAntigravityPromptRunner();
    const result = await run({
      cwd: process.cwd(),
      conversationId: 'invalido!@#$',
      text: 'ola',
    });
    expect(result).toEqual({ ok: false, error: 'id de conversa do Antigravity inválido' });
  });
});

describe('MessageRegistry: Antigravity', () => {
  function setup(runner?: (job: AntigravityPromptJob) => Promise<AntigravityPromptResult>) {
    let now = 1_000_000;
    const clock = { now: () => now, advance: (ms: number) => (now += ms) };
    let registry: MessageRegistry | undefined;
    const office = new Office({
      names: new NameStore(null),
      version: 't',
      startedAt: 0,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
      messages: () => registry?.reachable() ?? new Set(),
      now: clock.now,
    });
    office.addMain({
      id: MAIN,
      provider: 'antigravity',
      account: 'antigravity',
      sessionId: CONV_ID,
      cwd: '/p/projeto',
      role: 'Agente principal (Antigravity)',
      startedAt: 0,
      status: 'idle',
    });
    registry = new MessageRegistry({
      office,
      antigravity: runner ? { run: runner } : undefined,
      now: clock.now,
    });
    return { office, registry, clock };
  }

  it('canMessage e reachable: só com entregador configurado e agente presente', () => {
    const { office, registry } = setup();
    expect(registry.antigravityAvailable()).toBe(false);
    expect(registry.canMessage(MAIN)).toBe(false);
    expect(registry.reachable().has(MAIN)).toBe(false);

    const withRunner = setup(async () => ({ ok: true }));
    expect(withRunner.registry.antigravityAvailable()).toBe(true);
    expect(withRunner.registry.canMessage(MAIN)).toBe(true);
    expect(withRunner.registry.reachable().has(MAIN)).toBe(true);
  });

  it('envio de comando ao Antigravity: sucesso marca como delivered e adiciona atividade', async () => {
    const jobs: AntigravityPromptJob[] = [];
    let resolvePrompt: ((res: AntigravityPromptResult) => void) | undefined;
    const runner = (job: AntigravityPromptJob) =>
      new Promise<AntigravityPromptResult>((done) => {
        jobs.push(job);
        resolvePrompt = done;
      });

    const { office, registry, clock } = setup(runner);
    const id = sent(registry.send({ agentId: MAIN, text: 'faça os testes' }));

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      cwd: '/p/projeto',
      conversationId: CONV_ID,
      text: 'faça os testes',
    });
    expect(registry.get(id)?.status).toBe('sent');

    // Quando o prompt completa com sucesso:
    resolvePrompt!({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.get(id)?.status).toBe('delivered');
    const agent = office.get(MAIN);
    expect(agent?.recent.at(-1)).toMatchObject({
      text: 'Mensagem pelo Habblaud',
      detail: 'faça os testes',
    });
  });

  it('envio de comando ao Antigravity: erro marca como failed com mensagem', async () => {
    const runner = async () => ({ ok: false as const, error: 'erro ao executar agy' });
    const { registry } = setup(runner);
    const id = sent(registry.send({ agentId: MAIN, text: 'comando com erro' }));

    await Promise.resolve();
    await Promise.resolve();

    expect(registry.get(id)).toMatchObject({
      status: 'failed',
      error: 'erro ao executar agy',
    });
  });

  it('envia um por vez por agente e processa fila na ordem', async () => {
    const jobs: AntigravityPromptJob[] = [];
    const resolvers: Array<(r: AntigravityPromptResult) => void> = [];
    const runner = (job: AntigravityPromptJob) =>
      new Promise<AntigravityPromptResult>((done) => {
        jobs.push(job);
        resolvers.push(done);
      });

    const { registry } = setup(runner);
    const id1 = sent(registry.send({ agentId: MAIN, text: 'primeiro' }));
    const id2 = sent(registry.send({ agentId: MAIN, text: 'segundo' }));

    expect(jobs).toHaveLength(1);
    expect(jobs[0].text).toBe('primeiro');
    expect(registry.get(id1)?.status).toBe('sent');
    expect(registry.get(id2)?.status).toBe('queued');

    resolvers[0]({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.get(id1)?.status).toBe('delivered');
    expect(jobs).toHaveLength(2);
    expect(jobs[1].text).toBe('segundo');
    expect(registry.get(id2)?.status).toBe('sent');

    resolvers[1]({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.get(id2)?.status).toBe('delivered');
  });
});
