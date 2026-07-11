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
