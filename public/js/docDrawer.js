// Drawer de detalhe da nota (item 15)
window.AppDocDrawer = {
  previousFocus: null,

  open(doc) {
    const drawer = document.getElementById('doc-drawer');
    const backdrop = document.getElementById('doc-drawer-backdrop');
    const body = document.getElementById('doc-drawer-body');
    const title = document.getElementById('doc-drawer-title');
    if (!drawer || !body) return;

    const esc = window.AppUtils.escapeHtml;
    const fmt = (v) => (v == null || v === '' || v === 'N/A' ? '—' : String(v));
    const money = window.AppUtils.formatCurrency(doc.valorServico);
    const date = (v) => window.AppUtils.formatDate(v);

    if (title) {
      title.textContent = doc.numeroNfse && doc.numeroNfse !== 'N/A'
        ? `NFS-e ${doc.numeroNfse}`
        : `NSU ${doc.nsu || '—'}`;
    }

    const hasChave = doc.chave && doc.chave !== 'N/A';
    const hasToken = Boolean(doc.token);

    body.innerHTML = `
      <div class="doc-field-grid">
        <div class="doc-field"><span>Status</span><strong>${esc(fmt(doc.status))}</strong></div>
        <div class="doc-field"><span>Tipo</span><strong>${esc(fmt(doc.tipo))}</strong></div>
        <div class="doc-field"><span>NSU</span><strong>${esc(fmt(doc.nsu))}</strong></div>
        <div class="doc-field"><span>Número NFS-e</span><strong>${esc(fmt(doc.numeroNfse))}</strong></div>
        <div class="doc-field"><span>DPS / Série</span><strong>${esc(fmt(doc.numeroDps))} / ${esc(fmt(doc.serieDps))}</strong></div>
        <div class="doc-field"><span>Valor</span><strong>${esc(money)}</strong></div>
        <div class="doc-field"><span>Emissão</span><strong>${esc(date(doc.dataEmissao))}</strong></div>
        <div class="doc-field"><span>Competência</span><strong>${esc(date(doc.competencia))}</strong></div>
        <div class="doc-field"><span>Processamento</span><strong>${esc(date(doc.dataProcessamento))}</strong></div>
        <div class="doc-field"><span>Município</span><strong>${esc(fmt(doc.municipioPrestacao))}</strong></div>
        <div class="doc-field full"><span>Chave de acesso</span><strong>${esc(fmt(doc.chave))}</strong></div>
        <div class="doc-field full"><span>Prestador</span><strong>${esc(fmt(doc.prestadorNome))}<br><span class="helper-text">${esc(window.AppUtils.formatCnpj(doc.prestadorCnpj) || '—')}</span></strong></div>
        <div class="doc-field full"><span>Tomador</span><strong>${esc(fmt(doc.tomadorNome))}<br><span class="helper-text">${esc(window.AppUtils.formatCnpj(doc.tomadorCnpj) || '—')}</span></strong></div>
        <div class="doc-field full"><span>Descrição do serviço</span><strong>${esc(fmt(doc.descricao || doc.eventoDescricao))}</strong></div>
        <div class="doc-field"><span>Cód. tributação</span><strong>${esc(fmt(doc.codigoTributacao))}</strong></div>
        <div class="doc-field"><span>Cancelada</span><strong>${doc.isCancellation ? 'Sim' : 'Não'}</strong></div>
      </div>
      <div class="doc-drawer-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-drawer-action="xml" ${hasToken ? '' : 'disabled'}>Baixar XML</button>
        <button type="button" class="btn btn-secondary btn-sm" data-drawer-action="pdf" ${hasChave ? '' : 'disabled'}>Baixar PDF</button>
      </div>
    `;

    body.querySelector('[data-drawer-action="xml"]')?.addEventListener('click', async () => {
      try {
        await window.AppApi.downloadFromApi(`/api/download-xml/${doc.token}`, 'nfse.xml');
        window.AppToast?.success('XML baixado');
      } catch (err) {
        window.AppToast?.error(err.message || 'Falha no XML');
      }
    });
    body.querySelector('[data-drawer-action="pdf"]')?.addEventListener('click', async () => {
      try {
        const params = new URLSearchParams({
          certificateId: window.selectCertificate?.value || window.activeCertificateId || '',
          environment: window.selectEnvironment?.value || 'producao'
        });
        await window.AppApi.downloadFromApi(`/api/download-pdf/${encodeURIComponent(doc.chave)}?${params}`, 'danfse.pdf');
        window.AppToast?.success('PDF baixado');
      } catch (err) {
        window.AppToast?.error(err.message || 'Falha no PDF');
      }
    });

    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawer.inert = false;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) {
      backdrop.hidden = false;
    }
    document.body.classList.add('drawer-open-lock');
    const app = document.getElementById('app-layout');
    if (app) app.inert = true;
    requestAnimationFrame(() => document.getElementById('doc-drawer-close')?.focus());
  },

  close() {
    const drawer = document.getElementById('doc-drawer');
    const backdrop = document.getElementById('doc-drawer-backdrop');
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
    if (drawer) drawer.inert = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('drawer-open-lock');
    const app = document.getElementById('app-layout');
    if (app) app.inert = false;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  },

  bind() {
    document.getElementById('doc-drawer-close')?.addEventListener('click', () => this.close());
    document.getElementById('doc-drawer-backdrop')?.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      const drawer = document.getElementById('doc-drawer');
      if (!drawer?.classList.contains('open')) return;
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(drawer.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) {
        e.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
};
