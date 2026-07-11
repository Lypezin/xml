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

    if (window.consoleLog) {
      consoleLog.appendChild(line);
      // Limita linhas antigas para não explodir a DOM
      while (consoleLog.children.length > 400) {
        consoleLog.removeChild(consoleLog.firstChild);
      }
      consoleLog.scrollTop = consoleLog.scrollHeight;
      this._updateLogHint();
      // Auto-abre em erro/warning relevante
      if ((type === 'error' || type === 'warning') && window.consoleLogDrawer && !consoleLogDrawer.open) {
        consoleLogDrawer.open = true;
      }
    }
  },

  _updateLogHint() {
    const hint = window.consoleLogHint || document.getElementById('console-log-hint');
    const log = window.consoleLog || document.getElementById('console-log');
    if (!hint || !log) return;
    const n = log.children.length;
    const drawer = window.consoleLogDrawer || document.getElementById('console-log-drawer');
    const open = drawer && drawer.open;
    hint.textContent = open
      ? `${n} linha${n === 1 ? '' : 's'}`
      : `${n} linha${n === 1 ? '' : 's'} · clique para expandir`;
  },

  logNationalApiContext(nationalApi) {
    if (!nationalApi) return;
    this.log(`ADN: HTTP=${nationalApi.httpStatus || 'N/A'} | StatusProcessamento=${nationalApi.statusProcessamento || 'N/A'} | ambiente=${nationalApi.environment || 'N/A'} | cnpjConsulta=${nationalApi.cnpjConsulta || 'N/A'}`, 'warning');
    if (nationalApi.endpoint) {
      this.log(`ADN endpoint: ${nationalApi.endpoint}`, 'warning');
    }
    if (Array.isArray(nationalApi.errors) && nationalApi.errors.length > 0) {
      nationalApi.errors.forEach(err => {
        this.log(`ADN erro ${err.code || 'sem codigo'}: ${err.description || 'sem descricao'}`, 'error');
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
