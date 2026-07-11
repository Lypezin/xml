// Certificados e dashboard API
Object.assign(window.AppApi = window.AppApi || {}, {
}, {
async fetchCertStatus() {
    const cache = window.AppDataCache;
    if (!cache) {
      const res = await fetch('/api/certificate-status');
      return this._jsonOrThrow(res, 'Falha ao carregar certificado.');
    }
    return cache.getOrFetch('cert-status', 45000, async () => {
      const res = await fetch('/api/certificate-status');
      return this._jsonOrThrow(res, 'Falha ao carregar certificado.');
    }, { softMs: 300000 });
  },

  async fetchDashboardSummary() {
    const cache = window.AppDataCache;
    if (!cache) {
      const res = await fetch('/api/dashboard-summary');
      return this._jsonOrThrow(res, 'Falha ao carregar dashboard.');
    }
    return cache.getOrFetch('dashboard-summary', 60000, async () => {
      const res = await fetch('/api/dashboard-summary');
      return this._jsonOrThrow(res, 'Falha ao carregar dashboard.');
    }, { softMs: 600000 });
  },

  async uploadCertificate(formData) {
    const res = await fetch('/api/upload-certificate', {
      method: 'POST',
      body: formData
    });
    return res.json();
  },

  async selectCertificate(certificateId) {
    const res = await fetch('/api/select-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId })
    });
    const data = await res.json();
    if (window.AppDataCache) {
      window.AppDataCache.invalidate('cert-status');
      window.AppDataCache.invalidate('dashboard-summary');
      window.AppDataCache.invalidate('history:');
      window.AppDataCache.invalidate('sync-state:');
      window.AppDataCache.invalidate('storage:');
    }
    // Troca de certificado invalida a lista da aba XMLs (evita cidade anterior no cache de aba)
    if (data?.success) {
      window._historyReloadDirty = true;
      window._tabCache = window._tabCache || {};
      window._tabCache.syncAt = 0;
      window._tabCache.nsuAt = 0;
      window._tabCache.storageAt = 0;
    }
    return data;
  },

  async removeCertificate(certificateId) {
    const res = await fetch('/api/remove-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId })
    });
    const data = await res.json();
    if (window.AppDataCache) window.AppDataCache.invalidateAll();
    return data;
  },

  async renameCertificate(certificateId, filename) {
    const res = await fetch('/api/rename-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId, filename })
    });
    const data = await res.json();
    if (window.AppDataCache) {
      window.AppDataCache.invalidate('cert-status');
      window.AppDataCache.invalidate('dashboard-summary');
    }
    return data;
  },

  async diagnoseCertificate(certificateId, environment) {
    const params = new URLSearchParams({ certificateId, environment });
    const res = await fetch(`/api/certificate-diagnostics?${params.toString()}`);
    return res.json();
  }
});
