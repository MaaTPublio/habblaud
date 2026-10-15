// Parser de terminal para o formato JSONL do Google Antigravity (transcript.jsonl).
// Converte passos em TerminalEntry (user, thinking, tool, assistant, result, system).
import { basename } from 'node:path';
import { maskSecrets, truncate } from '../../../shared/activity';
import type { TerminalEntry, TerminalInputKind } from '../../../shared/types';
import { INPUT_MAX, TEXT_MAX, THINKING_MAX, type TerminalParser } from '../terminal';

export function formatAntigravityTool(
  tool: string,
  rawArgs: unknown,
): { title: string; input?: string; inputKind?: TerminalInputKind } {
  const args = typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : undefined;
  if (!args) return { title: tool };

  switch (tool) {
    case 'run_command': {
      const cmd = typeof args.CommandLine === 'string' ? args.CommandLine.trim() : '';
      return {
        title: cmd ? `Bash(${cmd})` : 'Bash',
        input: cmd || undefined,
        inputKind: 'command',
      };
    }
    case 'view_file': {
      const p = typeof args.AbsolutePath === 'string' ? args.AbsolutePath.trim() : '';
      const base = p ? basename(p) : '';
      return {
        title: base ? `Read(${base})` : 'Read',
        input: p || undefined,
        inputKind: 'text',
      };
    }
    case 'write_to_file': {
      const p = typeof args.TargetFile === 'string' ? args.TargetFile.trim() : '';
      const base = p ? basename(p) : '';
      const content = typeof args.CodeContent === 'string' ? args.CodeContent : '';
      return {
        title: base ? `Write(${base})` : 'Write',
        input: content || p || undefined,
        inputKind: content ? 'text' : undefined,
      };
    }
    case 'replace_file_content': {
      const p = typeof args.TargetFile === 'string' ? args.TargetFile.trim() : '';
      const base = p ? basename(p) : '';
      const target = typeof args.TargetContent === 'string' ? args.TargetContent : '';
      const replacement = typeof args.ReplacementContent === 'string' ? args.ReplacementContent : '';
      let diff = '';
      if (target || replacement) {
        const delLines = target ? target.split('\n').map((l) => `-${l}`).join('\n') : '';
        const addLines = replacement ? replacement.split('\n').map((l) => `+${l}`).join('\n') : '';
        diff = [delLines, addLines].filter(Boolean).join('\n');
      }
      return {
        title: base ? `Edit(${base})` : 'Edit',
        input: diff || undefined,
        inputKind: diff ? 'diff' : undefined,
      };
    }
    case 'search_web': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      return {
        title: q ? `Search(${q})` : 'Search',
        input: q || undefined,
        inputKind: 'text',
      };
    }
    case 'read_url_content': {
      const url = typeof args.Url === 'string' ? args.Url.trim() : '';
      return {
        title: url ? `Web(${url})` : 'Web',
        input: url || undefined,
        inputKind: 'text',
      };
    }
    default: {
      const summary = typeof args.toolSummary === 'string' ? args.toolSummary.trim() : typeof args.toolAction === 'string' ? args.toolAction.trim() : '';
      return {
        title: summary ? `${tool}(${summary})` : tool,
        input: JSON.stringify(args, null, 2),
        inputKind: 'json',
      };
    }
  }
}

export function createAntigravityTerminalParser(): TerminalParser {
  const seen = new Set<string>();
  const pendingToolIds: string[] = [];

  return {
    push(line: string): TerminalEntry[] {
      if (!line.trim()) return [];
      try {
        const step = JSON.parse(line) as Record<string, unknown>;
        const stepIdx = typeof step.step_index === 'number' ? step.step_index : Date.now();
        const at = step.created_at ? new Date(String(step.created_at)).getTime() : Date.now();
        const entries: TerminalEntry[] = [];

        // Prompt do usuário
        if (step.type === 'USER_INPUT' && typeof step.content === 'string' && step.content.trim()) {
          const id = `agy:p:${stepIdx}`;
          if (!seen.has(id)) {
            seen.add(id);
            entries.push({
              kind: 'user',
              id,
              at,
              text: maskSecrets(truncate(step.content, TEXT_MAX)),
            });
          }
        }

        // Raciocínio (thinking)
        if (typeof step.thinking === 'string' && step.thinking.trim()) {
          const id = `agy:th:${stepIdx}`;
          if (!seen.has(id)) {
            seen.add(id);
            entries.push({
              kind: 'thinking',
              id,
              at,
              text: maskSecrets(truncate(step.thinking, THINKING_MAX)),
            });
          }
        }

        // Chamadas de ferramentas
        if (Array.isArray(step.tool_calls)) {
          for (let i = 0; i < step.tool_calls.length; i++) {
            const call = step.tool_calls[i] as { name?: string; args?: unknown } | undefined;
            if (!call || typeof call.name !== 'string') continue;
            const id = `agy:t:${stepIdx}:${i}`;
            if (!seen.has(id)) {
              seen.add(id);
              pendingToolIds.push(id);
              const tool = call.name;
              const { title, input, inputKind } = formatAntigravityTool(tool, call.args);
              entries.push({
                kind: 'tool',
                id,
                at,
                tool,
                title,
                input: input ? maskSecrets(truncate(input, INPUT_MAX)) : undefined,
                inputKind,
              });
            }
          }
        }

        // Resultado de ferramenta (passo GENERIC logo após a tool call)
        if (step.type === 'GENERIC' && typeof step.content === 'string') {
          const toolUseId = pendingToolIds.shift();
          const id = `agy:r:${stepIdx}`;
          if (!seen.has(id)) {
            seen.add(id);
            if (toolUseId) {
              entries.push({
                kind: 'result',
                id,
                at,
                toolUseId,
                text: maskSecrets(truncate(step.content, TEXT_MAX)),
                error: step.status === 'ERROR',
              });
            }
          }
        }

        // Mensagens de sistema
        if ((step.type === 'SYSTEM_MESSAGE' || step.type === 'CHECKPOINT') && typeof step.content === 'string' && step.content.trim()) {
          const content = step.content.trim();
          if (!content.includes('not actually sent by the user') && !content.startsWith('checkpoint:')) {
            const id = `agy:s:${stepIdx}`;
            if (!seen.has(id)) {
              seen.add(id);
              entries.push({
                kind: 'system',
                id,
                at,
                text: maskSecrets(truncate(content, TEXT_MAX)),
              });
            }
          }
        }

        // Resposta final do assistente
        if (step.type === 'PLANNER_RESPONSE' && typeof step.content === 'string' && step.content.trim()) {
          const id = `agy:a:${stepIdx}`;
          if (!seen.has(id)) {
            seen.add(id);
            entries.push({
              kind: 'assistant',
              id,
              at,
              text: maskSecrets(truncate(step.content, TEXT_MAX)),
            });
          }
        }

        return entries;
      } catch {
        return [];
      }
    },
  };
}
