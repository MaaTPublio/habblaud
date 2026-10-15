// Parser de terminal para o formato JSONL do Google Antigravity (transcript.jsonl).
// Converte passos em TerminalEntry (user, thinking, tool, assistant).
import type { TerminalEntry } from '../../../shared/types';
import { maskSecrets, truncate } from '../../../shared/activity';
import { INPUT_MAX, TEXT_MAX, THINKING_MAX, type TerminalParser } from '../terminal';

export function createAntigravityTerminalParser(): TerminalParser {
  const seen = new Set<string>();

  return {
    push(line: string): TerminalEntry[] {
      if (!line.trim()) return [];
      try {
        const step = JSON.parse(line) as Record<string, unknown>;
        const stepIdx = typeof step.step_index === 'number' ? step.step_index : Date.now();
        const at = step.created_at ? new Date(String(step.created_at)).getTime() : Date.now();
        const entries: TerminalEntry[] = [];

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

        if (Array.isArray(step.tool_calls)) {
          for (let i = 0; i < step.tool_calls.length; i++) {
            const call = step.tool_calls[i] as { name?: string; args?: unknown } | undefined;
            if (!call || typeof call.name !== 'string') continue;
            const id = `agy:t:${stepIdx}:${i}`;
            if (!seen.has(id)) {
              seen.add(id);
              const tool = call.name;
              const input = typeof call.args === 'object' && call.args !== null ? JSON.stringify(call.args) : String(call.args ?? '');
              entries.push({
                kind: 'tool',
                id,
                at,
                tool,
                title: tool,
                input: maskSecrets(truncate(input, INPUT_MAX)),
                inputKind: 'json',
              });
            }
          }
        }

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
