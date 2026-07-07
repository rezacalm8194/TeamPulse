require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3001;
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/clients', require('./backend/routes/clients'));
app.use('/api/staff', require('./backend/routes/staff'));
app.use('/api/payments', require('./backend/routes/payments'));
app.use('/api/sessions', require('./backend/routes/sessions'));
app.use('/api/tasks', require('./backend/routes/tasks'));
app.use('/api/files', require('./backend/routes/files'));
app.use('/api/backup', require('./backend/routes/backup'));
app.use('/api/data', require('./backend/routes/data'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/sync', require('./backend/routes/sync'));
app.use('/api/reminders', require('./backend/routes/reminders'));
app.use('/api/share', require('./backend/routes/share'));
app.use('/api/speech', require('./backend/routes/speech'));
console.log('Speech API loaded');
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));
app.get('/app', (req,res) => res.sendFile(path.join(__dirname, 'app.html')));
app.get('/share/:token', require('./backend/routes/share').serveShare);
app.use('/api', (req, res) => res.status(404).json({
  error: 'api_route_not_found',
  path: req.originalUrl,
  message: 'API route was not found on this server',
}));
app.use(express.static(__dirname));
app.use((req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log('TeamPulse API on port ' + PORT));
module.exports = app;
