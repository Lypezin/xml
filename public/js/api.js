// Wrapper de Requisições da API com Interceptador de Token
const originalFetch = window.fetch.bind(window);
let refreshSessionPromise = null;

function getRequestUrl(resource) {
  return typeof resource === 'string' ? resource : resource.url;
}

function isProtectedApiRequest(url) {
  return Boolean(url && url.startsWith('/api/') && url !== '/api/auth-config');
}

function attachAuthHeader(options = {}) {
  const { __authRetry, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${window.authSession.access_token}`);
  return {
    ...fetchOptions,
    headers
  };
}

window.fetch = async (resource, options = {}) => {
  const url = getRequestUrl(resource);
  const shouldAttachAuth = window.authSession?.access_token && isProtectedApiRequest(url);

  if (!shouldAttachAuth) {
    return originalFetch(resource, options);
  }

  const firstResponse = await originalFetch(resource, attachAuthHeader(options));
  if (firstResponse.status !== 401 || options.__authRetry) {
    return firstResponse;
  }

  const refreshedSession = await window.AppApi.refreshAuthSession();
  if (!refreshedSession?.access_token) {
    if (window.AppUtils) window.AppUtils.clearAuthSession();
    if (window.AppUi) window.AppUi.showLogin();
    return firstResponse;
  }

  return originalFetch(resource, attachAuthHeader({
    ...options,
    __authRetry: true
  }));
};

window.AppApi = {
  async refreshAuthSession(session = window.authSession) {
    if (!session?.refresh_token || !window.authConfig.supabaseUrl || !window.authConfig.publishableKey) {
      return null;
    }

    if (!refreshSessionPromise) {
      const runRefreshWithRetry = async (retries = 3, delay = 2000) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const res = await originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
              method: 'POST',
              headers: {
                apikey: window.authConfig.publishableKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ refresh_token: session.refresh_token })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.error_description || data.error || 'Erro no refresh');
            }

            window.AppUtils.saveAuthSession(data);
            return data;
          } catch (err) {
            if (attempt < retries) {
              console.warn(`Refresh token falhou (tentativa ${attempt}/${retries}), tentando novamente em ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            return null;
          }
        }
      };

      refreshSessionPromise = runRefreshWithRetry()
        .finally(() => {
          refreshSessionPromise = null;
        });
    }

    return refreshSessionPromise;
  },

  async loadAuthConfig() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
    try {
      const res = await originalFetch('/api/auth-config', {
        signal: controller ? controller.signal : undefined,
        cache: 'no-cache'
      });
      window.authConfig = await res.json();
      return window.authConfig;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async validateAuthSession(session) {
    if (!session?.access_token || !window.authConfig.supabaseUrl || !window.authConfig.publishableKey) {
      return null;
    }

    window.authSession = session;
    const fetchUser = async (accessToken) => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
      try {
        return await originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/user`, {
          headers: {
            apikey: window.authConfig.publishableKey,
            Authorization: `Bearer ${accessToken}`
          },
          signal: controller ? controller.signal : undefined
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      let res = await fetchUser(session.access_token);
      if (!res.ok) {
        const refreshedSession = await this.refreshAuthSession(session);
        if (!refreshedSession?.access_token) return null;
        res = await fetchUser(refreshedSession.access_token);
      }

      if (!res.ok) return null;
      return res.json();
    } catch (err) {
      console.warn('validateAuthSession falhou:', err.message);
      return null;
    }
  },

  async loginWithPassword(email, password) {
    const res = await originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: window.authConfig.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.error || 'Login inválido.');
    }

    window.AppUtils.saveAuthSession(data);
    return data.user;
  },

  async _jsonOrThrow(res, fallbackError) {
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (!res.ok) {
      throw new Error(data.error || fallbackError || `HTTP ${res.status}`);
    }
    return data;
  },

  async fetchCertStatus() {
    const cache = window.AppDataCache;
    if (!cache) {
      const res = await fetch('/api/certificate-status');
      return this._jsonOrThrow(res, 'Falha ao carregar certificado.');
    }
    return cache.getOrFetch('cert-status', 30000, async () => {
      const res = await fetch('/api/certificate-status');
      return this._jsonOrThrow(res, 'Falha ao carregar certificado.');
    });
  },

  async fetchDashboardSummary() {
    const cache = window.AppDataCache;
    if (!cache) {
      const res = await fetch('/api/dashboard-summary');
      return this._jsonOrThrow(res, 'Falha ao carregar dashboard.');
    }
    return cache.getOrFetch('dashboard-summary', 45000, async () => {
      const res = await fetch('/api/dashboard-summary');
      return this._jsonOrThrow(res, 'Falha ao carregar dashboard.');
    });
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
  },

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
    return cache.getOrFetch(key, 20000, async () => {
      const res = await fetch(`/api/sync-state?${params.toString()}`);
      return res.json();
    });
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
      return (await fetch(`/api/list-documents?${qs}`)).json();
    }
    return cache.getOrFetch(key, 25000, async () => {
      const res = await fetch(`/api/list-documents?${qs}`);
      return res.json();
    });
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
  },

  async downloadPeriodZip(params) {
    const res = await fetch('/api/download-period-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      let message = 'Erro no ZIP.';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (err) {
        message = await res.text() || message;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = params.startDate && params.endDate
      ? `NFS-e_Periodo_${params.startDate}_a_${params.endDate}.zip`
      : 'NFS-e_XMLs_Tabela.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  },

  async downloadExcel(params) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/download-excel?${query}`);
    if (!res.ok) {
      let message = 'Erro ao baixar Excel.';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (err) {
        message = await res.text() || message;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = params.startDate && params.endDate
      ? `NFS-e_Relatorio_${params.startDate}_a_${params.endDate}.xlsx`
      : 'NFS-e_Relatorio_Tabela.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};
