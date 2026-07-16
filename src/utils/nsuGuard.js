function normalizeNsu(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/**
 * Impede que uma consulta ascendente volte acidentalmente ao NSU zero quando
 * ja existe progresso persistido. Uma zeragem explicita continua funcionando,
 * pois o endpoint de reset tambem zera o estado salvo antes da proxima busca.
 */
function protectAscendingStartNsu({ requestedStartNsu, savedLastNsu, sortOrder = 'asc' }) {
  const requested = normalizeNsu(requestedStartNsu);
  const saved = normalizeNsu(savedLastNsu);

  if (String(sortOrder || 'asc').toLowerCase() !== 'asc' || requested !== 0 || saved === 0) {
    return { startNsu: requested, adjusted: false, requestedStartNsu: requested };
  }

  return { startNsu: saved, adjusted: true, requestedStartNsu: requested };
}

module.exports = {
  normalizeNsu,
  protectAscendingStartNsu
};
