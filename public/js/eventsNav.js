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
