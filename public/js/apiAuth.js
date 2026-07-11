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

window.AppApi = Object.assign(window.AppApi || {}, {
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
});
