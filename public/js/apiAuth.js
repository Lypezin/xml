// Wrapper de Requisições da API com Interceptador de Token
const originalFetch = window.fetch.bind(window);
let refreshSessionPromise = null;
let authReadyResolve = null;
let authReadyPromise = null;
let authBootComplete = false;

window.AppAuthGate = {
  /** Bloqueia /api/* até validate/refresh terminar no boot */
  beginBoot() {
    authBootComplete = false;
    authReadyPromise = new Promise((resolve) => {
      authReadyResolve = resolve;
    });
  },
  endBoot() {
    authBootComplete = true;
    if (authReadyResolve) authReadyResolve();
    authReadyResolve = null;
    authReadyPromise = null;
  },
  async wait(ms = 12000) {
    if (authBootComplete || !authReadyPromise) return;
    await Promise.race([
      authReadyPromise,
      new Promise((r) => setTimeout(r, ms))
    ]);
  }
};

function getRequestUrl(resource) {
  return typeof resource === 'string' ? resource : (resource && resource.url) || '';
}

function isProtectedApiRequest(url) {
  if (!url) return false;
  // aceita path relativo e absoluto same-origin
  try {
    if (url.startsWith('/api/')) return url !== '/api/auth-config';
    if (url.startsWith('http')) {
      const u = new URL(url);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) {
        return u.pathname !== '/api/auth-config';
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

function attachAuthHeader(options = {}) {
  const { __authRetry, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});
  const token = window.authSession?.access_token;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return {
    ...fetchOptions,
    headers
  };
}

window.fetch = async (resource, options = {}) => {
  const url = getRequestUrl(resource);
  const needsAuth = isProtectedApiRequest(url);

  if (!needsAuth) {
    return originalFetch(resource, options);
  }

  // Espera o boot terminar a validação da sessão
  if (window.AppAuthGate) {
    await window.AppAuthGate.wait();
  }

  // Renova proativamente se estiver perto de expirar
  if (window.authSession?.access_token && window.AppUtils?.isAuthSessionExpiring?.(window.authSession)) {
    await window.AppApi.refreshAuthSession().catch(() => null);
  }

  // Sem token: 401 sintético (evita spam no console + força login)
  if (!window.authSession?.access_token) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Login obrigatório.',
      code: 'NO_TOKEN'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const firstResponse = await originalFetch(resource, attachAuthHeader(options));

  // 401 = sessão inválida no backend; tenta refresh uma vez
  if (firstResponse.status !== 401 || options.__authRetry) {
    return firstResponse;
  }

  const refreshedSession = await window.AppApi.refreshAuthSession();
  if (!refreshedSession?.access_token) {
    if (window.AppUtils) window.AppUtils.clearAuthSession();
    if (window.AppUi?.showLogin) window.AppUi.showLogin();
    return firstResponse;
  }

  return originalFetch(resource, attachAuthHeader({
    ...options,
    __authRetry: true
  }));
};

window.AppApi = Object.assign(window.AppApi || {}, {
  async refreshAuthSession(session = window.authSession) {
    if (!session?.refresh_token || !window.authConfig?.supabaseUrl || !window.authConfig?.publishableKey) {
      return null;
    }

    if (!refreshSessionPromise) {
      const runRefreshWithRetry = async (retries = 2, delay = 800) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const res = await originalFetch(
              `${window.authConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
              {
                method: 'POST',
                headers: {
                  apikey: window.authConfig.publishableKey,
                  Authorization: `Bearer ${window.authConfig.publishableKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refresh_token: session.refresh_token })
              }
            );

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              // refresh_token inválido/revogado: não insiste
              if (res.status === 400 || res.status === 401 || res.status === 403) {
                console.warn('Refresh token rejeitado:', data.error_description || data.msg || data.error || res.status);
                return null;
              }
              throw new Error(data.error_description || data.msg || data.error || `Erro no refresh (${res.status})`);
            }

            // Mantém user anterior se o refresh não devolver
            if (!data.user && session.user) {
              data.user = session.user;
            }
            window.AppUtils.saveAuthSession(data);
            return window.authSession;
          } catch (err) {
            if (attempt < retries) {
              console.warn(`Refresh token falhou (tentativa ${attempt}/${retries}): ${err.message}`);
              await new Promise(resolve => setTimeout(resolve, delay * attempt));
              continue;
            }
            return null;
          }
        }
        return null;
      };

      refreshSessionPromise = runRefreshWithRetry().finally(() => {
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
        cache: 'no-store'
      });
      window.authConfig = await res.json();
      return window.authConfig;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async validateAuthSession(session) {
    if (!session?.access_token || !window.authConfig?.supabaseUrl || !window.authConfig?.publishableKey) {
      return null;
    }

    // Normaliza + lê exp do JWT se faltar expires_at
    let active = window.AppUtils.normalizeAuthSession(session) || session;
    window.authSession = active;

    // Se já está expirando, renova ANTES de chamar /user (evita 403)
    if (window.AppUtils.isAuthSessionExpiring(active, 60)) {
      const refreshed = await this.refreshAuthSession(active);
      if (!refreshed?.access_token) return null;
      active = refreshed;
    }

    const fetchUser = async (accessToken) => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
      try {
        return await originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/user`, {
          headers: {
            apikey: window.authConfig.publishableKey,
            Authorization: `Bearer ${accessToken}`
          },
          signal: controller ? controller.signal : undefined,
          cache: 'no-store'
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      let res = await fetchUser(active.access_token);

      // 401/403: tenta refresh e valida de novo
      if (!res.ok && (res.status === 401 || res.status === 403)) {
        const refreshedSession = await this.refreshAuthSession(active);
        if (!refreshedSession?.access_token) return null;
        res = await fetchUser(refreshedSession.access_token);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn('validateAuthSession HTTP', res.status, body);
        return null;
      }

      const user = await res.json();
      if (user && window.authSession) {
        window.AppUtils.saveAuthSession({
          ...window.authSession,
          user
        });
      }
      return user;
    } catch (err) {
      console.warn('validateAuthSession falhou:', err.message);
      // Offline curto: se o JWT ainda não expirou, aceita user local
      if (active?.access_token && !window.AppUtils.isAuthSessionExpiring(active, 0)) {
        return active.user || { email: active.user?.email || 'sessao-local' };
      }
      return null;
    }
  },

  async loginWithPassword(email, password) {
    if (!window.authConfig?.supabaseUrl || !window.authConfig?.publishableKey) {
      throw new Error('Configuração de autenticação indisponível. Verifique SUPABASE_URL e a chave publishable na Vercel.');
    }

    const res = await originalFetch(`${window.authConfig.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: window.authConfig.publishableKey,
        Authorization: `Bearer ${window.authConfig.publishableKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.error || 'Login inválido.');
    }

    window.AppUtils.saveAuthSession(data);
    return data.user || window.authSession?.user;
  },

  async _jsonOrThrow(res, fallbackError) {
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (!res.ok) {
      throw new Error(data.error || data.warning || fallbackError || `HTTP ${res.status}`);
    }
    return data;
  }
});
