import { prisma } from "../src/lib/prisma.js";

const email = process.argv[2];
if (!email) {
  console.log("Uso: node scripts/make-superadmin.js seu@email.com");
  process.exit(1);
}

const run = async () => {
  const user = await prisma.user.update({
    where: { email: String(email).toLowerCase().trim() },
    data: { isSuperAdmin: true }
  });
  console.log("OK: super-admin habilitado:", { id: user.id, email: user.email });
};

run()
  .catch((e) => {
    console.error("ERRO:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
