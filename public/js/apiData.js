// Sync, docs, units API
Object.assign(window.AppApi = window.AppApi || {}, {
}, {
async fetchBatch({ startNsu, environment, cnpjConsulta, certificateId, sortOrder }) {
    const res = await fetch('/api/fetch-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startNsu,
        environment,
        cnpjConsulta,
        certificateId,
        sortOrder
      })
    });
    return res.json();
  },

  async discoverNsu({ environment, cnpjConsulta, certificateId }) {
    const res = await fetch('/api/discover-nsu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment, cnpjConsulta, certificateId })
    });
    return res.json();
  },

  async fetchSyncState({ environment, cnpjConsulta, certificateId }) {
    const params = new URLSearchParams({
      environment,
      cnpjConsulta: cnpjConsulta || '',
      certificateId: certificateId || ''
    });
    const key = `sync-state:${params.toString()}`;
    const cache = window.AppDataCache;
    if (!cache) {
      return (await fetch(`/api/sync-state?${params.toString()}`)).json();
    }
    return cache.getOrFetch(key, 40000, async () => {
      const res = await fetch(`/api/sync-state?${params.toString()}`);
      return res.json();
    }, { softMs: 240000 });
  },

  async clearDownloads() {
    const res = await fetch('/api/clear-downloads', { method: 'POST' });
    return res.json();
  },

  async downloadFromApi(url, fallbackFileName) {
    const res = await fetch(url);
    if (!res.ok) {
      let message = 'Falha ao baixar arquivo.';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (e) {
        message = await res.text();
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const fileName = match ? match[1] : fallbackFileName;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  },

  async fetchSchedulerSettings() {
    return (await fetch('/api/scheduler-settings')).json();
  },

  async saveSchedulerSettings(settings) {
    return (await fetch('/api/scheduler-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })).json();
  },

  async runSchedulerNow() {
    return (await fetch('/api/scheduler-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })).json();
  },

  async listDocuments(params) {
    const qs = new URLSearchParams(params).toString();
    const key = `history:${qs}`;
    const cache = window.AppDataCache;
    if (!cache) {
      const res = await fetch(`/api/list-documents?${qs}`);
      return this._jsonOrThrow(res, 'Falha ao listar documentos.');
    }
    return cache.getOrFetch(key, 45000, async () => {
      const res = await fetch(`/api/list-documents?${qs}`);
      return this._jsonOrThrow(res, 'Falha ao listar documentos.');
    }, { softMs: 300000 });
  },

  async getDocumentTotals(params) {
    const qs = new URLSearchParams(params).toString();
    const key = `totals:${qs}`;
    const cache = window.AppDataCache;
    if (!cache) {
      const res = await fetch(`/api/document-totals?${qs}`);
      return this._jsonOrThrow(res, 'Falha ao obter totais.');
    }
    return cache.getOrFetch(key, 60000, async () => {
      const res = await fetch(`/api/document-totals?${qs}`);
      return this._jsonOrThrow(res, 'Falha ao obter totais.');
    }, { softMs: 300000 });
  },

  async scanCancellations(body) {
    const res = await fetch('/api/scan-cancellations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return this._jsonOrThrow(res, 'Falha ao verificar canceladas na ADN.');
  },

  async fetchStorageSummary(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const key = `storage:${qs}`;
    const cache = window.AppDataCache;
    if (!cache) {
      return (await fetch(`/api/storage-summary?${qs}`)).json();
    }
    return cache.getOrFetch(key, 120000, async () => {
      const res = await fetch(`/api/storage-summary?${qs}`);
      return res.json();
    });
  },

  async listUnits() {
    const cache = window.AppDataCache;
    if (!cache) {
      return (await fetch('/api/units')).json();
    }
    return cache.getOrFetch('units', 60000, async () => {
      const res = await fetch('/api/units');
      return res.json();
    });
  },

  async saveUnit(unit) {
    return (await fetch('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unit)
    })).json();
  },

  async deleteUnit(id) {
    return (await fetch(`/api/units/${id}`, { method: 'DELETE' })).json();
  }
});
