const express = require('express');
const {
  listUnits,
  upsertUnit,
  deleteUnit
} = require('../services/supabase');

const router = express.Router();

router.get('/units', async (req, res) => {
  try {
    const units = await listUnits();
    return res.json({ success: true, units });
  } catch (err) {
    console.error('Erro ao listar unidades:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/units', async (req, res) => {
  try {
    const { id = null, name, cnpj, city = '', state = '' } = req.body || {};
    const unit = await upsertUnit({ id, name, cnpj, city, state });
    return res.json({ success: true, unit });
  } catch (err) {
    console.error('Erro ao salvar unidade:', err);
    return res.status(400).json({ success: false, error: err.response?.data?.message || err.message });
  }
});

router.delete('/units/:id', async (req, res) => {
  try {
    const unit = await deleteUnit(req.params.id);
    return res.json({ success: true, unit });
  } catch (err) {
    console.error('Erro ao remover unidade:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
