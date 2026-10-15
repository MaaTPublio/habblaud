// server/sync/room-activity.ts
// Sincroniza em tempo real a atividade dos agentes da sala em um arquivo markdown (.habblaud/room-activity.md)
// dentro da raiz do projeto, permitindo que agentes de ferramentas diferentes (Antigravity, Codex, Claude)
// saibam o que os colegas de sala estão fazendo, quais arquivos estão sendo editados e evitem conflitos.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInfo } from '../../shared/types';
import type { Office } from '../model/office';

export interface RoomActivitySyncOptions {
  office: Office;
  debounceMs?: number;
  now?: () => number;
}

export class RoomActivitySync {
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private stopped = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: RoomActivitySyncOptions) {
    this.debounceMs = opts.debounceMs ?? 500;
    this.now = opts.now ?? Date.now;
    this.unsubscribe = opts.office.onChange(() => this.schedule());
  }

  schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sync();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  sync(): void {
    if (this.stopped) return;
    try {
      const agents = this.opts.office.list();
      const byRoom = new Map<string, AgentInfo[]>();
      for (const a of agents) {
        if (a.status === 'offline') continue;
        const list = byRoom.get(a.roomId) ?? [];
        list.push(a);
        byRoom.set(a.roomId, list);
      }

      for (const [roomId, roomAgents] of byRoom) {
        const roomPath = this.opts.office.roomPath(roomId) ?? roomId;
        if (!existsSync(roomPath)) continue;
        this.writeRoomActivity(roomPath, roomId, roomAgents);
      }
    } catch {
      // Ignora erros de leitura/escrita para proteger o processo principal
    }
  }

  private writeRoomActivity(roomPath: string, roomId: string, agents: AgentInfo[]): void {
    const dir = join(roomPath, '.habblaud');
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // A pasta se ignora sozinha: não aparece no git status do projeto observado.
      const ignore = join(dir, '.gitignore');
      if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8');

      const roomName = this.opts.office.roomName(roomId);
      const content = this.formatMarkdown(roomName, agents);
      writeFileSync(join(dir, 'room-activity.md'), content, 'utf8');

      const jsonContent = JSON.stringify(
        {
          room: roomName,
          path: roomPath,
          updatedAt: this.now(),
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            provider: a.provider ?? 'claude',
            role: a.role,
            status: a.status,
            waitingFor: a.waitingFor,
            activity: a.activity
              ? {
                  tool: a.activity.tool,
                  text: a.activity.text,
                  detail: a.activity.detail,
                  at: a.activity.at,
                }
              : undefined,
            tasks: a.tasks,
          })),
        },
        null,
        2,
      );
      writeFileSync(join(dir, 'room-activity.json'), jsonContent, 'utf8');
    } catch {
      // Ignora falhas de disco
    }
  }

  private formatMarkdown(roomName: string, agents: AgentInfo[]): string {
    const lines: string[] = [
      `# 🏢 Habblaud — Atividade da Sala: ${roomName}`,
      '> *Este arquivo é mantido em tempo real pelo Habblaud para sincronizar agentes de IA que atuam neste projeto.*',
      '> *Agentes (Antigravity, Codex, Claude): consultem este arquivo para saber o que outros agentes estão fazendo e evitar edições concorrentes.*',
      '',
      `**Última atualização:** ${new Date(this.now()).toLocaleTimeString()}`,
      `**Agentes ativos na sala:** ${agents.length}`,
      '',
      '## 👥 Agentes Presentes',
    ];

    for (const a of agents) {
      const prov = (a.provider ?? 'claude').toUpperCase();
      const statusIcon = a.status === 'working' ? '🟡' : a.status === 'waiting' ? '✋' : a.status === 'shell' ? '⏳' : '🟢';
      const actText = a.activity ? `${a.activity.text}${a.activity.detail ? ` (${a.activity.detail})` : ''}` : 'Sem atividade recente';
      lines.push(`- **${a.name}** [${prov}] ${statusIcon} \`${a.status}\` — ${actText}`);
      if (a.waitingFor) {
        lines.push(`  - *Aguardando:* ${a.waitingFor}`);
      }
      if (a.tasks && a.tasks.length > 0) {
        lines.push('  - *Tarefas:*');
        for (const t of a.tasks) {
          const check = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[/]' : '[ ]';
          lines.push(`    - ${check} ${t.title}`);
        }
      }
    }

    lines.push('');
    lines.push('## ⚡ Atividades Recentes dos Colegas');
    const recentEvents: Array<{ agent: string; prov: string; act: { text: string; at: number; detail?: string } }> = [];
    for (const a of agents) {
      const prov = (a.provider ?? 'claude').toUpperCase();
      for (const act of a.recent.slice(-5)) {
        recentEvents.push({ agent: a.name, prov, act });
      }
    }
    recentEvents.sort((x, y) => y.act.at - x.act.at);

    if (recentEvents.length === 0) {
      lines.push('*Nenhuma atividade registrada ainda.*');
    } else {
      for (const ev of recentEvents.slice(0, 10)) {
        const time = new Date(ev.act.at).toLocaleTimeString();
        lines.push(`- \`${time}\` **${ev.agent}** (${ev.prov}): ${ev.act.text}${ev.act.detail ? ` — \`${ev.act.detail}\`` : ''}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
