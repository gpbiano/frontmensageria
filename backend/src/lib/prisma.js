// backend/src/lib/prisma.js
// Prisma 7 + Node (runtime "library") — importa direto do client gerado
import { PrismaClient } from "../../node_modules/.prisma/client/client.js";

let prisma = globalThis.__prisma;

if (!prisma) {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  // evita recriar client no dev (hot reload)
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = prisma;
  }
}

export { prisma };
