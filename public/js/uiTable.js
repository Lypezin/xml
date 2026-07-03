// Renderização de Documentos na Tabela do Dashboard

window.AppUiTable = {
  pageSize: 100,
  currentPage: 1,
  documents: [],
  remoteTotal: 0,
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

  setDocuments(docs, total = null, page = 1) {
    this.documents = this.dedupeDocuments((docs || []).map(doc => this.normalizeDocument(doc)));
    this.remoteTotal = total === null ? this.documents.length : Number(total || 0);
    this.remoteMode = total !== null;
    this.currentPage = page;
    this.renderCurrentPage();
  },

  appendDocumentsToTable(docs) {
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
    const orderedDocs = [...this.documents].sort((a, b) => {
      const aNsu = Number(a.nsu || 0);
      const bNsu = Number(b.nsu || 0);
      return mode === 'desc' ? bNsu - aNsu : aNsu - bNsu;
    });

    const totalItems = this.remoteMode ? this.remoteTotal : orderedDocs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    this.currentPage = Math.min(Math.max(this.currentPage, 1), totalPages);
    const start = this.remoteMode ? ((this.currentPage - 1) * this.pageSize) : ((this.currentPage - 1) * this.pageSize);
    const pageDocs = this.remoteMode ? orderedDocs : orderedDocs.slice(start, start + this.pageSize);

    if (pageDocs.length === 0) {
      tableBody.innerHTML = '<tr id="empty-row"><td colspan="7" class="text-center">Nenhum documento sincronizado ainda.</td></tr>';
      this.updatePagination(totalItems, 0, 0);
      return;
    }

    pageDocs.forEach(doc => {
      const tr = document.createElement('tr');
      const valorFormatado = window.AppUtils.formatCurrency(doc.valorServico);
      const isEvento = String(doc.tipo || '').toUpperCase() === 'EVENTO' || doc.status === 'Evento';
      const eventoDetalhe = isEvento
        ? [doc.eventoDescricao, doc.eventoMotivo].filter(v => v && v !== 'N/A').join(' - ')
        : '';

      tr.innerHTML = `
        <td>
          <strong>${doc.nsu}</strong>
          <div class="helper-text">${doc.tipo || 'N/A'}</div>
        </td>
        <td>
          <span class="tipo-badge ${doc.tipo.toLowerCase()}">${doc.tipo}</span>
          <span class="status-badge ${doc.status === 'Evento' ? 'event' : 'ok'}">${doc.status || 'Autorizada'}</span>
          ${eventoDetalhe ? `<div class="helper-text text-warning">${eventoDetalhe}</div>` : ''}
          <div class="helper-text">NFS-e: ${doc.numeroNfse || 'N/A'}</div>
          <div class="helper-text">DPS: ${doc.numeroDps || 'N/A'} / Série ${doc.serieDps || 'N/A'}</div>
        </td>
        <td><span class="cnpj-badge wrap">${doc.chave}</span></td>
        <td>
          <div><strong>Prestador</strong>: ${doc.prestadorNome || 'N/A'}</div>
          <div class="helper-text">CNPJ: ${doc.prestadorCnpj || 'N/A'}</div>
          <div style="height: 6px;"></div>
          <div><strong>Tomador</strong>: ${doc.tomadorNome || 'N/A'}</div>
          <div class="helper-text">CNPJ: ${doc.tomadorCnpj || 'Não cadastrado'}</div>
        </td>
        <td>
          <div class="descricao-texto expanded" title="${eventoDetalhe || doc.descricao || 'N/A'}">${eventoDetalhe || doc.descricao || 'N/A'}</div>
          <div class="helper-text">Município: ${doc.municipioPrestacao || 'N/A'}</div>
          <div class="helper-text">Cód. tributação: ${doc.codigoTributacao || 'N/A'}</div>
          <div class="helper-text">${doc.eventoMotivo && doc.eventoMotivo !== 'N/A' ? doc.eventoMotivo : doc.tributacaoNacional || ''}</div>
        </td>
        <td>
          <strong>${valorFormatado}</strong>
          <div class="helper-text">Emissão: ${window.AppUtils.formatDate(doc.dataEmissao)}</div>
          <div class="helper-text">Competência: ${window.AppUtils.formatDate(doc.competencia)}</div>
          <div class="helper-text">Processamento: ${window.AppUtils.formatDate(doc.dataProcessamento)}</div>
        </td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-xml" data-token="${doc.token}" style="display:inline-flex; align-items:center; text-decoration:none; padding:4px 8px; gap: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>XML</span>
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    this.updatePagination(totalItems, start + 1, start + pageDocs.length);
  },

  updatePagination(total, from, to) {
    if (historyCountLabel) historyCountLabel.innerText = `${total} XML${total === 1 ? '' : 's'} sincronizado${total === 1 ? '' : 's'}`;
    if (historyPageInfo) historyPageInfo.innerText = total > 0 ? `${from}-${to} de ${total}` : '0 de 0';
    if (btnHistoryPrev) btnHistoryPrev.disabled = this.currentPage <= 1;
    if (btnHistoryNext) btnHistoryNext.disabled = this.currentPage >= Math.ceil(Math.max(total, 1) / this.pageSize);
    if (statTotalNotas) statTotalNotas.innerText = total;
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
