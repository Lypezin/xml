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
    if (screen) screen.inert = true;
    if (layout) layout.style.display = 'flex';
    const skipLink = document.getElementById('skip-link');
    if (skipLink) skipLink.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Sessão ativa';
  },

  showLogin() {
    const screen = window.authScreen || document.getElementById('auth-screen');
    const layout = window.appLayout || document.getElementById('app-layout');
    if (layout) layout.style.display = 'none';
    const skipLink = document.getElementById('skip-link');
    if (skipLink) skipLink.hidden = true;
    // auth-screen.html vem com display:none inline — forca grid
    if (screen) {
      screen.inert = false;
      screen.style.setProperty('display', 'grid', 'important');
    }
  }
});
