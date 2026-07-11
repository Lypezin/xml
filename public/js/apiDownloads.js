// Downloads Excel/ZIP
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
    anchor.download = params.startDate && params.endDate
      ? `NFS-e_Relatorio_${params.startDate}_a_${params.endDate}.xlsx`
      : 'NFS-e_Relatorio_Tabela.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
});
