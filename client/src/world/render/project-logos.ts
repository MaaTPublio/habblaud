// Cache e carregamento assíncrono das logos dos projetos nas salas.

export class ProjectLogos {
  private readonly images = new Map<string, HTMLImageElement | null>();
  private readonly loading = new Set<string>();

  /**
   * Devolve a imagem carregada da logo da sala, se houver.
   * Se ainda não começou a carregar (e hasLogo for true), inicia o carregamento em segundo plano.
   */
  get(roomId: string, hasLogo?: boolean): HTMLImageElement | null {
    if (!hasLogo) return null;
    const hit = this.images.get(roomId);
    if (hit !== undefined) return hit;
    if (this.loading.has(roomId)) return null;

    this.loading.add(roomId);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.images.set(roomId, img.naturalWidth > 0 ? img : null);
      this.loading.delete(roomId);
    };
    img.onerror = () => {
      this.images.set(roomId, null);
      this.loading.delete(roomId);
    };
    img.src = `/api/rooms/logo?id=${encodeURIComponent(roomId)}`;
    return null;
  }

  /** Limpa o cache (usado em testes ou recarregamento). */
  clear(): void {
    this.images.clear();
    this.loading.clear();
  }
}
