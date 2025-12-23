// backend/src/routes/settings/whatsappChannelRouter.js
import express from "express";
import crypto from "crypto";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * Espera que resolveTenant já tenha colocado req.tenant (ou req.tenantId)
 * e que requireAuth já tenha colocado req.user.
 *
 * Endpoints:
 * - POST   /settings/channels/whatsapp/start
 * - POST   /settings/channels/whatsapp/callback
 * - DELETE /settings/channels/whatsapp
 */

function getTenantIdFromReq(req) {
  const t =
    req?.tenant?.id ||
    req?.tenantId ||
    req?.headers?.["x-tenant-id"] ||
    req?.headers?.["X-Tenant-Id"];
  return t ? String(t) : null;
}

function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

function getMetaScopes() {
  return [
    "whatsapp_business_messaging",
    "business_management"
  ];
}

/**
 * POST /settings/channels/whatsapp/start
 * Retorna { appId, state, scopes }
 * (isso destrava seu frontend e abre o FB SDK)
 */
router.post("/start", async (req, res) => {
  try {
    const tenantId = getTenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant não resolvido." });

    const appId = requireEnv("META_APP_ID");

    // state anti-CSRF (assinado/validável)
    // aqui estamos gerando um token simples; se quiser, dá pra persistir no DB/redis.
    const state = crypto.randomUUID();

    // Opcional: você pode armazenar state em ChannelConfig como "pendingState"
    // pra validar no callback. Por ora, vamos só devolver.
    return res.json({
      appId,
      state,
      scopes: getMetaScopes()
    });
  } catch (e) {
    logger.error("[whatsapp.start] error:", e);
    return res.status(500).json({
      error: e?.message || "Falha ao iniciar conexão do WhatsApp"
    });
  }
});

/**
 * POST /settings/channels/whatsapp/callback
 * Recebe { code, state }
 * Aqui você vai implementar:
 * - validar state
 * - trocar code -> access token
 * - buscar WABA / phone_number_id
 * - salvar ChannelConfig (whatsapp) como enabled/status connected
 *
 * Por enquanto: stub (não quebra o front, mas ainda não conecta de verdade)
 */
router.post("/callback", async (req, res) => {
  try {
    const tenantId = getTenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant não resolvido." });

    const code = String(req.body?.code || "").trim();
    const state = String(req.body?.state || "").trim();

    if (!code || !state) {
      return res.status(400).json({ error: "code/state são obrigatórios" });
    }

    // ✅ STUB: retorna 501 até você implementar a troca com a Meta
    return res.status(501).json({
      error:
        "Callback ainda não implementado no backend. Endpoint recebido com sucesso (code/state)."
    });
  } catch (e) {
    logger.error("[whatsapp.callback] error:", e);
    return res.status(500).json({ error: e?.message || "Falha no callback WhatsApp" });
  }
});

/**
 * DELETE /settings/channels/whatsapp
 * Desconecta WhatsApp do tenant (zera ChannelConfig)
 */
router.delete("/", async (req, res) => {
  try {
    const tenantId = getTenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant não resolvido." });

    // remove/zera config do canal whatsapp
    await prisma.channelConfig.upsert({
      where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
      create: {
        tenantId,
        channel: "whatsapp",
        enabled: false,
        status: "disabled",
        config: {}
      },
      update: {
        enabled: false,
        status: "disabled",
        config: {}
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    logger.error("[whatsapp.disconnect] error:", e);
    return res.status(500).json({ error: e?.message || "Falha ao desconectar WhatsApp" });
  }
});

export default router;
