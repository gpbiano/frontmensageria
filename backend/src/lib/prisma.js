// backend/src/lib/prisma.js
import { PrismaClient } from "@prisma/client";
import logger from "../logger.js";

let prisma;

/**
 * Singleton global do Prisma
 * Evita múltiplas instâncias em imports diferentes
 */
if (!global.__GP_PRISMA__) {
  prisma = new PrismaClient({
    log: ["error", "warn"]
  });

  prisma
    .$connect()
    .then(() => {
      logger.info("✅ Prisma conectado (singleton)");
    })
    .catch((err) => {
      logger.error({ err }, "❌ Falha ao conectar Prisma");
    });

  global.__GP_PRISMA__ = prisma;
} else {
  prisma = global.__GP_PRISMA__;
}

export default prisma;
export { prisma };
