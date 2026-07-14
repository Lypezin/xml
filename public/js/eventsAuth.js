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
      if (!window.authSession?.access_token) {
        throw new Error('Login ok, mas a sessão não foi salva. Tente novamente.');
      }
      if (window.AppAuthGate) window.AppAuthGate.endBoot();
      window.AppUi.setAuthMessage('Acesso liberado.', 'success');
      window.AppUi.showAuthenticatedApp(user);
      if (window.AppDataCache) window.AppDataCache.invalidateAll();
      // Pinta primeiro a rota solicitada e só então carrega seus dados.
      const initialRoute = activateInitialRoute();
      await bootDataParallel(initialRoute);
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
    window.AppDataCache?.invalidateAll?.();
    window._tabCache = {};
    window._lastHistoryCertId = '';
    // Um reload curto limpa também cards, certificados e métricas já renderizados,
    // evitando o flash de dados da sessão anterior no próximo login.
    window.location.reload();
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
