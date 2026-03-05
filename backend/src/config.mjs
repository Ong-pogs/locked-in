import { config as loadEnv } from 'dotenv';

loadEnv();

function required(name, fallback = '') {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function csvList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const defaultCorsOrigins = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const configuredCorsOrigins = csvList(
  process.env.CORS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGIN ?? '',
);

export const appConfig = {
  port: optionalInt('PORT', 3001),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: required('JWT_SECRET', 'dev-only-please-change'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'lockedin-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'lockedin-mobile',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  corsAllowedOrigins:
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins,
};
