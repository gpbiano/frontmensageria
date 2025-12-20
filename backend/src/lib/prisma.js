// backend/src/lib/prisma.js

// Compat ESM + CommonJS para @prisma/client
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

let prisma;

// Reaproveita instância em dev (hot reload)
if (globalThis.__prisma) {
  prisma = globalThis.__prisma;
} else {
  prisma = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"]
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = prisma;
  }
}

export { prisma };
