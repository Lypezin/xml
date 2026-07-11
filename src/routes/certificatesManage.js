const express = require('express');
const router = express.Router();
router.use(require('./certificatesUpload'));
router.use(require('./certificatesRenameRemove'));
module.exports = router;
