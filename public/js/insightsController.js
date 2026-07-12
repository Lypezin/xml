// Saúde API, histórico de runs, analytics, auditoria, validade de cert
window.AppInsights = {
  formatMoney(value) {
    const n = Number(value || 0);
    return (window.AppUtils?.formatCurrency?.(n)) || `R$ ${n.toFixed(2)}`;
  },

  formatDelta(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return { text: 'sem base anterior', cls: '' };
    const n = Number(pct);
    const sign = n > 0 ? '+' : '';
    return {
      text: `${sign}${n.toFixed(1)}%`,
      cls: n > 0 ? 'up' : n < 0 ? 'down' : ''
    };
  },

  async loadApiHealth() {
    const statusEl = document.getElementById('api-health-status');
    if (!statusEl) return;
    try {
      const data = await window.AppApi.fetchApiHealth(24);
      const h = data.health || {};
      const label = {
        healthy: 'Saudável',
        degraded: 'Degradada',
        down: 'Instável',
        unknown: 'Sem dados'
      }[h.status] || 'Sem dados';
      statusEl.className = `api-health-status ${h.status || 'unknown'}`;
      statusEl.textContent = label;
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set('api-health-rate', h.successRate == null ? '—' : `${h.successRate}%`);
      set('api-health-avg', h.avgLatencyMs != null ? `${h.avgLatencyMs} ms` : '—');
      set('api-health-p95', h.p95LatencyMs != null ? `${h.p95LatencyMs} ms` : '—');
      set('api-health-total', h.total != null ? String(h.total) : '—');
      const errEl = document.getElementById('api-health-error');
      if (errEl) {
        errEl.textContent = h.lastError
          ? `Último erro: ${h.lastError}`
          : 'Amostras gravadas a cada consulta DFe.';
      }
    } catch (err) {
      statusEl.className = 'api-health-status unknown';
      statusEl.textContent = 'Indisponível';
    }
  },

  async loadSyncRuns() {
    const list = document.getElementById('sync-runs-list');
    if (!list) return;
    try {
      const certId = window.selectCertificate?.value || window.activeCertificateId || '';
      const data = await window.AppApi.fetchSyncRuns({
        certificateId: certId,
        environment: window.selectEnvironment?.value || 'producao',
        limit: 20
      });
      const runs = data.runs || [];
      if (!runs.length) {
        list.innerHTML = `<div class="helper-text">${data.warning || 'Nenhuma varredura registrada ainda. Inicie uma sincronização para ver o histórico.'}</div>`;
        return;
      }
      const esc = window.AppUtils.escapeHtml;
      const statusLabel = {
        completed: 'Concluída',
        running: 'Em andamento',
        paused: 'Pausada',
        error: 'Erro',
        success: 'Concluída'
      };
      const formatDur = (secs) => {
        const s = Number(secs || 0);
        if (!Number.isFinite(s) || s < 0) return '—';
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const r = s % 60;
        if (m < 60) return `${m}m ${r}s`;
        const h = Math.floor(m / 60);
        return `${h}h ${m % 60}m`;
      };
      list.innerHTML = runs.map(run => {
        const status = String(run.status || 'running');
        const start = run.started_at || run.startedAt;
        const end = run.finished_at || run.finishedAt;
        const startTxt = start ? new Date(start).toLocaleString('pt-BR') : '—';
        const endTxt = end
          ? new Date(end).toLocaleString('pt-BR')
          : (status === 'running' ? 'em andamento…' : '—');
        const dur = formatDur(run.duration_seconds);
        const nsuStart = run.start_nsu ?? 0;
        const nsuEnd = run.end_nsu ?? run.max_nsu_seen ?? '…';
        const docs = run.documents_found != null ? Number(run.documents_found) : 0;
        const err = run.error_message
          ? `<div class="run-meta run-error">Erro: ${esc(run.error_message)}</div>`
          : '';
        return `
          <article class="sync-run-item">
            <strong>Sessão de varredura</strong>
            <span class="sync-run-status ${esc(status)}">${esc(statusLabel[status] || status)}</span>
            <div class="run-meta">
              <div><strong>Início:</strong> ${esc(startTxt)}</div>
              <div><strong>Fim:</strong> ${esc(endTxt)}</div>
              <div><strong>Duração:</strong> ${esc(dur)} · <strong>NSU:</strong> ${esc(String(nsuStart))} → ${esc(String(nsuEnd))} · <strong>Novos:</strong> ${esc(String(docs))}</div>
            </div>
            ${err}
          </article>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="helper-text">Não foi possível carregar o histórico.</div>`;
    }
  },

  setAnalyticsStatus(message, isError = false) {
    const el = document.getElementById('analytics-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
    el.style.display = message ? 'block' : 'none';
  },

  async loadAnalytics() {
    const chart = document.getElementById('analytics-monthly-chart');
    const rankP = document.getElementById('ranking-prestador');
    const rankT = document.getElementById('ranking-tomador');
    if (!chart && !rankP && !document.getElementById('analytics-mom-value')) {
      // Painel ainda não montado
      return;
    }
    if (chart) chart.innerHTML = '<div class="helper-text">Carregando indicadores…</div>';
    if (rankP) rankP.innerHTML = '<div class="helper-text">Carregando…</div>';
    if (rankT) rankT.innerHTML = '<div class="helper-text">Carregando…</div>';
    this.setAnalyticsStatus('Carregando indicadores…');

    try {
      const environment = window.selectEnvironment?.value || 'producao';
      const data = await window.AppApi.fetchDashboardAnalytics({
        months: 12,
        environment
      });

      const a = data.analytics || {};
      const monthly = Array.isArray(a.monthly) ? a.monthly : [];
      const rankPre = Array.isArray(a.rankingPrestador) ? a.rankingPrestador : [];
      const rankTom = Array.isArray(a.rankingTomador) ? a.rankingTomador : [];
      const hasData = monthly.length > 0 || rankPre.length > 0 || Number(a.totals?.documents || 0) > 0;

      if (!data.success && (data.error || data.warning)) {
        this.setAnalyticsStatus(data.warning || data.error, true);
      } else if (data.warning) {
        this.setAnalyticsStatus(data.warning, true);
      } else if (!hasData) {
        this.setAnalyticsStatus('Sem indicadores para o ambiente selecionado.', true);
      } else {
        const docs = window.AppUtils?.formatInteger
          ? window.AppUtils.formatInteger(a.totals?.documents || 0)
          : String(a.totals?.documents || 0);
        this.setAnalyticsStatus(`${docs} notas no ambiente · valor total ${this.formatMoney(a.totals?.value || 0)}`);
      }

      const mom = a.comparisons?.monthOverMonth || {};
      const yoy = a.comparisons?.yearOverYear || {};

      const momEl = document.getElementById('analytics-mom-value');
      const yoyEl = document.getElementById('analytics-yoy-value');
      const momD = document.getElementById('analytics-mom-delta');
      const yoyD = document.getElementById('analytics-yoy-delta');
      const canc = document.getElementById('analytics-cancelled');

      if (momEl) momEl.textContent = this.formatMoney(mom.current);
      if (yoyEl) yoyEl.textContent = this.formatMoney(yoy.current);
      if (canc) {
        canc.textContent = window.AppUtils?.formatInteger
          ? window.AppUtils.formatInteger(a.totals?.cancelled || 0)
          : String(a.totals?.cancelled || 0);
      }

      const dMom = this.formatDelta(mom.deltaPct);
      const dYoy = this.formatDelta(yoy.deltaPct);
      if (momD) {
        momD.textContent = dMom.text;
        momD.className = `compare-delta ${dMom.cls}`;
      }
      if (yoyD) {
        yoyD.textContent = dYoy.text;
        yoyD.className = `compare-delta ${dYoy.cls}`;
      }

      this.renderMonthlyChart(monthly);
      this.renderRanking('ranking-prestador', rankPre);
      this.renderRanking('ranking-tomador', rankTom);
    } catch (err) {
      console.error('[analytics]', err);
      this.setAnalyticsStatus(err.message || 'Falha ao carregar indicadores', true);
      if (chart) {
        const msg = err.message ? window.AppUtils.escapeHtml(err.message) : '';
        chart.innerHTML = `<div class="helper-text">Não foi possível carregar os gráficos${msg ? ': ' + msg : ''}.</div>`;
      }
      if (rankP) rankP.innerHTML = '<div class="helper-text">—</div>';
      if (rankT) rankT.innerHTML = '<div class="helper-text">—</div>';
    }
  },

  renderMonthlyChart(monthly) {
    const el = document.getElementById('analytics-monthly-chart');
    if (!el) return;
    if (!monthly.length) {
      el.innerHTML = '<div class="helper-text">Sem dados mensais ainda. Aplique a migração SQL e sincronize notas.</div>';
      return;
    }
    const esc = window.AppUtils.escapeHtml;
    const values = monthly.map(m => Math.max(0, Number(m.value || 0)));
    const maxCount = Math.max(...monthly.map(m => Number(m.count || 0)), 1);
    const maxValue = Math.max(...values, 1);
    const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
    const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
    const points = monthly.map((m, i) => {
      const x = ((i + 0.5) / monthly.length) * 100;
      const y = 94 - (Math.max(0, Number(m.value || 0)) / maxValue) * 80;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const columns = monthly.map(m => {
      const count = Math.max(0, Number(m.count || 0));
      const cancelled = Math.min(count, Math.max(0, Number(m.cancelled || 0)));
      const active = Math.max(0, count - cancelled);
      const h = Math.max(4, Math.round((count / maxCount) * 136));
      const cancelledH = count ? Math.round((cancelled / count) * h) : 0;
      const activeH = Math.max(0, h - cancelledH);
      const rawMonth = String(m.month || '');
      const parsed = /^\d{4}-\d{2}$/.test(rawMonth) ? new Date(`${rawMonth}-01T12:00:00`) : null;
      const label = parsed && !Number.isNaN(parsed.getTime())
        ? monthFmt.format(parsed).replace('.', '')
        : rawMonth.slice(5) || rawMonth;
      const title = `${rawMonth}: ${count} notas (${cancelled} canceladas) | ${this.formatMoney(m.value)}`;
      return `
        <div class="chart-bar-col" title="${esc(title)}" tabindex="0" aria-label="${esc(title)}">
          <span class="chart-bar-value">${esc(compactFmt.format(count))}</span>
          <div class="chart-bar-stack" style="height:${h}px">
            <div class="chart-bar active-part" style="height:${activeH}px"></div>
            ${cancelledH ? `<div class="chart-bar cancelled-part" style="height:${Math.max(3, cancelledH)}px"></div>` : ''}
          </div>
          <span class="chart-bar-label">${esc(label)}</span>
        </div>
      `;
    }).join('');

    el.innerHTML = `
      <div class="chart-summary">
        <span>Pico de volume <strong>${esc(compactFmt.format(maxCount))} notas</strong></span>
        <span>Pico financeiro <strong>${esc(this.formatMoney(maxValue))}</strong></span>
      </div>
      <div class="chart-plot">
        <div class="chart-grid-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <svg class="chart-value-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${points}" vector-effect="non-scaling-stroke"></polyline>
          ${monthly.map((m, i) => {
            const x = ((i + 0.5) / monthly.length) * 100;
            const y = 94 - (Math.max(0, Number(m.value || 0)) / maxValue) * 80;
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.3" vector-effect="non-scaling-stroke"></circle>`;
          }).join('')}
        </svg>
        <div class="chart-columns">${columns}</div>
      </div>
    `;
  },

  renderRanking(elementId, rows) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="helper-text">Sem ranking ainda.</div>';
      return;
    }
    const esc = window.AppUtils.escapeHtml;
    const visible = rows.slice(0, 8);
    const maxValue = Math.max(...visible.map(r => Number(r.value || 0)), 1);
    const totalValue = visible.reduce((sum, r) => sum + Math.max(0, Number(r.value || 0)), 0);
    el.innerHTML = visible.map((r, i) => {
      const value = Math.max(0, Number(r.value || 0));
      const width = Math.max(3, (value / maxValue) * 100);
      const share = totalValue ? (value / totalValue) * 100 : 0;
      return `
        <div class="ranking-item">
          <span class="rank-num">${i + 1}</span>
          <div class="rank-content">
            <div class="rank-row">
              <span class="rank-name" title="${esc(r.name || '')}">${esc(r.name || '—')}</span>
              <span class="rank-value">${esc(this.formatMoney(value))}</span>
            </div>
            <div class="rank-track" aria-hidden="true"><span style="width:${width.toFixed(1)}%"></span></div>
          </div>
          <span class="rank-share">${share.toFixed(1)}%</span>
        </div>
      `;
    }).join('');
  },

  async loadAuditLog() {
    const list = document.getElementById('audit-list');
    if (!list) return;
    list.innerHTML = '<div class="helper-text">Carregando auditoria…</div>';
    try {
      const data = await window.AppApi.fetchAuditLog({ limit: 40 });
      const events = data.events || [];
      if (!events.length) {
        list.innerHTML = `<div class="helper-text">${window.AppUtils.escapeHtml(data.warning || 'Nenhum download/export registrado ainda. Baixe um XML/Excel/ZIP para gerar eventos.')}</div>`;
        return;
      }
      const esc = window.AppUtils.escapeHtml;
      list.innerHTML = events.map(ev => {
        const when = ev.downloaded_at
          ? new Date(ev.downloaded_at).toLocaleString('pt-BR')
          : '—';
        const action = String(ev.action || 'xml');
        const who = ev.user_email || 'sistema';
        const file = ev.file_name || '—';
        const nsu = ev.nsu != null ? `NSU ${ev.nsu}` : '';
        return `
          <article class="audit-item">
            <span class="audit-action">${esc(action)}</span>
            <div class="audit-main" title="${esc(file)}">${esc(file)}</div>
            <span class="helper-text">${esc(when)}</span>
            <div class="audit-meta">${esc(who)}${nsu ? ' · ' + esc(nsu) : ''}</div>
          </article>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="helper-text">Auditoria indisponível${err.message ? ': ' + window.AppUtils.escapeHtml(err.message) : ''}.</div>`;
    }
  },

  renderCertExpiryBanner(certificates = []) {
    const banner = document.getElementById('cert-expiry-banner');
    if (!banner) return;

    const now = Date.now();
    const thresholds = [7, 15, 30];
    const items = (certificates || [])
      .map(c => {
        const raw = c.validUntil || c.valid_until;
        if (!raw) return null;
        const ts = new Date(raw).getTime();
        if (!Number.isFinite(ts)) return null;
        const days = Math.ceil((ts - now) / (24 * 3600 * 1000));
        return {
          name: c.filename || c.originalName || c.id,
          days,
          date: new Date(ts).toLocaleDateString('pt-BR')
        };
      })
      .filter(Boolean)
      .filter(c => c.days <= 30);

    if (!items.length) {
      banner.style.display = 'none';
      banner.textContent = '';
      return;
    }

    items.sort((a, b) => a.days - b.days);
    const worst = items[0];
    const isDanger = worst.days <= 7 || worst.days < 0;
    banner.className = `cert-expiry-banner${isDanger ? ' danger' : ''}`;
    banner.style.display = 'flex';

    if (worst.days < 0) {
      banner.innerHTML = `<strong>Certificado expirado</strong> — ${window.AppUtils.escapeHtml(worst.name)} venceu em ${worst.date}. Renove o A1.`;
    } else {
      const names = items.slice(0, 3).map(i => `${i.name} (${i.days}d)`).join(', ');
      banner.innerHTML = `<strong>Validade do A1</strong> — certificado(s) a vencer em até 30 dias: ${window.AppUtils.escapeHtml(names)}.`;
    }
  },

  bind() {
    document.getElementById('btn-refresh-api-health')?.addEventListener('click', () => this.loadApiHealth());
    document.getElementById('btn-refresh-sync-runs')?.addEventListener('click', () => this.loadSyncRuns());
    document.getElementById('btn-refresh-audit')?.addEventListener('click', () => this.loadAuditLog());
    document.getElementById('btn-refresh-analytics')?.addEventListener('click', () => this.loadAnalytics());

    // Atualiza contador do retry a cada segundo
    if (!window._retryTicker) {
      window._retryTicker = setInterval(() => {
        window.AppSyncController?.renderRetryStatus?.();
      }, 1000);
    }
  },

  async refreshOpsInsights() {
    await Promise.all([
      this.loadApiHealth(),
      this.loadSyncRuns()
    ]);
  },

  async refreshDashboardExtras(certificates) {
    this.renderCertExpiryBanner(certificates);
    await Promise.all([
      this.loadAnalytics(),
      this.loadAuditLog()
    ]);
  }
};

// Integra no sync controller
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
  loadSyncRuns() {
    return window.AppInsights?.loadSyncRuns?.();
  }
});
