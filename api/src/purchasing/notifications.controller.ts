import { Controller, Get } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { can, isAdmin } from '../common/access'
import type { User } from '../users/user.entity'
import { nextLevel } from './approval'
import { buyerGroupIds, code } from './purchasing.helpers'

interface Notice {
  id: string
  kind: 'aprovacao' | 'cotacao' | 'nota' | 'solicitacao' | 'reprovado' | 'certificado'
  title: string
  description: string
  link: string
  createdAt: string
}

// Avisos do sino: o que está esperando uma ação do usuário.
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@CurrentUser() me: User) {
    const notices: Notice[] = []

    if (can(me, 'aprovador')) {
      const orders = await this.db.query(
        `SELECT o.id, o.number, o.total, o.required_levels AS "requiredLevels", o.created_at AS "createdAt", o.buyer_id,
                s.name AS supplier, g.approval_group_id,
                (SELECT coalesce(array_agg(level), '{}') FROM purchase_order_approvals WHERE order_id = o.id AND decision = 'aprovado') AS approved
         FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN purchase_groups g ON g.id = o.purchase_group_id
         WHERE o.status = 'aguardando_aprovacao' AND o.buyer_id <> $1`,
        [me.id],
      )
      const memberships = await this.db.query(
        `SELECT l.group_id, l.level FROM approval_levels l JOIN approval_level_members m ON m.level_id = l.id WHERE m.user_id = $1`,
        [me.id],
      )
      for (const o of orders) {
        const level = nextLevel(o.requiredLevels, o.approved)
        if (!memberships.some((m: any) => m.group_id === o.approval_group_id && m.level === level)) continue
        notices.push({
          id: `aprovacao-${o.id}`, kind: 'aprovacao', title: `Aprovar ${code('PC', o.number)}`,
          description: `${o.supplier} · ${Number(o.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · nível ${level}`,
          link: `/compras/pedidos/${o.id}`, createdAt: o.createdAt,
        })
      }
    }

    if (can(me, 'comprador')) {
      const groups = await buyerGroupIds(this.db, me)
      const [pending] = await this.db.query(
        `SELECT count(*)::int AS n, min(r.created_at) AS since FROM purchase_request_items i JOIN purchase_requests r ON r.id = i.request_id
         WHERE i.status = 'pendente' AND r.status IN ('aberta', 'em_cotacao') AND ($1::uuid[] IS NULL OR r.purchase_group_id = ANY($1))`,
        [groups],
      )
      if (pending.n) {
        notices.push({
          id: 'cotacao', kind: 'cotacao', title: `${pending.n} item(ns) aguardando cotação`,
          description: 'Itens de solicitações que ainda não entraram em cotação', link: '/compras/cotacoes', createdAt: pending.since,
        })
      }
      const invoices = await this.db.query(
        `SELECT i.id, i.number, i.created_at AS "createdAt", s.name AS supplier FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.status = 'pendente' ORDER BY i.created_at LIMIT 20`,
      )
      for (const n of invoices) {
        notices.push({
          id: `nota-${n.id}`, kind: 'nota', title: `Lançar NF ${n.number}`, description: `${n.supplier} · importada e não lançada`,
          link: `/compras/notas/${n.id}`, createdAt: n.createdAt,
        })
      }
      const rejected = await this.db.query(
        `SELECT o.id, o.number, a.comment, a.created_at AS "createdAt" FROM purchase_orders o
         JOIN LATERAL (SELECT comment, created_at FROM purchase_order_approvals WHERE order_id = o.id AND decision = 'reprovado' ORDER BY created_at DESC LIMIT 1) a ON true
         WHERE o.status = 'reprovado' AND o.buyer_id = $1 AND a.created_at > now() - interval '15 days'`,
        [me.id],
      )
      for (const o of rejected) {
        notices.push({
          id: `reprovado-${o.id}`, kind: 'reprovado', title: `${code('PC', o.number)} reprovado`, description: o.comment ?? '',
          link: `/compras/pedidos/${o.id}`, createdAt: o.createdAt,
        })
      }
    }

    // Administrador: certificado A1 vencendo nos próximos 30 dias (ou já vencido).
    if (isAdmin(me)) {
      const certs = await this.db.query(
        `SELECT c.id, c.valid_to AS "validTo", floor(extract(epoch FROM c.valid_to - now()) / 86400)::int AS days,
                co.code || ' · ' || coalesce(co.trade_name, co.name) AS company
         FROM certificates c JOIN companies co ON co.id = c.company_id
         WHERE c.active AND c.valid_to < now() + interval '30 days'`,
      )
      for (const c of certs) {
        notices.push({
          id: `certificado-${c.id}`, kind: 'certificado',
          title: c.days < 0 ? 'Certificado A1 vencido' : c.days === 0 ? 'Certificado A1 vence hoje' : `Certificado A1 vence em ${c.days} dia(s)`,
          description: `${c.company} · renove para continuar emitindo notas`, link: '/cadastros/empresas/certificados', createdAt: new Date().toISOString(),
        })
      }
    }

    // Solicitante: suas SCs atendidas nos últimos 7 dias.
    const served = await this.db.query(
      `SELECT r.id, r.number, max(o.created_at) AS "createdAt" FROM purchase_requests r
       JOIN purchase_request_items i ON i.request_id = r.id JOIN purchase_order_items oi ON oi.request_item_id = i.id
       JOIN purchase_orders o ON o.id = oi.order_id
       WHERE r.requester_id = $1 AND r.status = 'atendida' GROUP BY r.id HAVING max(o.created_at) > now() - interval '7 days'`,
      [me.id],
    )
    for (const r of served) {
      notices.push({
        id: `solicitacao-${r.id}`, kind: 'solicitacao', title: `${code('SC', r.number)} atendida`,
        description: 'Pedido de compra gerado para a sua solicitação', link: '/compras/solicitacoes', createdAt: r.createdAt,
      })
    }

    return notices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }
}
