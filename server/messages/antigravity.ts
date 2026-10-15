// Mensagens pelo escritório para as sessões do Google Antigravity (`agy`):
// Executa `agy --conversation <convId> --prompt <texto>` no diretório do projeto.
import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { tr } from '../../shared/i18n';
import { findExecutable, isExecutableFile } from '../claude-bin';
import { CONVERSATION_ID_RE } from '../sources/antigravity/live';

/** Prazo máximo para execução de um prompt via agy (120 s). */
export const AGY_TIMEOUT_MS = 120_000;
const ERROR_MAX = 300;

export interface AntigravityPromptJob {
  /** Diretório de trabalho do agente. */
  cwd: string;
  /** Id da conversa (AgentInfo.sessionId). */
  conversationId: string;
  /** Texto da mensagem / comando. */
  text: string;
}

export type AntigravityPromptResult = { ok: true } | { ok: false; error: string };
export type AntigravityPromptRunner = (job: AntigravityPromptJob) => Promise<AntigravityPromptResult>;

export function antigravityArgs(conversationId: string, text: string): string[] {
  return ['--conversation', conversationId, '--prompt', text];
}

/** Executável do Antigravity CLI: HABBLAUD_AGY_BIN ou agy no PATH. undefined = não achou. */
export function findAgyBin(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const explicit = env.HABBLAUD_AGY_BIN?.trim();
  if (explicit) return isExecutableFile(explicit, platform) ? resolve(explicit) : undefined;
  return findExecutable('agy', env, platform);
}

export function createAntigravityPromptRunner(
  bin?: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): AntigravityPromptRunner {
  const executable = bin ?? findAgyBin(opts.env, process.platform) ?? 'agy';
  const timeoutMs = opts.timeoutMs ?? AGY_TIMEOUT_MS;

  return (job) =>
    new Promise<AntigravityPromptResult>((done) => {
      if (!CONVERSATION_ID_RE.test(job.conversationId)) {
        return done({ ok: false, error: tr('id de conversa do Antigravity inválido') });
      }
      const cwd = job.cwd && isAbsolute(job.cwd) ? job.cwd : process.cwd();
      const env = { ...(opts.env ?? process.env) };

      try {
        execFile(
          executable,
          antigravityArgs(job.conversationId, job.text),
          { cwd, env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
          (err, _stdout, stderr) => {
            if (!err) return done({ ok: true });
            const e = err as NodeJS.ErrnoException & { killed?: boolean };
            if (e.killed) {
              return done({
                ok: false,
                error: tr('o Antigravity demorou mais que {0} s para responder', [Math.round(timeoutMs / 1_000)]),
              });
            }
            if (e.code === 'ENOENT' || e.code === 'EACCES') {
              return done({ ok: false, error: tr('não consegui executar o agy ({0})', [executable]) });
            }
            const first = (stderr ?? '')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .find(Boolean);
            done({ ok: false, error: first ? first.slice(0, ERROR_MAX) : tr('falha ao enviar comando ao Antigravity') });
          },
        );
      } catch {
        done({ ok: false, error: tr('a mensagem contém caracteres inválidos para o Antigravity') });
      }
    });
}
