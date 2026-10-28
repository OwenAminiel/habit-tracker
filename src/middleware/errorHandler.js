function notFound(req, res) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}`, request_id: req.id } });
}

function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body contains invalid JSON.', request_id: req.id } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body is too large.', request_id: req.id } });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(`[${req.id}]`, err);
  res.status(status).json({
    error: {
      message: status >= 500 ? 'Internal server error.' : err.message,
      ...(err.details && { details: err.details }),
      request_id: req.id,
    },
  });
}

module.exports = { notFound, errorHandler };
