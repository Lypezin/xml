// eventsAuth
window.AppEventsAuth = {
  bind() {
if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    window.AppUi.setAuthMessage('Entrando...');
    authSubmit.disabled = true;

    try {
      const user = await window.AppApi.loginWithPassword(authEmail.value.trim(), authPassword.value);
      window.AppUi.setAuthMessage('Acesso liberado.', 'success');
      window.AppUi.showAuthenticatedApp(user);
      if (window.AppDataCache) window.AppDataCache.invalidateAll();
      // Paralelo pos-login
      Promise.allSettled([
        window.AppSyncController.checkCertStatus({ skipSecondary: true }),
        window.AppSyncController.loadDashboard(),
        loadSchedulerSettings()
      ]);
      window.AppUi.updateProgress(0, 0);
      if (selectEnvironment) selectEnvironment.dispatchEvent(new Event('change'));
    } catch (err) {
      window.AppUtils.clearAuthSession();
      window.AppUi.setAuthMessage(err.message, 'error');
    } finally {
      authSubmit.disabled = false;
    }
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    window.AppUtils.clearAuthSession();
    window.AppSyncController.stopQuerying();
    window.AppUi.showLogin();
  });
}

if (selectCertificate) {
  selectCertificate.addEventListener('change', async () => {
    await window.AppSyncController.selectCertificateById(selectCertificate.value);
    if (window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none') {
      window.AppSyncController.loadPersistedHistory();
    }
  });
}

  }
};
