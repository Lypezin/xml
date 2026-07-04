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
      refreshSessionPromise = originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          apikey: window.authConfig.publishableKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      })
        .then(async res => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return null;
          window.AppUtils.saveAuthSession(data);
          return data;
        })
        .finally(() => {
          refreshSessionPromise = null;
        });
    }

    return refreshSessionPromise;
  },

  async loadAuthConfig() {
    const res = await originalFetch('/api/auth-config');
    window.authConfig = await res.json();
    return window.authConfig;
  },

  async validateAuthSession(session) {
    if (!session?.access_token || !window.authConfig.supabaseUrl || !window.authConfig.publishableKey) {
      return null;
    }

    window.authSession = session;
    const fetchUser = accessToken => originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: window.authConfig.publishableKey,
        Authorization: `Bearer ${accessToken}`
      }
    });

    let res = await fetchUser(session.access_token);
    if (!res.ok) {
      const refreshedSession = await this.refreshAuthSession(session);
      if (!refreshedSession?.access_token) return null;
      res = await fetchUser(refreshedSession.access_token);
    }

    if (!res.ok) return null;
    return res.json();
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

  async fetchCertStatus() {
    const res = await fetch('/api/certificate-status');
    return res.json();
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
    return res.json();
  },

  async removeCertificate(certificateId) {
    const res = await fetch('/api/remove-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId })
    });
    return res.json();
  },

  async renameCertificate(certificateId, filename) {
    const res = await fetch('/api/rename-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId, filename })
    });
    return res.json();
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
    const res = await fetch(`/api/sync-state?${params.toString()}`);
    return res.json();
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
    return (await fetch(`/api/list-documents?${new URLSearchParams(params)}`)).json();
  },

  async fetchStorageSummary(params = {}) {
    return (await fetch(`/api/storage-summary?${new URLSearchParams(params)}`)).json();
  },

  async listUnits() {
    return (await fetch('/api/units')).json();
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
  }
};
