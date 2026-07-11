// Cache em memoria + dedupe de requests in-flight (acelera guias e dados)

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
      this.store.delete(key);
      return null;
    }
    return hit.data;
  },

  set(key, data, ttlMs = 60000) {
    this.store.set(key, {
      data,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0
    });
    return data;
  },

  /**
   * Retorna dados cacheados ou executa fetcher (deduplica chamadas iguais).
   */
  async getOrFetch(key, ttlMs, fetcher) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) return cached;

    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const promise = Promise.resolve()
      .then(fetcher)
      .then(data => {
        this.set(key, data, ttlMs);
        this.inflight.delete(key);
        return data;
      })
      .catch(err => {
        this.inflight.delete(key);
        throw err;
      });

    this.inflight.set(key, promise);
    return promise;
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
