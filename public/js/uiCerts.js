Object.assign(window.AppUi = window.AppUi || {}, {
renderCertificateSelector() {
    if (!selectCertificate) return;

    selectCertificate.innerHTML = '';
    if (window.certificates.length === 0) {
      selectCertificate.innerHTML = '<option value="">Nenhum certificado cadastrado</option>';
      return;
    }

    window.certificates.forEach(cert => {
      const option = document.createElement('option');
      option.value = cert.id;
      option.textContent = `${cert.cnpj || 'CNPJ não informado'} - ${cert.filename}`;
      option.selected = cert.id === window.activeCertificateId;
      selectCertificate.appendChild(option);
    });
  },

  renderCertificateList() {
    if (!certList) return;

    if (certCountLabel) {
      certCountLabel.innerText = `${window.certificates.length} certificado${window.certificates.length === 1 ? '' : 's'}`;
    }

    if (window.certificates.length === 0) {
      certList.innerHTML = '<div class="empty-cert-list">Nenhum certificado cadastrado.</div>';
      return;
    }

    certList.innerHTML = '';
    const esc = window.AppUtils.escapeHtml;
    window.certificates.forEach(cert => {
      const item = document.createElement('div');
      item.className = `cert-list-item ${cert.id === window.activeCertificateId ? 'active' : ''}`;
      const safeId = esc(cert.id);
      item.innerHTML = `
        <div class="cert-list-main">
          <strong>${esc(cert.filename)}</strong>
          <span>CNPJ: ${esc(cert.cnpj || 'Não informado')}</span>
        </div>
        <div class="cert-list-actions">
          <button class="btn btn-secondary btn-sm" data-action="select-cert" data-id="${safeId}" ${cert.id === window.activeCertificateId ? 'disabled' : ''}>Usar</button>
          <button class="btn btn-primary btn-sm" data-action="renew-cert" data-id="${safeId}" title="Troca o PFX mantendo CNPJ, XMLs e NSU">Renovar</button>
          <button class="btn btn-secondary btn-sm" data-action="rename-cert" data-id="${safeId}">Renomear</button>
          <button class="btn btn-secondary btn-sm text-danger" data-action="remove-cert" data-id="${safeId}">Remover</button>
        </div>
      `;
      certList.appendChild(item);
    });
  }
});
