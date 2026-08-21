function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}` } });
}

function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  // A malformed :id path param (not a valid ObjectId) is a client mistake,
  // not a server error, and should read as "not found" rather than a 500.
  if (error.name === 'CastError' && error.kind === 'ObjectId') {
    return res.status(404).json({ error: { message: 'Resource not found.' } });
  }

  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    // Deliberately log only safe diagnostic fields. Webhook bodies and headers
    // may contain payment data or credentials and must never be logged.
    console.error({ message: error.message, statusCode, code: error.code });
  }

  res.status(statusCode).json({
    error: {
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      details: error.details
    }
  });
}

module.exports = { notFoundHandler, errorHandler };
