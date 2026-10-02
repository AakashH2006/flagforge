import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { corsOrigins, env } from './config.js';
import { HttpError } from './lib/errors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { challengesRouter } from './routes/challenges.js';
import { eventsRouter } from './routes/events.js';
import { scoreboardRouter } from './routes/scoreboard.js';
import { teamsRouter } from './routes/teams.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  // Retry-After is exposed so browser clients can show when a rate limit ends.
  app.use(cors({ origin: corsOrigins, exposedHeaders: ['Retry-After'] }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/events/:eventId/teams', teamsRouter);
  app.use('/api/events/:eventId/challenges', challengesRouter);
  app.use('/api/events/:eventId/scoreboard', scoreboardRouter);
  app.use('/api/events', eventsRouter);

  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));
  app.use(errorHandler);

  return app;
}
