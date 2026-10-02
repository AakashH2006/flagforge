export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://ctf:ctf@localhost:5433/ctf_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  FLAG_SECRET: 'test-flag-secret-with-at-least-32-characters',
  FLAG_RATE_LIMIT_MAX: '5',
  FLAG_RATE_LIMIT_WINDOW_SECONDS: '60',
  AUTH_RATE_LIMIT_MAX: '1000',
  // Uploads go to a scratch directory, not the one a dev server writes to.
  UPLOAD_DIR: './test/.uploads',
  MAX_UPLOAD_BYTES: '2048',
  MAX_ATTACHMENTS_PER_CHALLENGE: '2',
};
