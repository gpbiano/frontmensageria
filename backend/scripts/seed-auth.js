import prismaDefault, { prisma as prismaNamed } from "../src/lib/prisma.js";
import { hashPassword } from "../src/security/passwords.js";

const prisma = prismaNamed || prismaDefault;

const slug = process.env.SEED_TENANT_SLUG || "gplabs";
const name = process.env.SEED_TENANT_NAME || "GP Labs";

const adminEmail = process.env.SEED_ADMIN_EMAIL || "contato@gplabs.com.br";
const adminName = process.env.SEED_ADMIN_NAME || "Admin GP Labs";

const adminPassword = process.env.SEED_ADMIN_PASSWORD;

if (!adminPassword || adminPassword.length < 12) {
  console.error("❌ Defina SEED_ADMIN_PASSWORD com pelo menos 12 caracteres (senha forte).");
  process.exit(1);
}

async function main() {
  if (!prisma?.tenant || !prisma?.user || !prisma?.userTenant) {
    console.error("❌ Prisma Client não tem os models esperados.");
    console.error("hasTenant:", !!prisma?.tenant, "hasUser:", !!prisma?.user, "hasUserTenant:", !!prisma?.userTenant);
    console.error("keys:", Object.keys(prisma || {}).slice(0, 60));
    process.exit(1);
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: { name, isActive: true },
    create: { slug, name, isActive: true },
    select: { id: true, slug: true, name: true },
  });

  const passwordHash = hashPassword(adminPassword);

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: adminName, isActive: true, role: "admin", passwordHash },
    create: { email: adminEmail, name: adminName, role: "admin", isActive: true, passwordHash },
    select: { id: true, email: true, name: true, role: true },
  });

  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: { role: "admin", isActive: true },
    create: { userId: user.id, tenantId: tenant.id, role: "admin", isActive: true },
  });

  console.log("✅ Seed concluído");
  console.log({ tenant, user });
}

main()
  .catch((e) => {
    console.error("❌ Seed falhou:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect?.();
  });
