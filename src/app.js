require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/habits', require('./routes/habits'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
