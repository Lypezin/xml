const express = require('express');

const router = express.Router();

router.use(require('./downloadsList'));
router.use(require('./downloadsSingle'));
router.use(require('./downloadsExcel'));
router.use(require('./downloadsPeriodZip'));

module.exports = router;
