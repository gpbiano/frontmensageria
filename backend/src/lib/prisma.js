// backend/src/lib/prisma.js

// Prisma 7 (client gerado via prisma.config.ts)
// Output: ./src/generated/prisma
import { PrismaClient } from "../generated/prisma/index.js";

let prisma;

if (globalThis.__prisma) {
  prisma = globalThis.__prisma;
} else {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = prisma;
  }
}

export { prisma };
