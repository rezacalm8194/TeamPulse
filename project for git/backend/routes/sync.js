const router = require('express').Router();
const auth = require('../middleware/auth');
router.get('/', auth, (req, res) => res.json({ message: 'sync coming soon' }));
module.exports = router;
