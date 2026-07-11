// Status de certificado
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
async checkCertStatus(options = {}) {
    const skipSecondary = Boolean(options.skipSecondary);
    try {
      // Cert + units em paralelo
      const [data, unitsResult] = await Promise.all([
        window.AppApi.fetchCertStatus(),
        window.AppApi.listUnits().catch(() => ({ success: false, units: [] }))
      ]);

      const indicator = document.getElementById('navbar-cert-indicator');
      const txt = document.getElementById('navbar-cert-text');
      window.certificates = data.certificates || [];
      window.activeCertificateId = data.activeCertificateId || null;

      if (unitsResult?.success) {
        window.units = unitsResult.units || [];
        this.renderUnitSelector();
      } else {
        await this.loadUnits();
      }

      window.AppUi.renderCertificateSelector();
      window.AppUi.renderCertificateList();

      if (data.active) {
        if (certUploadState) certUploadState.classList.remove('active');
        if (certActiveState) certActiveState.classList.add('active');
        if (activeCertName) activeCertName.innerText = `Arquivo: ${data.filename}`;
        if (activeCertCnpj) activeCertCnpj.innerText = `CNPJ: ${data.cnpj || 'Não informado'}`;
        if (btnStart) btnStart.disabled = false;
        if (window.btnResetNsu) window.btnResetNsu.disabled = false;
        if (!skipSecondary) window.AppUi.log(`Certificado ativo CNPJ: ${data.cnpj}`);
        if (indicator && txt) {
          indicator.className = 'status-indicator online';
          txt.innerText = `Certificado ativo: ${data.cnpj}`;
        }
        if (!skipSecondary) {
          const syncVisible = window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none'
            && window.viewDownloadContent.classList.contains('active-tab');
          if (syncVisible) {
            await Promise.allSettled([
              this.loadPersistedHistory(1, { quiet: true }),
              this.loadSavedStartNsu(),
              this.loadStorageSummary()
            ]);
          }
        }
      } else {
        if (certUploadState) certUploadState.classList.add('active');
        if (certActiveState) certActiveState.classList.remove('active');
        if (btnStart) btnStart.disabled = true;
        if (window.btnResetNsu) window.btnResetNsu.disabled = true;
        if (!skipSecondary) window.AppUi.log('Nenhum certificado carregado.', 'warning');
        if (indicator && txt) {
          indicator.className = 'status-indicator offline';
          txt.innerText = `Nenhum certificado carregado`;
        }
      }
    } catch (err) {
      console.error('Erro ao verificar status:', err);
    }
  },

  async selectCertificateById(certificateId) {
    if (!certificateId) return;
    try {
      const prevId = window.activeCertificateId
        || (window.selectCertificate && window.selectCertificate.value)
        || '';
      const data = await window.AppApi.selectCertificate(certificateId);
      if (!data.success) {
        window.AppUi.log(`Erro ao selecionar: ${data.error}`, 'error');
        return;
      }
      window.activeCertificateId = data.activeCertificateId || certificateId;
      if (String(prevId) !== String(window.activeCertificateId)) {
        if (window.AppUiTable?.setDocuments) {
          window.AppUiTable.setDocuments([], 0, 1, 0);
        }
        if (window.unitFilter) window.unitFilter.value = '';
      }
      window.AppUi.log('Certificado selecionado.', 'success');
      await this.checkCertStatus();
    } catch (err) {
      window.AppUi.log(`Erro ao selecionar: ${err.message}`, 'error');
    }
  }
});
