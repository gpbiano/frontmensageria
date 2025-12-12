// backend/src/logger.js
import pino from "pino";

const ENV = process.env.NODE_ENV || "development";
const isDev = ENV === "development";

const level = process.env.LOG_LEVEL || (isDev ? "debug" : "info");

/**
 * Redaction para não vazar segredos em logs:
 * - Authorization (Bearer ...)
 * - Senhas
 * - Tokens / API keys
 * - Cookies
 */
const redact = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers['x-api-key']",
    "req.headers['x-access-token']",
    "req.body.password",
    "req.body.pass",
    "req.body.token",
    "req.body.access_token",
    "req.body.refresh_token",
    "req.body.apiKey",
    "req.body.api_key",
    "req.body.openai_api_key",
    "req.body.whatsapp_token",
    "body.password",
    "body.pass",
    "body.token",
    "body.access_token",
    "body.refresh_token",
    "body.apiKey",
    "body.api_key"
  ],
  censor: "[REDACTED]"
};

function buildTransport() {
  // Pretty só no DEV. Em prod, log puro JSON.
  if (!isDev) return undefined;

  // pino-pretty precisa estar instalado no backend
  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
      ignore: "pid,hostname",
      singleLine: true
    }
  };
}

const logger = pino({
  level,
  redact,
  base: {
    env: ENV,
    service: process.env.SERVICE_NAME || "gplabs-whatsapp-api"
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: buildTransport()
});

export default logger;

