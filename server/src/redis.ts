import { Redis } from 'ioredis';
import { env } from './config.js';

// Fail requests quickly when Redis is down instead of queueing them forever. Rate
// limiting is then unavailable, and the protected endpoints return an error.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
