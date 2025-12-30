import express from "express";
import prismaMod from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * GET /reports/analytics
 *
 * Query params:
 * - from (YYYY-MM-DD)
 * - to (YYYY-MM-DD)
 * - type (sms | whatsapp)
 * - campaignId (optional)
 * - templateId (optional)
 */
router.get(
  "/analytics",
  requireAuth,
  enforceTokenTenant,
  async (req, res) => {
    try {
      const tenantId = req.tenantId;

      const {
        from,
        to,
        type,
        campaignId,
        templateId
      } = req.query;

      // -----------------------
      // Validação básica
      // -----------------------
      if (!from || !to) {
        return res.status(400).json({
          error: "Parâmetros 'from' e 'to' são obrigatórios"
        });
      }

      if (type && !["sms", "whatsapp"].includes(type)) {
        return res.status(400).json({
          error: "Tipo inválido (use sms ou whatsapp)"
        });
      }

      const fromDate = new Date(`${from}T00:00:00.000Z`);
      const toDate = new Date(`${to}T23:59:59.999Z`);

      // -----------------------
      // WHERE base (logs)
      // -----------------------
      const whereLogs = {
        tenantId,
        createdAt: {
          gte: fromDate,
          lte: toDate
        }
      };

      if (type) {
        whereLogs.channel = type;
      }

      if (campaignId) {
        whereLogs.campaignId = campaignId;
      }

      // filtro por template (join indireto via campaign)
      if (templateId) {
        whereLogs.campaign = {
          templateId
        };
      }

      // -----------------------
      // SUMMARY (KPIs)
      // -----------------------
      const logs = await prisma.outboundLog.findMany({
        where: whereLogs,
        select: {
          status: true,
          cost: true
        }
      });

      const summary = {
        processed: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        costEstimated: 0
      };

      for (const log of logs) {
        if (log.status === "processed") summary.processed++;
        if (log.status === "delivered") summary.delivered++;
        if (log.status === "read") summary.read++;
        if (log.status === "failed") summary.failed++;

        if (log.cost) {
          summary.costEstimated += Number(log.cost);
        }
      }

      // -----------------------
      // SERIES (gráfico diário)
      // -----------------------
      const seriesRaw = await prisma.$queryRaw`
        SELECT
          DATE("createdAt") as date,
          COUNT(*) FILTER (WHERE status = 'processed') as processed,
          COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
          COUNT(*) FILTER (WHERE status = 'read') as read,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM "OutboundLog"
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" BETWEEN ${fromDate} AND ${toDate}
          ${type ? prisma.$unsafe(`AND channel = '${type}'`) : prisma.$unsafe("")}
          ${campaignId ? prisma.$unsafe(`AND "campaignId" = '${campaignId}'`) : prisma.$unsafe("")}
        GROUP BY DATE("createdAt")
        ORDER BY DATE("createdAt") ASC
      `;

      const series = seriesRaw.map(row => ({
        date: row.date.toISOString().slice(0, 10),
        processed: Number(row.processed || 0),
        delivered: Number(row.delivered || 0),
        read: Number(row.read || 0),
        failed: Number(row.failed || 0)
      }));

      // -----------------------
      // RESPONSE
      // -----------------------
      return res.json({
        summary,
        series,
        meta: {
          type: type || "all",
          from,
          to,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error("❌ reports/analytics error:", err);
      return res.status(500).json({
        error: "Erro ao gerar analytics"
      });
    }
  }
);

export default router;
