require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
// Same defaults as helmet(), minus upgrade-insecure-requests so the site also works over plain http://localhost.
app.use(
  helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } } })
);
app.use(cors());
app.use(express.json({ limit: '10kb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/habits', require('./routes/habits'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
