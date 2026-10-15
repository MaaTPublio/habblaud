import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearProjectLogoCache, findProjectLogo, PROJECT_LOGO_CANDIDATES } from './project-logo';

describe('findProjectLogo', () => {
  it('retorna undefined para caminhos inválidos ou sem logo', () => {
    expect(findProjectLogo(undefined)).toBeUndefined();
    expect(findProjectLogo('')).toBeUndefined();
    expect(findProjectLogo('caminho-que-nao-existe-12345')).toBeUndefined();
  });

  it('encontra logo.png na raiz do projeto', () => {
    clearProjectLogoCache();
    const testDir = join(tmpdir(), 'habblaud-test-logo-' + Date.now());
    mkdirSync(testDir, { recursive: true });
    try {
      const logoPath = join(testDir, 'logo.png');
      writeFileSync(logoPath, 'fake-png-content');
      const found = findProjectLogo(testDir);
      expect(found).toBe(logoPath);
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('encontra public/icon.svg quando não há logo na raiz', () => {
    clearProjectLogoCache();
    const testDir = join(tmpdir(), 'habblaud-test-icon-' + Date.now());
    mkdirSync(join(testDir, 'public'), { recursive: true });
    try {
      const iconPath = join(testDir, 'public', 'icon.svg');
      writeFileSync(iconPath, '<svg></svg>');
      const found = findProjectLogo(testDir);
      expect(found).toBe(iconPath);
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('respeita a ordem de preferência', () => {
    clearProjectLogoCache();
    const testDir = join(tmpdir(), 'habblaud-test-prio-' + Date.now());
    mkdirSync(join(testDir, 'public'), { recursive: true });
    try {
      const rootLogo = join(testDir, 'logo.png');
      const publicFavicon = join(testDir, 'public', 'favicon.ico');
      writeFileSync(rootLogo, 'logo');
      writeFileSync(publicFavicon, 'favicon');
      const found = findProjectLogo(testDir);
      expect(found).toBe(rootLogo);
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
