const Joi = require('joi');
const { ValidationError } = require('../../../../shared/errors');

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Return all errors, not just the first one
      stripUnknown: true // Remove unknown fields
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return next(new ValidationError('Validation failed', details));
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

// User validation schemas
const schemas = {
  register: Joi.object({
    email: Joi.string()
      .email()
      .lowercase()
      .trim()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),

    password: Joi.string()
      .min(8)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'any.required': 'Password is required'
      }),

    firstName: Joi.string()
      .min(2)
      .max(50)
      .trim()
      .optional(),

    lastName: Joi.string()
      .min(2)
      .max(50)
      .trim()
      .optional()
  }),

  login: Joi.object({
    email: Joi.string()
      .email()
      .lowercase()
      .trim()
      .required(),

    password: Joi.string()
      .required()
  }),

  updateProfile: Joi.object({
    firstName: Joi.string()
      .min(2)
      .max(50)
      .trim()
      .optional(),

    lastName: Joi.string()
      .min(2)
      .max(50)
      .trim()
      .optional(),

    email: Joi.string()
      .email()
      .lowercase()
      .trim()
      .optional()
  }).min(1), // At least one field must be present

  changePassword: Joi.object({
    currentPassword: Joi.string()
      .required(),

    newPassword: Joi.string()
      .min(8)
      .required()
      .invalid(Joi.ref('currentPassword'))
      .messages({
        'any.invalid': 'New password must be different from current password'
      })
  })
};

module.exports = {
  validate,
  schemas
};
