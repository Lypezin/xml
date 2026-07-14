const express = require('express');
const {
  listUnits,
  upsertUnit,
  deleteUnit
} = require('../services/supabase');
const { safeErrorInfo } = require('../utils/security');

const router = express.Router();

router.get('/units', async (req, res) => {
  try {
    const units = await listUnits();
    return res.json({ success: true, units });
  } catch (err) {
    console.error('[units:list]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível listar as unidades.' });
  }
});

router.post('/units', async (req, res) => {
  try {
    const { id = null, name, cnpj, city = '', state = '' } = req.body || {};
    const unit = await upsertUnit({ id, name, cnpj, city, state });
    return res.json({ success: true, unit });
  } catch (err) {
    console.error('[units:save]', safeErrorInfo(err));
    return res.status(400).json({ success: false, error: 'Não foi possível salvar a unidade. Revise os dados informados.' });
  }
});

router.delete('/units/:id', async (req, res) => {
  try {
    const unit = await deleteUnit(req.params.id);
    return res.json({ success: true, unit });
  } catch (err) {
    console.error('[units:remove]', safeErrorInfo(err));
    return res.status(400).json({ success: false, error: 'Não foi possível remover a unidade.' });
  }
});

module.exports = router;
