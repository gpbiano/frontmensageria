// backend/src/lib/prisma.js
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

// Exporta dos dois jeitos (compat)
export { prisma, PrismaClient };
export default prisma;
