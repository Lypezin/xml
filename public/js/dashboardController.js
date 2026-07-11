// Dashboard de cidades (estende AppSyncController)
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
  cleanFilenameToCityName(filename) {
    if (!filename) return 'Desconhecido';
    let name = filename.replace(/\.(pfx|p12|cert|key)$/i, '');
    name = name.replace(/_\d{14}$/, '');
    name = name.replace(/\d{14}$/, '');
    name = name.replace(/[_-]+/g, ' ').trim();
    name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return name;
  },

  async loadDashboard(retryCount = 0) {
    if (!dashboardCitiesGrid) return;

    const hasCards = Boolean(dashboardCitiesGrid.querySelector('.city-card:not(.skeleton-row)'));

    // Skeleton so no primeiro load (sem cards reais) — troca de aba fica instantanea
    if (retryCount === 0 && !hasCards) {
      if (window.dashStatCities) window.dashStatCities.innerHTML = `<div class="skeleton-shimmer" style="width: 40px; height: 26px; vertical-align: middle;"></div>`;
      if (window.dashStatActive) window.dashStatActive.innerHTML = `<div class="skeleton-shimmer" style="width: 40px; height: 26px; vertical-align: middle;"></div>`;
      if (window.dashStatXmls) window.dashStatXmls.innerHTML = `<div class="skeleton-shimmer" style="width: 80px; height: 26px; vertical-align: middle;"></div>`;

      let skeletonHtml = '';
      for (let i = 0; i < 4; i++) {
        skeletonHtml += `
          <div class="city-card skeleton-row" style="opacity: ${1 - (i * 0.15)}; cursor: default;">
            <div class="city-card-header">
              <div>
                <div class="skeleton-shimmer" style="width: 130px; height: 18px; border-radius: 4px;"></div>
                <div class="skeleton-shimmer" style="width: 110px; height: 12px; margin-top: 6px; border-radius: 4px;"></div>
              </div>
            </div>
            <div class="city-card-stats" style="margin-top: auto;">
              <div class="city-card-stat-item">
                <div class="skeleton-shimmer" style="width: 60px; height: 10px; border-radius: 4px;"></div>
                <div class="skeleton-shimmer" style="width: 40px; height: 16px; margin-top: 4px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-shimmer" style="width: 140px; height: 16px; border-radius: 4px; align-self: flex-end;"></div>
            </div>
          </div>
        `;
      }

      dashboardCitiesGrid.innerHTML = skeletonHtml;
      dashboardCitiesGrid.style.display = 'grid';
      if (dashboardLoader) dashboardLoader.style.display = 'none';
    }

    if (btnRefreshDashboard) {
      btnRefreshDashboard.classList.add('loading');
      btnRefreshDashboard.onclick = (e) => {
        e.preventDefault();
        this.loadDashboard(0);
      };
    }

    try {
      const data = await window.AppApi.fetchDashboardSummary();
      if (!data.success) throw new Error(data.error || 'Erro ao carregar dados do painel.');

      // Calcular Métricas Gerais
      const citiesList = data.summary || [];
      
      // Ordenação específica solicitada pelo usuário
      const orderMap = {
        'sao paulo': 1,
        'salvador': 2,
        'sorocaba': 3,
        'sao bernardo': 4,
        'guarulhos': 5,
        'santo andre': 6,
        'manaus': 7
      };
      const normalizeName = (name) => {
        return String(name || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      };
      citiesList.sort((a, b) => {
        const nameA = normalizeName(this.cleanFilenameToCityName(a.filename));
        const nameB = normalizeName(this.cleanFilenameToCityName(b.filename));
        return (orderMap[nameA] || 99) - (orderMap[nameB] || 99);
      });

      const totalCities = citiesList.length;
      const activeCities = citiesList.filter(c => c.active).length;
      const totalXmls = citiesList.reduce((sum, c) => sum + Number(c.totalXmls || 0), 0);

      if (dashStatCities) dashStatCities.innerText = window.AppUtils.formatInteger(totalCities);
      if (dashStatActive) dashStatActive.innerText = window.AppUtils.formatInteger(activeCities);
      if (dashStatXmls) dashStatXmls.innerText = window.AppUtils.formatInteger(totalXmls);

      if (retryCount === 0 && window.AppToast && hasCards) {
        window.AppToast.success('Painel atualizado');
      }

      dashboardCitiesGrid.innerHTML = '';
      const esc = window.AppUtils.escapeHtml;
      const frag = document.createDocumentFragment();
      citiesList.forEach(city => {
        const card = document.createElement('div');
        card.className = `city-card ${city.active ? 'active' : ''}`;
        const cityName = this.cleanFilenameToCityName(city.filename);
        const safeName = esc(cityName);
        const safeCnpj = esc(window.AppUtils.formatCnpj(city.cnpj));
        const safeLast = esc(city.lastUpdate || 'N/A');
        const safeXmls = esc(window.AppUtils.formatInteger(city.totalXmls));

        card.innerHTML = `
          <div class="city-card-header">
            <div>
              <h3 class="city-card-title">${safeName}</h3>
              <span class="city-card-cnpj">${safeCnpj}</span>
            </div>
            ${city.active ? '<span class="city-card-active-badge">Ativo</span>' : ''}
          </div>
          <div class="city-card-stats">
            <div class="city-card-stat-item">
              <span class="city-card-stat-label">Total XMLs</span>
              <span class="city-card-stat-value success">${safeXmls}</span>
            </div>
            <span class="city-card-date" title="Última nota emitida em ${safeLast}">Última: ${safeLast}</span>
          </div>
          <div class="city-card-footer">
            <span>${city.active ? 'Abrir unidade' : 'Selecionar certificado'} →</span>
          </div>
        `;

        card.addEventListener('click', async () => {
          const certId = city.certificateId;
          if (!certId) {
            window.AppUi.log('Cidade sem certificado vinculado.', 'error');
            return;
          }

          const openXmlsTab = (forceRefresh = true) => {
            window.AppUi.switchTab(
              window.navDownload || document.getElementById('nav-download'),
              window.viewDownloadContent || document.getElementById('view-download-content'),
              'XMLs por Unidade',
              'XMLs NFS-e persistidos por certificado e unidade',
              { forceRefresh }
            );
          };

          // Sempre rebinda o certificado da cidade clicada. Antes, cards "Ativo"
          // só trocavam de aba e o cache da lista mantinha XMLs da cidade anterior.
          const currentId = window.activeCertificateId
            || (window.selectCertificate && window.selectCertificate.value)
            || '';
          const needsSelect = String(currentId) !== String(certId);

          try {
            if (needsSelect) {
              window.AppUi.log(`Selecionando certificado para a cidade ${cityName}...`);
              const res = await window.AppApi.selectCertificate(certId);
              if (!res.success) {
                window.AppUi.log(res.error || 'Erro ao selecionar o certificado.', 'error');
                return;
              }
              window.activeCertificateId = res.activeCertificateId || certId;
              // Evita flash com linhas da cidade anterior
              if (window.AppUiTable?.setDocuments) {
                window.AppUiTable.setDocuments([], 0, 1, 0);
              }
              if (window.unitFilter) window.unitFilter.value = '';
              window._historyReloadDirty = true;
              window._tabCache = window._tabCache || {};
              window._tabCache.syncAt = 0;
              window._tabCache.nsuAt = 0;
              window._tabCache.storageAt = 0;
              await window.AppSyncController.checkCertStatus({ skipSecondary: true });
            } else {
              // Mesmo certificado: ainda força refresh ao abrir pelo card
              window._historyReloadDirty = true;
              window._tabCache = window._tabCache || {};
              window._tabCache.syncAt = 0;
            }
            openXmlsTab(true);
          } catch (err) {
            window.AppUi.log(`Erro ao abrir a cidade ${cityName}: ${err.message}`, 'error');
          }
        });

        frag.appendChild(card);
      });
      dashboardCitiesGrid.appendChild(frag);

      if (dashboardLoader) dashboardLoader.style.display = 'none';
      dashboardCitiesGrid.style.display = 'grid';
    } catch (err) {
      console.warn(`Tentativa ${retryCount + 1} de carregar o painel falhou: ${err.message}`);
      // 1 retry rapido (800ms) em vez de 2x3s — evita sensacao de "travado"
      if (retryCount < 1) {
        setTimeout(() => {
          this.loadDashboard(retryCount + 1);
        }, 800);
      } else {
        dashboardCitiesGrid.innerHTML = `
          <div class="empty-state-card">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="empty-state-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <h3 class="empty-state-title">Conexão com o banco indisponível</h3>
            <p class="empty-state-text">O Supabase pode estar hibernando ou iniciando. Aguarde um momento e tente de novo.</p>
            <button type="button" class="btn btn-primary" id="btn-retry-dashboard">Tentar novamente</button>
          </div>
        `;
        const retryBtn = document.getElementById('btn-retry-dashboard');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => window.AppSyncController.loadDashboard(0));
        }
        if (window.dashStatCities) window.dashStatCities.innerText = '0';
        if (window.dashStatActive) window.dashStatActive.innerText = '0';
        if (window.dashStatXmls) window.dashStatXmls.innerText = '0';
        window.AppUi.log(`Erro ao carregar Dashboard: ${err.message}`, 'error');
      }
    } finally {
      if (btnRefreshDashboard) btnRefreshDashboard.classList.remove('loading');
    }
  }
});
