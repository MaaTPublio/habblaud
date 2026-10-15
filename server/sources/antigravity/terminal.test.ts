import { describe, expect, it } from 'vitest';
import { createAntigravityTerminalParser, formatAntigravityTool } from './terminal';

describe('formatAntigravityTool', () => {
  it('formata run_command como Bash(...) com input tipo command', () => {
    const f = formatAntigravityTool('run_command', { CommandLine: 'npm test' });
    expect(f.title).toBe('Bash(npm test)');
    expect(f.input).toBe('npm test');
    expect(f.inputKind).toBe('command');
  });

  it('formata view_file como Read(arquivo)', () => {
    const f = formatAntigravityTool('view_file', { AbsolutePath: 'C:\\project\\src\\index.ts' });
    expect(f.title).toBe('Read(index.ts)');
    expect(f.input).toBe('C:\\project\\src\\index.ts');
    expect(f.inputKind).toBe('text');
  });

  it('formata replace_file_content como Edit(arquivo) com diff colorido', () => {
    const f = formatAntigravityTool('replace_file_content', {
      TargetFile: 'server/index.ts',
      TargetContent: 'const a = 1;',
      ReplacementContent: 'const a = 2;',
    });
    expect(f.title).toBe('Edit(index.ts)');
    expect(f.inputKind).toBe('diff');
    expect(f.input).toContain('-const a = 1;');
    expect(f.input).toContain('+const a = 2;');
  });

  it('formata search_web como Search(query)', () => {
    const f = formatAntigravityTool('search_web', { query: 'antigravity terminal' });
    expect(f.title).toBe('Search(antigravity terminal)');
    expect(f.input).toBe('antigravity terminal');
  });

  it('formata read_url_content como Web(url)', () => {
    const f = formatAntigravityTool('read_url_content', { Url: 'https://habblaud.com' });
    expect(f.title).toBe('Web(https://habblaud.com)');
    expect(f.input).toBe('https://habblaud.com');
  });

  it('usa toolSummary ou toolAction para ferramentas desconhecidas', () => {
    const f = formatAntigravityTool('custom_tool', { toolSummary: 'Executa ação X' });
    expect(f.title).toBe('custom_tool(Executa ação X)');
    expect(f.inputKind).toBe('json');
  });
});

describe('createAntigravityTerminalParser', () => {
  it('converte sequência de passos do transcript em TerminalEntry com vínculo tool -> result', () => {
    const parser = createAntigravityTerminalParser();

    // 1. Prompt do usuário
    const userEntries = parser.push(
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        source: 'USER_EXPLICIT',
        content: 'Como funciona o terminal do antigravity?',
        created_at: '2026-10-15T12:00:00Z',
      }),
    );
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0]).toMatchObject({
      kind: 'user',
      id: 'agy:p:0',
      text: 'Como funciona o terminal do antigravity?',
    });

    // 2. Modelo pensando e chamando ferramenta
    const modelStep = parser.push(
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        thinking: 'Vou pesquisar no repositório.',
        tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm test' } }],
        created_at: '2026-10-15T12:00:05Z',
      }),
    );
    expect(modelStep).toHaveLength(2);
    expect(modelStep[0]).toMatchObject({
      kind: 'thinking',
      id: 'agy:th:1',
      text: 'Vou pesquisar no repositório.',
    });
    expect(modelStep[1]).toMatchObject({
      kind: 'tool',
      id: 'agy:t:1:0',
      tool: 'run_command',
      title: 'Bash(npm test)',
      input: 'npm test',
      inputKind: 'command',
    });

    // 3. Resultado da ferramenta (GENERIC)
    const resultStep = parser.push(
      JSON.stringify({
        step_index: 2,
        type: 'GENERIC',
        source: 'MODEL',
        status: 'DONE',
        content: 'Tests passed: 42 passed',
        created_at: '2026-10-15T12:00:10Z',
      }),
    );
    expect(resultStep).toHaveLength(1);
    expect(resultStep[0]).toMatchObject({
      kind: 'result',
      id: 'agy:r:2',
      toolUseId: 'agy:t:1:0',
      text: 'Tests passed: 42 passed',
      error: false,
    });

    // 4. Resposta final do modelo
    const assistantStep = parser.push(
      JSON.stringify({
        step_index: 3,
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        content: 'Todos os testes passaram com sucesso!',
        created_at: '2026-10-15T12:00:12Z',
      }),
    );
    expect(assistantStep).toHaveLength(1);
    expect(assistantStep[0]).toMatchObject({
      kind: 'assistant',
      id: 'agy:a:3',
      text: 'Todos os testes passaram com sucesso!',
    });
  });

  it('ignora linhas vazias ou JSON inválido sem falhar', () => {
    const parser = createAntigravityTerminalParser();
    expect(parser.push('')).toEqual([]);
    expect(parser.push('   \n')).toEqual([]);
    expect(parser.push('{ invalid json')).toEqual([]);
  });

  it('filtra ruídos internos de SYSTEM_MESSAGE e checkpoints técnicos', () => {
    const parser = createAntigravityTerminalParser();
    const noisy = parser.push(
      JSON.stringify({
        step_index: 99,
        type: 'SYSTEM_MESSAGE',
        content: '<SYSTEM_MESSAGE> not actually sent by the user. You are running a task.',
      }),
    );
    expect(noisy).toEqual([]);

    const valid = parser.push(
      JSON.stringify({
        step_index: 100,
        type: 'SYSTEM_MESSAGE',
        content: 'Workspace updated successfully',
      }),
    );
    expect(valid).toHaveLength(1);
    expect(valid[0].kind).toBe('system');
  });
});
