// Cache em memoria + dedupe + stale-while-revalidate (abas instantaneas)

window.AppDataCache = {
  store: new Map(),
  inflight: new Map(),

  key(parts) {
    return Array.isArray(parts) ? parts.join('|') : String(parts);
  },

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt && Date.now() > hit.expiresAt) {
      // mantem stale se ainda dentro do soft window
      if (hit.staleUntil && Date.now() <= hit.staleUntil) {
        return { data: hit.data, stale: true };
      }
      this.store.delete(key);
      return null;
    }
    return { data: hit.data, stale: false };
  },

  /** Compat: retorna so o valor (ou null) */
  peek(key) {
    const hit = this.get(key);
    return hit ? hit.data : null;
  },

  set(key, data, ttlMs = 60000, softMs = 300000) {
    const now = Date.now();
    this.store.set(key, {
      data,
      expiresAt: ttlMs > 0 ? now + ttlMs : 0,
      staleUntil: softMs > 0 ? now + softMs : 0
    });
    return data;
  },

  /**
   * Retorna dados frescos do cache, ou stale imediatamente e revalida em background.
   * options.allowStale (default true): se true, devolve stale sem esperar rede.
   */
  async getOrFetch(key, ttlMs, fetcher, options = {}) {
    const allowStale = options.allowStale !== false;
    const softMs = options.softMs ?? Math.max(ttlMs * 5, 180000);
    const hit = this.get(key);

    if (hit && !hit.stale) return hit.data;

    const runFetch = () => {
      if (this.inflight.has(key)) return this.inflight.get(key);
      const promise = Promise.resolve()
        .then(fetcher)
        .then(data => {
          this.set(key, data, ttlMs, softMs);
          this.inflight.delete(key);
          return data;
        })
        .catch(err => {
          this.inflight.delete(key);
          throw err;
        });
      this.inflight.set(key, promise);
      return promise;
    };

    // Stale: devolve na hora e atualiza em background
    if (hit && hit.stale && allowStale) {
      runFetch().catch(() => {});
      return hit.data;
    }

    return runFetch();
  },

  invalidate(prefixOrKey) {
    if (!prefixOrKey) {
      this.store.clear();
      return;
    }
    const prefix = String(prefixOrKey);
    for (const key of this.store.keys()) {
      if (key === prefix || key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  },

  invalidateAll() {
    this.store.clear();
    this.inflight.clear();
  }
};
