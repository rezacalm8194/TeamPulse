const router = require('express').Router();
const auth = require('../middleware/auth');
router.get('/', auth, (req, res) => res.json({ message: 'files coming soon' }));
module.exports = router;
