// eventsTable
window.AppEventsTable = {
  bind() {
if (tableBody) {
  tableBody.addEventListener('click', async (e) => {
    const detailButton = e.target.closest('button[data-action="open-detail"]');
    const xmlButton = e.target.closest('button[data-action="download-xml"]');
    const pdfButton = e.target.closest('button[data-action="download-pdf"]');
    if (!detailButton && !xmlButton && !pdfButton) return;

    try {
      if (detailButton) {
        const nsu = detailButton.dataset.nsu;
        const docs = window.AppUiTable?.documents || [];
        const doc = docs.find(d => String(d.nsu) === String(nsu))
          || docs.find(d => String(d.chave) === String(detailButton.closest('.xml-item')?.dataset?.docChave));
        if (doc && window.AppDocDrawer) window.AppDocDrawer.open(doc);
        return;
      }

      if (xmlButton) {
        await window.AppApi.downloadFromApi(`/api/download-xml/${xmlButton.dataset.token}`, 'nfse.xml');
        window.AppUi.log('XML baixado com sucesso.', 'success');
        window.AppToast?.success('XML baixado');
        window.AppInsights?.loadAuditLog?.();
        return;
      }

      const params = new URLSearchParams({
        certificateId: selectCertificate ? selectCertificate.value : (window.activeCertificateId || ''),
        environment: selectEnvironment ? selectEnvironment.value : 'producao'
      });
      await window.AppApi.downloadFromApi(`/api/download-pdf/${encodeURIComponent(pdfButton.dataset.chave)}?${params.toString()}`, 'danfse.pdf');
      window.AppUi.log('PDF baixado com sucesso.', 'success');
      window.AppToast?.success('PDF baixado');
      window.AppInsights?.loadAuditLog?.();
    } catch (err) {
      window.AppUi.log(`Erro ao baixar documento: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no download');
    }
  });
}

if (btnClearDownloads) btnClearDownloads.addEventListener('click', async () => {
  if (!confirm('Limpar apenas arquivos temporários? Os XMLs permanentes no banco de dados serão preservados.')) return;

  try {
    const data = await window.AppApi.clearDownloads();
    if (data.success) {
      window.AppUi.log(`Temporários limpos. ${data.count} XML(s) removido(s); banco de dados preservado.`);
      window.totalDownloaded = 0;
      if (btnDownloadZip) btnDownloadZip.disabled = true;
      window.AppUi.updateProgress(0, 0);
      statNsuAtual.innerText = '0';
      statNsuMax.innerText = '0';
      alertRateLimit.style.display = 'none';
      alertSyncSuccess.style.display = 'none';
      window.AppSyncController.loadPersistedHistory();
      window.AppSyncController.loadStorageSummary();
    }
  } catch (err) {
    window.AppUi.log(`Erro ao limpar pasta: ${err.message}`, 'error');
  }
});

if (btnExportExcel) {
  btnExportExcel.addEventListener('click', async () => {
    window.AppUi.log('Gerando Excel com os XMLs persistidos da tabela atual...');
    btnExportExcel.disabled = true;
    if (btnDownloadZip) btnDownloadZip.disabled = true;
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadExcel({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate: downloadStartDate?.value || null,
        endDate: downloadEndDate?.value || null,
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        cancelledMode: window.AppUtils.getCancelledMode(),
        includeCancelled: window.AppUtils.getIncludeCancelledParam(),
        onlyCancelled: window.AppUtils.getOnlyCancelledParam()
      });
      window.AppUi.log('Excel da tabela baixado com sucesso.', 'success');
      window.AppToast?.success('Excel exportado');
    } catch (err) {
      window.AppUi.log(`Erro ao baixar Excel: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no Excel');
    } finally {
      const empty = !window.AppUiTable?.documents?.length;
      btnExportExcel.disabled = empty;
      if (btnDownloadZip) btnDownloadZip.disabled = empty;
    }
  });
}

if (btnExportIntegrity) {
  btnExportIntegrity.addEventListener('click', async () => {
    btnExportIntegrity.disabled = true;
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadIntegrityManifest({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate: downloadStartDate?.value || '',
        endDate: downloadEndDate?.value || '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        cancelledMode: window.AppUtils.getCancelledMode(),
        includeCancelled: window.AppUtils.getIncludeCancelledParam(),
        onlyCancelled: window.AppUtils.getOnlyCancelledParam()
      });
      window.AppUi.log('Manifesto de integridade exportado com SHA-256.', 'success');
      window.AppToast?.success('Manifesto de integridade exportado');
    } catch (error) {
      window.AppUi.log(`Erro no manifesto: ${error.message}`, 'error');
      window.AppToast?.error(error.message || 'Falha no manifesto');
    } finally {
      btnExportIntegrity.disabled = !window.AppUiTable?.documents?.length;
    }
  });
}

if (btnDownloadZip) {
  btnDownloadZip.addEventListener('click', async () => {
    window.AppUi.log('Gerando ZIP com os XMLs persistidos da tabela atual...');
    btnDownloadZip.disabled = true;
    if (btnExportExcel) btnExportExcel.disabled = true;
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadPeriodZip({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate: downloadStartDate?.value || null,
        endDate: downloadEndDate?.value || null,
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        cancelledMode: window.AppUtils.getCancelledMode(),
        includeCancelled: window.AppUtils.getIncludeCancelledParam(),
        onlyCancelled: window.AppUtils.getOnlyCancelledParam()
      });
      window.AppUi.log('ZIP da tabela baixado com sucesso.', 'success');
      window.AppToast?.success('ZIP baixado');
    } catch (err) {
      window.AppUi.log(`Erro ao baixar ZIP: ${err.message}`, 'error');
      window.AppToast?.error(err.message || 'Falha no ZIP');
    } finally {
      const empty = !window.AppUiTable?.documents?.length;
      btnDownloadZip.disabled = empty;
      if (btnExportExcel) btnExportExcel.disabled = empty;
    }
  });
}
  }
};
