// Downloads Excel/ZIP
function formatDateForFileName(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function buildExcelFileName(params = {}) {
  const start = formatDateForFileName(params.startDate);
  const end = formatDateForFileName(params.endDate);
  if (start && end) return `Notas_NFSe_${start}_a_${end}.xlsx`;
  if (start) return `Notas_NFSe_desde_${start}.xlsx`;
  if (end) return `Notas_NFSe_ate_${end}.xlsx`;
  return 'Notas_NFSe.xlsx';
}

Object.assign(window.AppApi = window.AppApi || {}, {
async downloadPeriodZip(params) {
    const res = await fetch('/api/download-period-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      let message = 'Erro no ZIP.';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (err) {
        message = await res.text() || message;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = params.startDate && params.endDate
      ? `NFS-e_Periodo_${params.startDate}_a_${params.endDate}.zip`
      : 'NFS-e_XMLs_Tabela.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  },

  async downloadExcel(params) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/download-excel?${query}`);
    if (!res.ok) {
      let message = 'Erro ao baixar Excel.';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (err) {
        message = await res.text() || message;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    // Preferir o nome do Content-Disposition do servidor, se existir
    const disposition = res.headers.get('Content-Disposition') || '';
    const starMatch = disposition.match(/filename\*=(?:UTF-8''|)([^;]+)/i);
    const plainMatch = disposition.match(/filename="([^"]+)"/i)
      || disposition.match(/filename=([^;]+)/i);
    let serverName = '';
    if (starMatch) {
      try {
        serverName = decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ''));
      } catch (e) {
        serverName = starMatch[1].trim().replace(/^"|"$/g, '');
      }
    } else if (plainMatch) {
      serverName = plainMatch[1].trim().replace(/^"|"$/g, '');
    }
    anchor.download = serverName || buildExcelFileName(params);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  },

  async downloadIntegrityManifest(params) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/download-integrity-manifest?${query}`);
    if (!res.ok) {
      let message = 'Erro ao gerar manifesto de integridade.';
      try { message = (await res.json()).error || message; } catch (error) {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    anchor.download = match?.[1] || 'Manifesto_Integridade_NFSe.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
});
