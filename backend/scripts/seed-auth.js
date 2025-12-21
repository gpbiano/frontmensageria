import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/security/passwords.js";

const slug = process.env.SEED_TENANT_SLUG || "gplabs";
const name = process.env.SEED_TENANT_NAME || "GP Labs";

const adminEmail = process.env.SEED_ADMIN_EMAIL || "contato@gplabs.com.br";
const adminName = process.env.SEED_ADMIN_NAME || "Admin GP Labs";

// ⚠️ use uma senha forte via env em produção
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

if (!adminPassword || adminPassword.length < 12) {
  console.error(
    "❌ Defina SEED_ADMIN_PASSWORD com pelo menos 12 caracteres (senha forte) antes de rodar o seed."
  );
  process.exit(1);
}

async function main() {
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
    await prisma.$disconnect();
  });
