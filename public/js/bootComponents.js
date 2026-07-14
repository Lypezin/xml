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
    const auth = document.getElementById('auth-screen');
    if (auth) auth.inert = true;
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
  const auth = document.getElementById('auth-screen');
  if (auth) auth.inert = true;
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
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'boot-error-title');
  box.setAttribute('aria-describedby', 'boot-error-message');
  const panel = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.id = 'boot-error-title';
  h2.textContent = 'Falha ao iniciar';
  const p = document.createElement('p');
  p.id = 'boot-error-message';
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
  document.getElementById('boot-splash')?.remove();
  Array.from(document.body.children).forEach((child) => {
    if (child !== box && child instanceof HTMLElement) child.inert = true;
  });
  document.body.appendChild(box);
  requestAnimationFrame(() => btn.focus());
}

function showAppShell() {
  if (window.authScreen) window.authScreen.style.display = 'none';
  if (window.authScreen) window.authScreen.inert = true;
  if (window.appLayout) window.appLayout.style.display = 'flex';
  const skipLink = document.getElementById('skip-link');
  if (skipLink) skipLink.hidden = false;

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
    if (isDash) el.style.removeProperty('display');
    else el.style.display = 'none';
  });

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navDash = document.getElementById('nav-dashboard');
  if (navDash) navDash.classList.add('active');
}

/**
 * Carrega dados iniciais em PARALELO (cert + units + dashboard).
 */
