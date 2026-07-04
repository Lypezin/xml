// Certificados Upload e Ações de Gerenciamento Event Bindings

window.AppEventsCert = {
  bindCertEvents() {
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

      const formData = new FormData();
      formData.append('pfx', window.selectedFile);
      formData.append('passphrase', passphraseInput.value);
      formData.append('cnpj', certCnpjInput.value);

      window.AppUi.log('Enviando certificado para validação local...');
      document.getElementById('btn-save-cert-view').disabled = true;

      try {
        const data = await window.AppApi.uploadCertificate(formData);
        if (data.success) {
          window.AppUi.log('Certificado carregado e validado com sucesso!', 'success');
          window.AppSyncController.checkCertStatus();
          formCert.reset();
          window.selectedFile = null;
          fileNamePreview.innerText = '';
        } else {
          window.AppUi.log(`Erro na validação: ${data.error}`, 'error');
          alert(`Falha no certificado: ${data.error}`);
        }
      } catch (err) {
        window.AppUi.log(`Erro de rede ao salvar certificado: ${err.message}`, 'error');
      } finally {
        document.getElementById('btn-save-cert-view').disabled = false;
      }
    });

    if (certList) {
      certList.addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const certificateId = button.dataset.id;
        if (button.dataset.action === 'select-cert') {
          await window.AppSyncController.selectCertificateById(certificateId);
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
          if (!confirm(`Deseja remover o certificado "${cert?.filename || certificateId}"?`)) return;

          const data = await window.AppApi.removeCertificate(certificateId);
          if (data.success) {
            window.AppUi.log('Certificado removido.');
            window.AppSyncController.checkCertStatus();
            window.AppSyncController.stopQuerying();
          } else {
            window.AppUi.log(`Erro ao remover: ${data.error}`, 'error');
          }
        }
      });
    }

    btnReplaceCert.addEventListener('click', async () => {
      if (!window.activeCertificateId || !confirm('Deseja realmente remover o certificado ativo?')) return;
      try {
        const data = await window.AppApi.removeCertificate(window.activeCertificateId);
        if (data.success) {
          window.AppUi.log('Certificado ativo removido.');
          window.AppSyncController.checkCertStatus();
          window.AppSyncController.stopQuerying();
        }
      } catch (err) {
        window.AppUi.log(`Erro ao remover: ${err.message}`, 'error');
      }
    });

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
          window.AppUi.log(`PFX: descriptografado=${data.success ? 'sim' : 'nao'} | Titular=${data.pfx?.subject || 'N/A'}`);
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
