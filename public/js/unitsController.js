// Unidades e storage
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
}, {
  async loadStorageSummary() {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!window.AppApi?.fetchStorageSummary || !statStoragePayloads || !statStorageSize) return;

    try {
      const data = await window.AppApi.fetchStorageSummary({
        certificateId: certId || '',
        environment: selectEnvironment ? selectEnvironment.value : ''
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar armazenamento.');

      const summary = data.summary || {};
      statStoragePayloads.innerText = window.AppUtils.formatInteger(summary.totalPayloads || 0);
      statStorageSize.innerText = `${window.AppUtils.formatBytes(summary.totalBytes || 0)} permanentes`;
      if (Number(summary.expiringPayloads || 0) > 0) {
        statStorageSize.innerText += ` | ${window.AppUtils.formatInteger(summary.expiringPayloads)} com expiracao`;
      }
    } catch (err) {
      statStorageSize.innerText = 'Falha ao consultar';
      window.AppUi.log(`Erro ao carregar armazenamento: ${err.message}`, 'warning');
    }
  },

  getSelectedUnitFilter() {
    const selectedOption = unitFilter?.selectedOptions?.[0];
    return {
      partyCnpj: unitFilter ? unitFilter.value.trim() : '',
      partyRole: unitPartyRole ? unitPartyRole.value : 'tomador',
      unitId: selectedOption?.dataset?.id || ''
    };
  },

  renderUnitSelector() {
    if (!unitFilter) return;
    const currentValue = unitFilter.value;
    unitFilter.innerHTML = '<option value="">CNPJ do certificado ativo</option>';
    (window.units || []).forEach(unit => {
      const option = document.createElement('option');
      option.value = unit.cnpj || '';
      option.dataset.id = unit.id || '';
      option.dataset.name = unit.name || '';
      option.dataset.city = unit.city || '';
      option.dataset.state = unit.state || '';
      const location = [unit.city, unit.state].filter(Boolean).join('/');
      option.textContent = `${unit.name} - ${unit.cnpj}${location ? ` (${location})` : ''}`;
      unitFilter.appendChild(option);
    });
    unitFilter.value = currentValue;
    if (currentValue && unitFilter.value !== currentValue) unitFilter.value = '';
  },

  fillUnitFormFromSelection() {
    const option = unitFilter?.selectedOptions?.[0];
    if (!option || !unitFilter.value) {
      if (unitName) unitName.value = '';
      if (unitCnpj) unitCnpj.value = '';
      if (unitCity) unitCity.value = '';
      if (unitState) unitState.value = '';
      return;
    }
    if (unitName) unitName.value = option.dataset.name || '';
    if (unitCnpj) unitCnpj.value = unitFilter.value || '';
    if (unitCity) unitCity.value = option.dataset.city || '';
    if (unitState) unitState.value = option.dataset.state || '';
  },

  async loadUnits() {
    if (!window.AppApi?.listUnits) return;
    try {
      const data = await window.AppApi.listUnits();
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar unidades.');
      window.units = data.units || [];
      this.renderUnitSelector();
    } catch (err) {
      window.AppUi.log(`Erro ao carregar unidades: ${err.message}`, 'warning');
    }
  }
});
