async function bootstrap() {
  const t0 = performance.now();
  try {
    // Tema antes dos paineis (evita flash)
    if (window.AppUtils?.restoreTheme) window.AppUtils.restoreTheme();

    // 1) Painels do bundle (sincrono, instantaneo)
    await loadAllComponents();
    window.AppUi.initElements();
    if (window.AppUtils?.restoreTheme) window.AppUtils.restoreTheme();

    try {
      window.AppEvents.bindEvents();
    } catch (err) {
      console.error('bindEvents:', err);
    }

    // 2) Auth + dados
    await initializeAuthenticatedApp();

    console.info(`[boot] ready in ${Math.round(performance.now() - t0)}ms`);
  } catch (err) {
    console.error('bootstrap fatal:', err);
    showBootError(err.message || String(err));
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
