// Certificados Upload e Ações de Gerenciamento Event Bindings

window.AppEventsCert = {
  enterRenewMode(certificateId) {
    const cert = (window.certificates || []).find(item => item.id === certificateId);
    if (!cert) {
      window.AppUi?.log?.('Certificado não encontrado para renovar.', 'error');
      return;
    }

    window.renewCertificateId = certificateId;
    if (window.renewCertificateIdInput) window.renewCertificateIdInput.value = certificateId;

    if (window.certFormEyebrow) window.certFormEyebrow.textContent = 'Renovação';
    if (window.certFormTitle) window.certFormTitle.textContent = 'Renovar certificado A1';
    if (window.certRenewHint) window.certRenewHint.style.display = 'block';
    if (window.btnCancelRenewCert) window.btnCancelRenewCert.style.display = '';
    if (window.btnSaveCertLabel) window.btnSaveCertLabel.textContent = 'Renovar e validar (mesmo vínculo)';
    if (window.certDropText) {
      window.certDropText.innerHTML = 'Envie o <strong>A1 novo</strong> (.pfx/.p12) da <strong>mesma empresa</strong>';
    }

    if (window.certCnpjInput) {
      window.certCnpjInput.value = cert.cnpj || '';
      window.certCnpjInput.readOnly = true;
      window.certCnpjInput.title = 'CNPJ travado na renovação — deve ser o mesmo do cadastro';
    }

    if (window.formCert) window.formCert.reset();
    // reset limpa hidden e cnpj — reaplicar
    if (window.renewCertificateIdInput) window.renewCertificateIdInput.value = certificateId;
    if (window.certCnpjInput) {
      window.certCnpjInput.value = cert.cnpj || '';
      window.certCnpjInput.readOnly = true;
    }
    window.selectedFile = null;
    if (window.fileNamePreview) window.fileNamePreview.innerText = '';
    if (window.passphraseInput) window.passphraseInput.value = '';

    window.certUploadState?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    window.AppUi?.log?.(
      `Modo renovação: vínculo ${cert.cnpj || certificateId}. XMLs e NSU serão preservados.`,
      'warning'
    );
    window.AppToast?.info?.('Envie o A1 renovado da mesma empresa');
  },

  exitRenewMode() {
    window.renewCertificateId = null;
    if (window.renewCertificateIdInput) window.renewCertificateIdInput.value = '';
    if (window.certFormEyebrow) window.certFormEyebrow.textContent = 'Novo arquivo';
    if (window.certFormTitle) window.certFormTitle.textContent = 'Adicionar certificado A1';
    if (window.certRenewHint) window.certRenewHint.style.display = 'none';
    if (window.btnCancelRenewCert) window.btnCancelRenewCert.style.display = 'none';
    if (window.btnSaveCertLabel) window.btnSaveCertLabel.textContent = 'Salvar e validar certificado';
    if (window.certDropText) {
      window.certDropText.innerHTML = 'Arraste seu certificado <strong>.pfx</strong> ou <strong>.p12</strong> aqui ou clique para selecionar';
    }
    if (window.certCnpjInput) {
      window.certCnpjInput.readOnly = false;
      window.certCnpjInput.title = '';
      window.certCnpjInput.value = '';
    }
    window.selectedFile = null;
    if (window.fileNamePreview) window.fileNamePreview.innerText = '';
    if (window.passphraseInput) window.passphraseInput.value = '';
    if (window.fileInput) window.fileInput.value = '';
  },

  bindCertEvents() {
    // Painel de certificados pode ainda nao existir se o HTML secundario nao carregou
    if (!dropZone || !fileInput || !formCert) {
      return;
    }

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleFileSelection(e.target.files[0]);
    });

    formCert.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.selectedFile) {
        window.AppUi.log('Erro: Por favor, selecione um arquivo de certificado.', 'error');
        alert('Por favor, selecione o arquivo do certificado digital.');
        return;
      }

      const renewId = window.renewCertificateId
        || (window.renewCertificateIdInput && window.renewCertificateIdInput.value)
        || '';
      const isRenew = Boolean(renewId);

      const formData = new FormData();
      formData.append('pfx', window.selectedFile);
      formData.append('passphrase', passphraseInput ? passphraseInput.value : '');
      formData.append('cnpj', certCnpjInput ? certCnpjInput.value : '');
      if (isRenew) formData.append('certificateId', renewId);

      window.AppUi.log(isRenew
        ? 'Renovando certificado (mesmo vínculo / CNPJ)...'
        : 'Enviando certificado para validação local...');
      const saveBtn = document.getElementById('btn-save-cert-view');
      if (saveBtn) saveBtn.disabled = true;

      try {
        const data = isRenew
          ? await window.AppApi.renewCertificate(formData)
          : await window.AppApi.uploadCertificate(formData);
        if (data.success) {
          window.AppUi.log(
            data.message || (isRenew
              ? 'Certificado renovado. XMLs e NSU preservados.'
              : 'Certificado carregado e validado com sucesso!'),
            'success'
          );
          window.AppToast?.success?.(isRenew ? 'Certificado renovado' : 'Certificado salvo');
          this.exitRenewMode();
          formCert.reset();
          window.selectedFile = null;
          if (fileNamePreview) fileNamePreview.innerText = '';
          window.AppSyncController.checkCertStatus();
        } else {
          window.AppUi.log(`Erro na validação: ${data.error}`, 'error');
          alert(`Falha no certificado: ${data.error}`);
        }
      } catch (err) {
        window.AppUi.log(`Erro de rede ao salvar certificado: ${err.message}`, 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    if (window.btnCancelRenewCert) {
      window.btnCancelRenewCert.addEventListener('click', () => {
        this.exitRenewMode();
        window.AppUi?.log?.('Renovação cancelada.');
      });
    }

    if (window.btnRenewActiveCert) {
      window.btnRenewActiveCert.addEventListener('click', () => {
        const id = window.activeCertificateId;
        if (!id) {
          window.AppUi?.log?.('Nenhum certificado ativo para renovar.', 'warning');
          return;
        }
        this.enterRenewMode(id);
      });
    }

    if (certList) {
      certList.addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const certificateId = button.dataset.id;
        if (button.dataset.action === 'select-cert') {
          await window.AppSyncController.selectCertificateById(certificateId);
          return;
        }

        if (button.dataset.action === 'renew-cert') {
          this.enterRenewMode(certificateId);
          return;
        }

        if (button.dataset.action === 'rename-cert') {
          const cert = window.certificates.find(item => item.id === certificateId);
          const currentName = cert?.filename || cert?.originalName || '';
          const nextName = prompt('Novo nome do certificado:', currentName);
          if (nextName === null) return;

          const data = await window.AppApi.renameCertificate(certificateId, nextName.trim());
          if (data.success) {
            window.AppUi.log('Certificado renomeado.', 'success');
            window.AppSyncController.checkCertStatus();
          } else {
            window.AppUi.log(`Erro ao renomear: ${data.error}`, 'error');
          }
          return;
        }

        if (button.dataset.action === 'remove-cert') {
          const cert = window.certificates.find(item => item.id === certificateId);
          if (!confirm(`Deseja remover o certificado "${cert?.filename || certificateId}"?\n\nIsso apaga o histórico de XMLs e NSU vinculados a este certificado.`)) return;

          const data = await window.AppApi.removeCertificate(certificateId);
          if (data.success) {
            window.AppUi.log('Certificado removido.');
            if (window.renewCertificateId === certificateId) this.exitRenewMode();
            window.AppSyncController.checkCertStatus();
            window.AppSyncController.stopQuerying();
          } else {
            window.AppUi.log(`Erro ao remover: ${data.error}`, 'error');
          }
        }
      });
    }

    if (btnReplaceCert) {
      btnReplaceCert.addEventListener('click', async () => {
        if (!window.activeCertificateId || !confirm('Deseja realmente remover o certificado ativo?\n\nIsso apaga o histórico de XMLs e NSU deste vínculo.')) return;
        try {
          const data = await window.AppApi.removeCertificate(window.activeCertificateId);
          if (data.success) {
            window.AppUi.log('Certificado ativo removido.');
            if (window.renewCertificateId === window.activeCertificateId) this.exitRenewMode();
            window.AppSyncController.checkCertStatus();
            window.AppSyncController.stopQuerying();
          }
        } catch (err) {
          window.AppUi.log(`Erro ao remover: ${err.message}`, 'error');
        }
      });
    }

    if (btnDiagnoseCert) {
      btnDiagnoseCert.addEventListener('click', async () => {
        const certificateId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
        const env = selectEnvironment ? selectEnvironment.value : 'producao';
        if (!certificateId) {
          window.AppUi.log('Nenhum certificado para diagnosticar.', 'warning');
          return;
        }

        btnDiagnoseCert.disabled = true;
        window.AppUi.log('Diagnosticando certificado e ambiente...');

        try {
          const data = await window.AppApi.diagnoseCertificate(certificateId, env);
          window.AppUi.log(`PFX: descriptografado=${data.success ? 'sim' : 'não'} | Titular=${data.pfx?.subject || 'N/A'}`);
          if (data.success) {
            window.AppUi.log(`PFX Válido: CNPJ=${data.pfx?.cnpjExtracted} | Validade=${data.pfx?.validUntil}`, 'success');
          } else {
            window.AppUi.log(`Diagnóstico falhou: ${data.error || 'erro desconhecido'}`, 'error');
          }
        } catch (err) {
          window.AppUi.log(`Erro de diagnóstico: ${err.message}`, 'error');
        } finally {
          btnDiagnoseCert.disabled = false;
        }
      });
    }
  }
};
