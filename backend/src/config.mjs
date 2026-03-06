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

function optionalBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
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
  logPretty: optionalBool('LOG_PRETTY', process.env.NODE_ENV !== 'production'),
  logSingleLine: optionalBool('LOG_SINGLE_LINE', true),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: required('JWT_SECRET', 'dev-only-please-change'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'lockedin-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'lockedin-mobile',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  schedulerSecret: required('SCHEDULER_SECRET', 'dev-only-scheduler-secret'),
  missExtensionDays: optionalInt('MISS_EXTENSION_DAYS', 7),
  corsAllowedOrigins:
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins,
};
