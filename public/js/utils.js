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
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
    }
  },

  clearAuthSession() {
    window.authSession = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  loadStoredAuthSession() {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
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

  /**
   * Senha operacional no front (apenas UX — não é segurança real).
   * Usada em ações sensíveis de NSU: zerar e forçar.
   */
  OPS_NSU_PASSWORD: '5585',

  requireOpsPassword(actionLabel = 'esta ação') {
    const typed = window.prompt(`Digite a senha para ${actionLabel}:`);
    if (typed === null) return false; // cancelou
    if (String(typed).trim() !== this.OPS_NSU_PASSWORD) {
      window.AppUi?.log?.('Senha incorreta. Ação cancelada.', 'error');
      window.AppToast?.error?.('Senha incorreta');
      return false;
    }
    return true;
  }
};
