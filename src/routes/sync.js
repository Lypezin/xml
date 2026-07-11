const express = require('express');
const router = express.Router();
router.use(require('./syncFetch'));
router.use(require('./syncDiscover'));
router.use(require('./syncState'));
router.use(require('./syncScan'));
module.exports = router;
