// eventsNav
window.AppEventsNav = {
  isMobileSidebar() {
    return Boolean(window.matchMedia?.('(max-width: 900px)').matches);
  },

  syncSidebarAccessibility(open) {
    const layout = window.appLayout || document.getElementById('app-layout');
    const btn = window.btnSidebarToggle || document.getElementById('btn-sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('main-content');
    const mobile = this.isMobileSidebar();
    const isOpen = mobile && Boolean(open);

    if (layout) layout.classList.toggle('sidebar-open', isOpen);
    document.body.classList.toggle('sidebar-open-lock', isOpen);
    if (btn) {
      btn.setAttribute('aria-expanded', String(isOpen));
      btn.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
    }
    if (sidebar) {
      sidebar.inert = mobile && !isOpen;
      sidebar.setAttribute('aria-hidden', mobile && !isOpen ? 'true' : 'false');
      if (isOpen) {
        sidebar.setAttribute('role', 'dialog');
        sidebar.setAttribute('aria-modal', 'true');
        sidebar.setAttribute('aria-label', 'Menu principal');
      } else {
        sidebar.removeAttribute('role');
        sidebar.removeAttribute('aria-modal');
        sidebar.removeAttribute('aria-label');
      }
    }
    if (main) {
      main.inert = isOpen;
      if (isOpen) main.setAttribute('aria-hidden', 'true');
      else main.removeAttribute('aria-hidden');
    }
  },

  closeSidebar(restoreFocus = false) {
    this.syncSidebarAccessibility(false);
    if (restoreFocus && this.isMobileSidebar()) {
      requestAnimationFrame(() => {
        (window.btnSidebarToggle || document.getElementById('btn-sidebar-toggle'))?.focus();
      });
    }
  },

  openSidebar() {
    this.syncSidebarAccessibility(true);
    requestAnimationFrame(() => {
      const sidebar = document.getElementById('sidebar');
      (sidebar?.querySelector('.nav-item.active') || sidebar?.querySelector('.nav-item'))?.focus();
    });
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
      this.closeSidebar(false);
      if (updateHistory) {
        requestAnimationFrame(() => {
          (window.pageTitle || document.getElementById('page-title'))?.focus({ preventScroll: true });
        });
      }
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
      backdrop.addEventListener('click', () => this.closeSidebar(true));
    }
    window.addEventListener('keydown', (e) => {
      const layout = window.appLayout || document.getElementById('app-layout');
      if (!this.isMobileSidebar() || !layout?.classList.contains('sidebar-open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSidebar(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const sidebar = document.getElementById('sidebar');
      const focusable = Array.from(sidebar?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((el) => !el.inert);
      if (!focusable.length) return;
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
    window.addEventListener('popstate', () => {
      (routes[window.location.hash] || routes['#dashboard'])();
    });

    this.syncSidebarAccessibility(false);
    window.addEventListener('resize', () => {
      const layout = window.appLayout || document.getElementById('app-layout');
      this.syncSidebarAccessibility(Boolean(layout?.classList.contains('sidebar-open')));
    }, { passive: true });
  }
};
