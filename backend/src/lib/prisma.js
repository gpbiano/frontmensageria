// backend/src/lib/prisma.js
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

// evita múltiplas conexões em dev / reload
const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

// Exporta dos DOIS jeitos pra não quebrar imports existentes:
export { prisma, PrismaClient };
export default prisma;
