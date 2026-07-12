const { supabaseRpc } = require('./supabaseClient');

async function registerAuditEvent({
  certificateId = null,
  environment = null,
  nsu = null,
  fileName = null,
  action = 'xml',
  userEmail = null,
  details = {}
} = {}) {
  try {
    await supabaseRpc('xml_nfse_register_audit_event', {
      p_certificate_id: certificateId,
      p_environment: environment,
      p_nsu: nsu === undefined || nsu === null ? null : Number(nsu),
      p_file_name: fileName,
      p_action: action || 'xml',
      p_user_email: userEmail || null,
      p_details: details || {}
    });
    return true;
  } catch (err) {
    // Fallback para RPC antiga
    try {
      await supabaseRpc('xml_nfse_register_download', {
        p_certificate_id: certificateId,
        p_environment: environment,
        p_nsu: nsu === undefined || nsu === null ? null : Number(nsu),
        p_file_name: fileName
      });
      return true;
    } catch (err2) {
      console.warn('[audit] falha ao registrar evento:', err2.message || err.message);
      return false;
    }
  }
}

function userEmailFromReq(req) {
  return req?.authUser?.email || req?.user?.email || null;
}

module.exports = {
  registerAuditEvent,
  userEmailFromReq
};
