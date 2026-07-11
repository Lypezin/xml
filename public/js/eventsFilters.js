// eventsFilters
window.AppEventsFilters = {
  bind() {
if (selectEnvironment) {
  selectEnvironment.addEventListener('change', async () => {
    const envText = selectEnvironment.value === 'producao' ? 'Produção' : 'Homologação';
    const statAmbiente = document.getElementById('stat-ambiente');
    if (statAmbiente) {
      statAmbiente.innerText = envText;
      statAmbiente.className = selectEnvironment.value === 'producao' ? 'metric-value text-primary' : 'metric-value text-warning';
    }
    if (selectEnvironment.offsetParent !== null) {
      window.AppUi.log(`Ambiente alterado para: ${envText}`);
    }
    if (window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none') {
      if (window.AppDataCache) {
        window.AppDataCache.invalidate('history:');
        window.AppDataCache.invalidate('sync-state:');
      }
      await Promise.allSettled([
        window.AppSyncController.loadPersistedHistory(1, { quiet: true }),
        window.AppSyncController.loadSavedStartNsu()
      ]);
    }
  });
}

if (inputCnpjConsulta) {
  inputCnpjConsulta.addEventListener('change', async () => {
    if (window.AppDataCache) {
      window.AppDataCache.invalidate('history:');
      window.AppDataCache.invalidate('sync-state:');
    }
    await Promise.allSettled([
      window.AppSyncController.loadPersistedHistory(1, { quiet: true }),
      window.AppSyncController.loadSavedStartNsu()
    ]);
  });
}

if (unitFilter) {
  unitFilter.addEventListener('change', async () => {
    window.AppSyncController.fillUnitFormFromSelection();
    if (window.AppDataCache) {
      window.AppDataCache.invalidate('history:');
      window.AppDataCache.invalidate('sync-state:');
    }
    await Promise.allSettled([
      window.AppSyncController.loadPersistedHistory(1, { quiet: true }),
      window.AppSyncController.loadSavedStartNsu()
    ]);
  });
}

if (unitPartyRole) {
  unitPartyRole.addEventListener('change', async () => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    await window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  });
}

if (historySearch) {
  historySearch.addEventListener('input', debounce(() => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  }, 280));
}

if (includeCancelled) {
  includeCancelled.addEventListener('change', () => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  });
}

if (window.cancelledFilter) {
  window.cancelledFilter.addEventListener('change', () => {
    if (window.AppDataCache) window.AppDataCache.invalidate('history:');
    window.AppSyncController.loadPersistedHistory(1, { quiet: true });
  });
}

if (btnSaveUnit) {
  btnSaveUnit.addEventListener('click', async () => {
    btnSaveUnit.disabled = true;
    try {
      const selectedOption = unitFilter?.selectedOptions?.[0];
      const data = await window.AppApi.saveUnit({
        id: selectedOption?.dataset?.id || null,
        name: unitName ? unitName.value.trim() : '',
        cnpj: unitCnpj ? unitCnpj.value.trim() : '',
        city: unitCity ? unitCity.value.trim() : '',
        state: unitState ? unitState.value.trim() : ''
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível salvar a unidade.');
      await window.AppSyncController.loadUnits();
      if (unitFilter && data.unit?.cnpj) unitFilter.value = data.unit.cnpj;
      window.AppSyncController.fillUnitFormFromSelection();
      window.AppSyncController.loadPersistedHistory();
      window.AppUi.log('Unidade salva com sucesso.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao salvar unidade: ${err.message}`, 'error');
    } finally {
      btnSaveUnit.disabled = false;
    }
  });
}

if (btnDeleteUnit) {
  btnDeleteUnit.addEventListener('click', async () => {
    const selected = window.AppSyncController.getSelectedUnitFilter();
    if (!selected.unitId) {
      window.AppUi.log('Selecione uma unidade cadastrada para remover.', 'warning');
      return;
    }
    if (!confirm('Remover esta unidade da lista de filtros?')) return;

    btnDeleteUnit.disabled = true;
    try {
      const data = await window.AppApi.deleteUnit(selected.unitId);
      if (!data.success) throw new Error(data.error || 'Não foi possível remover a unidade.');
      if (unitFilter) unitFilter.value = '';
      await window.AppSyncController.loadUnits();
      window.AppSyncController.fillUnitFormFromSelection();
      window.AppSyncController.loadPersistedHistory();
      window.AppUi.log('Unidade removida.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao remover unidade: ${err.message}`, 'error');
    } finally {
      btnDeleteUnit.disabled = false;
    }
  });
}
  }
};
