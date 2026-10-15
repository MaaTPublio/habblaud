// Detecção de logo/ícone na pasta do projeto aberta.
// Procura arquivos comuns de identidade visual do projeto (logo.png, icon.svg, etc.)
// de forma segura dentro da raiz do projeto.

import { statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** Nomes e caminhos relativos candidatos para a logo do projeto (em ordem de preferência). */
export const PROJECT_LOGO_CANDIDATES: readonly string[] = [
  'logo.png',
  'logo.svg',
  'logo.webp',
  'icon.png',
  'icon.svg',
  'icon.webp',
  'assets/logo.png',
  'assets/logo.svg',
  'assets/icon.png',
  'assets/icon.svg',
  'src/assets/logo.png',
  'src/assets/logo.svg',
  'public/logo.png',
  'public/logo.svg',
  'public/logo.webp',
  'public/icon.png',
  'public/icon.svg',
  'public/icon.webp',
  'public/favicon.png',
  'public/favicon.svg',
  'public/favicon.ico',
  '.github/logo.png',
  '.github/logo.svg',
  '.github/icon.png',
  '.github/assets/logo.png',
  'brand/logo.png',
  'brand/logo.svg',
  'client/public/assets/brand/logo-mark.png',
  'client/public/assets/brand/logo-detailed.png',
  'docs/logo.png',
  'docs/logo.svg',
];

const cache = new Map<string, { result: string | undefined; expiresAt: number }>();
const CACHE_TTL_MS = 5000;

/**
 * Encontra a logo na pasta do projeto aberta.
 * Retorna o caminho absoluto do arquivo ou undefined.
 * Protegido contra path traversal.
 */
export function findProjectLogo(projectDir: string | undefined, now = Date.now()): string | undefined {
  if (!projectDir || typeof projectDir !== 'string') return undefined;
  const root = resolve(projectDir);
  const hit = cache.get(root);
  if (hit && hit.expiresAt > now) return hit.result;

  let found: string | undefined;
  for (const rel of PROJECT_LOGO_CANDIDATES) {
    const target = resolve(root, rel);
    // Trava de segurança: impede path traversal
    if (target !== root && !target.startsWith(root + sep)) continue;
    try {
      const st = statSync(target);
      if (st.isFile() && st.size > 0) {
        found = target;
        break;
      }
    } catch {
      // Arquivo inexistente ou sem acesso
    }
  }

  cache.set(root, { result: found, expiresAt: now + CACHE_TTL_MS });
  return found;
}

/** Limpa o cache (útil para testes). */
export function clearProjectLogoCache(): void {
  cache.clear();
}
