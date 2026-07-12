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
        list.innerHTML = `<div class="helper-text">${data.warning || 'Nenhuma varredura registrada ainda.'}</div>`;
        return;
      }
      const esc = window.AppUtils.escapeHtml;
      list.innerHTML = runs.map(run => {
        const status = String(run.status || 'running');
        const start = run.started_at || run.startedAt;
        const when = start ? new Date(start).toLocaleString('pt-BR') : '—';
        const dur = run.duration_seconds != null
          ? `${run.duration_seconds}s`
          : '—';
        const nsuRange = `NSU ${run.start_nsu ?? 0} → ${run.end_nsu ?? run.max_nsu_seen ?? '…'}`;
        const docs = run.documents_found != null ? `${run.documents_found} doc(s)` : '';
        const err = run.error_message ? ` · ${run.error_message}` : '';
        return `
          <article class="sync-run-item">
            <strong>${esc(when)}</strong>
            <span class="sync-run-status ${esc(status)}">${esc(status)}</span>
            <div class="run-meta">${esc(nsuRange)} · ${esc(docs)} · duração ${esc(dur)}${esc(err)}</div>
          </article>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="helper-text">Não foi possível carregar o histórico.</div>`;
    }
  },

  async loadAnalytics() {
    try {
      const data = await window.AppApi.fetchDashboardAnalytics({ months: 12 });
      const a = data.analytics || {};
      const mom = a.comparisons?.monthOverMonth || {};
      const yoy = a.comparisons?.yearOverYear || {};

      const momEl = document.getElementById('analytics-mom-value');
      const yoyEl = document.getElementById('analytics-yoy-value');
      const momD = document.getElementById('analytics-mom-delta');
      const yoyD = document.getElementById('analytics-yoy-delta');
      const canc = document.getElementById('analytics-cancelled');

      if (momEl) momEl.textContent = this.formatMoney(mom.current);
      if (yoyEl) yoyEl.textContent = this.formatMoney(yoy.current);
      if (canc) canc.textContent = String(a.totals?.cancelled || 0);

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

      this.renderMonthlyChart(a.monthly || []);
      this.renderRanking('ranking-prestador', a.rankingPrestador || []);
      this.renderRanking('ranking-tomador', a.rankingTomador || []);
    } catch (err) {
      // silencioso
    }
  },

  renderMonthlyChart(monthly) {
    const el = document.getElementById('analytics-monthly-chart');
    if (!el) return;
    if (!monthly.length) {
      el.innerHTML = '<div class="helper-text">Sem dados mensais ainda. Aplique a migração SQL e sincronize notas.</div>';
      return;
    }
    const max = Math.max(...monthly.map(m => Number(m.count || 0)), 1);
    el.innerHTML = monthly.map(m => {
      const count = Number(m.count || 0);
      const cancelled = Number(m.cancelled || 0);
      const h = Math.max(6, Math.round((count / max) * 140));
      const label = String(m.month || '').slice(5) || m.month;
      const title = `${m.month}: ${count} notas (${cancelled} canceladas) · ${this.formatMoney(m.value)}`;
      return `
        <div class="chart-bar-col" title="${window.AppUtils.escapeHtml(title)}">
          <div class="chart-bar ${cancelled > 0 ? 'cancelled-part' : ''}" style="height:${h}px"></div>
          <span class="chart-bar-label">${window.AppUtils.escapeHtml(label)}</span>
        </div>
      `;
    }).join('');
  },

  renderRanking(elementId, rows) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="helper-text">Sem ranking ainda.</div>';
      return;
    }
    const esc = window.AppUtils.escapeHtml;
    el.innerHTML = rows.slice(0, 8).map((r, i) => `
      <div class="ranking-item">
        <span class="rank-num">${i + 1}</span>
        <span class="rank-name" title="${esc(r.name || '')}">${esc(r.name || '—')}</span>
        <span class="rank-value">${esc(this.formatMoney(r.value))}</span>
      </div>
    `).join('');
  },

  async loadAuditLog() {
    const list = document.getElementById('audit-list');
    if (!list) return;
    try {
      const data = await window.AppApi.fetchAuditLog({ limit: 40 });
      const events = data.events || [];
      if (!events.length) {
        list.innerHTML = `<div class="helper-text">${data.warning || 'Nenhum download/export registrado ainda.'}</div>`;
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
      list.innerHTML = '<div class="helper-text">Auditoria indisponível.</div>';
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
