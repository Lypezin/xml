Object.assign(window.AppUiTable = window.AppUiTable || {}, {
showLoading() {
    const tableBody = window.tableBody || document.getElementById('table-body');
    if (!tableBody) return;
    
    let skeletonHtml = '';
    for (let i = 0; i < 3; i++) {
      skeletonHtml += `
        <div class="xml-item skeleton-row" style="opacity: ${1 - (i * 0.25)};">
          <div class="xml-main-cell">
            <div class="skeleton-shimmer" style="width: 120px; height: 16px;"></div>
            <div class="skeleton-shimmer" style="width: 80px; height: 12px; margin-top: 6px;"></div>
          </div>
          <div class="xml-party-cell">
            <div>
              <div class="skeleton-shimmer" style="width: 100px; height: 14px;"></div>
              <div class="skeleton-shimmer" style="width: 80px; height: 10px; margin-top: 6px;"></div>
            </div>
            <div>
              <div class="skeleton-shimmer" style="width: 100px; height: 14px;"></div>
              <div class="skeleton-shimmer" style="width: 80px; height: 10px; margin-top: 6px;"></div>
            </div>
          </div>
          <div class="xml-service-cell">
            <div class="skeleton-shimmer" style="width: 160px; height: 14px;"></div>
            <div class="skeleton-shimmer" style="width: 90px; height: 10px; margin-top: 6px;"></div>
          </div>
          <div class="xml-value-cell">
            <div class="skeleton-shimmer" style="width: 70px; height: 16px;"></div>
          </div>
          <div class="xml-action-cell" style="align-items: flex-end;">
            <div class="skeleton-shimmer" style="width: 60px; height: 26px; border-radius: 6px;"></div>
          </div>
        </div>
      `;
    }
    
    tableBody.innerHTML = skeletonHtml;

    if (window.statTotalNotas) {
      window.statTotalNotas.innerHTML = `<div class="skeleton-shimmer" style="width: 45px; height: 24px; vertical-align: middle;"></div>`;
    }
    if (window.statTotalValue) {
      window.statTotalValue.innerHTML = `<div class="skeleton-shimmer" style="width: 100px; height: 24px; vertical-align: middle;"></div>`;
    }
    if (window.statStoragePayloads) {
      window.statStoragePayloads.innerHTML = `<div class="skeleton-shimmer" style="width: 50px; height: 20px; vertical-align: middle;"></div>`;
    }
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
  }
});
