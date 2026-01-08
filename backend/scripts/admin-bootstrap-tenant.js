// backend/scripts/admin-bootstrap-tenant.js
import crypto from "crypto";
import { prisma } from "../src/lib/prisma.js";

function safeStr(v) {
  return String(v || "").trim();
}

function normalizeSlug(input) {
  return safeStr(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function randomKey(prefix = "wkey") {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Uso:
 * node scripts/admin-bootstrap-tenant.js \
 *   --name "Empresa X" \
 *   --slug "empresa-x" \
 *   --adminEmail "admin@empresa.com" \
 *   --adminName "Admin Empresa" \
 *   --inviteDays 7 \
 *   --webchatEnabled true
 */

function readArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function readBool(flag, def = false) {
  const raw = readArg(flag, null);
  if (raw == null) return def;
  const s = String(raw).toLowerCase().trim();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return def;
}

async function main() {
  const name = safeStr(readArg("--name"));
  const slugArg = safeStr(readArg("--slug"));
  const adminEmail = safeStr(readArg("--adminEmail")).toLowerCase();
  const adminName = safeStr(readArg("--adminName", "")) || null;
  const inviteDays = Math.min(30, Math.max(1, Number(readArg("--inviteDays", "7"))));
  const webchatEnabled = readBool("--webchatEnabled", true);

  if (!name) throw new Error("Param obrigatório: --name");
  if (!adminEmail || !adminEmail.includes("@")) throw new Error("Param obrigatório: --adminEmail válido");

  const slug = normalizeSlug(slugArg || name);
  if (!slug) throw new Error("slug inválido (via --slug ou --name)");

  // Evita duplicar tenant por slug
  const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
  if (existingTenant) {
    throw new Error(`Tenant já existe com slug=${slug} (id=${existingTenant.id})`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1) Tenant
    const tenant = await tx.tenant.create({
      data: {
        name,
        slug,
        isActive: true
      }
    });

    // 2) Admin user global (upsert por email)
    const user = await tx.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        name: adminName,
        role: "admin", // global (não manda muito, mas ok)
        isActive: true
      },
      update: {
        name: adminName || undefined,
        isActive: true
      }
    });

    // 3) Membership admin
    const membership = await tx.userTenant.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: "admin",
        isActive: true
      }
    });

    // 4) PasswordToken (invite)
    const expiresAt = addDays(inviteDays);
    const invite = await tx.passwordToken.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        type: "invite",
        expiresAt,
        used: false
      }
    });

    // 5) Defaults de channels (sempre garantir 4 linhas)
    // OBS: accessToken fica null e config vazio.
    // Status padrão: disabled (ou disconnected se preferir).
    const channelDefaults = [
      { channel: "webchat", enabled: webchatEnabled, status: webchatEnabled ? "connected" : "disabled" },
      { channel: "whatsapp", enabled: false, status: "disabled" },
      { channel: "messenger", enabled: false, status: "disabled" },
      { channel: "instagram", enabled: false, status: "disabled" }
    ];

    // 5.1) Webchat widgetKey + config base
    const widgetKey = randomKey("wkey");

    for (const c of channelDefaults) {
      if (c.channel === "webchat") {
        await tx.channelConfig.create({
          data: {
            tenantId: tenant.id,
            channel: "webchat",
            enabled: c.enabled,
            status: c.status,
            widgetKey,
            config: {
              // backend já usa config.allowedOrigins em alguns fluxos
              allowedOrigins: [],
              // defaults visuais (compat com teu doc de canais)
              primaryColor: "#111827",
              color: "#111827",
              position: "right",
              buttonText: "Ajuda",
              title: "Atendimento",
              headerTitle: "Atendimento",
              greeting: "Olá! Como posso ajudar?",
              // controle do bot no webchat (se você usa isso)
              botEnabled: true
            }
          }
        });
      } else {
        await tx.channelConfig.create({
          data: {
            tenantId: tenant.id,
            channel: c.channel,
            enabled: c.enabled,
            status: c.status,
            config: {}
          }
        });
      }
    }

    // 6) Grupo padrão (opcional e útil para inbox/handoff)
    // Se você não quiser grupo default, pode comentar este bloco.
    const group = await tx.group.create({
      data: {
        tenantId: tenant.id,
        name: "Atendimento",
        isActive: true,
        maxChatsPerAgent: 3
      }
    });

    // 6.1) Vincular admin ao grupo como manager (ou member)
    await tx.groupMember.create({
      data: {
        tenantId: tenant.id,
        groupId: group.id,
        userId: user.id,
        role: "manager",
        isActive: true
      }
    });

    return { tenant, user, membership, invite, widgetKey, group };
  });

  console.log("\n✅ BOOTSTRAP OK");
  console.log("Tenant:", { id: result.tenant.id, slug: result.tenant.slug, name: result.tenant.name });
  console.log("Admin:", { id: result.user.id, email: result.user.email, name: result.user.name });
  console.log("Membership:", { id: result.membership.id, role: result.membership.role });
  console.log("Webchat widgetKey:", result.widgetKey);
  console.log("Grupo default:", { id: result.group.id, name: result.group.name });

  // Token do convite (modo compat: id do PasswordToken)
  console.log("\n🔑 Invite token (compat):", result.invite.id);
  console.log("ExpiresAt:", result.invite.expiresAt.toISOString());
  console.log("\n📌 Use esse token na sua rota de criar senha/reset conforme seu fluxo de auth.\n");
}

main()
  .catch((e) => {
    console.error("❌ ERRO:", e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
