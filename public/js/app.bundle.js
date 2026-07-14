/* source: js/utils.js */
// Utilitários de Sessão e Formatadores
const AUTH_STORAGE_KEY = 'xml_nfse_auth_session';

window.AppUtils = {
  /** Decodifica payload do JWT (sem verificar assinatura) */
  decodeJwtPayload(token) {
    try {
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch (e) {
      return null;
    }
  },

  /**
   * Normaliza resposta do Supabase Auth (token endpoint) para sessão persistente.
   * Garante expires_at em epoch seconds (via expires_in ou claim exp do JWT).
   */
  normalizeAuthSession(session) {
    if (!session || typeof session !== 'object') return null;
    const next = { ...session };
    const nowSec = Math.floor(Date.now() / 1000);

    if (!next.expires_at) {
      const expiresIn = Number(next.expires_in);
      if (Number.isFinite(expiresIn) && expiresIn > 0) {
        next.expires_at = nowSec + expiresIn;
      }
    } else {
      // aceita ms acidentalmente gravado
      const exp = Number(next.expires_at);
      if (Number.isFinite(exp) && exp > 1e12) {
        next.expires_at = Math.floor(exp / 1000);
      }
    }

    // Fallback: exp do próprio JWT (evita chamar /user com token morto → 403)
    if (!next.expires_at && next.access_token) {
      const payload = this.decodeJwtPayload(next.access_token);
      if (payload?.exp) next.expires_at = Number(payload.exp);
    }

    // merge user se vier aninhado
    if (!next.user && session.user) next.user = session.user;
    return next;
  },

  /** true se o access_token deve ser renovado (faltando < 90s) */
  isAuthSessionExpiring(session, skewSeconds = 90) {
    if (!session?.access_token) return true;
    let exp = Number(session.expires_at);
    if (!Number.isFinite(exp) || exp <= 0) {
      const payload = this.decodeJwtPayload(session.access_token);
      exp = Number(payload?.exp);
    }
    if (!Number.isFinite(exp) || exp <= 0) return false; // desconhecido: tenta usar
    return Math.floor(Date.now() / 1000) >= (exp - skewSeconds);
  },

  saveAuthSession(session) {
    const normalized = this.normalizeAuthSession(session);
    window.authSession = normalized;
    if (normalized) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  },

  clearAuthSession() {
    window.authSession = null;
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  loadStoredAuthSession() {
    try {
      let stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) {
        // Migração única: sessões legadas persistentes passam a durar só a aba.
        stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          sessionStorage.setItem(AUTH_STORAGE_KEY, stored);
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }
      if (!stored) return null;
      return this.normalizeAuthSession(JSON.parse(stored));
    } catch (e) {
      return null;
    }
  },

  formatCurrency(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return 'N/A';
    }

    return parsed.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  },

  formatDate(value) {
    if (!value) return 'N/A';
    const rawDate = String(value).split('T')[0];
    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return rawDate;
    return `${match[3]}/${match[2]}/${match[1]}`;
  },

  formatCnpj(value) {
    if (!value || String(value).trim() === 'null' || String(value).trim() === 'undefined') return 'Sem CNPJ';
    if (String(value).trim() === 'N/A' || String(value).trim() === 'Não Informado') return value;
    const digits = String(value).replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  },

  formatInteger(value) {
    return Number(value || 0).toLocaleString('pt-BR');
  },

  formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
  },

  applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('light-mode', !isDark);
    document.documentElement.classList.toggle('theme-dark-boot', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#09090b' : '#f8fafc');

    const themeText = document.getElementById('theme-text') || window.themeText;
    const sun = document.querySelector('.sun-icon') || window.sunIcon;
    const moon = document.querySelector('.moon-icon') || window.moonIcon;
    if (themeText) themeText.textContent = isDark ? 'Modo claro' : 'Modo escuro';
    // No escuro mostra sol (ir para claro); no claro mostra lua (ir para escuro)
    if (sun) sun.style.display = isDark ? '' : 'none';
    if (moon) moon.style.display = isDark ? 'none' : '';
  },

  restoreTheme() {
    let theme = 'light';
    try {
      theme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    } catch (e) {
      theme = 'light';
    }
    this.applyTheme(theme);
    return theme;
  },

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Modo de filtro de canceladas na lista.
   * active | all | cancelled
   */
  getCancelledMode() {
    const el = window.cancelledFilter || document.getElementById('cancelled-filter');
    const mode = String(el?.value || 'all').toLowerCase();
    if (mode === 'active' || mode === 'cancelled') return mode;
    return 'all';
  },

  /** Compat: includeCancelled=true quando mostra todas ou so canceladas */
  getIncludeCancelledParam() {
    const mode = this.getCancelledMode();
    if (mode === 'active') return 'false';
    return 'true';
  },

  getOnlyCancelledParam() {
    return this.getCancelledMode() === 'cancelled' ? 'true' : 'false';
  },

  requireOpsPassword(actionLabel = 'esta ação') {
    return window.confirm(`Confirma ${actionLabel}? Esta ação será executada com o seu usuário autenticado.`);
  }
};
;

/* source: js/toast.js */
// Toast notifications — feedback global leve
window.AppToast = {
  _root: null,
  _ensureRoot() {
    if (this._root && document.body.contains(this._root)) return this._root;
    let el = document.getElementById('toast-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-root';
      el.className = 'toast-root';
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(el);
    }
    this._root = el;
    return el;
  },

  show(message, type = 'info', options = {}) {
    const root = this._ensureRoot();
    const duration = Number(options.duration || (type === 'error' ? 5200 : 3200));
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icons = {
      success: '✔',
      error: '✖',
      warning: '▲',
      info: '●'
    };

    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
      <span class="toast-message"></span>
      <button type="button" class="toast-close" aria-label="Fechar">×</button>
    `;
    toast.querySelector('.toast-message').textContent = String(message || '');

    const remove = () => {
      toast.classList.add('toast-out');
      window.setTimeout(() => toast.remove(), 180);
    };

    toast.querySelector('.toast-close').addEventListener('click', remove);
    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-in'));

    if (duration > 0) {
      window.setTimeout(remove, duration);
    }
    return toast;
  },

  success(message, options) { return this.show(message, 'success', options); },
  error(message, options) { return this.show(message, 'error', options); },
  warning(message, options) { return this.show(message, 'warning', options); },
  info(message, options) { return this.show(message, 'info', options); }
};
;

/* source: js/dataCache.js */
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
;

/* source: js/panels-bundle.js */
/* auto-generated by scripts/build-panels-bundle.js — do not edit */
window.PANEL_HTML = {"auth-screen-container":"<section class=\"auth-screen\" id=\"auth-screen\">\n  <div class=\"auth-shell\">\n    <aside class=\"auth-brand-panel\" aria-hidden=\"false\">\n      <div class=\"auth-brand-panel-inner\">\n        <div class=\"auth-brand-mark\">\n          <svg class=\"brand-icon\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n            <polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"></polygon>\n          </svg>\n          <span>NFS-e Ops</span>\n        </div>\n        <h1>Operação fiscal nacional com controle de ponta a ponta</h1>\n        <p class=\"auth-brand-lead\">Varredura ADN, cancelamentos, exportação e painel por unidade — em um só lugar.</p>\n        <ul class=\"auth-brand-points\">\n          <li>\n            <span class=\"auth-point-icon\" aria-hidden=\"true\">✓</span>\n            <span>mTLS com certificado A1 e consulta por NSU</span>\n          </li>\n          <li>\n            <span class=\"auth-point-icon\" aria-hidden=\"true\">✓</span>\n            <span>Detecção de cancelamentos e XMLs permanentes</span>\n          </li>\n          <li>\n            <span class=\"auth-point-icon\" aria-hidden=\"true\">✓</span>\n            <span>Excel, ZIP e filtros por unidade/tomador</span>\n          </li>\n        </ul>\n      </div>\n    </aside>\n\n    <div class=\"auth-form-panel\">\n      <form class=\"auth-panel\" id=\"auth-form\">\n        <div class=\"auth-brand\">\n          <svg class=\"brand-icon auth-form-icon\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n            <polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"></polygon>\n          </svg>\n          <div>\n            <h1>Entrar</h1>\n            <p>Acesso restrito da operação fiscal</p>\n          </div>\n        </div>\n\n        <div class=\"form-group\">\n          <label for=\"auth-email\">E-mail</label>\n          <input type=\"email\" id=\"auth-email\" autocomplete=\"email\" required placeholder=\"voce@empresa.com.br\">\n        </div>\n\n        <div class=\"form-group\">\n          <label for=\"auth-password\">Senha</label>\n          <input type=\"password\" id=\"auth-password\" autocomplete=\"current-password\" required placeholder=\"••••••••\">\n        </div>\n\n        <button type=\"submit\" class=\"btn btn-primary\" id=\"auth-submit\">\n          <span>Entrar na plataforma</span>\n        </button>\n        <p class=\"auth-message\" id=\"auth-message\"></p>\n      </form>\n    </div>\n  </div>\n</section>\n","sidebar-container":"<aside class=\"sidebar\" id=\"sidebar\">\n  <div class=\"sidebar-brand\">\n    <svg class=\"brand-icon\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n      <polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"></polygon>\n    </svg>\n    <div class=\"brand-text\">\n      <h2>NFS-e Ops</h2>\n      <span>ADN Nacional</span>\n    </div>\n  </div>\n\n  <nav class=\"sidebar-nav\" aria-label=\"Navegação principal\">\n    <div class=\"nav-section\">\n      <div class=\"nav-section-label\">Visão geral</div>\n      <a href=\"#dashboard\" class=\"nav-item active\" id=\"nav-dashboard\" aria-current=\"page\">\n        <svg class=\"nav-icon-svg\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n          <rect x=\"3\" y=\"3\" width=\"7\" height=\"9\" rx=\"1\"></rect>\n          <rect x=\"14\" y=\"3\" width=\"7\" height=\"5\" rx=\"1\"></rect>\n          <rect x=\"14\" y=\"12\" width=\"7\" height=\"9\" rx=\"1\"></rect>\n          <rect x=\"3\" y=\"16\" width=\"7\" height=\"5\" rx=\"1\"></rect>\n        </svg>\n        <span>Dashboard</span>\n      </a>\n    </div>\n\n    <div class=\"nav-section\">\n      <div class=\"nav-section-label\">Operação</div>\n      <a href=\"#xmls\" class=\"nav-item\" id=\"nav-download\">\n        <svg class=\"nav-icon-svg\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n          <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path>\n          <polyline points=\"7 10 12 15 17 10\"></polyline>\n          <line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line>\n        </svg>\n        <span>XMLs por unidade</span>\n      </a>\n      <a href=\"#certificados\" class=\"nav-item\" id=\"nav-certificado\">\n        <svg class=\"nav-icon-svg\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n          <rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\" ry=\"2\"></rect>\n          <path d=\"M7 11V7a5 5 0 0 1 10 0v4\"></path>\n        </svg>\n        <span>Certificados</span>\n      </a>\n    </div>\n\n    <div class=\"nav-section\">\n      <div class=\"nav-section-label\">Sistema</div>\n      <a href=\"#regras\" class=\"nav-item\" id=\"nav-regras\">\n        <svg class=\"nav-icon-svg\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n          <path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\"></path>\n          <path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\"></path>\n        </svg>\n        <span>Regras ADN</span>\n      </a>\n    </div>\n  </nav>\n\n  <div class=\"sidebar-footer\">\n    <button type=\"button\" class=\"theme-toggle-btn\" id=\"theme-toggle\" title=\"Alternar tema claro/escuro\" aria-label=\"Alternar tema\">\n      <svg class=\"moon-icon\" xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n        <path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"></path>\n      </svg>\n      <svg class=\"sun-icon\" xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" style=\"display:none;\">\n        <circle cx=\"12\" cy=\"12\" r=\"4\"></circle>\n        <path d=\"M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41\"></path>\n      </svg>\n      <span id=\"theme-text\">Modo escuro</span>\n    </button>\n    <div class=\"footer-status\">\n      <span class=\"status-indicator online\" aria-hidden=\"true\"></span>\n      <span>Sistema ativo</span>\n    </div>\n  </div>\n</aside>\n","view-dashboard-container":"<div id=\"view-dashboard-content\" class=\"tab-content active dashboard-overview\">\n  <div class=\"dashboard-header-flex\">\n    <div class=\"hero-copy\">\n      <span class=\"eyebrow\">Visão geral</span>\n      <h2>Painel das cidades</h2>\n      <p class=\"dashboard-lead\">Resumo operacional por certificado: totais, status e última emissão.</p>\n    </div>\n    <button id=\"btn-refresh-dashboard\" class=\"btn btn-secondary btn-icon-only\" type=\"button\" title=\"Atualizar painel\" aria-label=\"Atualizar painel\">\n      <svg class=\"refresh-icon\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"16\" height=\"16\" aria-hidden=\"true\">\n        <path d=\"M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67\"></path>\n      </svg>\n    </button>\n  </div>\n\n  <div id=\"cert-expiry-banner\" class=\"cert-expiry-banner\" style=\"display: none;\" role=\"status\"></div>\n\n  <div class=\"dashboard-metrics-summary\" id=\"dashboard-metrics-summary\">\n    <div class=\"mini-metric-card\">\n      <div class=\"mini-metric-icon\" aria-hidden=\"true\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 21h18\"/><path d=\"M5 21V7l7-4 7 4v14\"/><path d=\"M9 21v-4h6v4\"/></svg>\n      </div>\n      <div class=\"metric-info\">\n        <span class=\"metric-label\">Cidades</span>\n        <span class=\"metric-number\" id=\"dash-stat-cities\">0</span>\n      </div>\n    </div>\n    <div class=\"mini-metric-card\">\n      <div class=\"mini-metric-icon accent\" aria-hidden=\"true\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg>\n      </div>\n      <div class=\"metric-info\">\n        <span class=\"metric-label\">Ativas</span>\n        <span class=\"metric-number\" id=\"dash-stat-active\">0</span>\n      </div>\n    </div>\n    <div class=\"mini-metric-card\">\n      <div class=\"mini-metric-icon\" aria-hidden=\"true\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/></svg>\n      </div>\n      <div class=\"metric-info\">\n        <span class=\"metric-label\">Total XMLs</span>\n        <span class=\"metric-number\" id=\"dash-stat-xmls\">0</span>\n      </div>\n    </div>\n  </div>\n\n  <div id=\"dashboard-loader\" class=\"xml-empty-state\" style=\"margin-top: 40px; display: none;\">\n    <span>Buscando informações das cidades...</span>\n  </div>\n\n  <div class=\"dashboard-section-label\">Unidades / certificados</div>\n  <div class=\"dashboard-cities-grid\" id=\"dashboard-cities-grid\"></div>\n\n  <!-- Indicadores por último (após as unidades) -->\n  <div class=\"dashboard-analytics\" id=\"dashboard-analytics\">\n    <div class=\"dashboard-section-label analytics-section-heading\">\n      <div>\n        <span>Indicadores</span>\n        <small>Desempenho financeiro e volume dos últimos 12 meses</small>\n      </div>\n      <button type=\"button\" class=\"btn btn-ghost btn-sm\" id=\"btn-refresh-analytics\">Atualizar indicadores</button>\n    </div>\n    <p class=\"helper-text analytics-status\" id=\"analytics-status\" style=\"display:none;margin:0 0 8px;\"></p>\n    <div class=\"analytics-compare-row\" id=\"analytics-compare-row\">\n      <div class=\"compare-card\">\n        <span class=\"metric-label\">Mês atual × mês anterior</span>\n        <strong id=\"analytics-mom-value\">R$ 0,00</strong>\n        <span class=\"compare-delta\" id=\"analytics-mom-delta\">—</span>\n      </div>\n      <div class=\"compare-card\">\n        <span class=\"metric-label\">Ano atual × ano anterior</span>\n        <strong id=\"analytics-yoy-value\">R$ 0,00</strong>\n        <span class=\"compare-delta\" id=\"analytics-yoy-delta\">—</span>\n      </div>\n      <div class=\"compare-card\">\n        <span class=\"metric-label\">Canceladas (total)</span>\n        <strong id=\"analytics-cancelled\">0</strong>\n        <span class=\"helper-text\">No ambiente de produção</span>\n      </div>\n    </div>\n\n    <div class=\"analytics-grid\">\n      <div class=\"card analytics-card\">\n        <div class=\"panel-heading\">\n          <div>\n            <span class=\"eyebrow\">Volume</span>\n            <h2>Notas e valor por mês</h2>\n          </div>\n        </div>\n        <div class=\"chart-legend\" aria-label=\"Legenda do gráfico\">\n          <span><i class=\"legend-dot notes\"></i>Notas</span>\n          <span><i class=\"legend-dot cancelled\"></i>Canceladas</span>\n          <span><i class=\"legend-line\"></i>Valor</span>\n        </div>\n        <div class=\"chart-bars\" id=\"analytics-monthly-chart\"></div>\n      </div>\n      <div class=\"card analytics-card\">\n        <div class=\"panel-heading\">\n          <div>\n            <span class=\"eyebrow\">Ranking</span>\n            <h2>Top prestadores</h2>\n            <p class=\"helper-text\" style=\"margin:4px 0 0;font-size:12px;\">Soma de notas com valor até R$&nbsp;100&nbsp;mil (exclui outliers)</p>\n          </div>\n        </div>\n        <div class=\"ranking-list\" id=\"ranking-prestador\"></div>\n      </div>\n      <div class=\"card analytics-card\">\n        <div class=\"panel-heading\">\n          <div>\n            <span class=\"eyebrow\">Ranking</span>\n            <h2>Top unidades</h2>\n            <p class=\"helper-text\" style=\"margin:4px 0 0;font-size:12px;\">Nome do certificado (cidade/unidade)</p>\n          </div>\n        </div>\n        <div class=\"ranking-list\" id=\"ranking-tomador\"></div>\n      </div>\n    </div>\n\n    <div class=\"card analytics-card audit-card\">\n      <div class=\"panel-heading\">\n        <div>\n          <span class=\"eyebrow\">Auditoria</span>\n          <h2>Downloads e exports recentes</h2>\n        </div>\n        <button type=\"button\" class=\"btn btn-ghost btn-sm\" id=\"btn-refresh-audit\">Atualizar</button>\n      </div>\n      <div class=\"audit-list\" id=\"audit-list\">\n        <div class=\"helper-text\">Carregando auditoria…</div>\n      </div>\n    </div>\n  </div>\n</div>\n","view-download-container":"<div id=\"view-download-content\" class=\"tab-content nfse-dashboard ops-screen\">\n  <!-- KPI strip -->\n  <section class=\"overview-metrics ops-kpis\">\n    <div class=\"metric-card\">\n      <div class=\"metric-data\">\n        <span class=\"metric-label\">Total de notas</span>\n        <strong class=\"metric-value\" id=\"stat-total-notas\">0</strong>\n        <span class=\"helper-text\">Filtro atual</span>\n      </div>\n    </div>\n    <div class=\"metric-card metric-card-primary\">\n      <div class=\"metric-data\">\n        <span class=\"metric-label\">Valor total</span>\n        <strong class=\"metric-value text-primary\" id=\"stat-total-value\">R$ 0,00</strong>\n        <span class=\"helper-text\">Notas no filtro</span>\n      </div>\n    </div>\n    <div class=\"metric-card\">\n      <div class=\"metric-data\">\n        <span class=\"metric-label\">Cursor NSU</span>\n        <strong class=\"metric-value\">\n          <span id=\"stat-nsu-atual\">0</span>\n          <span class=\"metric-divider\">/</span>\n          <span id=\"stat-nsu-max\">0</span>\n        </strong>\n        <span class=\"helper-text\">Última varredura</span>\n      </div>\n    </div>\n    <div class=\"metric-card\">\n      <div class=\"metric-data\">\n        <span class=\"metric-label\">XMLs permanentes</span>\n        <strong class=\"metric-value text-success\" id=\"stat-storage-payloads\">0</strong>\n        <span class=\"helper-text\" id=\"stat-storage-size\">Armazenamento</span>\n      </div>\n    </div>\n  </section>\n\n  <!-- Command bar: recorte + export -->\n  <section class=\"command-bar\" aria-label=\"Recorte e exportação\">\n    <div class=\"command-bar-main\">\n      <div class=\"command-bar-fields\">\n        <div class=\"input-group certificate-field\">\n          <label for=\"certificate-select\">Certificado</label>\n          <select id=\"certificate-select\"><option value=\"\">Nenhum certificado cadastrado</option></select>\n        </div>\n        <div class=\"input-group\">\n          <label for=\"unit-filter\">Unidade</label>\n          <select id=\"unit-filter\"><option value=\"\">CNPJ do certificado ativo</option></select>\n        </div>\n        <div class=\"input-group\">\n          <label for=\"download-start-date\">Início</label>\n          <input type=\"date\" id=\"download-start-date\">\n        </div>\n        <div class=\"input-group\">\n          <label for=\"download-end-date\">Fim</label>\n          <input type=\"date\" id=\"download-end-date\">\n        </div>\n      </div>\n      <div class=\"command-bar-actions\">\n        <button class=\"btn btn-primary btn-export-excel\" id=\"btn-export-excel\" disabled type=\"button\" title=\"Exportar planilha Excel com os XMLs filtrados\">\n          <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"8\" y1=\"13\" x2=\"16\" y2=\"13\"/><line x1=\"8\" y1=\"17\" x2=\"12\" y2=\"17\"/></svg>\n          <span>Exportar Excel</span>\n        </button>\n        <button class=\"btn btn-secondary\" id=\"btn-export-integrity\" disabled type=\"button\" title=\"Exportar cadeia de custódia com SHA-256 dos XMLs\">\n          <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/><polyline points=\"9 12 11 14 15 10\"/></svg>\n          <span>Integridade</span>\n        </button>\n        <button class=\"btn btn-secondary btn-download-zip\" id=\"btn-download-period\" type=\"button\" title=\"Baixar XMLs em arquivo ZIP\">\n          <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg>\n          <span>ZIP</span>\n        </button>\n      </div>\n    </div>\n  </section>\n\n  <!-- Hidden legacy fields -->\n  <input type=\"text\" id=\"cnpj-consulta\" value=\"\" style=\"display: none;\">\n  <select id=\"environment\" style=\"display: none;\"><option value=\"producao\" selected>Produção</option></select>\n  <select id=\"search-mode\" style=\"display: none;\"><option value=\"asc\" selected>Inicial completa</option></select>\n  <input type=\"number\" id=\"limite-notas\" min=\"1\" style=\"display: none;\">\n  <select id=\"unit-party-role\" style=\"display: none;\"><option value=\"tomador\" selected>Recebidas</option></select>\n  <input type=\"checkbox\" id=\"scheduler-enabled\" style=\"display: none;\">\n  <input type=\"number\" id=\"scheduler-interval\" value=\"12\" min=\"1\" max=\"168\" style=\"display: none;\">\n  <select id=\"scheduler-env\" style=\"display: none;\"><option value=\"producao\" selected>Produção</option></select>\n  <input type=\"number\" id=\"scheduler-max-batches\" value=\"1\" min=\"1\" max=\"5\" style=\"display: none;\">\n  <input type=\"number\" id=\"scheduler-delay-seconds\" value=\"2\" min=\"2\" max=\"2\" style=\"display: none;\">\n  <button class=\"btn btn-primary btn-sm\" id=\"btn-save-scheduler\" style=\"display: none;\" type=\"button\">Salvar config.</button>\n  <button class=\"btn btn-secondary btn-sm\" id=\"btn-run-scheduler-now\" style=\"display: none;\" type=\"button\">Atualizar agora</button>\n  <div style=\"display: none;\">\n    <div id=\"manual-sync-progress-bar\"></div>\n    <span id=\"manual-sync-progress-text\"></span>\n    <span id=\"manual-sync-progress-percentage\"></span>\n    <strong id=\"scheduler-last-run\">-</strong>\n    <strong id=\"scheduler-status\">Manual</strong>\n  </div>\n\n  <!-- Ops strip: varredura + log -->\n  <section class=\"ops-strip\" aria-label=\"Varredura NSU\">\n    <div class=\"ops-strip-controls\">\n      <div class=\"ops-strip-heading\">\n        <div>\n          <span class=\"eyebrow\">Varredura ADN</span>\n          <h2>Sincronização por NSU</h2>\n        </div>\n        <div class=\"ops-nsu-controls\">\n          <label class=\"ops-nsu-toggle\" for=\"override-nsu\" title=\"Requer senha operacional\">\n            <input type=\"checkbox\" id=\"override-nsu\">\n            <span>Forçar NSU</span>\n          </label>\n          <input type=\"number\" id=\"start-nsu\" value=\"0\" min=\"0\" class=\"ops-nsu-input is-locked\" aria-label=\"NSU inicial\" readonly title=\"Marque Forçar NSU e digite a senha para editar\">\n        </div>\n      </div>\n      <div class=\"ops-strip-actions action-buttons\">\n        <button class=\"btn btn-success\" id=\"btn-start\" disabled type=\"button\"><span>Iniciar</span></button>\n        <button class=\"btn btn-warning\" id=\"btn-pause\" disabled type=\"button\"><span>Pausar</span></button>\n        <button class=\"btn btn-danger\" id=\"btn-reset-nsu\" disabled type=\"button\" title=\"Requer senha operacional\"><span>Zerar NSU</span></button>\n      </div>\n      <div class=\"alert-box success\" id=\"alert-sync-success\" style=\"display: none;\"><strong>Concluído:</strong> todas as notas foram sincronizadas.</div>\n      <div class=\"alert-box danger\" id=\"alert-rate-limit\" style=\"display: none;\"><strong>Consumo indevido:</strong> API bloqueou temporariamente este CNPJ.</div>\n      <div class=\"alert-box warning\" id=\"retry-status-banner\" style=\"display: none;\"></div>\n      <div class=\"crawler-status\" id=\"crawler-status-container\" style=\"display: none;\"><span id=\"crawler-current-cnpj\">-</span><span id=\"crawler-visited-count\">0</span><span id=\"crawler-queue-count\">0</span></div>\n    </div>\n\n    <div class=\"console-log-panel ops-log\" id=\"console-log-drawer\">\n      <div class=\"console-log-header\">\n        <div class=\"console-log-title\">\n          <span class=\"console-log-live-dot\" aria-hidden=\"true\"></span>\n          <span>Log da varredura</span>\n        </div>\n        <span class=\"console-log-hint\" id=\"console-log-hint\">Aguardando eventos…</span>\n      </div>\n      <div id=\"console-log\" class=\"console-log\" role=\"log\" aria-live=\"polite\" aria-relevant=\"additions\">\n        <div class=\"log-line system log-placeholder\">\n          <span class=\"log-time\">[--:--:--]</span>\n          <span class=\"log-badge system\">●</span>\n          <span class=\"log-text\">Pronto. Inicie a varredura para acompanhar o progresso aqui.</span>\n        </div>\n      </div>\n    </div>\n  </section>\n\n  <!-- Ops insights: saúde API + histórico de varreduras -->\n  <section class=\"ops-insights-grid\" aria-label=\"Insights da operação\">\n    <div class=\"card ops-insight-card\">\n      <div class=\"panel-heading\">\n        <div>\n          <span class=\"eyebrow\">ADN Nacional</span>\n          <h2>Saúde da API</h2>\n        </div>\n        <button type=\"button\" class=\"btn btn-ghost btn-sm\" id=\"btn-refresh-api-health\">Atualizar</button>\n      </div>\n      <div class=\"api-health-body\" id=\"api-health-body\">\n        <div class=\"api-health-status unknown\" id=\"api-health-status\">Sem dados</div>\n        <div class=\"api-health-metrics\">\n          <div><span>Taxa de sucesso</span><strong id=\"api-health-rate\">—</strong></div>\n          <div><span>Latência média</span><strong id=\"api-health-avg\">—</strong></div>\n          <div><span>P95</span><strong id=\"api-health-p95\">—</strong></div>\n          <div><span>Chamadas (24h)</span><strong id=\"api-health-total\">—</strong></div>\n        </div>\n        <p class=\"helper-text\" id=\"api-health-error\">As amostras são gravadas a cada consulta DFe.</p>\n      </div>\n    </div>\n    <div class=\"card ops-insight-card\">\n      <div class=\"panel-heading\">\n        <div>\n          <span class=\"eyebrow\">Varreduras</span>\n          <h2>Histórico de runs</h2>\n        </div>\n        <button type=\"button\" class=\"btn btn-ghost btn-sm\" id=\"btn-refresh-sync-runs\">Atualizar</button>\n      </div>\n      <div class=\"sync-runs-list\" id=\"sync-runs-list\">\n        <div class=\"helper-text\">Carregando histórico…</div>\n      </div>\n    </div>\n  </section>\n\n  <!-- Data table -->\n  <section class=\"data-grid-card data-table-card\">\n    <div class=\"data-table-toolbar\">\n      <div class=\"data-table-title\">\n        <h2>XMLs da unidade</h2>\n        <span class=\"results-subtitle\" id=\"history-count-label\">0 XMLs sincronizados</span>\n      </div>\n      <div class=\"data-table-filters\">\n        <div class=\"input-group search-field\">\n          <label for=\"history-search\" class=\"sr-only\">Buscar</label>\n          <input type=\"search\" id=\"history-search\" placeholder=\"Buscar valor, CNPJ ou nome...\">\n        </div>\n        <div class=\"input-group cancelled-filter-field\">\n          <label for=\"cancelled-filter\" class=\"sr-only\">Canceladas</label>\n          <select id=\"cancelled-filter\">\n            <option value=\"all\" selected>Todas</option>\n            <option value=\"active\">Ativas</option>\n            <option value=\"cancelled\">Canceladas</option>\n          </select>\n        </div>\n        <input type=\"checkbox\" id=\"include-cancelled\" style=\"display:none\">\n      </div>\n    </div>\n\n    <div class=\"xml-list-wrapper\" id=\"results-table\">\n      <div class=\"xml-list-head\">\n        <span>Documento</span>\n        <span>Participantes</span>\n        <span>Serviço</span>\n        <span>Valores</span>\n        <span>Ações</span>\n      </div>\n      <div class=\"xml-list\" id=\"table-body\">\n        <div id=\"empty-row\" class=\"xml-empty-state\">Nenhum documento sincronizado ainda.</div>\n      </div>\n    </div>\n\n    <div class=\"results-actions table-footer\">\n      <div class=\"pagination-actions\">\n        <button class=\"btn btn-secondary btn-sm\" id=\"btn-history-prev\" disabled type=\"button\">Anterior</button>\n        <span class=\"helper-text\" id=\"history-page-info\">0 de 0</span>\n        <button class=\"btn btn-secondary btn-sm\" id=\"btn-history-next\" disabled type=\"button\">Próxima</button>\n      </div>\n    </div>\n  </section>\n</div>\n","view-certificado-container":"<div id=\"view-certificado-content\" class=\"tab-content\" style=\"display: none;\">\n  <section class=\"dashboard-hero compact-page-hero\">\n    <div class=\"hero-copy\">\n      <span class=\"eyebrow\">Identidade fiscal</span>\n      <h2>Certificados digitais</h2>\n    </div>\n    <div class=\"hero-status-strip\">\n      <div><span>Tipo</span><strong>A1 PFX/P12</strong></div>\n      <div><span>Armazenamento</span><strong>Criptografado</strong></div>\n    </div>\n  </section>\n\n  <div class=\"certificates-layout\">\n    <section class=\"card certificates-list-card\">\n      <div class=\"panel-heading\">\n        <div>\n          <span class=\"eyebrow\">Cofre</span>\n          <h2>Certificados cadastrados</h2>\n        </div>\n        <span class=\"panel-count\" id=\"cert-count-label\">0 certificados</span>\n      </div>\n      <div class=\"cert-list-panel\">\n        <div id=\"cert-list\" class=\"cert-list\">\n          <div class=\"empty-cert-list\">Nenhum certificado cadastrado.</div>\n        </div>\n      </div>\n    </section>\n\n    <div class=\"certificates-side\">\n      <div id=\"cert-active-state-view\" class=\"cert-state\">\n        <section class=\"card active-cert-card\">\n          <div class=\"panel-heading\">\n            <div>\n              <span class=\"eyebrow\">Em uso</span>\n              <h2>Certificado ativo</h2>\n            </div>\n          </div>\n          <div class=\"success-banner\">\n            <svg class=\"success-icon-svg\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n              <polyline points=\"20 6 9 17 4 12\"></polyline>\n            </svg>\n            <div>\n              <h3 id=\"active-cert-name-view\">Certificado ativo</h3>\n              <p id=\"active-cert-cnpj-view\">CNPJ: --</p>\n            </div>\n          </div>\n          <div class=\"cert-action-row\">\n            <button class=\"btn btn-primary\" id=\"btn-renew-active-cert-view\" type=\"button\" title=\"Troca o PFX mantendo o mesmo vínculo (CNPJ, XMLs e NSU)\">\n              <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                <polyline points=\"23 4 23 10 17 10\"></polyline>\n                <path d=\"M20.49 15a9 9 0 1 1-2.12-9.36L23 10\"></path>\n              </svg>\n              <span>Renovar</span>\n            </button>\n            <button class=\"btn btn-secondary\" id=\"btn-diagnose-cert-view\" type=\"button\">\n              <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n                <circle cx=\"12\" cy=\"12\" r=\"10\"></circle>\n                <line x1=\"12\" y1=\"16\" x2=\"12\" y2=\"12\"></line>\n                <line x1=\"12\" y1=\"8\" x2=\"12.01\" y2=\"8\"></line>\n              </svg>\n              <span>Diagnosticar</span>\n            </button>\n            <button class=\"btn btn-danger\" id=\"btn-replace-cert-view\" type=\"button\">\n              <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n                <polyline points=\"3 6 5 6 21 6\"></polyline>\n                <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"></path>\n              </svg>\n              <span>Remover</span>\n            </button>\n          </div>\n        </section>\n      </div>\n\n      <div id=\"cert-upload-state-view\">\n        <section class=\"card upload-cert-card\">\n          <div class=\"panel-heading\">\n            <div>\n              <span class=\"eyebrow\" id=\"cert-form-eyebrow\">Novo arquivo</span>\n              <h2 id=\"cert-form-title\">Adicionar certificado A1</h2>\n            </div>\n            <button type=\"button\" class=\"btn btn-ghost btn-sm\" id=\"btn-cancel-renew-cert\" style=\"display: none;\">Cancelar renovação</button>\n          </div>\n          <p class=\"cert-renew-hint\" id=\"cert-renew-hint\" style=\"display: none;\">\n            Renovação mantém o <strong>mesmo ID</strong>, o <strong>CNPJ</strong>, XMLs e NSU. Envie apenas o A1 novo (válido) da mesma empresa.\n          </p>\n          <form id=\"form-cert-view\" enctype=\"multipart/form-data\">\n            <input type=\"hidden\" id=\"renew-certificate-id\" value=\"\">\n            <div class=\"drop-zone\" id=\"drop-zone-view\">\n              <svg class=\"drop-zone-icon-svg\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n                <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path>\n                <polyline points=\"17 8 12 3 7 8\"></polyline>\n                <line x1=\"12\" y1=\"3\" x2=\"12\" y2=\"15\"></line>\n              </svg>\n              <span class=\"drop-zone-text\" id=\"cert-drop-text\">Arraste seu certificado <strong>.pfx</strong> ou <strong>.p12</strong> aqui ou clique para selecionar</span>\n              <input type=\"file\" id=\"file-cert-view\" name=\"pfx\" accept=\".pfx,.p12\" style=\"display: none;\">\n              <div id=\"file-name-preview-view\" class=\"file-name-preview\"></div>\n            </div>\n\n            <div class=\"input-group\">\n              <label for=\"passphrase-view\">Senha do certificado</label>\n              <input type=\"password\" id=\"passphrase-view\" placeholder=\"Senha de segurança do PFX\" required>\n            </div>\n\n            <div class=\"input-group\">\n              <label for=\"cert-cnpj-view\">CNPJ da empresa titular</label>\n              <input type=\"text\" id=\"cert-cnpj-view\" placeholder=\"Deixe vazio para extrair automaticamente do certificado\">\n            </div>\n\n            <button type=\"submit\" class=\"btn btn-primary btn-full\" id=\"btn-save-cert-view\">\n              <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n                <path d=\"M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z\"></path>\n                <polyline points=\"17 21 17 13 7 13 7 21\"></polyline>\n                <polyline points=\"7 3 7 8 15 8\"></polyline>\n              </svg>\n              <span id=\"btn-save-cert-label\">Salvar e validar certificado</span>\n            </button>\n          </form>\n        </section>\n      </div>\n    </div>\n  </div>\n</div>\n","view-regras-container":"<div id=\"view-regras-content\" class=\"tab-content rules-screen\" style=\"display: none;\">\n  <section class=\"rules-hero\">\n    <div class=\"rules-hero-copy\">\n      <span class=\"eyebrow\">Sistema</span>\n      <h2>Regras operacionais ADN</h2>\n      <p>Boas práticas para distribuição de NFS-e, consumo da API e operação segura no dia a dia.</p>\n    </div>\n    <div class=\"rules-source\">\n      <div class=\"rules-source-label\">Fontes oficiais</div>\n      <ul>\n        <li>Portal Gov.br NFS-e — documentação atual</li>\n        <li>Manual de API ADN para Contribuintes</li>\n        <li>Manual de API ADN para Municípios</li>\n      </ul>\n    </div>\n  </section>\n\n  <div class=\"rules-section-label\">Princípios da distribuição</div>\n  <section class=\"rules-bento\">\n    <article class=\"rule-card rule-card--wide\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">01</span>\n        <span class=\"rule-tag\">Core</span>\n      </div>\n      <h3>Consulta por NSU</h3>\n      <p>A distribuição usa Número Sequencial Único. Guarde o último NSU recebido e continue do próximo ponto — não recomece a varredura sem necessidade.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">02</span>\n      </div>\n      <h3>Lote máximo</h3>\n      <p>Até 50 documentos por chamada na ADN. A interface pagina 10 itens; a varredura respeita os lotes da API.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">03</span>\n      </div>\n      <h3>Ordem dos documentos</h3>\n      <p>NSU segue a disponibilização nacional — não é ordenação perfeita por data de emissão.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">04</span>\n      </div>\n      <h3>Atores autorizados</h3>\n      <p>Prestador, tomador ou intermediário conforme o certificado mTLS da conexão.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">05</span>\n      </div>\n      <h3>NFS-e e eventos</h3>\n      <p>Cancelamentos e eventos fazem parte do ciclo. A lista consolida a nota principal quando há vínculo.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">06</span>\n        <span class=\"rule-tag rule-tag--warn\">Segurança</span>\n      </div>\n      <h3>Certificado digital</h3>\n      <p>mTLS com A1 (PFX/P12) ICP-Brasil. O certificado define identidade e o recorte acessível.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">07</span>\n        <span class=\"rule-tag rule-tag--danger\">Risco</span>\n      </div>\n      <h3>Consumo indevido</h3>\n      <p>Consultas rápidas demais ou após fim de fila podem bloquear o CNPJ. Use pausa de 2s entre lotes.</p>\n    </article>\n    <article class=\"rule-card\">\n      <div class=\"rule-card-top\">\n        <span class=\"rule-index\">08</span>\n      </div>\n      <h3>Persistência</h3>\n      <p>A tabela lê o banco com paginação no servidor — milhares de XMLs sem carregar tudo no navegador.</p>\n    </article>\n  </section>\n\n  <div class=\"rules-section-label\">Fluxo recomendado</div>\n  <section class=\"rules-flow-card\">\n    <ol class=\"rules-flow-steps\">\n      <li>\n        <span class=\"rules-step-num\">1</span>\n        <div>\n          <strong>Cadastre o certificado</strong>\n          <span>Valide senha, CNPJ e validade antes de iniciar.</span>\n        </div>\n      </li>\n      <li>\n        <span class=\"rules-step-num\">2</span>\n        <div>\n          <strong>Selecione a unidade</strong>\n          <span>Filtre a base pelo CNPJ da unidade desejada.</span>\n        </div>\n      </li>\n      <li>\n        <span class=\"rules-step-num\">3</span>\n        <div>\n          <strong>Use o último NSU</strong>\n          <span>Retome do NSU salvo para evitar chamadas redundantes.</span>\n        </div>\n      </li>\n      <li>\n        <span class=\"rules-step-num\">4</span>\n        <div>\n          <strong>Execute com pausa</strong>\n          <span>2 segundos entre lotes reduz pressão na API nacional.</span>\n        </div>\n      </li>\n      <li>\n        <span class=\"rules-step-num\">5</span>\n        <div>\n          <strong>Navegue a lista</strong>\n          <span>10 XMLs por página, direto do banco de dados.</span>\n        </div>\n      </li>\n    </ol>\n  </section>\n</div>\n"};
;

/* source: js/apiAuth.js */
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
;

/* source: js/apiCerts.js */
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

  async fetchDashboardSummary(options = {}) {
    const cache = window.AppDataCache;
    const forceRefresh = Boolean(options.forceRefresh);
    if (!cache) {
      const res = await fetch('/api/dashboard-summary');
      return this._jsonOrThrow(res, 'Falha ao carregar dashboard.');
    }
    if (forceRefresh) cache.invalidate('dashboard-summary');
    return cache.getOrFetch('dashboard-summary', 60000, async () => {
      const res = await fetch('/api/dashboard-summary');
      return this._jsonOrThrow(res, 'Falha ao carregar dashboard.');
    }, { softMs: 600000, allowStale: !forceRefresh });
  },

  async uploadCertificate(formData) {
    const res = await fetch('/api/upload-certificate', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (window.AppDataCache && data?.success) {
      window.AppDataCache.invalidate('cert-status');
      window.AppDataCache.invalidate('dashboard-summary');
    }
    return data;
  },

  async renewCertificate(formData) {
    const res = await fetch('/api/renew-certificate', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (window.AppDataCache && data?.success) {
      window.AppDataCache.invalidate('cert-status');
      window.AppDataCache.invalidate('dashboard-summary');
    }
    return data;
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
;

/* source: js/apiData.js */
// Sync, docs, units API
Object.assign(window.AppApi = window.AppApi || {}, {
}, {
async fetchBatch({ startNsu, environment, cnpjConsulta, certificateId, sortOrder, sessionRunId = null, closeRun = false }) {
    const res = await fetch('/api/fetch-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startNsu,
        environment,
        cnpjConsulta,
        certificateId,
        sortOrder,
        sessionRunId,
        closeRun
      })
    });
    return res.json();
  },

  async startSyncRun(payload) {
    const res = await fetch('/api/sync-run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    return res.json();
  },

  async finishSyncRun(payload) {
    const res = await fetch('/api/sync-run/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
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
  },

  async fetchSyncRuns(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/sync-runs?${qs}`);
    return this._jsonOrThrow(res, 'Falha ao carregar histórico de varreduras.');
  },

  async fetchApiHealth(hours = 24) {
    const res = await fetch(`/api/api-health?hours=${Number(hours) || 24}`);
    return this._jsonOrThrow(res, 'Falha ao carregar saúde da API.');
  },

  async fetchAuditLog(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/audit-log?${qs}`);
    return this._jsonOrThrow(res, 'Falha ao carregar auditoria.');
  },

  async fetchDashboardAnalytics(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/dashboard-analytics?${qs}`);
    return this._jsonOrThrow(res, 'Falha ao carregar analytics.');
  }
});
;

/* source: js/apiDownloads.js */
// Downloads Excel/ZIP
function formatDateForFileName(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function buildExcelFileName(params = {}) {
  const start = formatDateForFileName(params.startDate);
  const end = formatDateForFileName(params.endDate);
  if (start && end) return `Notas_NFSe_${start}_a_${end}.xlsx`;
  if (start) return `Notas_NFSe_desde_${start}.xlsx`;
  if (end) return `Notas_NFSe_ate_${end}.xlsx`;
  return 'Notas_NFSe.xlsx';
}

Object.assign(window.AppApi = window.AppApi || {}, {
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
    // Preferir o nome do Content-Disposition do servidor, se existir
    const disposition = res.headers.get('Content-Disposition') || '';
    const starMatch = disposition.match(/filename\*=(?:UTF-8''|)([^;]+)/i);
    const plainMatch = disposition.match(/filename="([^"]+)"/i)
      || disposition.match(/filename=([^;]+)/i);
    let serverName = '';
    if (starMatch) {
      try {
        serverName = decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ''));
      } catch (e) {
        serverName = starMatch[1].trim().replace(/^"|"$/g, '');
      }
    } else if (plainMatch) {
      serverName = plainMatch[1].trim().replace(/^"|"$/g, '');
    }
    anchor.download = serverName || buildExcelFileName(params);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  },

  async downloadIntegrityManifest(params) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/download-integrity-manifest?${query}`);
    if (!res.ok) {
      let message = 'Erro ao gerar manifesto de integridade.';
      try { message = (await res.json()).error || message; } catch (error) {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    anchor.download = match?.[1] || 'Manifesto_Integridade_NFSe.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
});
;

/* source: js/uiElements.js */
// Inicialização de Elementos DOM Globais

window.AppUiElements = {
  initElements() {
    window.authScreen = document.getElementById('auth-screen');
    window.appLayout = document.getElementById('app-layout');
    window.btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
    window.sidebarBackdrop = document.getElementById('sidebar-backdrop');
    window.authForm = document.getElementById('auth-form');
    window.authEmail = document.getElementById('auth-email');
    window.authPassword = document.getElementById('auth-password');
    window.authSubmit = document.getElementById('auth-submit');
    window.authMessage = document.getElementById('auth-message');
    window.authUserEmail = document.getElementById('auth-user-email');
    window.btnLogout = document.getElementById('btn-logout');

    window.dropZone = document.getElementById('drop-zone-view');
    window.fileInput = document.getElementById('file-cert-view');
    window.fileNamePreview = document.getElementById('file-name-preview-view');
    window.formCert = document.getElementById('form-cert-view');
    window.passphraseInput = document.getElementById('passphrase-view');
    window.certCnpjInput = document.getElementById('cert-cnpj-view');
    window.certUploadState = document.getElementById('cert-upload-state-view');
    window.certActiveState = document.getElementById('cert-active-state-view');
    window.activeCertName = document.getElementById('active-cert-name-view');
    window.activeCertCnpj = document.getElementById('active-cert-cnpj-view');
    window.btnReplaceCert = document.getElementById('btn-replace-cert-view');
    window.btnRenewActiveCert = document.getElementById('btn-renew-active-cert-view');
    window.btnCancelRenewCert = document.getElementById('btn-cancel-renew-cert');
    window.btnDiagnoseCert = document.getElementById('btn-diagnose-cert-view');
    window.renewCertificateIdInput = document.getElementById('renew-certificate-id');
    window.certFormEyebrow = document.getElementById('cert-form-eyebrow');
    window.certFormTitle = document.getElementById('cert-form-title');
    window.certRenewHint = document.getElementById('cert-renew-hint');
    window.btnSaveCertLabel = document.getElementById('btn-save-cert-label');
    window.certDropText = document.getElementById('cert-drop-text');
    window.certList = document.getElementById('cert-list');
    window.certCountLabel = document.getElementById('cert-count-label');

    window.selectCertificate = document.getElementById('certificate-select');
    window.selectEnvironment = document.getElementById('environment');
    window.selectSearchMode = document.getElementById('search-mode');
    window.inputCnpjConsulta = document.getElementById('cnpj-consulta');
    window.inputStartNsu = document.getElementById('start-nsu');
    window.btnUseSavedNsu = document.getElementById('btn-use-saved-nsu');
    window.btnUseNationalNsu = document.getElementById('btn-use-national-nsu');
    window.inputLimiteNotas = document.getElementById('limite-notas');
    window.btnStart = document.getElementById('btn-start');
    window.btnPause = document.getElementById('btn-pause');
    window.btnResetNsu = document.getElementById('btn-reset-nsu');

    window.progressBar = document.getElementById('progress-bar');
    window.progressText = document.getElementById('progress-text');
    window.progressPercentage = document.getElementById('progress-percentage');
    window.statNsuAtual = document.getElementById('stat-nsu-atual');
    window.statNsuMax = document.getElementById('stat-nsu-max');
    window.statTotalNotas = document.getElementById('stat-total-notas');
    window.statTotalValue = document.getElementById('stat-total-value');
    window.statStoragePayloads = document.getElementById('stat-storage-payloads');
    window.statStorageSize = document.getElementById('stat-storage-size');
    window.alertRateLimit = document.getElementById('alert-rate-limit');
    window.alertSyncSuccess = document.getElementById('alert-sync-success');
    window.crawlerStatusContainer = document.getElementById('crawler-status-container');
    window.crawlerCurrentCnpj = document.getElementById('crawler-current-cnpj');
    window.crawlerVisitedCount = document.getElementById('crawler-visited-count');
    window.crawlerQueueCount = document.getElementById('crawler-queue-count');
    window.consoleLog = document.getElementById('console-log');
    window.consoleLogDrawer = document.getElementById('console-log-drawer');
    window.consoleLogHint = document.getElementById('console-log-hint');
    if (window.consoleLogDrawer) {
      consoleLogDrawer.classList.add('is-idle');
    }
    if (window.AppUi?._updateLogHint) window.AppUi._updateLogHint();

    window.btnClearDownloads = document.getElementById('btn-clear-downloads');
    window.btnExportExcel = document.getElementById('btn-export-excel');
    window.btnExportIntegrity = document.getElementById('btn-export-integrity');
    window.btnDownloadZip = document.getElementById('btn-download-zip');
    window.tableBody = document.getElementById('table-body');
    window.historyCountLabel = document.getElementById('history-count-label');
    window.historyPageInfo = document.getElementById('history-page-info');
    window.btnHistoryPrev = document.getElementById('btn-history-prev');
    window.btnHistoryNext = document.getElementById('btn-history-next');
    window.historySearch = document.getElementById('history-search');
    window.includeCancelled = document.getElementById('include-cancelled');
    window.cancelledFilter = document.getElementById('cancelled-filter');

    window.navDashboard = document.getElementById('nav-dashboard');
    window.navDownload = document.getElementById('nav-download');
    window.navCertificado = document.getElementById('nav-certificado');
    window.navRegras = document.getElementById('nav-regras');

    window.viewDashboardContent = document.getElementById('view-dashboard-content');
    window.viewDownloadContent = document.getElementById('view-download-content');
    window.viewCertificadoContent = document.getElementById('view-certificado-content');
    window.viewRegrasContent = document.getElementById('view-regras-content');

    window.dashboardCitiesGrid = document.getElementById('dashboard-cities-grid');
    window.dashboardLoader = document.getElementById('dashboard-loader');
    window.btnRefreshDashboard = document.getElementById('btn-refresh-dashboard');
    window.dashStatCities = document.getElementById('dash-stat-cities');
    window.dashStatActive = document.getElementById('dash-stat-active');
    window.dashStatXmls = document.getElementById('dash-stat-xmls');

    window.pageTitle = document.getElementById('page-title');
    window.pageSubtitle = document.getElementById('page-subtitle');

    window.themeToggle = document.getElementById('theme-toggle');
    window.themeText = document.getElementById('theme-text');
    window.sunIcon = document.querySelector('.sun-icon');
    window.moonIcon = document.querySelector('.moon-icon');

    window.schedulerEnabled = document.getElementById('scheduler-enabled');
    window.schedulerInterval = document.getElementById('scheduler-interval');
    window.schedulerEnv = document.getElementById('scheduler-env');
    window.schedulerMaxBatches = document.getElementById('scheduler-max-batches');
    window.schedulerDelaySeconds = document.getElementById('scheduler-delay-seconds');
    window.schedulerLastRun = document.getElementById('scheduler-last-run');
    window.schedulerStatus = document.getElementById('scheduler-status');
    window.btnSaveScheduler = document.getElementById('btn-save-scheduler');
    window.btnRunSchedulerNow = document.getElementById('btn-run-scheduler-now');
    window.manualSyncProgressBar = document.getElementById('manual-sync-progress-bar');
    window.manualSyncProgressText = document.getElementById('manual-sync-progress-text');
    window.manualSyncProgressPercentage = document.getElementById('manual-sync-progress-percentage');
    window.downloadStartDate = document.getElementById('download-start-date');
    window.downloadEndDate = document.getElementById('download-end-date');
    window.btnDownloadPeriod = document.getElementById('btn-download-period');
    window.unitFilter = document.getElementById('unit-filter');
    window.unitPartyRole = document.getElementById('unit-party-role');
    window.unitName = document.getElementById('unit-name');
    window.unitCnpj = document.getElementById('unit-cnpj');
    window.unitCity = document.getElementById('unit-city');
    window.unitState = document.getElementById('unit-state');
    window.btnSaveUnit = document.getElementById('btn-save-unit');
    window.btnDeleteUnit = document.getElementById('btn-delete-unit');
  }
};
;

/* source: js/uiTableCore.js */
window.AppUiTable = Object.assign(window.AppUiTable || {}, {
pageSize: 10,
  currentPage: 1,
  documents: [],
  remoteTotal: 0,
  remoteTotalValue: 0,
  remoteMode: false,

  normalizeDocument(doc) {
    const metadata = doc.metadata || {};
    const fallbackDesc = doc.codigo_tributacao || doc.codigoTributacao || metadata.codigoTributacao
      ? `Serviço Tributação: ${doc.codigo_tributacao || doc.codigoTributacao || metadata.codigoTributacao}`
      : 'Serviço NFS-e Geral';
    return {
      nsu: doc.nsu,
      tipo: doc.tipo || metadata.tipo || 'NFSE',
      chave: doc.chave || metadata.chave || 'N/A',
      status: (doc.is_cancelled || metadata.isCancellation)
        ? 'Cancelada'
        : (metadata.status || doc.status || 'Autorizada'),
      isCancellation: Boolean(doc.is_cancelled || metadata.isCancellation),
      numeroNfse: doc.numeroNfse || doc.numero_nfse || metadata.numeroNfse || 'N/A',
      numeroDps: doc.numeroDps || metadata.numeroDps || 'N/A',
      serieDps: doc.serieDps || metadata.serieDps || 'N/A',
      prestadorCnpj: doc.prestadorCnpj || doc.prestador_cnpj || metadata.prestadorCnpj || 'N/A',
      prestadorNome: doc.prestadorNome || doc.prestador_nome || metadata.prestadorNome || 'N/A',
      tomadorCnpj: doc.tomadorCnpj || doc.tomador_cnpj || metadata.tomadorCnpj || 'N/A',
      tomadorNome: doc.tomadorNome || doc.tomador_nome || metadata.tomadorNome || 'N/A',
      descricao: doc.descricao || metadata.descricao || metadata.descricaoServico || fallbackDesc,
      municipioPrestacao: doc.municipioPrestacao || doc.municipio_prestacao || metadata.municipioPrestacao || 'N/A',
      codigoTributacao: doc.codigoTributacao || doc.codigo_tributacao || metadata.codigoTributacao || 'N/A',
      eventoDescricao: doc.eventoDescricao || metadata.eventoDescricao || 'N/A',
      eventoMotivo: doc.eventoMotivo || metadata.eventoMotivo || 'N/A',
      tributacaoNacional: doc.tributacaoNacional || metadata.tributacaoNacional || '',
      valorServico: doc.valorServico || doc.valor_servico || metadata.valorServico || '0.00',
      dataEmissao: doc.dataEmissao || doc.data_emissao || metadata.dataEmissao || 'N/A',
      competencia: doc.competencia || metadata.competencia || 'N/A',
      dataProcessamento: doc.dataProcessamento || metadata.dataProcessamento || doc.first_seen_at || doc.firstSeenAt || doc.created_at || 'N/A',
      token: metadata.token || doc.token || '',
      arquivo: doc.arquivo || doc.file_name || metadata.arquivo || ''
    };
  },

  getDedupKey(doc) {
    const chave = String(doc.chave || '').trim();
    if (chave && chave !== 'N/A' && !chave.startsWith('NSU_')) {
      return `CHAVE:${chave}`;
    }
    return `NSU:${doc.nsu || doc.token || doc.arquivo || doc.xmlSha256 || 'SEM_CHAVE'}`;
  },

  dedupeDocuments(docs) {
    const byKey = new Map();
    const ordered = [...(docs || [])].sort((a, b) => {
      const aEvento = String(a.tipo || '').toUpperCase() === 'EVENTO';
      const bEvento = String(b.tipo || '').toUpperCase() === 'EVENTO';
      return Number(aEvento) - Number(bEvento);
    });
    ordered.forEach(doc => {
      const key = this.getDedupKey(doc);
      if (!byKey.has(key)) byKey.set(key, doc);
    });
    return Array.from(byKey.values());
  },

  setDocuments(docs, total = null, page = 1, totalValue = 0, options = {}) {
    this.documents = this.dedupeDocuments((docs || []).map(doc => this.normalizeDocument(doc)));
    this.totalsPending = Boolean(options.totalsPending);
    this.remoteMode = true;
    this.currentPage = page;
    const pageSize = this.pageSize || 10;
    if (total == null && this.totalsPending) {
      // Provisório: habilita "próxima" se a página veio cheia
      const full = this.documents.length >= pageSize;
      this.remoteTotal = full
        ? page * pageSize + 1
        : (page - 1) * pageSize + this.documents.length;
      this.remoteTotalValue = totalValue == null ? this.remoteTotalValue : Number(totalValue || 0);
    } else {
      this.remoteTotal = total == null ? this.documents.length : Number(total || 0);
      this.remoteTotalValue = Number(totalValue || 0);
      this.totalsPending = false;
    }
    this.renderCurrentPage();
  },

  updateTotals(total, totalValue) {
    this.totalsPending = false;
    this.remoteTotal = Number(total || 0);
    this.remoteTotalValue = Number(totalValue || 0);
    this.remoteMode = true;
    this.renderCurrentPage();
  }
});
;

/* source: js/uiTableLoading.js */
Object.assign(window.AppUiTable = window.AppUiTable || {}, {
showLoading() {
    const tableBody = window.tableBody || document.getElementById('table-body');
    if (!tableBody) return;
    
    let skeletonHtml = '';
    for (let i = 0; i < 3; i++) {
      skeletonHtml += `
        <div class="xml-item skeleton-row" style="opacity: ${1 - (i * 0.25)};">
          <div class="xml-main-cell">
            <div class="skeleton-shimmer" style="width: 120px; height: 16px;"></div>
            <div class="skeleton-shimmer" style="width: 80px; height: 12px; margin-top: 6px;"></div>
          </div>
          <div class="xml-party-cell">
            <div>
              <div class="skeleton-shimmer" style="width: 100px; height: 14px;"></div>
              <div class="skeleton-shimmer" style="width: 80px; height: 10px; margin-top: 6px;"></div>
            </div>
            <div>
              <div class="skeleton-shimmer" style="width: 100px; height: 14px;"></div>
              <div class="skeleton-shimmer" style="width: 80px; height: 10px; margin-top: 6px;"></div>
            </div>
          </div>
          <div class="xml-service-cell">
            <div class="skeleton-shimmer" style="width: 160px; height: 14px;"></div>
            <div class="skeleton-shimmer" style="width: 90px; height: 10px; margin-top: 6px;"></div>
          </div>
          <div class="xml-value-cell">
            <div class="skeleton-shimmer" style="width: 70px; height: 16px;"></div>
          </div>
          <div class="xml-action-cell" style="align-items: flex-end;">
            <div class="skeleton-shimmer" style="width: 60px; height: 26px; border-radius: 6px;"></div>
          </div>
        </div>
      `;
    }
    
    tableBody.innerHTML = skeletonHtml;

    if (window.statTotalNotas) {
      window.statTotalNotas.innerHTML = `<div class="skeleton-shimmer" style="width: 45px; height: 24px; vertical-align: middle;"></div>`;
    }
    if (window.statTotalValue) {
      window.statTotalValue.innerHTML = `<div class="skeleton-shimmer" style="width: 100px; height: 24px; vertical-align: middle;"></div>`;
    }
    if (window.statStoragePayloads) {
      window.statStoragePayloads.innerHTML = `<div class="skeleton-shimmer" style="width: 50px; height: 20px; vertical-align: middle;"></div>`;
    }
  },

  showLoadError(message = 'Não foi possível carregar os XMLs desta unidade.') {
    const tableBody = window.tableBody || document.getElementById('table-body');
    if (!tableBody) return;
    tableBody.innerHTML = `
      <div class="xml-empty-state" role="alert">
        <strong>Falha ao carregar documentos</strong>
        <span class="helper-text" id="history-load-error-message"></span>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-retry-history">Tentar novamente</button>
      </div>
    `;
    const text = document.getElementById('history-load-error-message');
    if (text) text.textContent = message;
    document.getElementById('btn-retry-history')?.addEventListener('click', () => {
      window.AppSyncController?.loadPersistedHistory?.(1, { quiet: false });
    });
    if (window.statTotalNotas) window.statTotalNotas.textContent = '—';
    if (window.statTotalValue) window.statTotalValue.textContent = '—';
  },

  appendDocumentsToTable(docs) {
    if (window.AppSyncController?.loadPersistedHistory) {
      window.AppSyncController.loadPersistedHistory(1);
      return;
    }

    this.remoteMode = false;
    const normalized = (docs || []).map(doc => this.normalizeDocument(doc));
    const byKey = new Map(this.documents.map(doc => [this.getDedupKey(doc), doc]));
    const ordered = [...normalized].sort((a, b) => {
      const aEvento = String(a.tipo || '').toUpperCase() === 'EVENTO';
      const bEvento = String(b.tipo || '').toUpperCase() === 'EVENTO';
      return Number(aEvento) - Number(bEvento);
    });
    ordered.forEach(doc => {
      const key = this.getDedupKey(doc);
      const current = byKey.get(key);
      const currentIsEvento = String(current?.tipo || '').toUpperCase() === 'EVENTO';
      const nextIsEvento = String(doc.tipo || '').toUpperCase() === 'EVENTO';
      if (!current || (currentIsEvento && !nextIsEvento)) byKey.set(key, doc);
    });
    this.documents = Array.from(byKey.values());
    this.currentPage = Math.max(1, Math.ceil(this.documents.length / this.pageSize));
    this.renderCurrentPage();
  }
});
;

/* source: js/uiTableRender.js */
Object.assign(window.AppUiTable = window.AppUiTable || {}, {
  _prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  },

  _flashMetric(el) {
    if (!el || this._prefersReducedMotion()) return;
    el.classList.remove('metric-flash');
    // reflow para reiniciar animação
    void el.offsetWidth;
    el.classList.add('metric-flash');
  },

  _setMetricText(el, text, { pending = false, flash = false } = {}) {
    if (!el) return;
    const next = String(text);
    const prev = el.dataset.metricText;
    el.classList.toggle('is-pending', pending);
    if (prev === next && !flash) return;
    el.dataset.metricText = next;
    el.textContent = next;
    if (flash && !pending) this._flashMetric(el);
  },

  _renderEmptyState(tableBody) {
    const hasCert = Boolean(
      (window.selectCertificate && window.selectCertificate.value) ||
      window.activeCertificateId
    );
    tableBody.innerHTML = `
      <div id="empty-row" class="xml-empty-state rich-empty">
        <div class="empty-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="9" y1="13" x2="15" y2="13"></line>
            <line x1="9" y1="17" x2="13" y2="17"></line>
          </svg>
        </div>
        <div class="empty-title">Nenhum XML neste recorte</div>
        <p class="empty-text">
          ${hasCert
            ? 'Ajuste a unidade, o filtro de canceladas ou inicie uma varredura para sincronizar notas.'
            : 'Selecione um certificado e rode a varredura para trazer os XMLs da unidade.'}
        </p>
        <div class="empty-actions">
          ${hasCert
            ? '<button type="button" class="btn btn-success btn-sm" data-empty-action="start-scan">Iniciar varredura</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-empty-action="go-certs">Ir para certificados</button>'}
          <button type="button" class="btn btn-secondary btn-sm" data-empty-action="clear-filters">Limpar busca</button>
        </div>
      </div>
    `;

    const startBtn = tableBody.querySelector('[data-empty-action="start-scan"]');
    const certsBtn = tableBody.querySelector('[data-empty-action="go-certs"]');
    const clearBtn = tableBody.querySelector('[data-empty-action="clear-filters"]');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const btn = window.btnStart || document.getElementById('btn-start');
        if (btn && !btn.disabled) btn.click();
        else if (window.AppUi?.log) window.AppUi.log('Ative um certificado para iniciar a varredura.', 'warning');
      });
    }
    if (certsBtn) {
      certsBtn.addEventListener('click', () => {
        const nav = window.navCertificado || document.getElementById('nav-certificado');
        const view = window.viewCertificadoContent || document.getElementById('view-certificado-content');
        if (window.AppUi?.switchTab && nav && view) {
          window.AppUi.switchTab(nav, view, 'Certificados', 'Gerencie certificados A1 e nomes internos');
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (window.historySearch) window.historySearch.value = '';
        if (window.cancelledFilter) window.cancelledFilter.value = 'all';
        if (window.unitFilter) window.unitFilter.value = '';
        if (window.AppDataCache) window.AppDataCache.invalidate('history:');
        if (window.AppSyncController?.loadPersistedHistory) {
          window.AppSyncController.loadPersistedHistory(1, { quiet: true });
        }
      });
    }
  },

  renderCurrentPage() {
    const tableBody = window.tableBody || document.getElementById('table-body');
    if (!tableBody) return;

    const pageChanged = this._lastRenderedPage != null && this._lastRenderedPage !== this.currentPage;
    this._lastRenderedPage = this.currentPage;

    tableBody.innerHTML = '';
    tableBody.classList.remove('is-entering', 'is-paging');

    const mode = window.selectSearchMode ? window.selectSearchMode.value : 'asc';
    const orderedDocs = this.remoteMode ? [...this.documents] : [...this.documents].sort((a, b) => {
      const aNsu = Number(a.nsu || 0);
      const bNsu = Number(b.nsu || 0);
      return mode === 'desc' ? bNsu - aNsu : aNsu - bNsu;
    });

    const totalItems = this.remoteMode ? this.remoteTotal : orderedDocs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    this.currentPage = Math.min(Math.max(this.currentPage, 1), totalPages);
    const start = (this.currentPage - 1) * this.pageSize;
    const pageDocs = this.remoteMode ? orderedDocs : orderedDocs.slice(start, start + this.pageSize);

    if (pageDocs.length === 0) {
      this._renderEmptyState(tableBody);
      this.updatePagination(totalItems, 0, 0);
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = true;
      if (window.btnExportExcel) window.btnExportExcel.disabled = true;
      if (window.btnExportIntegrity) window.btnExportIntegrity.disabled = true;
      return;
    }

    if (window.btnDownloadZip) window.btnDownloadZip.disabled = false;
    if (window.btnExportExcel) window.btnExportExcel.disabled = false;
    if (window.btnExportIntegrity) window.btnExportIntegrity.disabled = false;

    const esc = window.AppUtils.escapeHtml;
    const frag = document.createDocumentFragment();
    pageDocs.forEach(doc => {
      const item = document.createElement('article');
      const isCancelled = Boolean(doc.isCancellation) || String(doc.status || '').toLowerCase().includes('cancel');
      item.className = isCancelled ? 'xml-item cancelled-row' : 'xml-item';
      const valorFormatado = window.AppUtils.formatCurrency(doc.valorServico);
      const isEvento = String(doc.tipo || '').toUpperCase() === 'EVENTO' || doc.status === 'Evento';
      const hasChave = doc.chave && doc.chave !== 'N/A';
      const eventoDetalhe = isEvento
        ? [doc.eventoDescricao, doc.eventoMotivo].filter(v => v && v !== 'N/A').join(' - ')
        : '';
      const statusClass = isCancelled ? 'cancelled' : (doc.status === 'Evento' ? 'event' : 'ok');
      const safeToken = esc(doc.token || '');
      const safeChave = esc(doc.chave || '');
      const descText = eventoDetalhe || doc.descricao || 'N/A';

      item.innerHTML = `
        <div class="xml-main-cell">
          <div class="xml-title-row">
            <span class="tipo-badge ${esc(String(doc.tipo || 'nfse').toLowerCase())}">${esc(doc.tipo || 'NFSE')}</span>
            <span class="status-badge ${statusClass}">${esc(doc.status || 'Autorizada')}</span>
          </div>
          <strong>NSU ${esc(doc.nsu || 'N/A')}</strong>
          <span class="helper-text">NFS-e ${esc(doc.numeroNfse || 'N/A')} | DPS ${esc(doc.numeroDps || 'N/A')} / Série ${esc(doc.serieDps || 'N/A')}</span>
          <span class="cnpj-badge wrap">${esc(doc.chave || 'Chave não informada')}</span>
        </div>
        <div class="xml-party-cell">
          <div><strong>Prestador</strong><span>${esc(doc.prestadorNome || 'N/A')}</span><small>${esc(window.AppUtils.formatCnpj(doc.prestadorCnpj) || 'N/A')}</small></div>
          <div><strong>Tomador</strong><span>${esc(doc.tomadorNome || 'N/A')}</span><small>${esc(window.AppUtils.formatCnpj(doc.tomadorCnpj) || 'Não cadastrado')}</small></div>
        </div>
        <div class="xml-service-cell">
          <div class="descricao-texto expanded" title="${esc(descText)}">${esc(descText)}</div>
          <span class="helper-text">Município: ${esc(doc.municipioPrestacao || 'N/A')}</span>
          <span class="helper-text">Cód. tributação: ${esc(doc.codigoTributacao || 'N/A')}</span>
        </div>
        <div class="xml-value-cell">
          <strong>${esc(valorFormatado)}</strong>
          <span>Emissão: ${esc(window.AppUtils.formatDate(doc.dataEmissao))}</span>
          <span>Competência: ${esc(window.AppUtils.formatDate(doc.competencia))}</span>
          <span>Processamento: ${esc(window.AppUtils.formatDate(doc.dataProcessamento))}</span>
        </div>
        <div class="xml-action-cell">
          <button type="button" class="btn btn-secondary btn-sm" data-action="open-detail" data-nsu="${esc(doc.nsu || '')}" title="Ver detalhes">
            <span>Detalhe</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-xml" data-token="${safeToken}" ${doc.token ? '' : 'disabled'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>XML</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-pdf" data-chave="${safeChave}" ${hasChave ? '' : 'disabled'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="9" y1="15" x2="15" y2="15"></line>
              <line x1="9" y1="18" x2="13" y2="18"></line>
            </svg>
            <span>PDF</span>
          </button>
        </div>
      `;
      item.dataset.docNsu = String(doc.nsu || '');
      item.dataset.docChave = String(doc.chave || '');
      frag.appendChild(item);
    });
    tableBody.appendChild(frag);

    if (!this._prefersReducedMotion()) {
      // Stagger na 1ª pintura da página; fade leve nas demais
      requestAnimationFrame(() => {
        tableBody.classList.add(pageChanged ? 'is-paging' : 'is-entering');
        window.setTimeout(() => {
          tableBody.classList.remove('is-entering', 'is-paging');
        }, pageChanged ? 200 : 320);
      });
    }

    this.updatePagination(totalItems, start + 1, start + pageDocs.length);
  },

  updatePagination(total, from, to) {
    const pending = Boolean(this.totalsPending);
    if (historyCountLabel) {
      historyCountLabel.innerText = pending
        ? `${this.documents.length} XML(s) nesta página…`
        : `${total} XML${total === 1 ? '' : 's'} sincronizado${total === 1 ? '' : 's'}`;
    }
    if (historyPageInfo) {
      historyPageInfo.innerText = pending
        ? (total > 0 ? `${from}-${to}` : '0')
        : (total > 0 ? `${from}-${to} de ${total}` : '0 de 0');
    }
    if (btnHistoryPrev) btnHistoryPrev.disabled = this.currentPage <= 1;
    if (btnHistoryNext) {
      const fullPage = this.documents.length >= (this.pageSize || 10);
      btnHistoryNext.disabled = pending
        ? !fullPage
        : this.currentPage >= Math.ceil(Math.max(total, 1) / this.pageSize);
    }

    const wasPending = this._metricsWerePending;
    const totalLabel = pending ? '…' : String(total);
    const valueLabel = pending && !this.remoteTotalValue
      ? '…'
      : window.AppUtils.formatCurrency(this.remoteTotalValue || 0);

    this._setMetricText(window.statTotalNotas || document.getElementById('stat-total-notas'), totalLabel, {
      pending,
      flash: wasPending && !pending
    });
    this._setMetricText(window.statTotalValue || document.getElementById('stat-total-value'), valueLabel, {
      pending: pending && !this.remoteTotalValue,
      flash: wasPending && !pending
    });
    this._metricsWerePending = pending;
  },

  nextPage() {
    if (this.remoteMode && window.AppSyncController?.loadPersistedHistory) {
      window.AppSyncController.loadPersistedHistory(this.currentPage + 1);
      return;
    }
    this.currentPage += 1;
    this.renderCurrentPage();
  },

  prevPage() {
    if (this.remoteMode && window.AppSyncController?.loadPersistedHistory) {
      window.AppSyncController.loadPersistedHistory(this.currentPage - 1);
      return;
    }
    this.currentPage -= 1;
    this.renderCurrentPage();
  }
});
;

/* source: js/uiCore.js */
window.AppUi = Object.assign(window.AppUi || {}, {
initElements() {
    window.AppUiElements.initElements();
  },

  log(message, type = 'system') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;

    let icon = '●';
    if (type === 'success') icon = '✔';
    if (type === 'warning') icon = '▲';
    if (type === 'error') icon = '✖';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.innerText = `[${timestamp}]`;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `log-badge ${type}`;
    badgeSpan.innerText = icon;

    const textSpan = document.createElement('span');
    textSpan.className = 'log-text';
    textSpan.innerText = message;

    line.appendChild(timeSpan);
    line.appendChild(badgeSpan);
    line.appendChild(textSpan);
    line.classList.add('is-new');

    if (window.consoleLog) {
      // Remove placeholder de idle na primeira mensagem real
      const placeholder = consoleLog.querySelector('.log-placeholder');
      if (placeholder) placeholder.remove();

      consoleLog.appendChild(line);
      while (consoleLog.children.length > 400) {
        consoleLog.removeChild(consoleLog.firstChild);
      }
      consoleLog.scrollTop = consoleLog.scrollHeight;
      this._updateLogHint(type);
      window.setTimeout(() => line.classList.remove('is-new'), 400);
    }
  },

  _updateLogHint(lastType = 'system') {
    const hint = window.consoleLogHint || document.getElementById('console-log-hint');
    const log = window.consoleLog || document.getElementById('console-log');
    const panel = window.consoleLogDrawer || document.getElementById('console-log-drawer');
    if (!hint || !log) return;

    const realLines = log.querySelectorAll('.log-line:not(.log-placeholder)');
    const n = realLines.length;
    hint.textContent = n === 0
      ? 'Aguardando eventos…'
      : `${n} linha${n === 1 ? '' : 's'}`;

    if (panel) {
      panel.classList.toggle('is-idle', n === 0);
      if (lastType === 'error') panel.classList.add('has-error');
      if (lastType === 'success' && n > 0) panel.classList.remove('has-error');
    }
  },

  logNationalApiContext(nationalApi) {
    if (!nationalApi) return;
    this.log(`ADN: HTTP=${nationalApi.httpStatus || 'N/A'} | StatusProcessamento=${nationalApi.statusProcessamento || 'N/A'} | ambiente=${nationalApi.environment || 'N/A'} | cnpjConsulta=${nationalApi.cnpjConsulta || 'N/A'}`, 'warning');
    if (nationalApi.endpoint) {
      this.log(`ADN endpoint: ${nationalApi.endpoint}`, 'warning');
    }
    if (Array.isArray(nationalApi.errors) && nationalApi.errors.length > 0) {
      nationalApi.errors.forEach(err => {
        this.log(`ADN erro ${err.code || 'sem código'}: ${err.description || 'sem descrição'}`, 'error');
      });
    }
  },

  setAuthMessage(message, type = '') {
    if (!authMessage) return;
    authMessage.textContent = message || '';
    authMessage.className = `auth-message ${type}`.trim();
  },

  showAuthenticatedApp(user) {
    const screen = window.authScreen || document.getElementById('auth-screen');
    const layout = window.appLayout || document.getElementById('app-layout');
    const emailEl = window.authUserEmail || document.getElementById('auth-user-email');
    if (screen) screen.style.display = 'none';
    if (layout) layout.style.display = 'flex';
    if (emailEl) emailEl.textContent = user?.email || 'Sessão ativa';
  },

  showLogin() {
    const screen = window.authScreen || document.getElementById('auth-screen');
    const layout = window.appLayout || document.getElementById('app-layout');
    if (layout) layout.style.display = 'none';
    // auth-screen.html vem com display:none inline — forca grid
    if (screen) screen.style.setProperty('display', 'grid', 'important');
  }
});
;

/* source: js/uiCerts.js */
Object.assign(window.AppUi = window.AppUi || {}, {
renderCertificateSelector() {
    if (!selectCertificate) return;

    selectCertificate.innerHTML = '';
    if (window.certificates.length === 0) {
      selectCertificate.innerHTML = '<option value="">Nenhum certificado cadastrado</option>';
      return;
    }

    window.certificates.forEach(cert => {
      const option = document.createElement('option');
      option.value = cert.id;
      option.textContent = `${cert.cnpj || 'CNPJ não informado'} - ${cert.filename}`;
      option.selected = cert.id === window.activeCertificateId;
      selectCertificate.appendChild(option);
    });
  },

  renderCertificateList() {
    if (!certList) return;

    if (certCountLabel) {
      certCountLabel.innerText = `${window.certificates.length} certificado${window.certificates.length === 1 ? '' : 's'}`;
    }

    if (window.certificates.length === 0) {
      certList.innerHTML = '<div class="empty-cert-list">Nenhum certificado cadastrado.</div>';
      return;
    }

    certList.innerHTML = '';
    const esc = window.AppUtils.escapeHtml;
    window.certificates.forEach(cert => {
      const item = document.createElement('div');
      item.className = `cert-list-item ${cert.id === window.activeCertificateId ? 'active' : ''}`;
      const safeId = esc(cert.id);
      item.innerHTML = `
        <div class="cert-list-main">
          <strong>${esc(cert.filename)}</strong>
          <span>CNPJ: ${esc(cert.cnpj || 'Não informado')}</span>
        </div>
        <div class="cert-list-actions">
          <button class="btn btn-secondary btn-sm" data-action="select-cert" data-id="${safeId}" ${cert.id === window.activeCertificateId ? 'disabled' : ''}>Usar</button>
          <button class="btn btn-primary btn-sm" data-action="renew-cert" data-id="${safeId}" title="Troca o PFX mantendo CNPJ, XMLs e NSU">Renovar</button>
          <button class="btn btn-secondary btn-sm" data-action="rename-cert" data-id="${safeId}">Renomear</button>
          <button class="btn btn-secondary btn-sm text-danger" data-action="remove-cert" data-id="${safeId}">Remover</button>
        </div>
      `;
      certList.appendChild(item);
    });
  }
});
;

/* source: js/uiProgress.js */
Object.assign(window.AppUi = window.AppUi || {}, {
setBtnStartActive(active, isResume = false) {
    if (active) {
      btnStart.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        <span>Pausar</span>
      `;
      btnStart.className = 'btn btn-danger';
    } else {
      btnStart.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>${isResume ? 'Continuar' : 'Iniciar'}</span>
      `;
      btnStart.className = 'btn btn-success';
    }
  },

  updateCrawlerUI() {
    if (window.isCrawlerActive) {
      crawlerStatusContainer.style.display = 'block';
      crawlerCurrentCnpj.innerText = window.currentCrawlerCnpj || 'CNPJ do certificado';
      crawlerVisitedCount.innerText = window.crawlerVisited.size;
      crawlerQueueCount.innerText = window.crawlerQueue.length;
    } else {
      crawlerStatusContainer.style.display = 'none';
    }
  },

  updateProgress(current, max) {
    // Barra de progresso removida do card de varredura
    const bar = window.progressBar || document.getElementById('progress-bar');
    const pctEl = window.progressPercentage || document.getElementById('progress-percentage');
    const txt = window.progressText || document.getElementById('progress-text');
    if (!bar || !pctEl || !txt) return;

    if (max === 0) {
      bar.style.width = '0%';
      pctEl.innerText = '0%';
      txt.innerText = 'Nenhuma nota disponível';
      return;
    }

    const percentage = Math.min(Math.round((current / max) * 100), 100);
    bar.style.width = `${percentage}%`;
    pctEl.innerText = `${percentage}%`;
    txt.innerText = percentage >= 100
      ? 'Totalmente sincronizado'
      : `Sincronizando: NSU ${current} de ${max}`;
  },

  appendDocumentsToTable(docs) {
    window.AppUiTable.appendDocumentsToTable(docs);
  }
});
;

/* source: js/uiTabs.js */
Object.assign(window.AppUi = window.AppUi || {}, {
switchTab(activeNav, activeContent, title, subtitle, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const now = Date.now();
    // Soft cache de aba: so forca rede se stale ou dirty (UI sempre troca na hora)
    const cacheTtlMs = 120000;

    const navs = [
      window.navDashboard || document.getElementById('nav-dashboard'),
      window.navDownload || document.getElementById('nav-download'),
      window.navCertificado || document.getElementById('nav-certificado'),
      window.navRegras || document.getElementById('nav-regras')
    ];
    const contents = [
      window.viewDashboardContent || document.getElementById('view-dashboard-content'),
      window.viewDownloadContent || document.getElementById('view-download-content'),
      window.viewCertificadoContent || document.getElementById('view-certificado-content'),
      window.viewRegrasContent || document.getElementById('view-regras-content')
    ];

    // Troca visual IMEDIATA (nunca espera rede)
    navs.forEach(nav => {
      if (nav) {
        nav.classList.remove('active');
        nav.removeAttribute('aria-current');
      }
    });
    contents.forEach(content => {
      if (content) {
        content.classList.remove('active-tab', 'active');
        content.style.display = 'none';
      }
    });

    if (activeNav) {
      activeNav.classList.add('active');
      activeNav.setAttribute('aria-current', 'page');
    }
    if (activeContent) {
      activeContent.style.display = 'block';
      requestAnimationFrame(() => {
        activeContent.classList.add('active-tab', 'active');
      });
    }
    const titleEl = window.pageTitle || document.getElementById('page-title');
    const subtitleEl = window.pageSubtitle || document.getElementById('page-subtitle');
    if (titleEl) titleEl.innerText = title;
    if (subtitleEl) subtitleEl.innerText = subtitle;

    window._tabCache = window._tabCache || {};
    const activeId = activeContent?.id || '';
    const crumb = document.getElementById('page-breadcrumb');
    if (crumb) {
      const section =
        activeId === 'view-dashboard-content' ? 'Visão geral' :
        activeId === 'view-download-content' ? 'Operação' :
        activeId === 'view-certificado-content' ? 'Operação' :
        activeId === 'view-regras-content' ? 'Sistema' : 'NFS-e Ops';
      crumb.textContent = `${section} / ${title || 'NFS-e Ops'}`;
    }

    // Dados em background (nao bloqueia pintura da aba)
    const schedule = (fn, urgent = false) => {
      if (urgent) {
        requestAnimationFrame(fn);
        return;
      }
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 400 });
      else setTimeout(fn, 0);
    };

    if (activeId === 'view-dashboard-content' && window.AppSyncController?.loadDashboard) {
      const lastDash = window._tabCache.dashboardAt || 0;
      const hasCards = Boolean(document.querySelector('#dashboard-cities-grid .city-card'));
      if (forceRefresh || !hasCards || !lastDash || now - lastDash > cacheTtlMs) {
        window._tabCache.dashboardAt = now;
        schedule(
          () => window.AppSyncController.loadDashboard(0, { forceRefresh }),
          forceRefresh || !hasCards
        );
      }
    }

    if (activeId === 'view-download-content' && window.AppSyncController) {
      const lastSync = window._tabCache.syncAt || 0;
      const lastNsu = window._tabCache.nsuAt || 0;
      const lastStorage = window._tabCache.storageAt || 0;
      const hasRows = Boolean(window.AppUiTable?.documents?.length);
      // Se o certificado da UI diverge do último carregado, força reload da lista
      const uiCertId = (window.selectCertificate && window.selectCertificate.value)
        || window.activeCertificateId
        || '';
      const certChanged = Boolean(uiCertId)
        && Boolean(window._lastHistoryCertId)
        && String(uiCertId) !== String(window._lastHistoryCertId);
      const needHistory = forceRefresh || certChanged || !hasRows || !lastSync
        || now - lastSync > cacheTtlMs || window._historyReloadDirty;
      const needNsu = forceRefresh || certChanged || !lastNsu || now - lastNsu > cacheTtlMs;
      const needStorage = forceRefresh || certChanged || !lastStorage || now - lastStorage > 300000;

      schedule(() => {
        const jobs = [];
        if (needHistory) {
          const wasDirty = Boolean(window._historyReloadDirty);
          window._tabCache.syncAt = now;
          window._historyReloadDirty = false;
          // Não manter linhas da cidade anterior quando o certificado mudou
          const keep = hasRows && !forceRefresh && !certChanged && !wasDirty;
          jobs.push(window.AppSyncController.loadPersistedHistory(1, {
            quiet: true,
            keepVisible: keep
          }));
        }
        if (needNsu) {
          window._tabCache.nsuAt = now;
          jobs.push(window.AppSyncController.loadSavedStartNsu());
        }
        if (jobs.length) Promise.allSettled(jobs);
        if (needStorage) {
          window._tabCache.storageAt = now;
          window.AppSyncController.loadStorageSummary();
        }
        window.AppInsights?.refreshOpsInsights?.();
      }, forceRefresh || certChanged || !hasRows);
    }

    if (activeId === 'view-dashboard-content' && window.AppInsights && !window.AppSyncController?.loadDashboard) {
      schedule(() => {
        window.AppInsights.refreshDashboardExtras([]).catch(() => {});
      });
    }
  },

  /** Prefetch de dados da aba (hover na nav) */
  prefetchTab(tabId) {
    if (!window.AppSyncController) return;
    if (tabId === 'view-dashboard-content' && window.AppApi?.fetchDashboardSummary) {
      window.AppApi.fetchDashboardSummary().catch(() => {});
    }
    if (tabId === 'view-download-content') {
      const hasRows = Boolean(window.AppUiTable?.documents?.length);
      if (!hasRows) {
        window.AppSyncController.loadPersistedHistory(1, { quiet: true, keepVisible: true }).catch(() => {});
      }
      window.AppSyncController.loadSavedStartNsu?.().catch(() => {});
    }
  },

  updateSchedulerUI(settings) {
    if (!schedulerEnabled) return;
    schedulerEnabled.checked = settings.autoSyncEnabled;
    schedulerInterval.value = settings.autoSyncIntervalHours || 12;
    schedulerEnv.value = settings.autoSyncEnvironment || 'producao';
    if (schedulerMaxBatches) schedulerMaxBatches.value = settings.autoSyncMaxBatchesPerRun || 1;
    if (schedulerDelaySeconds) schedulerDelaySeconds.value = 2;
    schedulerLastRun.innerText = settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : 'Nunca';
    schedulerStatus.innerText = 'Manual';
    schedulerStatus.className = 'metric-value text-primary';
  },

  updateManualSyncProgress(current, max, message) {
    if (!manualSyncProgressBar || !manualSyncProgressPercentage || !manualSyncProgressText) return;
    const safeCurrent = Number(current || 0);
    const safeMax = Number(max || 0);
    const percentage = safeMax > 0 ? Math.min(Math.round((safeCurrent / safeMax) * 100), 100) : 0;
    manualSyncProgressBar.style.width = `${percentage}%`;
    manualSyncProgressPercentage.innerText = `${percentage}%`;
    manualSyncProgressText.innerText = message || (safeMax > 0 ? `NSU ${safeCurrent} de ${safeMax}` : 'Aguardando atualização manual...');
  }
});
;

/* source: js/unitsController.js */
// Unidades e storage
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
}, {
  async loadStorageSummary() {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!window.AppApi?.fetchStorageSummary || !statStoragePayloads || !statStorageSize) return;

    try {
      const data = await window.AppApi.fetchStorageSummary({
        certificateId: certId || '',
        environment: selectEnvironment ? selectEnvironment.value : ''
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar armazenamento.');

      const summary = data.summary || {};
      statStoragePayloads.innerText = window.AppUtils.formatInteger(summary.totalPayloads || 0);
      statStorageSize.innerText = `${window.AppUtils.formatBytes(summary.totalBytes || 0)} permanentes`;
      if (Number(summary.expiringPayloads || 0) > 0) {
        statStorageSize.innerText += ` | ${window.AppUtils.formatInteger(summary.expiringPayloads)} com expiracao`;
      }
    } catch (err) {
      statStorageSize.innerText = 'Falha ao consultar';
      window.AppUi.log(`Erro ao carregar armazenamento: ${err.message}`, 'warning');
    }
  },

  getSelectedUnitFilter() {
    const selectedOption = unitFilter?.selectedOptions?.[0];
    return {
      partyCnpj: unitFilter ? unitFilter.value.trim() : '',
      partyRole: unitPartyRole ? unitPartyRole.value : 'tomador',
      unitId: selectedOption?.dataset?.id || ''
    };
  },

  renderUnitSelector() {
    if (!unitFilter) return;
    const currentValue = unitFilter.value;
    unitFilter.innerHTML = '<option value="">CNPJ do certificado ativo</option>';
    (window.units || []).forEach(unit => {
      const option = document.createElement('option');
      option.value = unit.cnpj || '';
      option.dataset.id = unit.id || '';
      option.dataset.name = unit.name || '';
      option.dataset.city = unit.city || '';
      option.dataset.state = unit.state || '';
      const location = [unit.city, unit.state].filter(Boolean).join('/');
      option.textContent = `${unit.name} - ${unit.cnpj}${location ? ` (${location})` : ''}`;
      unitFilter.appendChild(option);
    });
    unitFilter.value = currentValue;
    if (currentValue && unitFilter.value !== currentValue) unitFilter.value = '';
  },

  fillUnitFormFromSelection() {
    const option = unitFilter?.selectedOptions?.[0];
    if (!option || !unitFilter.value) {
      if (unitName) unitName.value = '';
      if (unitCnpj) unitCnpj.value = '';
      if (unitCity) unitCity.value = '';
      if (unitState) unitState.value = '';
      return;
    }
    if (unitName) unitName.value = option.dataset.name || '';
    if (unitCnpj) unitCnpj.value = unitFilter.value || '';
    if (unitCity) unitCity.value = option.dataset.city || '';
    if (unitState) unitState.value = option.dataset.state || '';
  },

  async loadUnits() {
    if (!window.AppApi?.listUnits) return;
    try {
      const data = await window.AppApi.listUnits();
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar unidades.');
      window.units = data.units || [];
      this.renderUnitSelector();
    } catch (err) {
      window.AppUi.log(`Erro ao carregar unidades: ${err.message}`, 'warning');
    }
  }
});
;

/* source: js/historyController.js */
// Historico remoto
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
_historySnapshotKey(certId, page, unitFilterParams) {
    const env = selectEnvironment ? selectEnvironment.value : 'producao';
    const mode = window.AppUtils?.getCancelledMode?.() || 'active';
    const search = historySearch ? historySearch.value.trim() : '';
    const party = unitFilterParams?.partyCnpj || '';
    return `hist_snap:${certId}|${env}|${mode}|${party}|${search}|p${page}`;
  },

  _restoreHistorySnapshot(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.documents)) return false;
      // snapshot valido por 10 min
      if (snap.at && Date.now() - snap.at > 600000) return false;
      window.AppUiTable.setDocuments(snap.documents, snap.total || 0, snap.page || 1, snap.totalValue || 0);
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = !(snap.documents && snap.documents.length > 0);
      return true;
    } catch (e) {
      return false;
    }
  },

  _saveHistorySnapshot(key, documents, total, page, totalValue) {
    try {
      sessionStorage.setItem(key, JSON.stringify({
        at: Date.now(),
        documents,
        total,
        page,
        totalValue
      }));
    } catch (e) {
      // quota / private mode
    }
  },

  async loadPersistedHistory(page = 1, options = {}) {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!certId || !window.AppApi?.listDocuments || !window.AppUiTable?.setDocuments) return;

    const requestId = (window._historyRequestId = (window._historyRequestId || 0) + 1);
    const quiet = Boolean(options.quiet);
    const keepVisible = Boolean(options.keepVisible);
    const prevCertId = window._lastHistoryCertId || '';
    const certSwitched = Boolean(prevCertId) && String(prevCertId) !== String(certId);
    // Se o certificado mudou, nunca reutilizar linhas/snapshot da cidade anterior
    if (certSwitched && window.AppUiTable.documents?.length) {
      window.AppUiTable.setDocuments([], 0, 1, 0);
    }
    const hasRows = Boolean(window.AppUiTable.documents?.length) && !certSwitched;
    const safePage = Math.max(1, Number(page || 1));
    const unitFilterParams = this.getSelectedUnitFilter();
    const snapKey = this._historySnapshotKey(certId, safePage, unitFilterParams);
    window._lastHistoryCertId = certId;

    // Paint instantaneo a partir do sessionStorage (antes da rede)
    if (!hasRows) {
      const restored = this._restoreHistorySnapshot(snapKey);
      if (!restored && !keepVisible && window.AppUiTable.showLoading) {
        window.AppUiTable.showLoading();
      }
    }

    const limit = window.AppUiTable.pageSize || 10;
    const listParams = {
      certificateId: certId,
      environment: selectEnvironment ? selectEnvironment.value : 'producao',
      cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
      partyCnpj: unitFilterParams.partyCnpj,
      partyRole: unitFilterParams.partyRole,
      search: historySearch ? historySearch.value.trim() : '',
      cancelledMode: window.AppUtils.getCancelledMode(),
      includeCancelled: window.AppUtils.getIncludeCancelledParam(),
      onlyCancelled: window.AppUtils.getOnlyCancelledParam(),
      limit,
      offset: (safePage - 1) * limit,
      skipTotals: true
    };

    try {
      // 1) Página primeiro (sem count/sum)
      const data = await window.AppApi.listDocuments(listParams);

      if (requestId !== window._historyRequestId) return;

      if (!data.success) {
        if (!quiet) window.AppUi.log(`Erro ao carregar histórico: ${data.error}`, 'warning');
        if (!hasRows && window.AppUiTable.showLoadError) {
          window.AppUiTable.showLoadError(data.error || 'Não foi possível carregar os XMLs desta unidade.');
        }
        return;
      }

      const docs = data.documents || [];
      const totalsPending = data.totalsPending !== false && (data.total == null || data.summary?.totalValue == null);
      const totalValue = data.summary?.totalValue ?? data.totalValue ?? null;
      window.AppUiTable.setDocuments(docs, totalsPending ? null : (data.total || 0), safePage, totalValue, {
        totalsPending
      });
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = !(docs && docs.length > 0);

      // 2) Totais em segundo request (stats cache no banco)
      if (totalsPending && window.AppApi.getDocumentTotals) {
        this._loadHistoryTotals(requestId, listParams, snapKey, docs, safePage, quiet, unitFilterParams);
      } else {
        this._saveHistorySnapshot(snapKey, docs, data.total || 0, safePage, totalValue || 0);
        if (!quiet) {
          const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
          window.AppUi.log(`Histórico carregado${unitLabel}: ${docs.length} de ${data.total || 0} XML(s) salvos.`, 'success');
        }
      }

      // 3) Prefetch página 2 (só na 1ª página, se veio cheia)
      if (safePage === 1 && docs.length >= limit) {
        this._prefetchHistoryPage(2, { ...listParams, offset: limit });
      }
    } catch (err) {
      if (requestId !== window._historyRequestId) return;
      if (!quiet) window.AppUi.log(`Erro ao carregar histórico: ${err.message}`, 'warning');
      if (!hasRows && window.AppUiTable.showLoadError) {
        window.AppUiTable.showLoadError('A conexão falhou. Verifique sua rede e tente novamente.');
      }
    }
  },

  async _loadHistoryTotals(requestId, listParams, snapKey, docs, safePage, quiet, unitFilterParams) {
    try {
      const { limit, offset, skipTotals, ...totalsParams } = listParams;
      const totals = await window.AppApi.getDocumentTotals(totalsParams);
      if (requestId !== window._historyRequestId) return;
      if (!totals?.success) return;
      const total = totals.total || 0;
      const totalValue = totals.totalValue ?? totals.summary?.totalValue ?? 0;
      if (window.AppUiTable.updateTotals) {
        window.AppUiTable.updateTotals(total, totalValue);
      } else {
        window.AppUiTable.setDocuments(docs, total, safePage, totalValue);
      }
      this._saveHistorySnapshot(snapKey, docs, total, safePage, totalValue);
      if (!quiet) {
        const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
        window.AppUi.log(`Histórico carregado${unitLabel}: ${docs.length} de ${total} XML(s) salvos.`, 'success');
      }
    } catch (err) {
      if (requestId !== window._historyRequestId) return;
      // Página já está ok; totais falharam silenciosamente
      if (!quiet) window.AppUi.log(`Totais ainda sendo calculados: ${err.message}`, 'warning');
    }
  },

  _prefetchHistoryPage(page, listParams) {
    if (!window.AppApi?.listDocuments) return;
    const params = { ...listParams, skipTotals: true };
    // Dispara e deixa no cache do AppDataCache (mesma key da navegação)
    window.AppApi.listDocuments(params).catch(() => {});
  },

  async loadSavedStartNsu() {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const unitFilterParams = this.getSelectedUnitFilter();
    const cnpjConsulta = unitFilterParams.partyCnpj || (inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '');

    const data = await window.AppApi.fetchSyncState({
      environment: selectEnvironment ? selectEnvironment.value : 'producao',
      cnpjConsulta,
      certificateId: certId
    });

    const lastReceivedNsu = Number(data.state?.last_received_nsu || 0);
    const lastNsu = Number(data.state?.last_nsu || 0);
    const savedNsu = data.state ? lastNsu : lastReceivedNsu;
    inputStartNsu.value = savedNsu;
    window.currentNsu = savedNsu;
    window.maxNsu = Math.max(window.maxNsu || 0, savedNsu);
    statNsuAtual.innerText = String(savedNsu);
    statNsuMax.innerText = String(window.maxNsu || savedNsu);
    return savedNsu;
  }
});
;

/* source: js/certStatusController.js */
// Status de certificado
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
async checkCertStatus(options = {}) {
    const skipSecondary = Boolean(options.skipSecondary);
    try {
      // Cert + units em paralelo
      const [data, unitsResult] = await Promise.all([
        window.AppApi.fetchCertStatus(),
        window.AppApi.listUnits().catch(() => ({ success: false, units: [] }))
      ]);

      const indicator = document.getElementById('navbar-cert-indicator');
      const txt = document.getElementById('navbar-cert-text');
      window.certificates = data.certificates || [];
      window.activeCertificateId = data.activeCertificateId || null;

      if (unitsResult?.success) {
        window.units = unitsResult.units || [];
        this.renderUnitSelector();
      } else {
        await this.loadUnits();
      }

      window.AppUi.renderCertificateSelector();
      window.AppUi.renderCertificateList();
      window.AppInsights?.renderCertExpiryBanner?.(data.certificates || []);

      if (data.active) {
        if (certUploadState) certUploadState.classList.remove('active');
        if (certActiveState) certActiveState.classList.add('active');
        if (activeCertName) activeCertName.innerText = `Arquivo: ${data.filename}`;
        if (activeCertCnpj) activeCertCnpj.innerText = `CNPJ: ${data.cnpj || 'Não informado'}`;
        if (btnStart) btnStart.disabled = false;
        if (window.btnResetNsu) window.btnResetNsu.disabled = false;
        if (!skipSecondary) window.AppUi.log(`Certificado ativo CNPJ: ${data.cnpj}`);
        if (indicator && txt) {
          indicator.className = 'status-indicator online';
          txt.innerText = `Certificado ativo: ${data.cnpj}`;
        }
        if (!skipSecondary) {
          const syncVisible = window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none'
            && window.viewDownloadContent.classList.contains('active-tab');
          if (syncVisible) {
            await Promise.allSettled([
              this.loadPersistedHistory(1, { quiet: true }),
              this.loadSavedStartNsu(),
              this.loadStorageSummary()
            ]);
          }
        }
      } else {
        if (certUploadState) certUploadState.classList.add('active');
        if (certActiveState) certActiveState.classList.remove('active');
        if (btnStart) btnStart.disabled = true;
        if (window.btnResetNsu) window.btnResetNsu.disabled = true;
        if (!skipSecondary) window.AppUi.log('Nenhum certificado carregado.', 'warning');
        if (indicator && txt) {
          indicator.className = 'status-indicator offline';
          txt.innerText = `Nenhum certificado carregado`;
        }
      }
    } catch (err) {
      console.error('Erro ao verificar status:', err);
    }
  },

  async selectCertificateById(certificateId) {
    if (!certificateId) return;
    try {
      const prevId = window.activeCertificateId
        || (window.selectCertificate && window.selectCertificate.value)
        || '';
      const data = await window.AppApi.selectCertificate(certificateId);
      if (!data.success) {
        window.AppUi.log(`Erro ao selecionar: ${data.error}`, 'error');
        return;
      }
      window.activeCertificateId = data.activeCertificateId || certificateId;
      if (String(prevId) !== String(window.activeCertificateId)) {
        if (window.AppUiTable?.setDocuments) {
          window.AppUiTable.setDocuments([], 0, 1, 0);
        }
        if (window.unitFilter) window.unitFilter.value = '';
      }
      window.AppUi.log('Certificado selecionado.', 'success');
      await this.checkCertStatus();
    } catch (err) {
      window.AppUi.log(`Erro ao selecionar: ${err.message}`, 'error');
    }
  }
});
;

/* source: js/syncController.js */
// Start/stop/discover varredura
window.AppSyncController = Object.assign(window.AppSyncController || {}, {
}, {
}, {
  beginQueryRun() {
    window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
    if (window.queryLoopTimer) {
      clearTimeout(window.queryLoopTimer);
      window.queryLoopTimer = null;
    }
    return window.activeQueryRunId;
  },

  async openSessionRun(startNsu) {
    try {
      const unitFilterParams = this.getSelectedUnitFilter?.() || {};
      const data = await window.AppApi.startSyncRun({
        certificateId: window.selectCertificate?.value || window.activeCertificateId,
        environment: window.selectEnvironment?.value || 'producao',
        cnpjConsulta: unitFilterParams.partyCnpj || window.inputCnpjConsulta?.value || '',
        startNsu: Number(startNsu || 0)
      });
      if (data.success && data.runId) {
        window.sessionRunId = data.runId;
        window.sessionRunStartNsu = Number(startNsu || 0);
        window.sessionRunDocs = 0;
        window.sessionRunStartedAt = Date.now();
        return data.runId;
      }
    } catch (err) {
      window.AppUi?.log?.(`Não foi possível abrir a run de sessão: ${err.message}`, 'warning');
    }
    window.sessionRunId = null;
    return null;
  },

  async closeSessionRun({ status = 'completed', errorMessage = null } = {}) {
    const runId = window.sessionRunId;
    if (!runId) return;
    try {
      await window.AppApi.finishSyncRun({
        runId,
        status,
        endNsu: Number(window.currentNsu || window.sessionRunStartNsu || 0),
        maxNsuSeen: Number(window.maxNsu || window.currentNsu || 0),
        documentsFound: Number(window.sessionRunDocs || 0),
        errorMessage
      });
    } catch (err) {
      console.warn('[closeSessionRun]', err);
    } finally {
      window.sessionRunId = null;
      window.sessionRunDocs = 0;
      window.sessionRunStartNsu = null;
      window.sessionRunStartedAt = null;
      window.AppInsights?.loadSyncRuns?.();
    }
  },

  isActiveQueryRun(runId) {
    return window.isQuerying && !window.isPaused && runId === window.activeQueryRunId;
  },

  isTransientSyncError(errorMessage = '') {
    return /timeout|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|Retorno vazio|Erro 200 retornado/i.test(String(errorMessage));
  },

  scheduleRetry(runId, requestNsu, errorMessage) {
    if (!this.isActiveQueryRun(runId)) return;
    window.transientRetryCount = (window.transientRetryCount || 0) + 1;
    const retryCount = window.transientRetryCount;
    const maxRetries = 8;

    if (retryCount > maxRetries) {
      window.AppUi.log('Limite de tentativas temporárias atingido. Consulta pausada para evitar insistir na API.', 'error');
      window.AppToast?.error?.('Varredura pausada após falhas de rede');
      this.stopQuerying({ finishStatus: 'error', errorMessage: errorMessage || 'Limite de retries' });
      return;
    }

    // Backoff exponencial com jitter (10s, 20s, 40s… até 3 min)
    const base = Math.min(180, 10 * (2 ** (retryCount - 1)));
    const jitter = Math.floor(Math.random() * Math.min(8, base * 0.2));
    const retryDelaySeconds = base + jitter;

    window.currentNsu = requestNsu;
    if (inputStartNsu) inputStartNsu.value = requestNsu;
    window._retryMeta = {
      runId,
      requestNsu,
      retryCount,
      maxRetries,
      nextAt: Date.now() + retryDelaySeconds * 1000,
      errorMessage: String(errorMessage || '')
    };

    window.AppUi.log(
      `Erro temporário na API (${errorMessage}). Retomada automática ${retryCount}/${maxRetries} em ${retryDelaySeconds}s no NSU ${requestNsu}.`,
      'warning'
    );
    window.AppToast?.warning?.(`Retry ${retryCount}/${maxRetries} em ${retryDelaySeconds}s`);
    this.renderRetryStatus?.();

    if (window.queryLoopTimer) clearTimeout(window.queryLoopTimer);
    window.queryLoopTimer = setTimeout(() => {
      window.queryLoopTimer = null;
      window._retryMeta = null;
      this.renderRetryStatus?.();
      this.runQueryLoop(runId);
    }, retryDelaySeconds * 1000);
  },

  renderRetryStatus() {
    const el = document.getElementById('retry-status-banner');
    if (!el) return;
    const meta = window._retryMeta;
    if (!meta || !window.isQuerying) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    const secs = Math.max(0, Math.ceil((meta.nextAt - Date.now()) / 1000));
    el.style.display = 'block';
    el.innerHTML = `<strong>Retomada automática</strong> · tentativa ${meta.retryCount}/${meta.maxRetries} · NSU ${meta.requestNsu} · em ${secs}s`;
  },

async discoverAndStart(runId = window.activeQueryRunId) {
    try {
      const env = selectEnvironment.value, cnpj = window.currentCrawlerCnpj, certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
      const data = await window.AppApi.discoverNsu({ environment: env, cnpjConsulta: cnpj, certificateId: certId });
      if (!this.isActiveQueryRun(runId)) return;
      
      if (data.success && data.maxNSU > 0 && data.reliableMax) {
        window.maxNsu = data.maxNSU;
        window.currentNsu = Math.max(0, window.maxNsu - 50);
        inputStartNsu.value = window.currentNsu;
        window.AppUi.log(`NSU máximo API: ${window.maxNsu}. Consultando a partir do NSU ${window.currentNsu}...`, 'success');
        this.runQueryLoop(runId);
      } else if (data.success) {
        if (data.maxNSU > 0) {
          window.maxNsu = data.maxNSU;
          window.currentNsu = Math.max(0, window.maxNsu - 50);
          inputStartNsu.value = window.currentNsu;
          window.AppUi.log(`Estimado ${window.maxNsu}. Consultando a partir de ${window.currentNsu}.`, 'warning');
          this.runQueryLoop(runId);
          return;
        }
        window.currentNsu = parseInt(inputStartNsu.value) || 0;
        window.AppUi.log('Sem maxNSU confiável. Seguirá sequência por NSU.', 'warning');
        this.runQueryLoop(runId);
      } else {
        window.AppUi.log('Erro ao descobrir NSU: ' + (data.error || 'Nenhum documento encontrado.'), 'error');
        window.AppUi.logNationalApiContext(data.nationalApi);
        this.stopQuerying();
      }
    } catch (err) {
      window.AppUi.log('Falha na descoberta de NSU: ' + err.message, 'error');
      this.stopQuerying();
    }
  },

  stopQuerying(options = {}) {
    const {
      finishStatus = 'paused',
      errorMessage = null,
      skipFinish = false
    } = options;
    window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
    if (window.queryLoopTimer) {
      clearTimeout(window.queryLoopTimer);
      window.queryLoopTimer = null;
    }
    window.isQuerying = false;
    window.isPaused = false;
    window._retryMeta = null;
    this.renderRetryStatus?.();
    window.AppUi.setBtnStartActive(false, false);
    if (typeof btnPause !== 'undefined' && btnPause) btnPause.disabled = true;
    if (window.btnResetNsu) window.btnResetNsu.disabled = false;

    // Fecha a run de ponta a ponta (se ainda aberta)
    if (!skipFinish && window.sessionRunId) {
      this.closeSessionRun({ status: finishStatus, errorMessage });
    }
  }
});
;

/* source: js/queryLoop.js */
// Loop de consulta NSU
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
async runQueryLoop(runId = window.activeQueryRunId) {
    if (!this.isActiveQueryRun(runId)) return;

    const env = selectEnvironment.value, cnpj = window.currentCrawlerCnpj, certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const limiteNotas = parseInt(inputLimiteNotas.value) || 0;
    const requestNsu = Number(window.currentNsu || 0);

    if (!certId) {
      window.AppUi.log('Selecione um certificado.', 'error');
      this.stopQuerying({ finishStatus: 'error', errorMessage: 'Sem certificado' });
      return;
    }

    window.AppUi.log(`Consultando bloco a partir do NSU ${requestNsu}...`);

    try {
      const data = await window.AppApi.fetchBatch({
        startNsu: requestNsu,
        environment: env,
        cnpjConsulta: cnpj,
        certificateId: certId,
        sortOrder: selectSearchMode ? selectSearchMode.value : 'asc',
        sessionRunId: window.sessionRunId || null,
        closeRun: false
      });

      if (!this.isActiveQueryRun(runId)) return;

      if (!data.success) {
        window.AppUi.log('Erro na NFS-e: ' + data.error, 'error');
        window.AppUi.logNationalApiContext(data.nationalApi);
        if (data.retryable || this.isTransientSyncError(data.error)) {
          this.scheduleRetry(runId, requestNsu, data.error);
          return;
        }
        if (data.error.includes('Consumo Indevido') || data.error.includes('429') || data.error.includes('656')) {
          alertRateLimit.style.display = 'block';
        } else {
          window.AppUi.log('Consulta interrompida: ' + data.error, 'error');
        }
        this.stopQuerying({ finishStatus: 'error', errorMessage: data.error });
        return;
      }

      if (data.runId && !window.sessionRunId) window.sessionRunId = data.runId;
      window.sessionRunDocs = Number(window.sessionRunDocs || 0) + Number(data.novos || 0);
      window.transientRetryCount = 0;

      const {
        ultNSU,
        maxNSU,
        totalFila,
        documentos,
        novos = 0,
        existentes = 0,
        canceladasNovas = 0,
        eventosCancelamento = 0
      } = data;
      window.maxNsu = Math.max(window.maxNsu, maxNSU);
      statNsuMax.innerText = window.maxNsu;
      statNsuAtual.innerText = ultNSU;
      
      if (documentos && documentos.length > 0) {
        let loteMsg = `Lote processado! ${novos} novo(s), ${existentes} já existiam, ${documentos.length} recebido(s) no lote.`;
        if (Number(canceladasNovas) > 0 || Number(eventosCancelamento) > 0) {
          loteMsg += ` Canceladas detectadas: ${canceladasNovas} (eventos de cancel: ${eventosCancelamento}).`;
        }
        window.AppUi.log(loteMsg, novos > 0 || canceladasNovas > 0 ? 'success' : 'warning');
        window.totalDownloaded += novos;
        if (window.btnDownloadZip) btnDownloadZip.disabled = false;
        // Throttle: nao recarrega a tabela a cada lote (melhora velocidade da varredura)
        window._historyReloadDirty = true;
        if (window.AppDataCache) {
          window.AppDataCache.invalidate('history:');
          window.AppDataCache.invalidate('storage:');
          window.AppDataCache.invalidate('dashboard-summary');
        }
        const now = Date.now();
        if (!window._lastHistoryReloadAt || now - window._lastHistoryReloadAt > 8000) {
          window._lastHistoryReloadAt = now;
          window._historyReloadDirty = false;
          this.loadPersistedHistory(1, { quiet: true });
        }
        
        if (window.isCrawlerActive) {
          let novosCnpjs = 0;
          documentos.forEach(doc => {
            [doc.prestadorCnpj, doc.tomadorCnpj].forEach(c => {
              if (c && c !== 'N/A' && c !== 'Não Informado') {
                const clean = c.replace(/\D/g, '');
                if (clean.length === 14 && !window.crawlerVisited.has(clean) && !window.crawlerQueue.includes(clean)) {
                  window.crawlerQueue.push(clean);
                  novosCnpjs++;
                }
              }
            });
          });
          if (novosCnpjs > 0) window.AppUi.updateCrawlerUI();
        }
      }

      window.AppUi.updateProgress(ultNSU, window.maxNsu);

      let deveParar = false;
      let motivoParada = '';
      const mode = selectSearchMode ? selectSearchMode.value : 'asc';

      if (mode === 'asc') {
        if (ultNSU >= window.maxNsu) {
          deveParar = true;
          motivoParada = `NSU Atual (${ultNSU}) atingiu o máximo (${window.maxNsu}).`;
        } else if (Number(ultNSU || 0) < requestNsu) {
          deveParar = true;
          motivoParada = `A API retornou ultNSU (${ultNSU}) menor que o NSU consultado (${requestNsu}); consulta interrompida para evitar voltar no historico.`;
        }
      } else {
        if (window.currentNsu <= 0) {
          deveParar = true;
          motivoParada = `Busca reversa atingiu o NSU 0.`;
        }
      }

      if (!deveParar) {
        if (totalFila === 0 && mode === 'asc') {
          deveParar = true;
          motivoParada = `Não há mais documentos disponíveis.`;
        } else if (limiteNotas > 0 && window.totalDownloaded >= limiteNotas) {
          deveParar = true;
          motivoParada = `Limite de ${limiteNotas} atingido.`;
        }
      }

      if (deveParar) {
        window.AppUi.log(`Sincronização concluída! ${motivoParada}`, 'success');
        alertSyncSuccess.style.display = 'block';
        if (window._historyReloadDirty) {
          window._historyReloadDirty = false;
          window._lastHistoryReloadAt = Date.now();
          await this.loadPersistedHistory(1);
        }
        this.loadStorageSummary();
        this.stopQuerying({ finishStatus: 'completed' });
        window.AppInsights?.refreshOpsInsights?.();
        return;
      }

      if (mode === 'asc') {
        window.currentNsu = Math.max(requestNsu, Number(ultNSU || requestNsu));
      } else {
        window.currentNsu = Math.max(0, window.currentNsu - 50);
        inputStartNsu.value = window.currentNsu;
      }

      const safeDelaySeconds = 2;
      const safeDelayMs = safeDelaySeconds * 1000;
      window.AppUi.log(`Aguardando ${safeDelaySeconds}s antes do próximo bloco...`, 'warning');
      window.queryLoopTimer = setTimeout(() => {
        window.queryLoopTimer = null;
        this.runQueryLoop(runId);
      }, safeDelayMs);

    } catch (err) {
      if (!this.isActiveQueryRun(runId)) return;
      const isTransientNetwork = err.message === 'Failed to fetch' || /fetch|network|connection|load failed|timeout/i.test(err.message);
      if (isTransientNetwork) {
        this.scheduleRetry(runId, requestNsu, `Falha de conexão: ${err.message}`);
        return;
      }
      window.AppUi.log(`Erro crítico: ${err.message}`, 'error');
      this.stopQuerying({ finishStatus: 'error', errorMessage: err.message });
    }
  }
});
;

/* source: js/dashboardController.js */
// Dashboard de cidades (estende AppSyncController)
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
  cleanFilenameToCityName(filename) {
    if (!filename) return 'Desconhecido';
    let name = filename.replace(/\.(pfx|p12|cert|key)$/i, '');
    name = name.replace(/_\d{14}$/, '');
    name = name.replace(/\d{14}$/, '');
    name = name.replace(/[_-]+/g, ' ').trim();
    name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return name;
  },

  async loadDashboard(retryCount = 0, options = {}) {
    if (!dashboardCitiesGrid) return;

    const hasCards = Boolean(dashboardCitiesGrid.querySelector('.city-card:not(.skeleton-row)'));

    // Skeleton so no primeiro load (sem cards reais) — troca de aba fica instantanea
    if (retryCount === 0 && !hasCards) {
      if (window.dashStatCities) window.dashStatCities.innerHTML = `<div class="skeleton-shimmer" style="width: 40px; height: 26px; vertical-align: middle;"></div>`;
      if (window.dashStatActive) window.dashStatActive.innerHTML = `<div class="skeleton-shimmer" style="width: 40px; height: 26px; vertical-align: middle;"></div>`;
      if (window.dashStatXmls) window.dashStatXmls.innerHTML = `<div class="skeleton-shimmer" style="width: 80px; height: 26px; vertical-align: middle;"></div>`;

      let skeletonHtml = '';
      for (let i = 0; i < 4; i++) {
        skeletonHtml += `
          <div class="city-card skeleton-row" style="opacity: ${1 - (i * 0.15)}; cursor: default;">
            <div class="city-card-header">
              <div>
                <div class="skeleton-shimmer" style="width: 130px; height: 18px; border-radius: 4px;"></div>
                <div class="skeleton-shimmer" style="width: 110px; height: 12px; margin-top: 6px; border-radius: 4px;"></div>
              </div>
            </div>
            <div class="city-card-stats" style="margin-top: auto;">
              <div class="city-card-stat-item">
                <div class="skeleton-shimmer" style="width: 60px; height: 10px; border-radius: 4px;"></div>
                <div class="skeleton-shimmer" style="width: 40px; height: 16px; margin-top: 4px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-shimmer" style="width: 140px; height: 16px; border-radius: 4px; align-self: flex-end;"></div>
            </div>
          </div>
        `;
      }

      dashboardCitiesGrid.innerHTML = skeletonHtml;
      dashboardCitiesGrid.style.display = 'grid';
      if (dashboardLoader) dashboardLoader.style.display = 'none';
    }

    if (btnRefreshDashboard) {
      btnRefreshDashboard.classList.add('loading');
      btnRefreshDashboard.onclick = (e) => {
        e.preventDefault();
        this.loadDashboard(0, { forceRefresh: true });
      };
    }

    try {
      const data = await window.AppApi.fetchDashboardSummary({
        forceRefresh: Boolean(options.forceRefresh) && retryCount === 0
      });
      if (!data.success) throw new Error(data.error || 'Erro ao carregar dados do painel.');

      // Calcular Métricas Gerais
      const citiesList = data.summary || [];
      
      // Ordenação específica solicitada pelo usuário
      const orderMap = {
        'sao paulo': 1,
        'salvador': 2,
        'sorocaba': 3,
        'sao bernardo': 4,
        'guarulhos': 5,
        'santo andre': 6,
        'manaus': 7
      };
      const normalizeName = (name) => {
        return String(name || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      };
      citiesList.sort((a, b) => {
        const nameA = normalizeName(this.cleanFilenameToCityName(a.filename));
        const nameB = normalizeName(this.cleanFilenameToCityName(b.filename));
        return (orderMap[nameA] || 99) - (orderMap[nameB] || 99);
      });

      const totalCities = citiesList.length;
      const activeCities = citiesList.filter(c => c.active).length;
      const totalXmls = citiesList.reduce((sum, c) => sum + Number(c.totalXmls || 0), 0);

      if (dashStatCities) dashStatCities.innerText = window.AppUtils.formatInteger(totalCities);
      if (dashStatActive) dashStatActive.innerText = window.AppUtils.formatInteger(activeCities);
      if (dashStatXmls) dashStatXmls.innerText = window.AppUtils.formatInteger(totalXmls);

      // Indicadores / auditoria / validade — independente (não espera cert-status)
      if (window.AppInsights) {
        window.AppInsights.refreshDashboardExtras(citiesList).catch((err) => {
          console.warn('[dashboard extras]', err);
        });
      }

      if (retryCount === 0 && window.AppToast && hasCards) {
        window.AppToast.success('Painel atualizado');
      }

      dashboardCitiesGrid.innerHTML = '';
      const esc = window.AppUtils.escapeHtml;
      const frag = document.createDocumentFragment();
      citiesList.forEach(city => {
        const card = document.createElement('div');
        card.className = `city-card ${city.active ? 'active' : ''}`;
        const cityName = this.cleanFilenameToCityName(city.filename);
        const safeName = esc(cityName);
        const safeCnpj = esc(window.AppUtils.formatCnpj(city.cnpj));
        const safeLast = esc(city.lastUpdate || 'N/A');
        const safeXmls = esc(window.AppUtils.formatInteger(city.totalXmls));
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Abrir unidade ${cityName}, ${safeXmls} XMLs`);

        card.innerHTML = `
          <div class="city-card-header">
            <div>
              <h3 class="city-card-title">${safeName}</h3>
              <span class="city-card-cnpj">${safeCnpj}</span>
            </div>
            ${city.active ? '<span class="city-card-active-badge">Ativo</span>' : ''}
          </div>
          <div class="city-card-stats">
            <div class="city-card-stat-item">
              <span class="city-card-stat-label">Total XMLs</span>
              <span class="city-card-stat-value success">${safeXmls}</span>
            </div>
            <span class="city-card-date" title="Última nota emitida em ${safeLast}">Última: ${safeLast}</span>
          </div>
          <div class="city-card-footer">
            <span>${city.active ? 'Abrir unidade' : 'Selecionar certificado'} →</span>
          </div>
        `;

        card.addEventListener('click', async () => {
          const certId = city.certificateId;
          if (!certId) {
            window.AppUi.log('Cidade sem certificado vinculado.', 'error');
            return;
          }

          const openXmlsTab = (forceRefresh = true) => {
            window.AppUi.switchTab(
              window.navDownload || document.getElementById('nav-download'),
              window.viewDownloadContent || document.getElementById('view-download-content'),
              'XMLs por unidade',
              'XMLs da NFS-e persistidos por certificado e unidade',
              { forceRefresh }
            );
          };

          // Sempre rebinda o certificado da cidade clicada. Antes, cards "Ativo"
          // só trocavam de aba e o cache da lista mantinha XMLs da cidade anterior.
          const currentId = window.activeCertificateId
            || (window.selectCertificate && window.selectCertificate.value)
            || '';
          const needsSelect = String(currentId) !== String(certId);

          try {
            if (needsSelect) {
              window.AppUi.log(`Selecionando certificado para a cidade ${cityName}...`);
              const res = await window.AppApi.selectCertificate(certId);
              if (!res.success) {
                window.AppUi.log(res.error || 'Erro ao selecionar o certificado.', 'error');
                return;
              }
              window.activeCertificateId = res.activeCertificateId || certId;
              // Evita flash com linhas da cidade anterior
              if (window.AppUiTable?.setDocuments) {
                window.AppUiTable.setDocuments([], 0, 1, 0);
              }
              if (window.unitFilter) window.unitFilter.value = '';
              window._historyReloadDirty = true;
              window._tabCache = window._tabCache || {};
              window._tabCache.syncAt = 0;
              window._tabCache.nsuAt = 0;
              window._tabCache.storageAt = 0;
              await window.AppSyncController.checkCertStatus({ skipSecondary: true });
            } else {
              // Mesmo certificado: ainda força refresh ao abrir pelo card
              window._historyReloadDirty = true;
              window._tabCache = window._tabCache || {};
              window._tabCache.syncAt = 0;
            }
            openXmlsTab(true);
          } catch (err) {
            window.AppUi.log(`Erro ao abrir a cidade ${cityName}: ${err.message}`, 'error');
          }
        });
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            card.click();
          }
        });

        frag.appendChild(card);
      });
      dashboardCitiesGrid.appendChild(frag);

      if (dashboardLoader) dashboardLoader.style.display = 'none';
      dashboardCitiesGrid.style.display = 'grid';
    } catch (err) {
      console.warn(`Tentativa ${retryCount + 1} de carregar o painel falhou: ${err.message}`);
      // 1 retry rapido (800ms) em vez de 2x3s — evita sensacao de "travado"
      if (retryCount < 1) {
        setTimeout(() => {
          this.loadDashboard(retryCount + 1, options);
        }, 800);
      } else {
        dashboardCitiesGrid.innerHTML = `
          <div class="empty-state-card">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="empty-state-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <h3 class="empty-state-title">Conexão com o banco indisponível</h3>
            <p class="empty-state-text">O Supabase pode estar hibernando ou iniciando. Aguarde um momento e tente de novo.</p>
            <button type="button" class="btn btn-primary" id="btn-retry-dashboard">Tentar novamente</button>
          </div>
        `;
        const retryBtn = document.getElementById('btn-retry-dashboard');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => window.AppSyncController.loadDashboard(0));
        }
        if (window.dashStatCities) window.dashStatCities.innerText = '0';
        if (window.dashStatActive) window.dashStatActive.innerText = '0';
        if (window.dashStatXmls) window.dashStatXmls.innerText = '0';
        window.AppUi.log(`Erro ao carregar Dashboard: ${err.message}`, 'error');
      }
    } finally {
      if (btnRefreshDashboard) btnRefreshDashboard.classList.remove('loading');
    }
  }
});
;

/* source: js/insightsController.js */
// Saúde API, histórico de runs, analytics, auditoria, validade de cert
window.AppInsights = {
  formatMoney(value) {
    const n = Number(value || 0);
    return (window.AppUtils?.formatCurrency?.(n)) || `R$ ${n.toFixed(2)}`;
  },

  formatDelta(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return { text: 'sem base anterior', cls: '' };
    const n = Number(pct);
    const sign = n > 0 ? '+' : '';
    return {
      text: `${sign}${n.toFixed(1)}%`,
      cls: n > 0 ? 'up' : n < 0 ? 'down' : ''
    };
  },

  async loadApiHealth() {
    const statusEl = document.getElementById('api-health-status');
    if (!statusEl) return;
    try {
      const data = await window.AppApi.fetchApiHealth(24);
      const h = data.health || {};
      const label = {
        healthy: 'Saudável',
        degraded: 'Degradada',
        down: 'Instável',
        unknown: 'Sem dados'
      }[h.status] || 'Sem dados';
      statusEl.className = `api-health-status ${h.status || 'unknown'}`;
      statusEl.textContent = label;
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set('api-health-rate', h.successRate == null ? '—' : `${h.successRate}%`);
      set('api-health-avg', h.avgLatencyMs != null ? `${h.avgLatencyMs} ms` : '—');
      set('api-health-p95', h.p95LatencyMs != null ? `${h.p95LatencyMs} ms` : '—');
      set('api-health-total', h.total != null ? String(h.total) : '—');
      const errEl = document.getElementById('api-health-error');
      if (errEl) {
        errEl.textContent = h.lastError
          ? `Último erro: ${h.lastError}`
          : 'Amostras gravadas a cada consulta DFe.';
      }
    } catch (err) {
      statusEl.className = 'api-health-status unknown';
      statusEl.textContent = 'Indisponível';
    }
  },

  async loadSyncRuns() {
    const list = document.getElementById('sync-runs-list');
    if (!list) return;
    try {
      const certId = window.selectCertificate?.value || window.activeCertificateId || '';
      const data = await window.AppApi.fetchSyncRuns({
        certificateId: certId,
        environment: window.selectEnvironment?.value || 'producao',
        limit: 20
      });
      const runs = data.runs || [];
      if (!runs.length) {
        list.innerHTML = '<div class="helper-text"></div>';
        list.firstElementChild.textContent = data.warning || 'Nenhuma varredura registrada ainda. Inicie uma sincronização para ver o histórico.';
        return;
      }
      const esc = window.AppUtils.escapeHtml;
      const statusLabel = {
        completed: 'Concluída',
        running: 'Em andamento',
        paused: 'Pausada',
        error: 'Erro',
        success: 'Concluída'
      };
      const formatDur = (secs) => {
        const s = Number(secs || 0);
        if (!Number.isFinite(s) || s < 0) return '—';
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const r = s % 60;
        if (m < 60) return `${m}m ${r}s`;
        const h = Math.floor(m / 60);
        return `${h}h ${m % 60}m`;
      };
      list.innerHTML = runs.map(run => {
        const status = String(run.status || 'running');
        const start = run.started_at || run.startedAt;
        const end = run.finished_at || run.finishedAt;
        const startTxt = start ? new Date(start).toLocaleString('pt-BR') : '—';
        const endTxt = end
          ? new Date(end).toLocaleString('pt-BR')
          : (status === 'running' ? 'em andamento…' : '—');
        const dur = formatDur(run.duration_seconds);
        const nsuStart = run.start_nsu ?? 0;
        const nsuEnd = run.end_nsu ?? run.max_nsu_seen ?? '…';
        const docs = run.documents_found != null ? Number(run.documents_found) : 0;
        const err = run.error_message
          ? `<div class="run-meta run-error">Erro: ${esc(run.error_message)}</div>`
          : '';
        return `
          <article class="sync-run-item">
            <strong>Sessão de varredura</strong>
            <span class="sync-run-status ${esc(status)}">${esc(statusLabel[status] || status)}</span>
            <div class="run-meta">
              <div><strong>Início:</strong> ${esc(startTxt)}</div>
              <div><strong>Fim:</strong> ${esc(endTxt)}</div>
              <div><strong>Duração:</strong> ${esc(dur)} · <strong>NSU:</strong> ${esc(String(nsuStart))} → ${esc(String(nsuEnd))} · <strong>Novos:</strong> ${esc(String(docs))}</div>
            </div>
            ${err}
          </article>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="helper-text">Não foi possível carregar o histórico.</div>`;
    }
  },

  setAnalyticsStatus(message, isError = false) {
    const el = document.getElementById('analytics-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
    el.style.display = message ? 'block' : 'none';
  },

  async loadAnalytics() {
    const chart = document.getElementById('analytics-monthly-chart');
    const rankP = document.getElementById('ranking-prestador');
    const rankT = document.getElementById('ranking-tomador');
    if (!chart && !rankP && !document.getElementById('analytics-mom-value')) {
      // Painel ainda não montado
      return;
    }
    if (chart) chart.innerHTML = '<div class="helper-text">Carregando indicadores…</div>';
    if (rankP) rankP.innerHTML = '<div class="helper-text">Carregando…</div>';
    if (rankT) rankT.innerHTML = '<div class="helper-text">Carregando…</div>';
    this.setAnalyticsStatus('Carregando indicadores…');

    try {
      const environment = window.selectEnvironment?.value || 'producao';
      const data = await window.AppApi.fetchDashboardAnalytics({
        months: 12,
        environment
      });

      const a = data.analytics || {};
      const monthly = Array.isArray(a.monthly) ? a.monthly : [];
      const rankPre = Array.isArray(a.rankingPrestador) ? a.rankingPrestador : [];
      const rankTom = Array.isArray(a.rankingTomador) ? a.rankingTomador : [];
      const hasData = monthly.length > 0 || rankPre.length > 0 || Number(a.totals?.documents || 0) > 0;

      if (!data.success && (data.error || data.warning)) {
        this.setAnalyticsStatus(data.warning || data.error, true);
      } else if (data.warning) {
        this.setAnalyticsStatus(data.warning, true);
      } else if (!hasData) {
        this.setAnalyticsStatus('Sem indicadores para o ambiente selecionado.', true);
      } else {
        const docs = window.AppUtils?.formatInteger
          ? window.AppUtils.formatInteger(a.totals?.documents || 0)
          : String(a.totals?.documents || 0);
        this.setAnalyticsStatus(`${docs} notas no ambiente · valor total ${this.formatMoney(a.totals?.value || 0)}`);
      }

      const mom = a.comparisons?.monthOverMonth || {};
      const yoy = a.comparisons?.yearOverYear || {};

      const momEl = document.getElementById('analytics-mom-value');
      const yoyEl = document.getElementById('analytics-yoy-value');
      const momD = document.getElementById('analytics-mom-delta');
      const yoyD = document.getElementById('analytics-yoy-delta');
      const canc = document.getElementById('analytics-cancelled');

      if (momEl) momEl.textContent = this.formatMoney(mom.current);
      if (yoyEl) yoyEl.textContent = this.formatMoney(yoy.current);
      if (canc) {
        canc.textContent = window.AppUtils?.formatInteger
          ? window.AppUtils.formatInteger(a.totals?.cancelled || 0)
          : String(a.totals?.cancelled || 0);
      }

      const dMom = this.formatDelta(mom.deltaPct);
      const dYoy = this.formatDelta(yoy.deltaPct);
      if (momD) {
        momD.textContent = dMom.text;
        momD.className = `compare-delta ${dMom.cls}`;
      }
      if (yoyD) {
        yoyD.textContent = dYoy.text;
        yoyD.className = `compare-delta ${dYoy.cls}`;
      }

      this.renderMonthlyChart(monthly);
      this.renderRanking('ranking-prestador', rankPre);
      this.renderRanking('ranking-tomador', rankTom);
    } catch (err) {
      console.error('[analytics]', err);
      this.setAnalyticsStatus(err.message || 'Falha ao carregar indicadores', true);
      if (chart) {
        const msg = err.message ? window.AppUtils.escapeHtml(err.message) : '';
        chart.innerHTML = `<div class="helper-text">Não foi possível carregar os gráficos${msg ? ': ' + msg : ''}.</div>`;
      }
      if (rankP) rankP.innerHTML = '<div class="helper-text">—</div>';
      if (rankT) rankT.innerHTML = '<div class="helper-text">—</div>';
    }
  },

  renderMonthlyChart(monthly) {
    const el = document.getElementById('analytics-monthly-chart');
    if (!el) return;
    if (!monthly.length) {
      el.innerHTML = '<div class="helper-text">Sem dados mensais ainda. Aplique a migração SQL e sincronize notas.</div>';
      return;
    }
    const esc = window.AppUtils.escapeHtml;
    const values = monthly.map(m => Math.max(0, Number(m.value || 0)));
    const maxCount = Math.max(...monthly.map(m => Number(m.count || 0)), 1);
    const maxValue = Math.max(...values, 1);
    const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
    const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
    const points = monthly.map((m, i) => {
      const x = ((i + 0.5) / monthly.length) * 100;
      const y = 94 - (Math.max(0, Number(m.value || 0)) / maxValue) * 80;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const columns = monthly.map(m => {
      const count = Math.max(0, Number(m.count || 0));
      const cancelled = Math.min(count, Math.max(0, Number(m.cancelled || 0)));
      const active = Math.max(0, count - cancelled);
      const h = Math.max(4, Math.round((count / maxCount) * 136));
      const cancelledH = count ? Math.round((cancelled / count) * h) : 0;
      const activeH = Math.max(0, h - cancelledH);
      const rawMonth = String(m.month || '');
      const parsed = /^\d{4}-\d{2}$/.test(rawMonth) ? new Date(`${rawMonth}-01T12:00:00`) : null;
      const label = parsed && !Number.isNaN(parsed.getTime())
        ? monthFmt.format(parsed).replace('.', '')
        : rawMonth.slice(5) || rawMonth;
      const title = `${rawMonth}: ${count} notas (${cancelled} canceladas) | ${this.formatMoney(m.value)}`;
      return `
        <div class="chart-bar-col" title="${esc(title)}" tabindex="0" aria-label="${esc(title)}">
          <span class="chart-bar-value">${esc(compactFmt.format(count))}</span>
          <div class="chart-bar-stack" style="height:${h}px">
            <div class="chart-bar active-part" style="height:${activeH}px"></div>
            ${cancelledH ? `<div class="chart-bar cancelled-part" style="height:${Math.max(3, cancelledH)}px"></div>` : ''}
          </div>
          <span class="chart-bar-label">${esc(label)}</span>
        </div>
      `;
    }).join('');

    el.innerHTML = `
      <div class="chart-summary">
        <span>Pico de volume <strong>${esc(compactFmt.format(maxCount))} notas</strong></span>
        <span>Pico financeiro <strong>${esc(this.formatMoney(maxValue))}</strong></span>
      </div>
      <div class="chart-plot">
        <div class="chart-grid-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <svg class="chart-value-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${points}" vector-effect="non-scaling-stroke"></polyline>
          ${monthly.map((m, i) => {
            const x = ((i + 0.5) / monthly.length) * 100;
            const y = 94 - (Math.max(0, Number(m.value || 0)) / maxValue) * 80;
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.3" vector-effect="non-scaling-stroke"></circle>`;
          }).join('')}
        </svg>
        <div class="chart-columns">${columns}</div>
      </div>
    `;
  },

  renderRanking(elementId, rows) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="helper-text">Sem ranking ainda.</div>';
      return;
    }
    const esc = window.AppUtils.escapeHtml;
    const visible = rows.slice(0, 8);
    const maxValue = Math.max(...visible.map(r => Number(r.value || 0)), 1);
    const totalValue = visible.reduce((sum, r) => sum + Math.max(0, Number(r.value || 0)), 0);
    el.innerHTML = visible.map((r, i) => {
      const value = Math.max(0, Number(r.value || 0));
      const width = Math.max(3, (value / maxValue) * 100);
      const share = totalValue ? (value / totalValue) * 100 : 0;
      return `
        <div class="ranking-item">
          <span class="rank-num">${i + 1}</span>
          <div class="rank-content">
            <div class="rank-row">
              <span class="rank-name" title="${esc(r.name || '')}">${esc(r.name || '—')}</span>
              <span class="rank-value">${esc(this.formatMoney(value))}</span>
            </div>
            <div class="rank-track" aria-hidden="true"><span style="width:${width.toFixed(1)}%"></span></div>
          </div>
          <span class="rank-share">${share.toFixed(1)}%</span>
        </div>
      `;
    }).join('');
  },

  async loadAuditLog() {
    const list = document.getElementById('audit-list');
    if (!list) return;
    list.innerHTML = '<div class="helper-text">Carregando auditoria…</div>';
    try {
      const data = await window.AppApi.fetchAuditLog({ limit: 40 });
      const events = data.events || [];
      if (!events.length) {
        list.innerHTML = `<div class="helper-text">${window.AppUtils.escapeHtml(data.warning || 'Nenhum download/export registrado ainda. Baixe um XML/Excel/ZIP para gerar eventos.')}</div>`;
        return;
      }
      const esc = window.AppUtils.escapeHtml;
      list.innerHTML = events.map(ev => {
        const when = ev.downloaded_at
          ? new Date(ev.downloaded_at).toLocaleString('pt-BR')
          : '—';
        const action = String(ev.action || 'xml');
        const who = ev.user_email || 'sistema';
        const file = ev.file_name || '—';
        const nsu = ev.nsu != null ? `NSU ${ev.nsu}` : '';
        return `
          <article class="audit-item">
            <span class="audit-action">${esc(action)}</span>
            <div class="audit-main" title="${esc(file)}">${esc(file)}</div>
            <span class="helper-text">${esc(when)}</span>
            <div class="audit-meta">${esc(who)}${nsu ? ' · ' + esc(nsu) : ''}</div>
          </article>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="helper-text">Auditoria indisponível${err.message ? ': ' + window.AppUtils.escapeHtml(err.message) : ''}.</div>`;
    }
  },

  renderCertExpiryBanner(certificates = []) {
    const banner = document.getElementById('cert-expiry-banner');
    if (!banner) return;

    const now = Date.now();
    const thresholds = [7, 15, 30];
    const items = (certificates || [])
      .map(c => {
        const raw = c.validUntil || c.valid_until;
        if (!raw) return null;
        const ts = new Date(raw).getTime();
        if (!Number.isFinite(ts)) return null;
        const days = Math.ceil((ts - now) / (24 * 3600 * 1000));
        return {
          name: c.filename || c.originalName || c.id,
          days,
          date: new Date(ts).toLocaleDateString('pt-BR')
        };
      })
      .filter(Boolean)
      .filter(c => c.days <= 30);

    if (!items.length) {
      banner.style.display = 'none';
      banner.textContent = '';
      return;
    }

    items.sort((a, b) => a.days - b.days);
    const worst = items[0];
    const isDanger = worst.days <= 7 || worst.days < 0;
    banner.className = `cert-expiry-banner${isDanger ? ' danger' : ''}`;
    banner.style.display = 'flex';

    if (worst.days < 0) {
      banner.innerHTML = `<strong>Certificado expirado</strong> — ${window.AppUtils.escapeHtml(worst.name)} venceu em ${worst.date}. Renove o A1.`;
    } else {
      const names = items.slice(0, 3).map(i => `${i.name} (${i.days}d)`).join(', ');
      banner.innerHTML = `<strong>Validade do A1</strong> — certificado(s) a vencer em até 30 dias: ${window.AppUtils.escapeHtml(names)}.`;
    }
  },

  bind() {
    document.getElementById('btn-refresh-api-health')?.addEventListener('click', () => this.loadApiHealth());
    document.getElementById('btn-refresh-sync-runs')?.addEventListener('click', () => this.loadSyncRuns());
    document.getElementById('btn-refresh-audit')?.addEventListener('click', () => this.loadAuditLog());
    document.getElementById('btn-refresh-analytics')?.addEventListener('click', () => this.loadAnalytics());

    // Atualiza contador do retry a cada segundo
    if (!window._retryTicker) {
      window._retryTicker = setInterval(() => {
        window.AppSyncController?.renderRetryStatus?.();
      }, 1000);
    }
  },

  async refreshOpsInsights() {
    await Promise.all([
      this.loadApiHealth(),
      this.loadSyncRuns()
    ]);
  },

  async refreshDashboardExtras(certificates) {
    this.renderCertExpiryBanner(certificates);
    await Promise.all([
      this.loadAnalytics(),
      this.loadAuditLog()
    ]);
  }
};

// Integra no sync controller
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
  loadSyncRuns() {
    return window.AppInsights?.loadSyncRuns?.();
  }
});
;

/* source: js/docDrawer.js */
// Drawer de detalhe da nota (item 15)
window.AppDocDrawer = {
  previousFocus: null,

  open(doc) {
    const drawer = document.getElementById('doc-drawer');
    const backdrop = document.getElementById('doc-drawer-backdrop');
    const body = document.getElementById('doc-drawer-body');
    const title = document.getElementById('doc-drawer-title');
    if (!drawer || !body) return;

    const esc = window.AppUtils.escapeHtml;
    const fmt = (v) => (v == null || v === '' || v === 'N/A' ? '—' : String(v));
    const money = window.AppUtils.formatCurrency(doc.valorServico);
    const date = (v) => window.AppUtils.formatDate(v);

    if (title) {
      title.textContent = doc.numeroNfse && doc.numeroNfse !== 'N/A'
        ? `NFS-e ${doc.numeroNfse}`
        : `NSU ${doc.nsu || '—'}`;
    }

    const hasChave = doc.chave && doc.chave !== 'N/A';
    const hasToken = Boolean(doc.token);

    body.innerHTML = `
      <div class="doc-field-grid">
        <div class="doc-field"><span>Status</span><strong>${esc(fmt(doc.status))}</strong></div>
        <div class="doc-field"><span>Tipo</span><strong>${esc(fmt(doc.tipo))}</strong></div>
        <div class="doc-field"><span>NSU</span><strong>${esc(fmt(doc.nsu))}</strong></div>
        <div class="doc-field"><span>Número NFS-e</span><strong>${esc(fmt(doc.numeroNfse))}</strong></div>
        <div class="doc-field"><span>DPS / Série</span><strong>${esc(fmt(doc.numeroDps))} / ${esc(fmt(doc.serieDps))}</strong></div>
        <div class="doc-field"><span>Valor</span><strong>${esc(money)}</strong></div>
        <div class="doc-field"><span>Emissão</span><strong>${esc(date(doc.dataEmissao))}</strong></div>
        <div class="doc-field"><span>Competência</span><strong>${esc(date(doc.competencia))}</strong></div>
        <div class="doc-field"><span>Processamento</span><strong>${esc(date(doc.dataProcessamento))}</strong></div>
        <div class="doc-field"><span>Município</span><strong>${esc(fmt(doc.municipioPrestacao))}</strong></div>
        <div class="doc-field full"><span>Chave de acesso</span><strong>${esc(fmt(doc.chave))}</strong></div>
        <div class="doc-field full"><span>Prestador</span><strong>${esc(fmt(doc.prestadorNome))}<br><span class="helper-text">${esc(window.AppUtils.formatCnpj(doc.prestadorCnpj) || '—')}</span></strong></div>
        <div class="doc-field full"><span>Tomador</span><strong>${esc(fmt(doc.tomadorNome))}<br><span class="helper-text">${esc(window.AppUtils.formatCnpj(doc.tomadorCnpj) || '—')}</span></strong></div>
        <div class="doc-field full"><span>Descrição do serviço</span><strong>${esc(fmt(doc.descricao || doc.eventoDescricao))}</strong></div>
        <div class="doc-field"><span>Cód. tributação</span><strong>${esc(fmt(doc.codigoTributacao))}</strong></div>
        <div class="doc-field"><span>Cancelada</span><strong>${doc.isCancellation ? 'Sim' : 'Não'}</strong></div>
      </div>
      <div class="doc-drawer-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-drawer-action="xml" ${hasToken ? '' : 'disabled'}>Baixar XML</button>
        <button type="button" class="btn btn-secondary btn-sm" data-drawer-action="pdf" ${hasChave ? '' : 'disabled'}>Baixar PDF</button>
      </div>
    `;

    body.querySelector('[data-drawer-action="xml"]')?.addEventListener('click', async () => {
      try {
        await window.AppApi.downloadFromApi(`/api/download-xml/${doc.token}`, 'nfse.xml');
        window.AppToast?.success('XML baixado');
      } catch (err) {
        window.AppToast?.error(err.message || 'Falha no XML');
      }
    });
    body.querySelector('[data-drawer-action="pdf"]')?.addEventListener('click', async () => {
      try {
        const params = new URLSearchParams({
          certificateId: window.selectCertificate?.value || window.activeCertificateId || '',
          environment: window.selectEnvironment?.value || 'producao'
        });
        await window.AppApi.downloadFromApi(`/api/download-pdf/${encodeURIComponent(doc.chave)}?${params}`, 'danfse.pdf');
        window.AppToast?.success('PDF baixado');
      } catch (err) {
        window.AppToast?.error(err.message || 'Falha no PDF');
      }
    });

    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) {
      backdrop.hidden = false;
    }
    document.body.classList.add('drawer-open-lock');
    const app = document.getElementById('app-layout');
    if (app) app.inert = true;
    requestAnimationFrame(() => document.getElementById('doc-drawer-close')?.focus());
  },

  close() {
    const drawer = document.getElementById('doc-drawer');
    const backdrop = document.getElementById('doc-drawer-backdrop');
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('drawer-open-lock');
    const app = document.getElementById('app-layout');
    if (app) app.inert = false;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  },

  bind() {
    document.getElementById('doc-drawer-close')?.addEventListener('click', () => this.close());
    document.getElementById('doc-drawer-backdrop')?.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      const drawer = document.getElementById('doc-drawer');
      if (!drawer?.classList.contains('open')) return;
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(drawer.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) {
        e.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
};
;

/* source: js/eventsCert.js */
// Certificados Upload e Ações de Gerenciamento Event Bindings

window.AppEventsCert = {
  enterRenewMode(certificateId) {
    const cert = (window.certificates || []).find(item => item.id === certificateId);
    if (!cert) {
      window.AppUi?.log?.('Certificado não encontrado para renovar.', 'error');
      return;
    }

    window.renewCertificateId = certificateId;
    if (window.renewCertificateIdInput) window.renewCertificateIdInput.value = certificateId;

    if (window.certFormEyebrow) window.certFormEyebrow.textContent = 'Renovação';
    if (window.certFormTitle) window.certFormTitle.textContent = 'Renovar certificado A1';
    if (window.certRenewHint) window.certRenewHint.style.display = 'block';
    if (window.btnCancelRenewCert) window.btnCancelRenewCert.style.display = '';
    if (window.btnSaveCertLabel) window.btnSaveCertLabel.textContent = 'Renovar e validar (mesmo vínculo)';
    if (window.certDropText) {
      window.certDropText.innerHTML = 'Envie o <strong>A1 novo</strong> (.pfx/.p12) da <strong>mesma empresa</strong>';
    }

    if (window.certCnpjInput) {
      window.certCnpjInput.value = cert.cnpj || '';
      window.certCnpjInput.readOnly = true;
      window.certCnpjInput.title = 'CNPJ travado na renovação — deve ser o mesmo do cadastro';
    }

    if (window.formCert) window.formCert.reset();
    // reset limpa hidden e cnpj — reaplicar
    if (window.renewCertificateIdInput) window.renewCertificateIdInput.value = certificateId;
    if (window.certCnpjInput) {
      window.certCnpjInput.value = cert.cnpj || '';
      window.certCnpjInput.readOnly = true;
    }
    window.selectedFile = null;
    if (window.fileNamePreview) window.fileNamePreview.innerText = '';
    if (window.passphraseInput) window.passphraseInput.value = '';

    window.certUploadState?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    window.AppUi?.log?.(
      `Modo renovação: vínculo ${cert.cnpj || certificateId}. XMLs e NSU serão preservados.`,
      'warning'
    );
    window.AppToast?.info?.('Envie o A1 renovado da mesma empresa');
  },

  exitRenewMode() {
    window.renewCertificateId = null;
    if (window.renewCertificateIdInput) window.renewCertificateIdInput.value = '';
    if (window.certFormEyebrow) window.certFormEyebrow.textContent = 'Novo arquivo';
    if (window.certFormTitle) window.certFormTitle.textContent = 'Adicionar certificado A1';
    if (window.certRenewHint) window.certRenewHint.style.display = 'none';
    if (window.btnCancelRenewCert) window.btnCancelRenewCert.style.display = 'none';
    if (window.btnSaveCertLabel) window.btnSaveCertLabel.textContent = 'Salvar e validar certificado';
    if (window.certDropText) {
      window.certDropText.innerHTML = 'Arraste seu certificado <strong>.pfx</strong> ou <strong>.p12</strong> aqui ou clique para selecionar';
    }
    if (window.certCnpjInput) {
      window.certCnpjInput.readOnly = false;
      window.certCnpjInput.title = '';
      window.certCnpjInput.value = '';
    }
    window.selectedFile = null;
    if (window.fileNamePreview) window.fileNamePreview.innerText = '';
    if (window.passphraseInput) window.passphraseInput.value = '';
    if (window.fileInput) window.fileInput.value = '';
  },

  bindCertEvents() {
    // Painel de certificados pode ainda nao existir se o HTML secundario nao carregou
    if (!dropZone || !fileInput || !formCert) {
      return;
    }

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleFileSelection(e.target.files[0]);
    });

    formCert.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.selectedFile) {
        window.AppUi.log('Erro: Por favor, selecione um arquivo de certificado.', 'error');
        alert('Por favor, selecione o arquivo do certificado digital.');
        return;
      }

      const renewId = window.renewCertificateId
        || (window.renewCertificateIdInput && window.renewCertificateIdInput.value)
        || '';
      const isRenew = Boolean(renewId);

      const formData = new FormData();
      formData.append('pfx', window.selectedFile);
      formData.append('passphrase', passphraseInput ? passphraseInput.value : '');
      formData.append('cnpj', certCnpjInput ? certCnpjInput.value : '');
      if (isRenew) formData.append('certificateId', renewId);

      window.AppUi.log(isRenew
        ? 'Renovando certificado (mesmo vínculo / CNPJ)...'
        : 'Enviando certificado para validação local...');
      const saveBtn = document.getElementById('btn-save-cert-view');
      if (saveBtn) saveBtn.disabled = true;

      try {
        const data = isRenew
          ? await window.AppApi.renewCertificate(formData)
          : await window.AppApi.uploadCertificate(formData);
        if (data.success) {
          window.AppUi.log(
            data.message || (isRenew
              ? 'Certificado renovado. XMLs e NSU preservados.'
              : 'Certificado carregado e validado com sucesso!'),
            'success'
          );
          window.AppToast?.success?.(isRenew ? 'Certificado renovado' : 'Certificado salvo');
          this.exitRenewMode();
          formCert.reset();
          window.selectedFile = null;
          if (fileNamePreview) fileNamePreview.innerText = '';
          window.AppSyncController.checkCertStatus();
        } else {
          window.AppUi.log(`Erro na validação: ${data.error}`, 'error');
          alert(`Falha no certificado: ${data.error}`);
        }
      } catch (err) {
        window.AppUi.log(`Erro de rede ao salvar certificado: ${err.message}`, 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    if (window.btnCancelRenewCert) {
      window.btnCancelRenewCert.addEventListener('click', () => {
        this.exitRenewMode();
        window.AppUi?.log?.('Renovação cancelada.');
      });
    }

    if (window.btnRenewActiveCert) {
      window.btnRenewActiveCert.addEventListener('click', () => {
        const id = window.activeCertificateId;
        if (!id) {
          window.AppUi?.log?.('Nenhum certificado ativo para renovar.', 'warning');
          return;
        }
        this.enterRenewMode(id);
      });
    }

    if (certList) {
      certList.addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const certificateId = button.dataset.id;
        if (button.dataset.action === 'select-cert') {
          await window.AppSyncController.selectCertificateById(certificateId);
          return;
        }

        if (button.dataset.action === 'renew-cert') {
          this.enterRenewMode(certificateId);
          return;
        }

        if (button.dataset.action === 'rename-cert') {
          const cert = window.certificates.find(item => item.id === certificateId);
          const currentName = cert?.filename || cert?.originalName || '';
          const nextName = prompt('Novo nome do certificado:', currentName);
          if (nextName === null) return;

          const data = await window.AppApi.renameCertificate(certificateId, nextName.trim());
          if (data.success) {
            window.AppUi.log('Certificado renomeado.', 'success');
            window.AppSyncController.checkCertStatus();
          } else {
            window.AppUi.log(`Erro ao renomear: ${data.error}`, 'error');
          }
          return;
        }

        if (button.dataset.action === 'remove-cert') {
          const cert = window.certificates.find(item => item.id === certificateId);
          if (!confirm(`Deseja remover o certificado "${cert?.filename || certificateId}"?\n\nIsso apaga o histórico de XMLs e NSU vinculados a este certificado.`)) return;

          const data = await window.AppApi.removeCertificate(certificateId);
          if (data.success) {
            window.AppUi.log('Certificado removido.');
            if (window.renewCertificateId === certificateId) this.exitRenewMode();
            window.AppSyncController.checkCertStatus();
            window.AppSyncController.stopQuerying();
          } else {
            window.AppUi.log(`Erro ao remover: ${data.error}`, 'error');
          }
        }
      });
    }

    if (btnReplaceCert) {
      btnReplaceCert.addEventListener('click', async () => {
        if (!window.activeCertificateId || !confirm('Deseja realmente remover o certificado ativo?\n\nIsso apaga o histórico de XMLs e NSU deste vínculo.')) return;
        try {
          const data = await window.AppApi.removeCertificate(window.activeCertificateId);
          if (data.success) {
            window.AppUi.log('Certificado ativo removido.');
            if (window.renewCertificateId === window.activeCertificateId) this.exitRenewMode();
            window.AppSyncController.checkCertStatus();
            window.AppSyncController.stopQuerying();
          }
        } catch (err) {
          window.AppUi.log(`Erro ao remover: ${err.message}`, 'error');
        }
      });
    }

    if (btnDiagnoseCert) {
      btnDiagnoseCert.addEventListener('click', async () => {
        const certificateId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
        const env = selectEnvironment ? selectEnvironment.value : 'producao';
        if (!certificateId) {
          window.AppUi.log('Nenhum certificado para diagnosticar.', 'warning');
          return;
        }

        btnDiagnoseCert.disabled = true;
        window.AppUi.log('Diagnosticando certificado e ambiente...');

        try {
          const data = await window.AppApi.diagnoseCertificate(certificateId, env);
          window.AppUi.log(`PFX: descriptografado=${data.success ? 'sim' : 'não'} | Titular=${data.pfx?.subject || 'N/A'}`);
          if (data.success) {
            window.AppUi.log(`PFX Válido: CNPJ=${data.pfx?.cnpjExtracted} | Validade=${data.pfx?.validUntil}`, 'success');
          } else {
            window.AppUi.log(`Diagnóstico falhou: ${data.error || 'erro desconhecido'}`, 'error');
          }
        } catch (err) {
          window.AppUi.log(`Erro de diagnóstico: ${err.message}`, 'error');
        } finally {
          btnDiagnoseCert.disabled = false;
        }
      });
    }
  }
};
;

/* source: js/eventsAuth.js */
// eventsAuth
window.AppEventsAuth = {
  bind() {
if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    window.AppUi.setAuthMessage('Entrando...');
    authSubmit.disabled = true;

    try {
      const user = await window.AppApi.loginWithPassword(authEmail.value.trim(), authPassword.value);
      if (!window.authSession?.access_token) {
        throw new Error('Login ok, mas a sessão não foi salva. Tente novamente.');
      }
      if (window.AppAuthGate) window.AppAuthGate.endBoot();
      window.AppUi.setAuthMessage('Acesso liberado.', 'success');
      window.AppUi.showAuthenticatedApp(user);
      if (window.AppDataCache) window.AppDataCache.invalidateAll();
      // Só carrega dados com token válido em memória
      await Promise.allSettled([
        window.AppSyncController.checkCertStatus({ skipSecondary: true }),
        window.AppSyncController.loadDashboard(),
        typeof loadSchedulerSettings === 'function' ? loadSchedulerSettings() : Promise.resolve()
      ]);
      window.AppUi.updateProgress(0, 0);
      if (selectEnvironment) selectEnvironment.dispatchEvent(new Event('change'));
    } catch (err) {
      window.AppUtils.clearAuthSession();
      window.AppUi.setAuthMessage(err.message, 'error');
    } finally {
      authSubmit.disabled = false;
    }
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    window.AppUtils.clearAuthSession();
    window.AppSyncController.stopQuerying();
    window.AppUi.showLogin();
  });
}

if (selectCertificate) {
  selectCertificate.addEventListener('change', async () => {
    await window.AppSyncController.selectCertificateById(selectCertificate.value);
    if (window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none') {
      window.AppSyncController.loadPersistedHistory();
    }
  });
}

  }
};
;

/* source: js/eventsSync.js */
// eventsSync
window.AppEventsSync = {
  bind() {
if (btnStart) {
  btnStart.addEventListener('click', async () => {
    if (window.isQuerying) {
      window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
      if (window.queryLoopTimer) {
        clearTimeout(window.queryLoopTimer);
        window.queryLoopTimer = null;
      }
      window.isPaused = true;
      window.AppUi.setBtnStartActive(false, true);
      if (btnPause) btnPause.disabled = true;
      if (window.btnResetNsu) window.btnResetNsu.disabled = false;
      window.AppUi.log('Sincronização pausada pelo usuário.', 'warning');
      window.isQuerying = false;
      // Fecha a run de ponta a ponta como "pausada"
      window.AppSyncController.closeSessionRun?.({ status: 'paused' });
    } else {
      const wasPaused = window.isPaused;
      window.isQuerying = true;
      window.isPaused = false;
      const runId = window.AppSyncController.beginQueryRun();
      if (alertRateLimit) alertRateLimit.style.display = 'none';
      if (alertSyncSuccess) alertSyncSuccess.style.display = 'none';
      window.AppUi.setBtnStartActive(true);
      if (btnPause) btnPause.disabled = false;
      if (window.btnResetNsu) window.btnResetNsu.disabled = true;

      const overrideNsuCheckbox = document.getElementById('override-nsu');
      const isOverridden = overrideNsuCheckbox && overrideNsuCheckbox.checked;

      if (isOverridden) {
        window.currentNsu = parseInt(inputStartNsu?.value) || 0;
        window.AppUi.log(`Varredura iniciada manualmente forçando o NSU inicial: ${window.currentNsu}.`);
      }

      if (!wasPaused) {
        window.totalDownloaded = 0;
        const mode = 'asc';
        window.isCrawlerActive = false;
        window.crawlerVisited = new Set();
        window.crawlerQueue = [];
        const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
        window.currentCrawlerCnpj = unitFilterParams.partyCnpj || (inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '');
        window.AppUi.updateCrawlerUI();

        if (!isOverridden) {
          try {
            const savedNsu = await window.AppSyncController.loadSavedStartNsu();
            window.AppUi.log(`Iniciando varredura a partir do último NSU recebido salvo: ${savedNsu}.`);
          } catch (err) {
            window.currentNsu = 0;
            if (inputStartNsu) inputStartNsu.value = 0;
            window.AppUi.log(`Não foi possível carregar o último NSU salvo (${err.message}). Iniciando do NSU 0.`, 'warning');
          }
        }

        // Abre UMA run para toda a sessão (início → fim)
        await window.AppSyncController.openSessionRun(window.currentNsu || 0);
        window.AppUi.log('Run de varredura aberta. O histórico registrará do início ao fim desta sessão.');

        if (mode === 'desc' && window.currentNsu === 0) {
          window.AppUi.log(`Descobrindo NSU mais recente na Receita Federal para busca reversa...`);
          window.AppSyncController.discoverAndStart(runId);
          return;
        }
      } else if (!isOverridden) {
        // Retomada: reabre run se a anterior foi fechada na pausa
        if (!window.sessionRunId) {
          await window.AppSyncController.openSessionRun(window.currentNsu || 0);
        }
        window.AppUi.log(`Retomando busca a partir do NSU ${window.currentNsu}...`);
      }

      window.AppSyncController.runQueryLoop(runId);
    }
  });
}

if (btnPause) {
  btnPause.addEventListener('click', () => {
    window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
    if (window.queryLoopTimer) {
      clearTimeout(window.queryLoopTimer);
      window.queryLoopTimer = null;
    }
    window.isPaused = true;
    window.AppUi.setBtnStartActive(false, true);
    btnPause.disabled = true;
    if (window.btnResetNsu) window.btnResetNsu.disabled = false;
    window.AppUi.log('Sincronização pausada pelo usuário.', 'warning');
    window.isQuerying = false;
    window.AppSyncController.closeSessionRun?.({ status: 'paused' });
  });
}

if (window.btnResetNsu) {
  window.btnResetNsu.addEventListener('click', async () => {
    if (!window.AppUtils?.requireOpsPassword?.('zerar o NSU')) return;
    if (!confirm('Tem certeza que deseja zerar o histórico de NSU e começar do 0 para este certificado/unidade?')) return;

    window.btnResetNsu.disabled = true;
    try {
      const certId = window.selectCertificate.value;
      const env = window.selectEnvironment.value;
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      const cnpj = unitFilterParams.partyCnpj || window.inputCnpjConsulta?.value || '';
      
      if (!certId) {
        window.AppUi.log('Selecione um certificado primeiro.', 'error');
        return;
      }
      
      const response = await fetch('/api/reset-nsu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificateId: certId, environment: env, cnpjConsulta: cnpj })
      });
      
      const result = await response.json();
      if (result.success) {
        window.AppUi.log('Histórico de NSU zerado com sucesso. Você pode iniciar a varredura a partir do 0.', 'success');
        window.inputStartNsu.value = '0';
        window.currentNsu = 0;
      } else {
        window.AppUi.log(`Erro ao zerar NSU: ${result.error}`, 'error');
      }
    } catch (err) {
      window.AppUi.log(`Erro na requisição: ${err.message}`, 'error');
    } finally {
      window.btnResetNsu.disabled = false;
    }
  });
}
  }
};
;

/* source: js/eventsTable.js */
// eventsTable
window.AppEventsTable = {
  bind() {
if (tableBody) {
  tableBody.addEventListener('click', async (e) => {
    const detailButton = e.target.closest('button[data-action="open-detail"]');
    const xmlButton = e.target.closest('button[data-action="download-xml"]');
    const pdfButton = e.target.closest('button[data-action="download-pdf"]');
    if (!detailButton && !xmlButton && !pdfButton) return;

    try {
      if (detailButton) {
        const nsu = detailButton.dataset.nsu;
        const docs = window.AppUiTable?.documents || [];
        const doc = docs.find(d => String(d.nsu) === String(nsu))
          || docs.find(d => String(d.chave) === String(detailButton.closest('.xml-item')?.dataset?.docChave));
        if (doc && window.AppDocDrawer) window.AppDocDrawer.open(doc);
        return;
      }

      if (xmlButton) {
        await window.AppApi.downloadFromApi(`/api/download-xml/${xmlButton.dataset.token}`, 'nfse.xml');
        window.AppUi.log('XML baixado com sucesso.', 'success');
        window.AppToast?.success('XML baixado');
        window.AppInsights?.loadAuditLog?.();
        return;
      }

      const params = new URLSearchParams({
        certificateId: selectCertificate ? selectCertificate.value : (window.activeCertificateId || ''),
        environment: selectEnvironment ? selectEnvironment.value : 'producao'
      });
      await window.AppApi.downloadFromApi(`/api/download-pdf/${encodeURIComponent(pdfButton.dataset.chave)}?${params.toString()}`, 'danfse.pdf');
      window.AppUi.log('PDF baixado com sucesso.', 'success');
      window.AppToast?.success('PDF baixado');
      window.AppInsights?.loadAuditLog?.();
    } catch (err) {
      window.AppUi.log(`Erro ao baixar documento: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no download');
    }
  });
}

if (btnClearDownloads) btnClearDownloads.addEventListener('click', async () => {
  if (!confirm('Limpar apenas arquivos temporários? Os XMLs permanentes no banco de dados serão preservados.')) return;

  try {
    const data = await window.AppApi.clearDownloads();
    if (data.success) {
      window.AppUi.log(`Temporários limpos. ${data.count} XML(s) removido(s); banco de dados preservado.`);
      window.totalDownloaded = 0;
      if (btnDownloadZip) btnDownloadZip.disabled = true;
      window.AppUi.updateProgress(0, 0);
      statNsuAtual.innerText = '0';
      statNsuMax.innerText = '0';
      alertRateLimit.style.display = 'none';
      alertSyncSuccess.style.display = 'none';
      window.AppSyncController.loadPersistedHistory();
      window.AppSyncController.loadStorageSummary();
    }
  } catch (err) {
    window.AppUi.log(`Erro ao limpar pasta: ${err.message}`, 'error');
  }
});

if (btnExportExcel) {
  btnExportExcel.addEventListener('click', async () => {
    window.AppUi.log('Gerando Excel com os XMLs persistidos da tabela atual...');
    btnExportExcel.disabled = true;
    if (btnDownloadZip) btnDownloadZip.disabled = true;
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadExcel({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate: downloadStartDate?.value || null,
        endDate: downloadEndDate?.value || null,
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        cancelledMode: window.AppUtils.getCancelledMode(),
        includeCancelled: window.AppUtils.getIncludeCancelledParam(),
        onlyCancelled: window.AppUtils.getOnlyCancelledParam()
      });
      window.AppUi.log('Excel da tabela baixado com sucesso.', 'success');
      window.AppToast?.success('Excel exportado');
    } catch (err) {
      window.AppUi.log(`Erro ao baixar Excel: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no Excel');
    } finally {
      const empty = !window.AppUiTable?.documents?.length;
      btnExportExcel.disabled = empty;
      if (btnDownloadZip) btnDownloadZip.disabled = empty;
    }
  });
}

if (btnExportIntegrity) {
  btnExportIntegrity.addEventListener('click', async () => {
    btnExportIntegrity.disabled = true;
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadIntegrityManifest({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate: downloadStartDate?.value || '',
        endDate: downloadEndDate?.value || '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        cancelledMode: window.AppUtils.getCancelledMode(),
        includeCancelled: window.AppUtils.getIncludeCancelledParam(),
        onlyCancelled: window.AppUtils.getOnlyCancelledParam()
      });
      window.AppUi.log('Manifesto de integridade exportado com SHA-256.', 'success');
      window.AppToast?.success('Manifesto de integridade exportado');
    } catch (error) {
      window.AppUi.log(`Erro no manifesto: ${error.message}`, 'error');
      window.AppToast?.error(error.message || 'Falha no manifesto');
    } finally {
      btnExportIntegrity.disabled = !window.AppUiTable?.documents?.length;
    }
  });
}

if (btnDownloadZip) {
  btnDownloadZip.addEventListener('click', async () => {
    window.AppUi.log('Gerando ZIP com os XMLs persistidos da tabela atual...');
    btnDownloadZip.disabled = true;
    if (btnExportExcel) btnExportExcel.disabled = true;
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadPeriodZip({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate: downloadStartDate?.value || null,
        endDate: downloadEndDate?.value || null,
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        cancelledMode: window.AppUtils.getCancelledMode(),
        includeCancelled: window.AppUtils.getIncludeCancelledParam(),
        onlyCancelled: window.AppUtils.getOnlyCancelledParam()
      });
      window.AppUi.log('ZIP da tabela baixado com sucesso.', 'success');
      window.AppToast?.success('ZIP baixado');
    } catch (err) {
      window.AppUi.log(`Erro ao baixar ZIP: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no ZIP');
    } finally {
      const empty = !window.AppUiTable?.documents?.length;
      btnDownloadZip.disabled = empty;
      if (btnExportExcel) btnExportExcel.disabled = empty;
    }
  });
}
  }
};
;

/* source: js/eventsFilters.js */
// eventsFilters
window.AppEventsFilters = {
  bind() {
if (selectEnvironment) {
  selectEnvironment.addEventListener('change', async () => {
    const envText = selectEnvironment.value === 'producao' ? 'Produção' : 'Homologação';
    const statAmbiente = document.getElementById('stat-ambiente');
    if (statAmbiente) {
      statAmbiente.innerText = envText;
      statAmbiente.className = selectEnvironment.value === 'producao' ? 'metric-value text-primary' : 'metric-value text-warning';
    }
    if (selectEnvironment.offsetParent !== null) {
      window.AppUi.log(`Ambiente alterado para: ${envText}`);
    }
    if (window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none') {
      if (window.AppDataCache) {
        window.AppDataCache.invalidate('history:');
        window.AppDataCache.invalidate('sync-state:');
      }
      await Promise.allSettled([
        window.AppSyncController.loadPersistedHistory(1, { quiet: true }),
        window.AppSyncController.loadSavedStartNsu()
      ]);
    }
  });
}

if (inputCnpjConsulta) {
  inputCnpjConsulta.addEventListener('change', async () => {
    if (window.AppDataCache) {
      window.AppDataCache.invalidate('history:');
      window.AppDataCache.invalidate('sync-state:');
    }
    await Promise.allSettled([
      window.AppSyncController.loadPersistedHistory(1, { quiet: true }),
      window.AppSyncController.loadSavedStartNsu()
    ]);
  });
}

if (unitFilter) {
  unitFilter.addEventListener('change', async () => {
    window.AppSyncController.fillUnitFormFromSelection();
    if (window.AppDataCache) {
      window.AppDataCache.invalidate('history:');
      window.AppDataCache.invalidate('sync-state:');
    }
    await Promise.allSettled([
      window.AppSyncController.loadPersistedHistory(1, { quiet: true }),
      window.AppSyncController.loadSavedStartNsu()
    ]);
  });
}

if (unitPartyRole) {
  unitPartyRole.addEventListener('change', async () => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    await window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  });
}

if (historySearch) {
  historySearch.addEventListener('input', debounce(() => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  }, 280));
}

if (includeCancelled) {
  includeCancelled.addEventListener('change', () => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  });
}

if (window.cancelledFilter) {
  window.cancelledFilter.addEventListener('change', () => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  });
}

if (btnSaveUnit) {
  btnSaveUnit.addEventListener('click', async () => {
    btnSaveUnit.disabled = true;
    try {
      const selectedOption = unitFilter?.selectedOptions?.[0];
      const data = await window.AppApi.saveUnit({
        id: selectedOption?.dataset?.id || null,
        name: unitName ? unitName.value.trim() : '',
        cnpj: unitCnpj ? unitCnpj.value.trim() : '',
        city: unitCity ? unitCity.value.trim() : '',
        state: unitState ? unitState.value.trim() : ''
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível salvar a unidade.');
      await window.AppSyncController.loadUnits();
      if (unitFilter && data.unit?.cnpj) unitFilter.value = data.unit.cnpj;
      window.AppSyncController.fillUnitFormFromSelection();
      window.AppSyncController.loadPersistedHistory();
      window.AppUi.log('Unidade salva com sucesso.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao salvar unidade: ${err.message}`, 'error');
    } finally {
      btnSaveUnit.disabled = false;
    }
  });
}

if (btnDeleteUnit) {
  btnDeleteUnit.addEventListener('click', async () => {
    const selected = window.AppSyncController.getSelectedUnitFilter();
    if (!selected.unitId) {
      window.AppUi.log('Selecione uma unidade cadastrada para remover.', 'warning');
      return;
    }
    if (!confirm('Remover esta unidade da lista de filtros?')) return;

    btnDeleteUnit.disabled = true;
    try {
      const data = await window.AppApi.deleteUnit(selected.unitId);
      if (!data.success) throw new Error(data.error || 'Não foi possível remover a unidade.');
      if (unitFilter) unitFilter.value = '';
      await window.AppSyncController.loadUnits();
      window.AppSyncController.fillUnitFormFromSelection();
      window.AppSyncController.loadPersistedHistory();
      window.AppUi.log('Unidade removida.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao remover unidade: ${err.message}`, 'error');
    } finally {
      btnDeleteUnit.disabled = false;
    }
  });
}
  }
};
;

/* source: js/eventsNsu.js */
// Botões de NSU e paginação da tabela
window.AppEventsNsu = {
  bind() {
    if (selectSearchMode) {
      selectSearchMode.addEventListener('change', () => window.AppUiTable.renderCurrentPage());
    }

    // Forçar NSU: checkbox + input protegidos por senha (front only)
    const overrideNsuCheckbox = document.getElementById('override-nsu');
    const nsuInput = window.inputStartNsu || document.getElementById('start-nsu');

    const setNsuForceUnlocked = (unlocked) => {
      if (nsuInput) {
        nsuInput.readOnly = !unlocked;
        nsuInput.classList.toggle('is-locked', !unlocked);
        nsuInput.title = unlocked
          ? 'NSU inicial forçado (editável)'
          : 'Marque "Forçar NSU" e digite a senha para editar';
      }
      if (overrideNsuCheckbox) overrideNsuCheckbox.checked = Boolean(unlocked);
    };

    // Input bloqueado até destravar com senha
    setNsuForceUnlocked(false);

    if (overrideNsuCheckbox) {
      overrideNsuCheckbox.addEventListener('change', () => {
        if (overrideNsuCheckbox.checked) {
          if (!window.AppUtils?.requireOpsPassword?.('forçar o NSU')) {
            setNsuForceUnlocked(false);
            return;
          }
          setNsuForceUnlocked(true);
          nsuInput?.focus();
          window.AppUi?.log?.('Forçar NSU desbloqueado. Informe o NSU inicial desejado.', 'warning');
        } else {
          setNsuForceUnlocked(false);
          window.AppUi?.log?.('Forçar NSU desativado. A varredura usará o último NSU salvo.');
        }
      });
    }

    if (nsuInput) {
      // Qualquer tentativa de editar com o force off pede senha
      const guardNsuEdit = (e) => {
        if (overrideNsuCheckbox?.checked) return;
        e.preventDefault();
        e.stopPropagation();
        if (!window.AppUtils?.requireOpsPassword?.('forçar o NSU')) {
          setNsuForceUnlocked(false);
          return;
        }
        setNsuForceUnlocked(true);
        window.AppUi?.log?.('Forçar NSU desbloqueado. Informe o NSU inicial desejado.', 'warning');
        // reabre o input no próximo tick
        setTimeout(() => nsuInput.focus(), 0);
      };
      nsuInput.addEventListener('pointerdown', (e) => {
        if (!overrideNsuCheckbox?.checked) guardNsuEdit(e);
      });
      nsuInput.addEventListener('keydown', (e) => {
        if (!overrideNsuCheckbox?.checked && !['Tab'].includes(e.key)) guardNsuEdit(e);
      });
    }

    if (btnUseSavedNsu) {
      btnUseSavedNsu.addEventListener('click', async () => {
        btnUseSavedNsu.disabled = true;
        try {
          const data = await window.AppApi.fetchSyncState({
            environment: selectEnvironment ? selectEnvironment.value : 'producao',
            cnpjConsulta: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
            certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId
          });
          const lastReceivedNsu = Number(data.state?.last_received_nsu || 0);
          const lastNsu = Number(data.state?.last_nsu || 0);
          const savedNsu = lastReceivedNsu || lastNsu;
          inputStartNsu.value = savedNsu;
          window.currentNsu = savedNsu;
          window.maxNsu = Math.max(window.maxNsu || 0, savedNsu);
          statNsuAtual.innerText = String(savedNsu);
          statNsuMax.innerText = String(window.maxNsu || savedNsu);
          window.totalDownloaded = 0;
          window.isPaused = false;
          window.AppUi.log(`NSU inicial ajustado para o último NSU recebido e salvo: ${savedNsu}.`, 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao buscar o último NSU salvo: ${err.message}`, 'error');
        } finally {
          btnUseSavedNsu.disabled = false;
        }
      });
    }

    if (btnUseNationalNsu) {
      btnUseNationalNsu.addEventListener('click', async () => {
        btnUseNationalNsu.disabled = true;
        window.AppUi.log('Consultando ADN para descobrir o último NSU nacional...', 'warning');
        try {
          const data = await window.AppApi.discoverNsu({
            environment: selectEnvironment ? selectEnvironment.value : 'producao',
            cnpjConsulta: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
            certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId
          });
          if (!data.success) throw new Error(data.error || 'Não foi possível descobrir o último NSU.');
          const nationalNsu = Number(data.maxNSU || 0);
          inputStartNsu.value = nationalNsu;
          window.currentNsu = nationalNsu;
          window.maxNsu = Math.max(window.maxNsu || 0, nationalNsu);
          statNsuAtual.innerText = String(nationalNsu);
          statNsuMax.innerText = String(window.maxNsu || nationalNsu);
          window.totalDownloaded = 0;
          window.isPaused = false;
          window.AppUi.log(`NSU inicial ajustado para o último NSU nacional: ${nationalNsu}.`, 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao descobrir o último NSU nacional: ${err.message}`, 'error');
        } finally {
          btnUseNationalNsu.disabled = false;
        }
      });
    }

    if (btnHistoryPrev) {
      btnHistoryPrev.addEventListener('click', () => window.AppUiTable.prevPage());
    }

    if (btnHistoryNext) {
      btnHistoryNext.addEventListener('click', () => window.AppUiTable.nextPage());
    }
  }
};
;

/* source: js/eventsNav.js */
// eventsNav
window.AppEventsNav = {
  closeSidebar() {
    const layout = window.appLayout || document.getElementById('app-layout');
    const btn = window.btnSidebarToggle || document.getElementById('btn-sidebar-toggle');
    if (layout) layout.classList.remove('sidebar-open');
    document.body.classList.remove('sidebar-open-lock');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  },

  openSidebar() {
    const layout = window.appLayout || document.getElementById('app-layout');
    const btn = window.btnSidebarToggle || document.getElementById('btn-sidebar-toggle');
    if (layout) layout.classList.add('sidebar-open');
    document.body.classList.add('sidebar-open-lock');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  },

  toggleSidebar() {
    const layout = window.appLayout || document.getElementById('app-layout');
    if (!layout) return;
    if (layout.classList.contains('sidebar-open')) this.closeSidebar();
    else this.openSidebar();
  },

  bind() {
    const go = (nav, view, title, subtitle, hash, updateHistory = true) => {
      window.AppUi.switchTab(nav, view, title, subtitle);
      if (updateHistory && hash && window.location.hash !== hash) {
        window.history.pushState({ tab: hash }, '', hash);
      }
      this.closeSidebar();
    };

    const routes = {
      '#dashboard': () => go(navDashboard, viewDashboardContent, 'Dashboard', 'Resumo das cidades e total de XMLs persistidos', '#dashboard', false),
      '#xmls': () => go(navDownload, viewDownloadContent, 'XMLs por unidade', 'XMLs da NFS-e persistidos por certificado e unidade', '#xmls', false),
      '#certificados': () => go(navCertificado, viewCertificadoContent, 'Certificados', 'Gerencie certificados A1 e nomes internos', '#certificados', false),
      '#regras': () => go(navRegras, viewRegrasContent, 'Regras ADN', 'Limites de consulta e boas práticas da NFS-e Nacional', '#regras', false)
    };

    if (navDashboard) {
      navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        go(navDashboard, viewDashboardContent, 'Dashboard', 'Resumo das cidades e total de XMLs persistidos', '#dashboard');
      });
      navDashboard.addEventListener('mouseenter', () => window.AppUi.prefetchTab?.('view-dashboard-content'), { passive: true });
    }
    if (navDownload) {
      navDownload.addEventListener('click', (e) => {
        e.preventDefault();
        go(navDownload, viewDownloadContent, 'XMLs por unidade', 'XMLs da NFS-e persistidos por certificado e unidade', '#xmls');
      });
      navDownload.addEventListener('mouseenter', () => window.AppUi.prefetchTab?.('view-download-content'), { passive: true });
    }
    if (navCertificado) {
      navCertificado.addEventListener('click', (e) => {
        e.preventDefault();
        go(navCertificado, viewCertificadoContent, 'Certificados', 'Gerencie certificados A1 e nomes internos', '#certificados');
      });
    }
    if (navRegras) {
      navRegras.addEventListener('click', (e) => {
        e.preventDefault();
        go(navRegras, viewRegrasContent, 'Regras ADN', 'Limites de consulta e boas práticas da NFS-e Nacional', '#regras');
      });
    }

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        window.AppUtils.applyTheme(newTheme);
        window.AppUi.log(`Tema alternado para o modo ${newTheme === 'light' ? 'claro' : 'escuro'}.`);
      });
    }

    const toggleBtn = window.btnSidebarToggle || document.getElementById('btn-sidebar-toggle');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (toggleBtn) {
      window.btnSidebarToggle = toggleBtn;
      toggleBtn.addEventListener('click', () => this.toggleSidebar());
    }
    if (backdrop) {
      backdrop.addEventListener('click', () => this.closeSidebar());
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSidebar();
    });
    window.addEventListener('popstate', () => {
      (routes[window.location.hash] || routes['#dashboard'])();
    });
  }
};
;

/* source: js/eventsScheduler.js */
// eventsScheduler
window.AppEventsScheduler = {
  bind() {
if (btnSaveScheduler) {
  btnSaveScheduler.addEventListener('click', async () => {
    btnSaveScheduler.disabled = true;
    try {
      const settings = {
        autoSyncEnabled: Boolean(schedulerEnabled?.checked),
        autoSyncIntervalHours: Number(schedulerInterval?.value || 12),
        autoSyncEnvironment: selectEnvironment?.value || schedulerEnv?.value || 'producao',
        autoSyncMaxBatchesPerRun: Number(schedulerMaxBatches?.value || 1),
        autoSyncDelaySeconds: 2
      };
      const data = await window.AppApi.saveSchedulerSettings(settings);
      if (!data.success) throw new Error(data.error || 'Não foi possível salvar o agendamento.');
      window.AppUi.updateSchedulerUI(data.settings);
      window.AppUi.log('Agendamento salvo com sucesso.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao salvar agendamento: ${err.message}`, 'error');
    } finally {
      btnSaveScheduler.disabled = false;
    }
  });
}

if (btnRunSchedulerNow) {
  btnRunSchedulerNow.addEventListener('click', async () => {
    btnRunSchedulerNow.disabled = true;
    if (btnSaveScheduler) btnSaveScheduler.disabled = true;
    window.AppUi.log('Iniciando atualização manual segura...');
    try {
      const settings = {
        autoSyncEnabled: false,
        autoSyncIntervalHours: Number(schedulerInterval?.value || 12),
        autoSyncEnvironment: selectEnvironment?.value || schedulerEnv?.value || 'producao',
        autoSyncMaxBatchesPerRun: Number(schedulerMaxBatches?.value || 1),
        autoSyncDelaySeconds: 2
      };
      await window.AppApi.saveSchedulerSettings(settings);

      const delaySeconds = 2;
      let finished = false;
      let cycles = 0;

      while (!finished) {
        cycles += 1;
        const data = await window.AppApi.runSchedulerNow();
        if (!data.success) throw new Error(data.error || 'Não foi possível executar a atualização.');

        const result = data.result || {};
        if (result.error) throw new Error(result.error);

        window.AppUi.updateManualSyncProgress(
          result.lastNsu || 0,
          result.maxNsuSeen || 0,
          result.maxNsuSeen ? `NSU ${result.lastNsu || 0} de ${result.maxNsuSeen}` : 'Consultando primeiro lote...'
        );
        window.AppUi.updateProgress(result.lastNsu || 0, result.maxNsuSeen || 0);
        window.AppUi.log(`Ciclo ${cycles}: ${result.batches || 0} lote(s), ${result.documentsFound || 0} XML(s).`, 'success');

        finished = Boolean(result.finished || result.started === false);
        if (!finished) {
          window.AppUi.log(`Pausa segura de ${delaySeconds}s antes do próximo lote para reduzir risco de bloqueio...`, 'warning');
          await sleep(delaySeconds * 1000);
        }
      }

      window.AppUi.log('Atualização manual concluída.', 'success');
      window.AppSyncController.loadPersistedHistory();
      window.AppSyncController.loadStorageSummary();
      loadSchedulerSettings();
    } catch (err) {
      window.AppUi.log(`Erro na atualização manual: ${err.message}`, 'error');
    } finally {
      btnRunSchedulerNow.disabled = false;
      if (btnSaveScheduler) btnSaveScheduler.disabled = false;
    }
  });
}

if (btnDownloadPeriod) {
  btnDownloadPeriod.addEventListener('click', async () => {
    const startDate = downloadStartDate?.value;
    const endDate = downloadEndDate?.value;
    if (!startDate || !endDate) {
      window.AppUi.log('Informe a data inicial e a data final para baixar o período.', 'warning');
      window.AppToast?.warning('Informe início e fim do período');
      return;
    }

    btnDownloadPeriod.disabled = true;
    window.AppUi.log(`Gerando ZIP do período ${startDate} a ${endDate}...`);
    window.AppToast?.info('Gerando ZIP…');
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadPeriodZip({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate,
        endDate,
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        includeCancelled: window.AppUtils.getIncludeCancelledParam()
      });
      window.AppUi.log('ZIP do período baixado com sucesso.', 'success');
      window.AppToast?.success('ZIP do período baixado');
    } catch (err) {
      window.AppUi.log(`Erro ao baixar o período: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no ZIP do período');
    } finally {
      btnDownloadPeriod.disabled = false;
    }
  });
}
  }
};
;

/* source: js/events.js */
// Bind de Eventos Gerais e Wire-up do Frontend

function handleFileSelection(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension !== 'pfx' && extension !== 'p12') {
    window.AppUi.log('Erro: Selecione apenas arquivos .pfx ou .p12', 'error');
    window.selectedFile = null;
    fileNamePreview.innerText = '';
    return;
  }
  window.selectedFile = file;
  fileNamePreview.innerText = `Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  window.AppUi.log(`Arquivo selecionado: ${file.name}`);
}

async function loadSchedulerSettings() {
  if (!window.AppApi?.fetchSchedulerSettings || !window.AppUi?.updateSchedulerUI) return;
  try {
    const data = await window.AppApi.fetchSchedulerSettings();
    if (data.success) {
      window.AppUi.updateSchedulerUI(data.settings || {});
    }
  } catch (err) {
    window.AppUi.log(`Erro ao carregar agendamento: ${err.message}`, 'warning');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(fn, delayMs = 300) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

window.AppEvents = {
  bindEvents() {
    window.AppEventsCert.bindCertEvents();
    window.AppEventsAuth?.bind();
    window.AppEventsSync?.bind();
    window.AppEventsTable?.bind();
    window.AppEventsFilters?.bind();
    window.AppEventsNsu?.bind();
    window.AppEventsNav?.bind();
    window.AppEventsScheduler?.bind();
    window.AppInsights?.bind?.();
    window.AppDocDrawer?.bind?.();
  }
};
;

/* source: app.js */
// Estado Global do Frontend
window.isQuerying = false;
window.isPaused = false;
window.currentNsu = 0;
window.maxNsu = 0;
window.totalDownloaded = 0;
window.activeQueryRunId = 0;
window.queryLoopTimer = null;
window.transientRetryCount = 0;
window.selectedFile = null;
window.certificates = [];
window.units = [];
window.activeCertificateId = null;
window.authConfig = { authRequired: false, supabaseUrl: null, publishableKey: null };
window.authSession = null;
window._tabCache = { dashboardAt: 0, syncAt: 0, storageAt: 0, nsuAt: 0, dashboardData: null, historyData: null };

// Crawler State
window.crawlerQueue = [];
window.crawlerVisited = new Set();
window.isCrawlerActive = false;
window.currentCrawlerCnpj = '';

// bootstrap/loaders em js/boot.js
// loadAllComponents / initializeAuthenticatedApp / bootstrap definidos em boot.js

// entrypoint real fica em boot.js (DOMContentLoaded)
;

/* source: js/bootComponents.js */
function withTimeout(promise, ms, label = 'operacao') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout em ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Injeta paineis a partir do bundle embutido (sem 6 round-trips HTTP).
 * Fallback: fetch individual se bundle nao estiver disponivel.
 */
async function loadAllComponents() {
  const map = [
    'auth-screen-container',
    'sidebar-container',
    'view-dashboard-container',
    'view-download-container',
    'view-certificado-container',
    'view-regras-container'
  ];

  if (window.PANEL_HTML && typeof window.PANEL_HTML === 'object') {
    map.forEach(id => {
      const el = document.getElementById(id);
      const html = window.PANEL_HTML[id];
      if (el && html) el.outerHTML = html;
    });
    return;
  }

  // Fallback lento: 6 fetches em paralelo
  await Promise.all(map.map(async (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const file = {
      'auth-screen-container': 'components/auth-screen.html',
      'sidebar-container': 'components/sidebar.html',
      'view-dashboard-container': 'components/dashboard-panel.html',
      'view-download-container': 'components/sync-panel.html',
      'view-certificado-container': 'components/certificates-panel.html',
      'view-regras-container': 'components/rules-panel.html'
    }[id];
    try {
      const res = await fetch(file, { cache: 'force-cache' });
      if (res.ok) el.outerHTML = await res.text();
    } catch (err) {
      console.error('Falha componente', file, err);
    }
  }));
}

function showBootError(message) {
  const existing = document.getElementById('boot-error');
  if (existing) {
    const p = existing.querySelector('p');
    if (p) p.textContent = String(message || 'Erro desconhecido');
    return;
  }
  const box = document.createElement('div');
  box.id = 'boot-error';
  box.className = 'boot-error-overlay';
  const panel = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'Falha ao iniciar';
  const p = document.createElement('p');
  p.textContent = String(message || 'Erro desconhecido');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = 'Recarregar';
  btn.addEventListener('click', () => location.reload());
  panel.appendChild(h2);
  panel.appendChild(p);
  panel.appendChild(btn);
  box.appendChild(panel);
  document.body.appendChild(box);
}

function showAppShell() {
  if (window.authScreen) window.authScreen.style.display = 'none';
  if (window.appLayout) window.appLayout.style.display = 'flex';

  // Garante uma unica aba visivel no boot (evita dashboard + XMLs juntos no F5)
  const tabIds = [
    'view-dashboard-content',
    'view-download-content',
    'view-certificado-content',
    'view-regras-content'
  ];
  tabIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isDash = id === 'view-dashboard-content';
    el.classList.toggle('active-tab', isDash);
    el.classList.toggle('active', isDash);
    el.style.display = isDash ? 'block' : 'none';
  });

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navDash = document.getElementById('nav-dashboard');
  if (navDash) navDash.classList.add('active');
}

/**
 * Carrega dados iniciais em PARALELO (cert + units + dashboard).
 */
;

/* source: js/bootData.js */
async function bootDataParallel() {
  const tasks = [];

  // Cert + units (sequencia interna leve, mas paralelo ao dashboard)
  tasks.push(
    (async () => {
      try {
        await window.AppSyncController.checkCertStatus({ skipSecondary: true });
      } catch (err) {
        console.warn('checkCertStatus:', err);
      }
    })()
  );

  tasks.push(
    (async () => {
      try {
        if (window.loadSchedulerSettings) await window.loadSchedulerSettings();
      } catch (err) {
        console.warn('scheduler:', err);
      }
    })()
  );

  tasks.push(
    (async () => {
      try {
        if (window.AppSyncController?.loadDashboard) {
          await window.AppSyncController.loadDashboard();
        }
      } catch (err) {
        console.warn('dashboard:', err);
      }
    })()
  );

  if (window.AppUi?.updateProgress) window.AppUi.updateProgress(0, 0);

  const selectEnv = window.selectEnvironment;
  if (selectEnv) {
    const envText = selectEnv.value === 'producao' ? 'Produção' : 'Homologação';
    const statAmbiente = document.getElementById('stat-ambiente');
    if (statAmbiente) {
      statAmbiente.innerText = envText;
      statAmbiente.className = selectEnv.value === 'producao'
        ? 'metric-value text-primary'
        : 'metric-value text-warning';
    }
  }

  // Marca nav dashboard
  const nav = window.navDashboard || document.getElementById('nav-dashboard');
  if (nav) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    nav.classList.add('active');
  }
  const titleEl = window.pageTitle || document.getElementById('page-title');
  const subtitleEl = window.pageSubtitle || document.getElementById('page-subtitle');
  if (titleEl) titleEl.innerText = 'Dashboard';
  if (subtitleEl) subtitleEl.innerText = 'Resumo das cidades e total de XMLs persistidos';
  const crumb = document.getElementById('page-breadcrumb');
  if (crumb) crumb.textContent = 'Visão geral / Dashboard';

  await Promise.allSettled(tasks);

  // Restaura a guia compartilhável somente depois de autenticação e boot seguro.
  if (window.location.hash && window.location.hash !== '#dashboard') {
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else if (!window.location.hash) {
    window.history.replaceState({ tab: '#dashboard' }, '', '#dashboard');
  }
}

async function initializeAuthenticatedApp() {
  if (window.AppAuthGate) window.AppAuthGate.beginBoot();

  try {
    try {
      await withTimeout(window.AppApi.loadAuthConfig(), 8000, 'auth-config');
    } catch (err) {
      console.error(err);
      window.authConfig = window.authConfig || { authRequired: false };
    }

    if (!window.authConfig.authRequired) {
      if (typeof showAppShell === 'function') showAppShell();
      if (window.AppAuthGate) window.AppAuthGate.endBoot();
      await bootDataParallel();
      return;
    }

    if (window.authConfig.accessPolicyConfigured === false) {
      if (window.AppUi?.showLogin) window.AppUi.showLogin();
      if (window.AppUi?.setAuthMessage) {
        window.AppUi.setAuthMessage(
          'Acesso bloqueado com segurança: configure AUTH_ALLOWED_EMAILS/DOMAINS ou o perfil xml_nfse_role.',
          'error'
        );
      }
      return;
    }

    // Sem config de Supabase no frontend → login impossível
    if (!window.authConfig.supabaseUrl || !window.authConfig.publishableKey) {
      if (window.AppUi?.showLogin) window.AppUi.showLogin();
      if (window.AppUi?.setAuthMessage) {
        window.AppUi.setAuthMessage(
          'Configuração de auth incompleta no servidor (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).',
          'error'
        );
      }
      return;
    }

    const storedSession = window.AppUtils.loadStoredAuthSession();

    if (!storedSession?.access_token) {
      if (window.AppUi?.showLogin) {
        window.AppUi.showLogin();
      } else if (window.authScreen) {
        window.authScreen.style.display = 'grid';
      }
      return;
    }

    // 1) Define sessão e VALIDA/RENOVA antes de qualquer chamada /api/*
    window.authSession = storedSession;
    if (window.authUserEmail && storedSession.user?.email) {
      window.authUserEmail.textContent = storedSession.user.email;
    }

    let user = null;
    try {
      user = await withTimeout(
        window.AppApi.validateAuthSession(storedSession),
        15000,
        'validate-session'
      );
    } catch (err) {
      console.warn('validate-session timeout/erro:', err.message);
      // tenta refresh direto
      try {
        const refreshed = await window.AppApi.refreshAuthSession(storedSession);
        if (refreshed?.access_token) {
          user = refreshed.user || { email: storedSession.user?.email || '' };
        }
      } catch (e2) {
        console.warn('refresh fallback falhou:', e2.message);
      }
    }

    if (!user) {
      window.AppUtils.clearAuthSession();
      if (window.AppUi?.showLogin) window.AppUi.showLogin();
      if (window.AppUi?.setAuthMessage) {
        window.AppUi.setAuthMessage('Sessão expirada. Faça login novamente.', 'error');
      }
      return;
    }

    // 2) Libera o gate e só depois carrega dados autenticados
    if (window.AppAuthGate) window.AppAuthGate.endBoot();

    if (typeof showAppShell === 'function') showAppShell();
    if (window.AppUi?.showAuthenticatedApp) {
      window.AppUi.showAuthenticatedApp(user);
    } else if (window.authUserEmail && user.email) {
      window.authUserEmail.textContent = user.email;
    }

    await bootDataParallel();
  } finally {
    // Garante que o gate não fica pendurado se houver early return
    if (window.AppAuthGate) window.AppAuthGate.endBoot();
  }
}
;

/* source: js/boot.js */
async function bootstrap() {
  const t0 = performance.now();
  try {
    // Tema antes dos paineis (evita flash)
    if (window.AppUtils?.restoreTheme) window.AppUtils.restoreTheme();

    // 1) Painels do bundle (sincrono, instantaneo)
    await loadAllComponents();
    window.AppUi.initElements();
    if (window.AppUtils?.restoreTheme) window.AppUtils.restoreTheme();

    try {
      window.AppEvents.bindEvents();
    } catch (err) {
      console.error('bindEvents:', err);
    }

    // 2) Auth + dados
    await initializeAuthenticatedApp();

    console.info(`[boot] ready in ${Math.round(performance.now() - t0)}ms`);
  } catch (err) {
    console.error('bootstrap fatal:', err);
    showBootError(err.message || String(err));
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
;
