// Historico remoto
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
_historySnapshotKey(certId, page, unitFilterParams) {
    const env = selectEnvironment ? selectEnvironment.value : 'producao';
    const mode = window.AppUtils?.getCancelledMode?.() || 'active';
    const search = historySearch ? historySearch.value.trim() : '';
    const party = unitFilterParams?.partyCnpj || '';
    return `hist_snap:${certId}|${env}|${mode}|${party}|${search}|p${page}`;
  },

  _restoreHistorySnapshot(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.documents)) return false;
      // snapshot valido por 10 min
      if (snap.at && Date.now() - snap.at > 600000) return false;
      window.AppUiTable.setDocuments(snap.documents, snap.total || 0, snap.page || 1, snap.totalValue || 0);
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = !(snap.documents && snap.documents.length > 0);
      return true;
    } catch (e) {
      return false;
    }
  },

  _saveHistorySnapshot(key, documents, total, page, totalValue) {
    try {
      sessionStorage.setItem(key, JSON.stringify({
        at: Date.now(),
        documents,
        total,
        page,
        totalValue
      }));
    } catch (e) {
      // quota / private mode
    }
  },

  async loadPersistedHistory(page = 1, options = {}) {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!certId || !window.AppApi?.listDocuments || !window.AppUiTable?.setDocuments) return;

    const requestId = (window._historyRequestId = (window._historyRequestId || 0) + 1);
    const quiet = Boolean(options.quiet);
    const keepVisible = Boolean(options.keepVisible);
    const hasRows = Boolean(window.AppUiTable.documents?.length);
    const safePage = Math.max(1, Number(page || 1));
    const unitFilterParams = this.getSelectedUnitFilter();
    const snapKey = this._historySnapshotKey(certId, safePage, unitFilterParams);

    // Paint instantaneo a partir do sessionStorage (antes da rede)
    if (!hasRows) {
      const restored = this._restoreHistorySnapshot(snapKey);
      if (!restored && !keepVisible && window.AppUiTable.showLoading) {
        window.AppUiTable.showLoading();
      }
    }

    const limit = window.AppUiTable.pageSize || 10;
    const listParams = {
      certificateId: certId,
      environment: selectEnvironment ? selectEnvironment.value : 'producao',
      cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
      partyCnpj: unitFilterParams.partyCnpj,
      partyRole: unitFilterParams.partyRole,
      search: historySearch ? historySearch.value.trim() : '',
      cancelledMode: window.AppUtils.getCancelledMode(),
      includeCancelled: window.AppUtils.getIncludeCancelledParam(),
      onlyCancelled: window.AppUtils.getOnlyCancelledParam(),
      limit,
      offset: (safePage - 1) * limit,
      skipTotals: true
    };

    try {
      // 1) Página primeiro (sem count/sum)
      const data = await window.AppApi.listDocuments(listParams);

      if (requestId !== window._historyRequestId) return;

      if (!data.success) {
        if (!quiet) window.AppUi.log(`Erro ao carregar histórico: ${data.error}`, 'warning');
        return;
      }

      const docs = data.documents || [];
      const totalsPending = data.totalsPending !== false && (data.total == null || data.summary?.totalValue == null);
      const totalValue = data.summary?.totalValue ?? data.totalValue ?? null;
      window.AppUiTable.setDocuments(docs, totalsPending ? null : (data.total || 0), safePage, totalValue, {
        totalsPending
      });
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = !(docs && docs.length > 0);

      // 2) Totais em segundo request (stats cache no banco)
      if (totalsPending && window.AppApi.getDocumentTotals) {
        this._loadHistoryTotals(requestId, listParams, snapKey, docs, safePage, quiet, unitFilterParams);
      } else {
        this._saveHistorySnapshot(snapKey, docs, data.total || 0, safePage, totalValue || 0);
        if (!quiet) {
          const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
          window.AppUi.log(`Histórico carregado${unitLabel}: ${docs.length} de ${data.total || 0} XML(s) salvos.`, 'success');
        }
      }

      // 3) Prefetch página 2 (só na 1ª página, se veio cheia)
      if (safePage === 1 && docs.length >= limit) {
        this._prefetchHistoryPage(2, { ...listParams, offset: limit });
      }
    } catch (err) {
      if (requestId !== window._historyRequestId) return;
      if (!quiet) window.AppUi.log(`Erro ao carregar histórico: ${err.message}`, 'warning');
    }
  },

  async _loadHistoryTotals(requestId, listParams, snapKey, docs, safePage, quiet, unitFilterParams) {
    try {
      const { limit, offset, skipTotals, ...totalsParams } = listParams;
      const totals = await window.AppApi.getDocumentTotals(totalsParams);
      if (requestId !== window._historyRequestId) return;
      if (!totals?.success) return;
      const total = totals.total || 0;
      const totalValue = totals.totalValue ?? totals.summary?.totalValue ?? 0;
      if (window.AppUiTable.updateTotals) {
        window.AppUiTable.updateTotals(total, totalValue);
      } else {
        window.AppUiTable.setDocuments(docs, total, safePage, totalValue);
      }
      this._saveHistorySnapshot(snapKey, docs, total, safePage, totalValue);
      if (!quiet) {
        const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
        window.AppUi.log(`Histórico carregado${unitLabel}: ${docs.length} de ${total} XML(s) salvos.`, 'success');
      }
    } catch (err) {
      if (requestId !== window._historyRequestId) return;
      // Página já está ok; totais falharam silenciosamente
      if (!quiet) window.AppUi.log(`Totais ainda calculando: ${err.message}`, 'warning');
    }
  },

  _prefetchHistoryPage(page, listParams) {
    if (!window.AppApi?.listDocuments) return;
    const params = { ...listParams, skipTotals: true };
    // Dispara e deixa no cache do AppDataCache (mesma key da navegação)
    window.AppApi.listDocuments(params).catch(() => {});
  },

  async loadSavedStartNsu() {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const unitFilterParams = this.getSelectedUnitFilter();
    const cnpjConsulta = unitFilterParams.partyCnpj || (inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '');

    const data = await window.AppApi.fetchSyncState({
      environment: selectEnvironment ? selectEnvironment.value : 'producao',
      cnpjConsulta,
      certificateId: certId
    });

    const lastReceivedNsu = Number(data.state?.last_received_nsu || 0);
    const lastNsu = Number(data.state?.last_nsu || 0);
    const savedNsu = data.state ? lastNsu : lastReceivedNsu;
    inputStartNsu.value = savedNsu;
    window.currentNsu = savedNsu;
    window.maxNsu = Math.max(window.maxNsu || 0, savedNsu);
    statNsuAtual.innerText = String(savedNsu);
    statNsuMax.innerText = String(window.maxNsu || savedNsu);
    return savedNsu;
  }
});
