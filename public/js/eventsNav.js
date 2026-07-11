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
    const go = (nav, view, title, subtitle) => {
      window.AppUi.switchTab(nav, view, title, subtitle);
      this.closeSidebar();
    };

    if (navDashboard) {
      navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        go(navDashboard, viewDashboardContent, 'Dashboard', 'Resumo de cidades e total de XMLs persistidos');
      });
      navDashboard.addEventListener('mouseenter', () => window.AppUi.prefetchTab?.('view-dashboard-content'), { passive: true });
    }
    if (navDownload) {
      navDownload.addEventListener('click', (e) => {
        e.preventDefault();
        go(navDownload, viewDownloadContent, 'XMLs por Unidade', 'XMLs NFS-e persistidos por certificado e unidade');
      });
      navDownload.addEventListener('mouseenter', () => window.AppUi.prefetchTab?.('view-download-content'), { passive: true });
    }
    if (navCertificado) {
      navCertificado.addEventListener('click', (e) => {
        e.preventDefault();
        go(navCertificado, viewCertificadoContent, 'Certificados', 'Gerencie certificados A1 e nomes internos');
      });
    }
    if (navRegras) {
      navRegras.addEventListener('click', (e) => {
        e.preventDefault();
        go(navRegras, viewRegrasContent, 'Regras ADN', 'Limites de consulta e boas praticas da NFS-e Nacional');
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
  }
};
