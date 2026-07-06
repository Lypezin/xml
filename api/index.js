try {
  module.exports = require('../server');
} catch (err) {
  module.exports = (req, res) => {
    res.status(500).json({
      error: "Erro na inicialização do servidor (Boot Crash)",
      message: err.message,
      stack: err.stack
    });
  };
}
