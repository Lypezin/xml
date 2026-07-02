// Renderização de Documentos na Tabela do Dashboard

window.AppUiTable = {
  appendDocumentsToTable(docs) {
    const emptyRow = document.getElementById('empty-row');
    if (emptyRow) emptyRow.remove();

    const mode = selectSearchMode ? selectSearchMode.value : 'asc';
    const orderedDocs = [...docs].sort((a, b) => {
      const aNsu = Number(a.nsu || 0);
      const bNsu = Number(b.nsu || 0);
      return mode === 'desc' ? bNsu - aNsu : aNsu - bNsu;
    });

    orderedDocs.forEach(doc => {
      const tr = document.createElement('tr');
      const valorFormatado = window.AppUtils.formatCurrency(doc.valorServico);

      tr.innerHTML = `
        <td>
          <strong>${doc.nsu}</strong>
          <div class="helper-text">${doc.tipo || 'N/A'}</div>
        </td>
        <td>
          <span class="tipo-badge ${doc.tipo.toLowerCase()}">${doc.tipo}</span>
          <span class="status-badge ${doc.status === 'Evento' ? 'event' : 'ok'}">${doc.status || 'Autorizada'}</span>
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
          <div class="descricao-texto expanded" title="${doc.descricao || 'N/A'}">${doc.descricao || 'N/A'}</div>
          <div class="helper-text">Município: ${doc.municipioPrestacao || 'N/A'}</div>
          <div class="helper-text">Cód. tributação: ${doc.codigoTributacao || 'N/A'}</div>
          <div class="helper-text">${doc.eventoMotivo && doc.eventoMotivo !== 'N/A' ? doc.eventoMotivo : doc.tributacaoNacional || ''}</div>
        </td>
        <td>
          <strong>${valorFormatado}</strong>
          <div class="helper-text">Emissão: ${doc.dataEmissao || 'N/A'}</div>
          <div class="helper-text">Competência: ${doc.competencia || 'N/A'}</div>
          <div class="helper-text">Processamento: ${doc.dataProcessamento || 'N/A'}</div>
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
  }
};
