Object.assign(window.AppUiTable = window.AppUiTable || {}, {
  _prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  },

  _flashMetric(el) {
    if (!el || this._prefersReducedMotion()) return;
    el.classList.remove('metric-flash');
    // reflow para reiniciar animação
    void el.offsetWidth;
    el.classList.add('metric-flash');
  },

  _setMetricText(el, text, { pending = false, flash = false } = {}) {
    if (!el) return;
    const next = String(text);
    const prev = el.dataset.metricText;
    el.classList.toggle('is-pending', pending);
    if (prev === next && !flash) return;
    el.dataset.metricText = next;
    el.textContent = next;
    if (flash && !pending) this._flashMetric(el);
  },

  _renderEmptyState(tableBody) {
    const hasCert = Boolean(
      (window.selectCertificate && window.selectCertificate.value) ||
      window.activeCertificateId
    );
    tableBody.innerHTML = `
      <div id="empty-row" class="xml-empty-state rich-empty">
        <div class="empty-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="9" y1="13" x2="15" y2="13"></line>
            <line x1="9" y1="17" x2="13" y2="17"></line>
          </svg>
        </div>
        <div class="empty-title">Nenhum XML neste recorte</div>
        <p class="empty-text">
          ${hasCert
            ? 'Ajuste a unidade, o filtro de canceladas ou inicie uma varredura para sincronizar notas.'
            : 'Selecione um certificado e rode a varredura para trazer os XMLs da unidade.'}
        </p>
        <div class="empty-actions">
          ${hasCert
            ? '<button type="button" class="btn btn-success btn-sm" data-empty-action="start-scan">Iniciar varredura</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-empty-action="go-certs">Ir para certificados</button>'}
          <button type="button" class="btn btn-secondary btn-sm" data-empty-action="clear-filters">Limpar busca</button>
        </div>
      </div>
    `;

    const startBtn = tableBody.querySelector('[data-empty-action="start-scan"]');
    const certsBtn = tableBody.querySelector('[data-empty-action="go-certs"]');
    const clearBtn = tableBody.querySelector('[data-empty-action="clear-filters"]');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const btn = window.btnStart || document.getElementById('btn-start');
        if (btn && !btn.disabled) btn.click();
        else if (window.AppUi?.log) window.AppUi.log('Ative um certificado para iniciar a varredura.', 'warning');
      });
    }
    if (certsBtn) {
      certsBtn.addEventListener('click', () => {
        const nav = window.navCertificado || document.getElementById('nav-certificado');
        const view = window.viewCertificadoContent || document.getElementById('view-certificado-content');
        if (window.AppUi?.switchTab && nav && view) {
          window.AppUi.switchTab(nav, view, 'Certificados', 'Gerencie certificados A1 e nomes internos');
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (window.historySearch) window.historySearch.value = '';
        if (window.cancelledFilter) window.cancelledFilter.value = 'all';
        if (window.unitFilter) window.unitFilter.value = '';
        if (window.AppDataCache) window.AppDataCache.invalidate('history:');
        if (window.AppSyncController?.loadPersistedHistory) {
          window.AppSyncController.loadPersistedHistory(1, { quiet: true });
        }
      });
    }
  },

  renderCurrentPage() {
    const tableBody = window.tableBody || document.getElementById('table-body');
    if (!tableBody) return;

    const pageChanged = this._lastRenderedPage != null && this._lastRenderedPage !== this.currentPage;
    this._lastRenderedPage = this.currentPage;

    tableBody.innerHTML = '';
    tableBody.classList.remove('is-entering', 'is-paging');

    const mode = window.selectSearchMode ? window.selectSearchMode.value : 'asc';
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
      this._renderEmptyState(tableBody);
      this.updatePagination(totalItems, 0, 0);
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = true;
      if (window.btnExportExcel) window.btnExportExcel.disabled = true;
      return;
    }

    if (window.btnDownloadZip) window.btnDownloadZip.disabled = false;
    if (window.btnExportExcel) window.btnExportExcel.disabled = false;

    const esc = window.AppUtils.escapeHtml;
    const frag = document.createDocumentFragment();
    pageDocs.forEach(doc => {
      const item = document.createElement('article');
      const isCancelled = Boolean(doc.isCancellation) || String(doc.status || '').toLowerCase().includes('cancel');
      item.className = isCancelled ? 'xml-item cancelled-row' : 'xml-item';
      const valorFormatado = window.AppUtils.formatCurrency(doc.valorServico);
      const isEvento = String(doc.tipo || '').toUpperCase() === 'EVENTO' || doc.status === 'Evento';
      const hasChave = doc.chave && doc.chave !== 'N/A';
      const eventoDetalhe = isEvento
        ? [doc.eventoDescricao, doc.eventoMotivo].filter(v => v && v !== 'N/A').join(' - ')
        : '';
      const statusClass = isCancelled ? 'cancelled' : (doc.status === 'Evento' ? 'event' : 'ok');
      const safeToken = esc(doc.token || '');
      const safeChave = esc(doc.chave || '');
      const descText = eventoDetalhe || doc.descricao || 'N/A';

      item.innerHTML = `
        <div class="xml-main-cell">
          <div class="xml-title-row">
            <span class="tipo-badge ${esc(String(doc.tipo || 'nfse').toLowerCase())}">${esc(doc.tipo || 'NFSE')}</span>
            <span class="status-badge ${statusClass}">${esc(doc.status || 'Autorizada')}</span>
          </div>
          <strong>NSU ${esc(doc.nsu || 'N/A')}</strong>
          <span class="helper-text">NFS-e ${esc(doc.numeroNfse || 'N/A')} | DPS ${esc(doc.numeroDps || 'N/A')} / Série ${esc(doc.serieDps || 'N/A')}</span>
          <span class="cnpj-badge wrap">${esc(doc.chave || 'Chave não informada')}</span>
        </div>
        <div class="xml-party-cell">
          <div><strong>Prestador</strong><span>${esc(doc.prestadorNome || 'N/A')}</span><small>${esc(window.AppUtils.formatCnpj(doc.prestadorCnpj) || 'N/A')}</small></div>
          <div><strong>Tomador</strong><span>${esc(doc.tomadorNome || 'N/A')}</span><small>${esc(window.AppUtils.formatCnpj(doc.tomadorCnpj) || 'Não cadastrado')}</small></div>
        </div>
        <div class="xml-service-cell">
          <div class="descricao-texto expanded" title="${esc(descText)}">${esc(descText)}</div>
          <span class="helper-text">Município: ${esc(doc.municipioPrestacao || 'N/A')}</span>
          <span class="helper-text">Cód. tributação: ${esc(doc.codigoTributacao || 'N/A')}</span>
        </div>
        <div class="xml-value-cell">
          <strong>${esc(valorFormatado)}</strong>
          <span>Emissão: ${esc(window.AppUtils.formatDate(doc.dataEmissao))}</span>
          <span>Competência: ${esc(window.AppUtils.formatDate(doc.competencia))}</span>
          <span>Processamento: ${esc(window.AppUtils.formatDate(doc.dataProcessamento))}</span>
        </div>
        <div class="xml-action-cell">
          <button type="button" class="btn btn-secondary btn-sm" data-action="open-detail" data-nsu="${esc(doc.nsu || '')}" title="Ver detalhes">
            <span>Detalhe</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-xml" data-token="${safeToken}" ${doc.token ? '' : 'disabled'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>XML</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-pdf" data-chave="${safeChave}" ${hasChave ? '' : 'disabled'}>
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
      item.dataset.docNsu = String(doc.nsu || '');
      item.dataset.docChave = String(doc.chave || '');
      frag.appendChild(item);
    });
    tableBody.appendChild(frag);

    if (!this._prefersReducedMotion()) {
      // Stagger na 1ª pintura da página; fade leve nas demais
      requestAnimationFrame(() => {
        tableBody.classList.add(pageChanged ? 'is-paging' : 'is-entering');
        window.setTimeout(() => {
          tableBody.classList.remove('is-entering', 'is-paging');
        }, pageChanged ? 200 : 320);
      });
    }

    this.updatePagination(totalItems, start + 1, start + pageDocs.length);
  },

  updatePagination(total, from, to) {
    const pending = Boolean(this.totalsPending);
    if (historyCountLabel) {
      historyCountLabel.innerText = pending
        ? `${this.documents.length} XML(s) nesta página…`
        : `${total} XML${total === 1 ? '' : 's'} sincronizado${total === 1 ? '' : 's'}`;
    }
    if (historyPageInfo) {
      historyPageInfo.innerText = pending
        ? (total > 0 ? `${from}-${to}` : '0')
        : (total > 0 ? `${from}-${to} de ${total}` : '0 de 0');
    }
    if (btnHistoryPrev) btnHistoryPrev.disabled = this.currentPage <= 1;
    if (btnHistoryNext) {
      const fullPage = this.documents.length >= (this.pageSize || 10);
      btnHistoryNext.disabled = pending
        ? !fullPage
        : this.currentPage >= Math.ceil(Math.max(total, 1) / this.pageSize);
    }

    const wasPending = this._metricsWerePending;
    const totalLabel = pending ? '…' : String(total);
    const valueLabel = pending && !this.remoteTotalValue
      ? '…'
      : window.AppUtils.formatCurrency(this.remoteTotalValue || 0);

    this._setMetricText(window.statTotalNotas || document.getElementById('stat-total-notas'), totalLabel, {
      pending,
      flash: wasPending && !pending
    });
    this._setMetricText(window.statTotalValue || document.getElementById('stat-total-value'), valueLabel, {
      pending: pending && !this.remoteTotalValue,
      flash: wasPending && !pending
    });
    this._metricsWerePending = pending;
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
});
