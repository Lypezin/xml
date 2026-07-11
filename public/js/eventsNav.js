// eventsNav
window.AppEventsNav = {
  bind() {
if (navDashboard) {
  navDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    window.AppUi.switchTab(navDashboard, viewDashboardContent, 'Dashboard', 'Resumo de cidades e total de XMLs persistidos');
  });
  navDashboard.addEventListener('mouseenter', () => window.AppUi.prefetchTab?.('view-dashboard-content'), { passive: true });
}
if (navDownload) {
  navDownload.addEventListener('click', (e) => {
    e.preventDefault();
    window.AppUi.switchTab(navDownload, viewDownloadContent, 'XMLs por Unidade', 'XMLs NFS-e persistidos por certificado e unidade');
  });
  navDownload.addEventListener('mouseenter', () => window.AppUi.prefetchTab?.('view-download-content'), { passive: true });
}
if (navCertificado) {
  navCertificado.addEventListener('click', (e) => {
    e.preventDefault();
    window.AppUi.switchTab(navCertificado, viewCertificadoContent, 'Certificados', 'Gerencie certificados A1 e nomes internos');
  });
}
if (navRegras) {
  navRegras.addEventListener('click', (e) => {
    e.preventDefault();
    window.AppUi.switchTab(navRegras, viewRegrasContent, 'Regras ADN', 'Limites de consulta e boas praticas da NFS-e Nacional');
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
  }
};
