Object.assign(window.AppUi = window.AppUi || {}, {
setBtnStartActive(active, isResume = false) {
    if (active) {
      btnStart.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        <span>Pausar</span>
      `;
      btnStart.className = 'btn btn-danger';
    } else {
      btnStart.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>${isResume ? 'Continuar' : 'Iniciar'}</span>
      `;
      btnStart.className = 'btn btn-success';
    }
  },

  updateCrawlerUI() {
    if (window.isCrawlerActive) {
      crawlerStatusContainer.style.display = 'block';
      crawlerCurrentCnpj.innerText = window.currentCrawlerCnpj || 'CNPJ do certificado';
      crawlerVisitedCount.innerText = window.crawlerVisited.size;
      crawlerQueueCount.innerText = window.crawlerQueue.length;
    } else {
      crawlerStatusContainer.style.display = 'none';
    }
  },

  updateProgress(current, max) {
    // Barra de progresso removida do card de varredura
    const bar = window.progressBar || document.getElementById('progress-bar');
    const pctEl = window.progressPercentage || document.getElementById('progress-percentage');
    const txt = window.progressText || document.getElementById('progress-text');
    if (!bar || !pctEl || !txt) return;

    if (max === 0) {
      bar.style.width = '0%';
      pctEl.innerText = '0%';
      txt.innerText = 'Nenhuma nota disponível';
      return;
    }

    const percentage = Math.min(Math.round((current / max) * 100), 100);
    bar.style.width = `${percentage}%`;
    pctEl.innerText = `${percentage}%`;
    txt.innerText = percentage >= 100
      ? 'Totalmente sincronizado'
      : `Sincronizando: NSU ${current} de ${max}`;
  },

  appendDocumentsToTable(docs) {
    window.AppUiTable.appendDocumentsToTable(docs);
  }
});
