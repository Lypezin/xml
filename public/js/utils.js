// Utilitários de Sessão e Formatadores
const AUTH_STORAGE_KEY = 'xml_nfse_auth_session';

window.AppUtils = {
  saveAuthSession(session) {
    window.authSession = session;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  },

  clearAuthSession() {
    window.authSession = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  loadStoredAuthSession() {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
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
   * Label do checkbox: "Ocultar canceladas"
   * checked => NAO incluir canceladas na API (includeCancelled=false)
   * unchecked => incluir canceladas (includeCancelled=true)
   */
  getIncludeCancelledParam() {
    const checked = Boolean(window.includeCancelled?.checked);
    // "Ocultar" marcado => includeCancelled false
    return checked ? 'false' : 'true';
  }
};
