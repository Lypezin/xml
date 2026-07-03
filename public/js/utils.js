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
    return String(value).split('T')[0];
  },

  applyTheme(theme) {
    const themeText = document.getElementById('theme-text');
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    
    if (theme === 'light') {
      document.body.classList.add('light-mode');
      if (themeText) themeText.innerText = 'Modo Escuro';
      if (sunIcon) sunIcon.style.display = 'none';
      if (moonIcon) moonIcon.style.display = 'block';
    } else {
      document.body.classList.remove('light-mode');
      if (themeText) themeText.innerText = 'Modo Claro';
      if (sunIcon) sunIcon.style.display = 'block';
      if (moonIcon) moonIcon.style.display = 'none';
    }
  }
};
