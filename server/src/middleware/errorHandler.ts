import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError, pgError } from '../lib/errors.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request',
      issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  // Errors from express.json(), such as malformed JSON or an oversized body.
  if (typeof err?.status === 'number' && err.expose) {
    const message = err.type === 'entity.parse.failed' ? 'Malformed JSON body' : err.message;
    res.status(err.status).json({ error: message });
    return;
  }

  // Constraint violations that route handlers didn't turn into friendlier messages.
  const pg = pgError(err);
  if (pg?.code === '23505') {
    res.status(409).json({ error: 'A conflicting record already exists' });
    return;
  }
  if (pg?.code === '23514') {
    res.status(400).json({ error: 'Request violates a data constraint' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
