const { formatNationalApiRejection } = require('../services/nfse');
const { syncSupabaseState, finishSupabaseRun } = require('../services/supabase');

async function handleSyncError({ e, res, selectedCertificate, requestEnvironment, requestStartNsu, requestCnpjConsulta, supabaseRunId }) {
  if (e.response && e.response.status === 404) {
    const data = e.response.data;
    if (data && (data.StatusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO' || 
                 (data.Erros && data.Erros.some(err => err.Codigo === 'E2220')))) {
      const fallbackNsu = requestStartNsu;
      if (selectedCertificate) {
        await syncSupabaseState({
          certificateId: selectedCertificate.id,
          environment: requestEnvironment,
          cnpjConsulta: requestCnpjConsulta,
          lastNsu: fallbackNsu,
          maxNsuSeen: fallbackNsu,
          status: 'completed'
        });
        await finishSupabaseRun({
          runId: supabaseRunId,
          status: 'completed',
          endNsu: fallbackNsu,
          maxNsuSeen: fallbackNsu,
          documentsFound: 0
        });
      }
      return res.json({ success: true, ultNSU: fallbackNsu, maxNSU: fallbackNsu, documentos: [] });
    }
  }

  let errorMsg = e.message;
  const isTransientTransportError =
    e.isTransient ||
    e.code === 'ECONNABORTED' ||
    /timeout|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|Retorno vazio/i.test(String(e.message || ''));

  if (e.response) {
    const rejection = formatNationalApiRejection(e.response.data);
    if (rejection) {
      errorMsg = rejection;
    } else if (e.response.status === 200) {
      errorMsg = 'Retorno vazio temporario da API Nacional.';
    } else {
      const statusMap = {
        496: 'Erro 496: Certificado não fornecido ou inválido para o mTLS da Receita Federal.',
        403: 'Erro 403: Acesso Proibido. O certificado não tem permissão ou o ambiente bloqueou a conexão.',
        401: 'Erro 401: Não autorizado. Verifique as credenciais do certificado.',
        429: 'Erro 429/656: Consumo Indevido. Aguarde 1 hora antes de consultar novamente.',
        656: 'Erro 429/656: Consumo Indevido. Aguarde 1 hora antes de consultar novamente.'
      };
      errorMsg = statusMap[e.response.status] || `Erro ${e.response.status} retornado pelo servidor nacional: ${JSON.stringify(e.response.data || '')}`;
    }
  }

  const isTransientError = isTransientTransportError || /Retorno vazio temporario|Erro 200 retornado/i.test(errorMsg);

  if (selectedCertificate) {
    if (isTransientError) {
      // Finaliza a run para nao ficar "running" eternamente; nao regride last_nsu
      await finishSupabaseRun({
        runId: supabaseRunId,
        status: 'error',
        endNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        documentsFound: 0,
        errorMessage: errorMsg
      });
    } else {
      const nextAllowedAt = /429|656|Consumo Indevido/i.test(errorMsg)
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : null;
      await syncSupabaseState({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        cnpjConsulta: requestCnpjConsulta,
        lastNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        status: 'error',
        nextAllowedAt,
        lastError: errorMsg
      });
      await finishSupabaseRun({
        runId: supabaseRunId,
        status: 'error',
        endNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        documentsFound: 0,
        errorMessage: errorMsg
      });
    }
  }

  return res.status(isTransientError ? 503 : 500).json({
    success: false,
    error: errorMsg,
    retryable: isTransientError,
    nationalApi: e.nationalApi || null
  });
}

module.exports = {
  handleSyncError
};
