import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma = globalThis.__prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export { prisma };
