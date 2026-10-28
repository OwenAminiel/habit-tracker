require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { requestLogger } = require('./middleware/requestLogger');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Behind a hosting proxy (Render, Railway...) set TRUST_PROXY=1 so rate limits see each visitor's real address.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

app.use(requestLogger);
// Same defaults as helmet(), minus upgrade-insecure-requests so the site also works over plain http://localhost.
app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } } }));
// CORS_ORIGIN can hold a comma-separated list of allowed origins. Without it, any origin may call the API.
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) } : undefined));
app.use(express.json({ limit: '10kb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// API documentation: interactive page at /docs, raw spec at /openapi.json
const swaggerUi = require('swagger-ui-express');
const openapi = require('./docs/openapi');
app.get('/openapi.json', (req, res) => res.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Habit Tracker API docs', swaggerOptions: { persistAuthorization: true } }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', apiLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/habits', require('./routes/habits'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/export', require('./routes/export'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
