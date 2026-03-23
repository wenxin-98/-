// src/utils/logger.ts
import winston from 'winston';
import { ENV } from '../config.js';

const { combine, timestamp, printf, colorize } = winston.format;

const SENSITIVE_KEYS = /password|secret|token|key|pass|auth|cookie|jwt|private/i;

/** 脱敏 JSON 中的敏感字段 */
function redactSensitive(obj: any): any {
  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object' || !obj) return obj;
  const result: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(k) && typeof v === 'string') {
      result[k] = v.length > 4 ? v.slice(0, 2) + '***' + v.slice(-2) : '***';
    } else if (typeof v === 'object') {
      result[k] = redactSensitive(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const safe = Object.keys(meta).length ? ` ${JSON.stringify(redactSensitive(meta))}` : '';
  return `${timestamp} [${level}] ${message}${safe}`;
});

export const logger = winston.createLogger({
  level: ENV.NODE_ENV === 'development' ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), logFormat),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});
