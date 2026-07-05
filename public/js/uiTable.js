// Renderizacao dos XMLs sincronizados na lista paginada.

window.AppUiTable = {
  pageSize: 10,
  currentPage: 1,
  documents: [],
  remoteTotal: 0,
  remoteTotalValue: 0,
  remoteMode: false,

  normalizeDocument(doc) {
    const metadata = doc.metadata || {};
    return {
      nsu: doc.nsu,
      tipo: doc.tipo || metadata.tipo || 'NFSE',
      chave: doc.chave || metadata.chave || 'N/A',
      status: metadata.status || doc.status || 'Autorizada',
      numeroNfse: doc.numeroNfse || doc.numero_nfse || metadata.numeroNfse || 'N/A',
      numeroDps: doc.numeroDps || metadata.numeroDps || 'N/A',
      serieDps: doc.serieDps || metadata.serieDps || 'N/A',
      prestadorCnpj: doc.prestadorCnpj || doc.prestador_cnpj || metadata.prestadorCnpj || 'N/A',
      prestadorNome: doc.prestadorNome || doc.prestador_nome || metadata.prestadorNome || 'N/A',
      tomadorCnpj: doc.tomadorCnpj || doc.tomador_cnpj || metadata.tomadorCnpj || 'N/A',
      tomadorNome: doc.tomadorNome || doc.tomador_nome || metadata.tomadorNome || 'N/A',
      descricao: doc.descricao || metadata.descricao || metadata.descricaoServico || 'N/A',
      municipioPrestacao: doc.municipioPrestacao || doc.municipio_prestacao || metadata.municipioPrestacao || 'N/A',
      codigoTributacao: doc.codigoTributacao || doc.codigo_tributacao || metadata.codigoTributacao || 'N/A',
      eventoDescricao: doc.eventoDescricao || metadata.eventoDescricao || 'N/A',
      eventoMotivo: doc.eventoMotivo || metadata.eventoMotivo || 'N/A',
      tributacaoNacional: doc.tributacaoNacional || metadata.tributacaoNacional || '',
      valorServico: doc.valorServico || doc.valor_servico || metadata.valorServico || '0.00',
      dataEmissao: doc.dataEmissao || doc.data_emissao || metadata.dataEmissao || 'N/A',
      competencia: doc.competencia || metadata.competencia || 'N/A',
      dataProcessamento: doc.dataProcessamento || metadata.dataProcessamento || 'N/A',
      token: metadata.token || doc.token || '',
      arquivo: doc.arquivo || doc.file_name || metadata.arquivo || ''
    };
  },

  getDedupKey(doc) {
    const chave = String(doc.chave || '').trim();
    if (chave && chave !== 'N/A' && !chave.startsWith('NSU_')) {
      return `CHAVE:${chave}`;
    }
    return `NSU:${doc.nsu || doc.token || doc.arquivo || doc.xmlSha256 || 'SEM_CHAVE'}`;
  },

  dedupeDocuments(docs) {
    const byKey = new Map();
    const ordered = [...(docs || [])].sort((a, b) => {
      const aEvento = String(a.tipo || '').toUpperCase() === 'EVENTO';
      const bEvento = String(b.tipo || '').toUpperCase() === 'EVENTO';
      return Number(aEvento) - Number(bEvento);
    });
    ordered.forEach(doc => {
      const key = this.getDedupKey(doc);
      if (!byKey.has(key)) byKey.set(key, doc);
    });
    return Array.from(byKey.values());
  },

  setDocuments(docs, total = null, page = 1, totalValue = 0) {
    this.documents = this.dedupeDocuments((docs || []).map(doc => this.normalizeDocument(doc)));
    this.remoteTotal = total === null ? this.documents.length : Number(total || 0);
    this.remoteTotalValue = Number(totalValue || 0);
    this.remoteMode = total !== null;
    this.currentPage = page;
    this.renderCurrentPage();
  },

  showLoading() {
    if (!tableBody) return;
    tableBody.innerHTML = `
      <div class="xml-empty-state">
        <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" style="margin: 0 auto 12px; display: block; color: var(--text-muted);">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"></circle>
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Buscando documentos salvos...</span>
      </div>
    `;
    if (statTotalNotas) statTotalNotas.innerHTML = `<span class="pulse-loading">...</span>`;
    if (statTotalValue) statTotalValue.innerHTML = `<span class="pulse-loading">...</span>`;
  },

  appendDocumentsToTable(docs) {
    if (window.AppSyncController?.loadPersistedHistory) {
      window.AppSyncController.loadPersistedHistory(1);
      return;
    }

    this.remoteMode = false;
    const normalized = (docs || []).map(doc => this.normalizeDocument(doc));
    const byKey = new Map(this.documents.map(doc => [this.getDedupKey(doc), doc]));
    const ordered = [...normalized].sort((a, b) => {
      const aEvento = String(a.tipo || '').toUpperCase() === 'EVENTO';
      const bEvento = String(b.tipo || '').toUpperCase() === 'EVENTO';
      return Number(aEvento) - Number(bEvento);
    });
    ordered.forEach(doc => {
      const key = this.getDedupKey(doc);
      const current = byKey.get(key);
      const currentIsEvento = String(current?.tipo || '').toUpperCase() === 'EVENTO';
      const nextIsEvento = String(doc.tipo || '').toUpperCase() === 'EVENTO';
      if (!current || (currentIsEvento && !nextIsEvento)) byKey.set(key, doc);
    });
    this.documents = Array.from(byKey.values());
    this.currentPage = Math.max(1, Math.ceil(this.documents.length / this.pageSize));
    this.renderCurrentPage();
  },

  renderCurrentPage() {
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const mode = selectSearchMode ? selectSearchMode.value : 'asc';
    const orderedDocs = this.remoteMode ? [...this.documents] : [...this.documents].sort((a, b) => {
      const aNsu = Number(a.nsu || 0);
      const bNsu = Number(b.nsu || 0);
      return mode === 'desc' ? bNsu - aNsu : aNsu - bNsu;
    });

    const totalItems = this.remoteMode ? this.remoteTotal : orderedDocs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    this.currentPage = Math.min(Math.max(this.currentPage, 1), totalPages);
    const start = (this.currentPage - 1) * this.pageSize;
    const pageDocs = this.remoteMode ? orderedDocs : orderedDocs.slice(start, start + this.pageSize);

    if (pageDocs.length === 0) {
      tableBody.innerHTML = '<div id="empty-row" class="xml-empty-state">Nenhum documento sincronizado ainda.</div>';
      this.updatePagination(totalItems, 0, 0);
      return;
    }

    pageDocs.forEach(doc => {
      const item = document.createElement('article');
      item.className = 'xml-item';
      const valorFormatado = window.AppUtils.formatCurrency(doc.valorServico);
      const isEvento = String(doc.tipo || '').toUpperCase() === 'EVENTO' || doc.status === 'Evento';
      const hasChave = doc.chave && doc.chave !== 'N/A';
      const eventoDetalhe = isEvento
        ? [doc.eventoDescricao, doc.eventoMotivo].filter(v => v && v !== 'N/A').join(' - ')
        : '';

      item.innerHTML = `
        <div class="xml-main-cell">
          <div class="xml-title-row">
            <span class="tipo-badge ${String(doc.tipo || 'nfse').toLowerCase()}">${doc.tipo || 'NFSE'}</span>
            <span class="status-badge ${doc.status === 'Evento' ? 'event' : 'ok'}">${doc.status || 'Autorizada'}</span>
          </div>
          <strong>NSU ${doc.nsu || 'N/A'}</strong>
          <span class="helper-text">NFS-e ${doc.numeroNfse || 'N/A'} | DPS ${doc.numeroDps || 'N/A'} / Serie ${doc.serieDps || 'N/A'}</span>
          <span class="cnpj-badge wrap">${doc.chave || 'Chave não informada'}</span>
        </div>
        <div class="xml-party-cell">
          <div><strong>Prestador</strong><span>${doc.prestadorNome || 'N/A'}</span><small>${doc.prestadorCnpj || 'N/A'}</small></div>
          <div><strong>Tomador</strong><span>${doc.tomadorNome || 'N/A'}</span><small>${doc.tomadorCnpj || 'Não cadastrado'}</small></div>
        </div>
        <div class="xml-service-cell">
          <div class="descricao-texto expanded" title="${eventoDetalhe || doc.descricao || 'N/A'}">${eventoDetalhe || doc.descricao || 'N/A'}</div>
          <span class="helper-text">Município: ${doc.municipioPrestacao || 'N/A'}</span>
          <span class="helper-text">Cod. tributação: ${doc.codigoTributacao || 'N/A'}</span>
        </div>
        <div class="xml-value-cell">
          <strong>${valorFormatado}</strong>
          <span>Emissão: ${window.AppUtils.formatDate(doc.dataEmissao)}</span>
          <span>Competência: ${window.AppUtils.formatDate(doc.competencia)}</span>
          <span>Processamento: ${window.AppUtils.formatDate(doc.dataProcessamento)}</span>
        </div>
        <div class="xml-action-cell">
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-xml" data-token="${doc.token}" ${doc.token ? '' : 'disabled'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>XML</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-pdf" data-chave="${doc.chave || ''}" ${hasChave ? '' : 'disabled'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="9" y1="15" x2="15" y2="15"></line>
              <line x1="9" y1="18" x2="13" y2="18"></line>
            </svg>
            <span>PDF</span>
          </button>
        </div>
      `;
      tableBody.appendChild(item);
    });

    this.updatePagination(totalItems, start + 1, start + pageDocs.length);
  },

  updatePagination(total, from, to) {
    if (historyCountLabel) historyCountLabel.innerText = `${total} XML${total === 1 ? '' : 's'} sincronizado${total === 1 ? '' : 's'}`;
    if (historyPageInfo) historyPageInfo.innerText = total > 0 ? `${from}-${to} de ${total}` : '0 de 0';
    if (btnHistoryPrev) btnHistoryPrev.disabled = this.currentPage <= 1;
    if (btnHistoryNext) btnHistoryNext.disabled = this.currentPage >= Math.ceil(Math.max(total, 1) / this.pageSize);
    if (statTotalNotas) statTotalNotas.innerText = total;
    if (statTotalValue) statTotalValue.innerText = window.AppUtils.formatCurrency(this.remoteTotalValue || 0);
  },

  nextPage() {
    if (this.remoteMode && window.AppSyncController?.loadPersistedHistory) {
      window.AppSyncController.loadPersistedHistory(this.currentPage + 1);
      return;
    }
    this.currentPage += 1;
    this.renderCurrentPage();
  },

  prevPage() {
    if (this.remoteMode && window.AppSyncController?.loadPersistedHistory) {
      window.AppSyncController.loadPersistedHistory(this.currentPage - 1);
      return;
    }
    this.currentPage -= 1;
    this.renderCurrentPage();
  }
};
