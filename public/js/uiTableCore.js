window.AppUiTable = Object.assign(window.AppUiTable || {}, {
pageSize: 10,
  currentPage: 1,
  documents: [],
  remoteTotal: 0,
  remoteTotalValue: 0,
  remoteMode: false,

  normalizeDocument(doc) {
    const metadata = doc.metadata || {};
    const fallbackDesc = doc.codigo_tributacao || doc.codigoTributacao || metadata.codigoTributacao
      ? `Serviço Tributação: ${doc.codigo_tributacao || doc.codigoTributacao || metadata.codigoTributacao}`
      : 'Serviço NFS-e Geral';
    return {
      nsu: doc.nsu,
      tipo: doc.tipo || metadata.tipo || 'NFSE',
      chave: doc.chave || metadata.chave || 'N/A',
      status: (doc.is_cancelled || metadata.isCancellation)
        ? 'Cancelada'
        : (metadata.status || doc.status || 'Autorizada'),
      isCancellation: Boolean(doc.is_cancelled || metadata.isCancellation),
      numeroNfse: doc.numeroNfse || doc.numero_nfse || metadata.numeroNfse || 'N/A',
      numeroDps: doc.numeroDps || metadata.numeroDps || 'N/A',
      serieDps: doc.serieDps || metadata.serieDps || 'N/A',
      prestadorCnpj: doc.prestadorCnpj || doc.prestador_cnpj || metadata.prestadorCnpj || 'N/A',
      prestadorNome: doc.prestadorNome || doc.prestador_nome || metadata.prestadorNome || 'N/A',
      tomadorCnpj: doc.tomadorCnpj || doc.tomador_cnpj || metadata.tomadorCnpj || 'N/A',
      tomadorNome: doc.tomadorNome || doc.tomador_nome || metadata.tomadorNome || 'N/A',
      descricao: doc.descricao || metadata.descricao || metadata.descricaoServico || fallbackDesc,
      municipioPrestacao: doc.municipioPrestacao || doc.municipio_prestacao || metadata.municipioPrestacao || 'N/A',
      codigoTributacao: doc.codigoTributacao || doc.codigo_tributacao || metadata.codigoTributacao || 'N/A',
      eventoDescricao: doc.eventoDescricao || metadata.eventoDescricao || 'N/A',
      eventoMotivo: doc.eventoMotivo || metadata.eventoMotivo || 'N/A',
      tributacaoNacional: doc.tributacaoNacional || metadata.tributacaoNacional || '',
      valorServico: doc.valorServico || doc.valor_servico || metadata.valorServico || '0.00',
      dataEmissao: doc.dataEmissao || doc.data_emissao || metadata.dataEmissao || 'N/A',
      competencia: doc.competencia || metadata.competencia || 'N/A',
      dataProcessamento: doc.dataProcessamento || metadata.dataProcessamento || doc.first_seen_at || doc.firstSeenAt || doc.created_at || 'N/A',
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

  setDocuments(docs, total = null, page = 1, totalValue = 0, options = {}) {
    this.documents = this.dedupeDocuments((docs || []).map(doc => this.normalizeDocument(doc)));
    this.totalsPending = Boolean(options.totalsPending);
    this.remoteMode = true;
    this.currentPage = page;
    const pageSize = this.pageSize || 10;
    if (total == null && this.totalsPending) {
      // Provisório: habilita "próxima" se a página veio cheia
      const full = this.documents.length >= pageSize;
      this.remoteTotal = full
        ? page * pageSize + 1
        : (page - 1) * pageSize + this.documents.length;
      this.remoteTotalValue = totalValue == null ? this.remoteTotalValue : Number(totalValue || 0);
    } else {
      this.remoteTotal = total == null ? this.documents.length : Number(total || 0);
      this.remoteTotalValue = Number(totalValue || 0);
      this.totalsPending = false;
    }
    this.renderCurrentPage();
  },

  updateTotals(total, totalValue) {
    this.totalsPending = false;
    this.remoteTotal = Number(total || 0);
    this.remoteTotalValue = Number(totalValue || 0);
    this.remoteMode = true;
    this.renderCurrentPage();
  }
});
