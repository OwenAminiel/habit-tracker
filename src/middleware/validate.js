const { AppError } = require('../utils/errors');

// validate(schema, 'body' | 'query' | 'params')
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || source,
      message: i.message,
    }));
    return next(new AppError(400, 'Validation failed.', details));
  }
  req[source] = result.data;
  next();
};

module.exports = { validate };
