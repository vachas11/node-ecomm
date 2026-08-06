import { Request, Response, NextFunction } from 'express';
import Joi, { Schema } from 'joi';
import { ValidationError } from '../../../../shared/errors';

interface ValidationDetail {
  field: string;
  message: string;
}

export const validate = (schema: Schema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details: ValidationDetail[] = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      next(new ValidationError('Validation failed', details));
      return;
    }

    req.body = value;
    next();
  };
};

export const schemas = {
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

    firstName: Joi.string().min(2).max(50).trim().required().messages({
      'any.required': 'First name is required'
    }),
    lastName: Joi.string().min(2).max(50).trim().required().messages({
      'any.required': 'Last name is required'
    })
  }),

  login: Joi.object({
    email: Joi.string()
      .email()
      .lowercase()
      .trim()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),
    password: Joi.string().required().messages({
      'any.required': 'Password is required'
    })
  }),

  refresh: Joi.object({
    refreshToken: Joi.string().required().messages({
      'any.required': 'Refresh token is required'
    })
  })
};
