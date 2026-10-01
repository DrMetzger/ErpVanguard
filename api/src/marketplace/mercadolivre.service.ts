import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { branchForInsert, visibleIn } from '../branches/branch.context'
import { municipioPorNome } from '../common/br'
import { one, type Db } from '../common/db'
import { IntegrationsService } from '../integrations/integrations.service'
import { authorizeUrl, exchangeCode, MercadoLivreError, mlFetch, refreshTokens, SITE } from '../integrations/mercadolivre'
import { branchStock } from '../stock/stock'
import { SalesDocsService } from '../sales/sales-docs.service'
import type { User } from '../users/user.entity'

const P = 'mercadolivre'
const SYNC_EVERY = 5 * 60_000
const r2 = (n: number) => Math.round(n * 100) / 100

export interface PublishInput { productId: string; categoryId: string; title?: string; listingType?: string; attributes?: { id: string; value: string }[] }

// Mercado Livre: conta conectada (OAuth), anúncios ligados aos produtos, preço/estoque da filial e vendas → pedido.
@Injectable()
export class MercadoLivreService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MercadoLivre')
  private refreshing: Promise<string> | null = null
  private timer: NodeJS.Timeout | null = null
  private pending = new Set<Promise<unknown>>()

  constructor(private readonly db: DataSource, private readonly integrations: IntegrationsService, private readonly docs: SalesDocsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.ML_SYNC === 'off') return
    // Rede de segurança: preço/estoque alterados e vendas que o aviso do ML não trouxe.
    this.timer = setInterval(() => void this.background(), SYNC_EVERY)
    this.timer.unref()
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  private async background() {
    try {
      const it = await this.integrations.get(P)
      if (!it.enabled || !it.secrets.accessToken) return
      await this.syncAll(false)
      await this.importRecent(null)
    } catch (e) { this.log.warn(`Sincronização automática: ${(e as Error).message}`) }
  }

  // Aguarda as importações disparadas pelo aviso do ML (usado nos testes).
  async idle() { await Promise.allSettled([...this.pending]) }

  private async conf() {
    const it = await this.integrations.get(P)
    return { ...it, c: it.config, s: it.secrets }
  }

  // Token válido (renova 5 minutos antes de vencer; o ML troca o refresh token a cada renovação).
  async token(): Promise<string> {
    const { c, s, enabled } = await this.conf()
    if (!enabled) throw new BadRequestException('Integração com o Mercado Livre desativada (Administração › Integrações)')
    if (!s.accessToken) throw new BadRequestException('Conecte a conta do Mercado Livre em Administração › Integrações')
    if (Number(c.tokenExpiresAt ?? 0) > Date.now() + 5 * 60_000) return s.accessToken
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const t = await refreshTokens(c.clientId!, s.clientSecret!, s.refreshToken!)
          await this.integrations.patch(P, { secrets: { accessToken: t.access_token, refreshToken: t.refresh_token }, config: { tokenExpiresAt: String(Date.now() + t.expires_in * 1000) } })
          return t.access_token
        } catch (e) {
          await this.integrations.setStatus(P, 'erro', (e as Error).message)
          throw e
        } finally { this.refreshing = null }
      })()
    }
    return this.refreshing
  }

  private async api<T>(path: string, init: Parameters<typeof mlFetch>[1] = {}) {
    try {
      return await mlFetch<T>(path, { ...init, token: await this.token() })
    } catch (e) {
      if (e instanceof MercadoLivreError) throw new BadRequestException(e.message)
      throw e
    }
  }

  // ── Conectar conta ──
  async authorize(me: User, origin: string) {
    const { c, s } = await this.conf()
    if (!c.clientId || !s.clientSecret) throw new BadRequestException('Preencha o Client ID e o Client Secret do app do Mercado Livre e salve')
    const redirectUri = c.redirectUri || `${origin}/api/integrations/mercadolivre/callback`
    const state = randomBytes(16).toString('hex')
    await this.integrations.patch(P, { config: { oauthState: `${state}.${Date.now()}`, userId: me.id, redirectUri } })
    return { url: authorizeUrl(c.clientId, redirectUri, state), redirectUri }
  }

  async callback(code: string, state: string) {
    const { c, s } = await this.conf()
    const [expected, at] = String(c.oauthState ?? '').split('.')
    if (!expected || expected !== state || Date.now() - Number(at) > 15 * 60_000) throw new BadRequestException('Autorização expirada ou inválida: clique em Conectar de novo')
    try {
      const t = await exchangeCode(c.clientId!, s.clientSecret!, code, c.redirectUri!)
      const me = await mlFetch<{ id: number; nickname: string }>('/users/me', { token: t.access_token })
      await this.integrations.patch(P, {
        enabled: true, secrets: { accessToken: t.access_token, refreshToken: t.refresh_token },
        config: { tokenExpiresAt: String(Date.now() + t.expires_in * 1000), sellerId: String(me.id), nickname: me.nickname, oauthState: null, ordersFrom: c.ordersFrom ?? new Date().toISOString() },
      })
      await this.integrations.setStatus(P, 'conectado', null)
      await this.integrations.log({ provider: P, direction: 'out', kind: 'conexao', status: 'conectado', target: me.nickname, summary: `Conta ${me.nickname} (${me.id}) conectada`, userId: c.userId })
      return me.nickname
    } catch (e) {
      await this.integrations.setStatus(P, 'erro', (e as Error).message)
      throw new BadRequestException((e as Error).message)
    }
  }

  async status() {
    const { c, s, enabled } = await this.conf()
    return { connected: enabled && !!s.accessToken, nickname: c.nickname ?? null }
  }

  async disconnect(me: User) {
    await this.integrations.patch(P, { secrets: { accessToken: null, refreshToken: null }, config: { sellerId: null, nickname: null, tokenExpiresAt: null } })
    await this.integrations.setStatus(P, 'desconectado', null)
    await this.integrations.log({ provider: P, direction: 'out', kind: 'conexao', status: 'desconectado', summary: 'Conta desconectada', userId: me.id })
  }

  // ── Anúncios ──
  async listings(q?: string) {
    const rows = await this.db.query(
      `SELECT p.id AS "productId", p.sku, p.name, p.sale_price AS "salePrice", p.barcode, l.id, l.external_id AS "externalId", l.title, l.permalink, l.status, l.price, l.quantity,
              l.synced_at AS "syncedAt", l.sync_error AS "syncError"
       FROM products p LEFT JOIN marketplace_listings l ON l.product_id = p.id AND l.provider = $1
       WHERE p.active AND ($2::text IS NULL OR p.sku ILIKE '%' || $2 || '%' OR p.name ILIKE '%' || $2 || '%' OR l.external_id ILIKE '%' || $2 || '%')
       ORDER BY (l.id IS NULL), p.name LIMIT 500`, [P, q?.trim() || null])
    return rows.map((r: any) => ({ ...r, salePrice: Number(r.salePrice), price: r.price === null ? null : Number(r.price), quantity: r.quantity === null ? null : Number(r.quantity) }))
  }

  private async item(itemId: string) {
    return this.api<any>(`/items/${encodeURIComponent(itemId)}`)
  }

  async link(productId: string, rawItemId: string, me: User) {
    const itemId = rawItemId.trim().toUpperCase().replace(/^(MLB)-?/, 'MLB')
    if (!/^MLB\d{3,15}$/.test(itemId)) throw new BadRequestException('Código do anúncio inválido (ex.: MLB1234567890)')
    if (!(await one(this.db, `SELECT 1 FROM products WHERE id = $1`, [productId]))) throw new NotFoundException('Produto não encontrado')
    const { c } = await this.conf()
    const item = await this.item(itemId)
    if (String(item.seller_id) !== String(c.sellerId)) throw new BadRequestException('Este anúncio não é da conta conectada')
    if (item.variations?.length) throw new BadRequestException('Anúncio com variações (cor, tamanho…) ainda não é sincronizado pelo ERP')
    const dup = await one(this.db, `SELECT p.sku FROM marketplace_listings l JOIN products p ON p.id = l.product_id WHERE l.provider = $1 AND l.external_id = $2`, [P, itemId])
    if (dup) throw new BadRequestException(`Este anúncio já está vinculado ao produto ${dup.sku}`)
    const row = await one(this.db,
      `INSERT INTO marketplace_listings (provider, product_id, external_id, title, permalink, status, price, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [P, productId, itemId, item.title, item.permalink, item.status, item.price, item.available_quantity])
    await this.integrations.log({ provider: P, direction: 'out', kind: 'anuncio', status: 'vinculado', externalId: itemId, summary: `${itemId} vinculado: ${item.title}`, userId: me.id })
    return this.syncListing(row!.id)
  }

  async unlink(id: string, me: User) {
    const l = await one(this.db, `DELETE FROM marketplace_listings WHERE id = $1 AND provider = $2 RETURNING external_id`, [id, P])
    if (!l) throw new NotFoundException('Anúncio não encontrado')
    await this.integrations.log({ provider: P, direction: 'out', kind: 'anuncio', status: 'desvinculado', externalId: l.external_id, summary: `${l.external_id} desvinculado (o anúncio continua no Mercado Livre)`, userId: me.id })
  }

  async categories(q: string) {
    if (!q?.trim()) return []
    const r = await this.api<any[]>(`/sites/${SITE}/domain_discovery/search?limit=5&q=${encodeURIComponent(q.trim())}`)
    return r.map((d) => ({ categoryId: d.category_id, category: d.category_name, domain: d.domain_name }))
  }

  // Atributos obrigatórios da categoria (marca, modelo…), para a tela pedir antes de publicar.
  async requiredAttributes(categoryId: string) {
    const attrs = await this.api<any[]>(`/categories/${encodeURIComponent(categoryId)}/attributes`)
    return attrs.filter((a) => a.tags?.required || a.tags?.catalog_required).map((a) => ({ id: a.id, name: a.name, values: (a.values ?? []).slice(0, 50).map((v: any) => v.name) }))
  }

  // Preço (tabela de preço escolhida ou preço de venda) e saldo da filial escolhida (inteiro, nunca negativo).
  private async desired(db: Db, productId: string) {
    const { c } = await this.conf()
    const p = (await one(db, `SELECT sale_price FROM products WHERE id = $1`, [productId]))!
    const table = c.priceTableId ? await one(db, `SELECT price FROM price_table_items WHERE price_table_id = $1 AND product_id = $2`, [c.priceTableId, productId]) : null
    const stock = await branchStock(db, productId, c.companyId || null)
    return { price: r2(Number(table?.price ?? p.sale_price)), quantity: Math.max(0, Math.floor(stock.quantity)) }
  }

  async publish(input: PublishInput, me: User) {
    const p = await one(this.db, `SELECT id, sku, name, barcode FROM products WHERE id = $1 AND active`, [input.productId])
    if (!p) throw new NotFoundException('Produto não encontrado')
    if (await one(this.db, `SELECT 1 FROM marketplace_listings WHERE provider = $1 AND product_id = $2`, [P, p.id])) throw new BadRequestException('Este produto já tem anúncio vinculado')
    const { c } = await this.conf()
    const want = await this.desired(this.db, p.id)
    if (want.quantity < 1) throw new BadRequestException('Sem estoque na filial da integração: o Mercado Livre exige pelo menos 1 unidade para publicar')
    if (want.price <= 0) throw new BadRequestException('Produto sem preço de venda')
    // Fotos do produto (até 6) vão para o Mercado Livre
    const photos = await this.db.query(`SELECT data, content_type FROM product_photos WHERE product_id = $1 ORDER BY position LIMIT 6`, [p.id])
    const pictures: { id: string }[] = []
    for (const [i, ph] of photos.entries()) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(ph.data)], { type: ph.content_type }), `foto-${i + 1}.${ph.content_type.split('/')[1] ?? 'jpg'}`)
      pictures.push({ id: (await this.api<{ id: string }>('/pictures/items/upload', { form })).id })
    }
    const attributes = (input.attributes ?? []).filter((a) => a.value?.trim()).map((a) => ({ id: a.id, value_name: a.value.trim() }))
    if (p.barcode && !attributes.some((a) => a.id === 'GTIN')) attributes.push({ id: 'GTIN', value_name: p.barcode })
    if (!attributes.some((a) => a.id === 'SELLER_SKU')) attributes.push({ id: 'SELLER_SKU', value_name: p.sku })
    const item = await this.api<any>('/items', {
      json: {
        title: (input.title?.trim() || p.name).slice(0, 60), category_id: input.categoryId, price: want.price, currency_id: 'BRL', available_quantity: want.quantity,
        buying_mode: 'buy_it_now', condition: 'new', listing_type_id: input.listingType || c.listingType || 'gold_special', pictures, attributes,
      },
    })
    await this.api(`/items/${item.id}/description`, { json: { plain_text: p.name } }).catch(() => undefined) // descrição é opcional
    const row = await one(this.db,
      `INSERT INTO marketplace_listings (provider, product_id, external_id, title, permalink, status, price, quantity, synced_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
      [P, p.id, item.id, item.title, item.permalink, item.status, want.price, want.quantity])
    await this.integrations.log({ provider: P, direction: 'out', kind: 'anuncio', status: 'publicado', externalId: item.id, summary: `${item.id} publicado: ${item.title} · ${want.quantity} un · R$ ${want.price}`, userId: me.id })
    return (await this.listings(p.sku)).find((l: any) => l.id === row!.id)
  }

  // Envia preço e estoque de um anúncio (só se mudou, a menos que force).
  async syncListing(id: string, force = true) {
    const l = await one(this.db, `SELECT * FROM marketplace_listings WHERE id = $1`, [id])
    if (!l) throw new NotFoundException('Anúncio não encontrado')
    const want = await this.desired(this.db, l.product_id)
    if (!force && l.synced_at && Number(l.price) === want.price && Number(l.quantity) === want.quantity) return null
    try {
      const item = await this.api<any>(`/items/${l.external_id}`, { method: 'PUT', json: { price: want.price, available_quantity: want.quantity } })
      await this.db.query(`UPDATE marketplace_listings SET price = $2, quantity = $3, status = coalesce($4, status), title = coalesce($5, title), permalink = coalesce($6, permalink), synced_at = now(), sync_error = NULL WHERE id = $1`,
        [id, want.price, want.quantity, item?.status ?? null, item?.title ?? null, item?.permalink ?? null])
      await this.integrations.log({ provider: P, direction: 'out', kind: 'estoque', status: 'enviado', externalId: l.external_id, summary: `${l.external_id}: R$ ${want.price} · ${want.quantity} un` })
    } catch (e) {
      await this.db.query(`UPDATE marketplace_listings SET sync_error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 1000)])
      await this.integrations.log({ provider: P, direction: 'out', kind: 'estoque', status: 'erro', externalId: l.external_id, error: (e as Error).message })
      if (force) throw e
    }
    return (await this.listings()).find((x: any) => x.id === id)
  }

  async syncAll(force: boolean) {
    const rows = await this.db.query(`SELECT id FROM marketplace_listings WHERE provider = $1`, [P])
    let sent = 0
    for (const r of rows) if (await this.syncListing(r.id, force).catch(() => null)) sent++
    return { listings: rows.length, sent }
  }

  // ── Vendas ──
  async orders() {
    return this.db.query(
      `SELECT m.id, m.external_id AS "externalId", m.status, m.buyer, m.total, m.error, m.created_at AS "createdAt", m.sales_order_id AS "salesOrderId", o.number AS "orderNumber"
       FROM marketplace_orders m LEFT JOIN sales_orders o ON o.id = m.sales_order_id WHERE m.provider = $1 ORDER BY m.created_at DESC LIMIT 200`, [P])
  }

  // Aviso do Mercado Livre (tópico orders_v2): confere conta e app e importa em segundo plano.
  async notification(body: any) {
    const { c, enabled } = await this.conf()
    if (!enabled || String(body?.user_id) !== String(c.sellerId) || (body?.application_id && String(body.application_id) !== String(c.clientId))) return false
    const m = String(body?.resource ?? '').match(/^\/orders\/(\d+)$/)
    if (!['orders_v2', 'orders'].includes(body?.topic) || !m) return false
    const job = this.importOrder(m[1]!).catch((e) => this.log.warn(`Venda ${m[1]}: ${(e as Error).message}`))
    this.pending.add(job); void job.finally(() => this.pending.delete(job))
    return true
  }

  async importRecent(me: User | null) {
    const { c } = await this.conf()
    const from = c.ordersFrom ?? new Date(Date.now() - 7 * 86400e3).toISOString()
    const r = await this.api<{ results: any[] }>(`/orders/search?seller=${c.sellerId}&order.status=paid&sort=date_desc&order.date_created.from=${encodeURIComponent(from)}`)
    let created = 0
    for (const o of r.results ?? []) {
      const res = await this.importOrder(String(o.id), o).catch(() => null)
      if (res === 'criado') created++
    }
    if (me) await this.integrations.log({ provider: P, direction: 'in', kind: 'vendas', status: 'ok', summary: `Busca manual: ${r.results?.length ?? 0} venda(s) paga(s), ${created} nova(s)`, userId: me.id })
    return { found: r.results?.length ?? 0, created }
  }

  // Venda paga → pedido de venda na filial da integração (uma vez só por venda).
  // Uma importação por venda de cada vez (avisos repetidos chegam juntos e não podem gerar dois pedidos).
  private locks = new Map<string, Promise<unknown>>()
  async importOrder(orderId: string, known?: any): Promise<'criado' | 'existente' | 'ignorado' | 'erro'> {
    const prev = this.locks.get(orderId) ?? Promise.resolve()
    const job = prev.catch(() => undefined).then(() => this.importOrderNow(orderId, known))
    this.locks.set(orderId, job)
    try { return await job } finally { if (this.locks.get(orderId) === job) this.locks.delete(orderId) }
  }

  private async importOrderNow(orderId: string, known?: any): Promise<'criado' | 'existente' | 'ignorado' | 'erro'> {
    const done = await one(this.db, `SELECT status FROM marketplace_orders WHERE provider = $1 AND external_id = $2`, [P, orderId])
    if (done && done.status === 'importado') return 'existente'
    const o = known?.order_items ? known : await this.api<any>(`/orders/${orderId}`)
    const { c } = await this.conf()
    const buyerName = [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(' ') || o.buyer?.nickname || 'Comprador Mercado Livre'
    const save = (status: string, salesOrderId: string | null, error: string | null) => this.db.query(
      `INSERT INTO marketplace_orders (provider, external_id, status, sales_order_id, buyer, total, error, raw) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider, external_id) DO UPDATE SET status = EXCLUDED.status, sales_order_id = EXCLUDED.sales_order_id, error = EXCLUDED.error, raw = EXCLUDED.raw, buyer = EXCLUDED.buyer, total = EXCLUDED.total, updated_at = now()`,
      [P, orderId, status, salesOrderId, buyerName, o.total_amount ?? null, error, JSON.stringify(o)])
    if (o.status !== 'paid') { await save('aguardando', null, `Situação no Mercado Livre: ${o.status}`); return 'ignorado' }
    try {
      if (!c.companyId || !c.paymentTermId || !c.userId) throw new Error('Escolha a filial e a condição de pagamento da integração (Administração › Integrações)')
      // Produtos pelos anúncios vinculados
      const items: { productId: string; quantity: number; unitPrice: number }[] = []
      for (const it of o.order_items ?? []) {
        const l = await one(this.db, `SELECT product_id FROM marketplace_listings WHERE provider = $1 AND external_id = $2`, [P, it.item?.id])
          ?? (it.item?.seller_sku ? await one(this.db, `SELECT id AS product_id FROM products t WHERE t.sku = $1 AND ${visibleIn('t', 2)}`, [it.item.seller_sku, c.companyId]) : null)
        if (!l) throw new Error(`Anúncio ${it.item?.id} (${it.item?.title}) não está vinculado a nenhum produto`)
        items.push({ productId: l.product_id, quantity: Number(it.quantity), unitPrice: r2(Number(it.unit_price)) })
      }
      const billing = await this.api<any>(`/orders/${orderId}/billing_info`).catch(() => null)
      const customerId = await this.customer(billing, o, buyerName, c.companyId)
      const id = await this.db.transaction(async (tx) => {
        const dto = { companyId: c.companyId!, customerId, paymentTermId: c.paymentTermId!, items, notes: `Venda Mercado Livre ${orderId}${o.pack_id ? ` (carrinho ${o.pack_id})` : ''} · comprador ${o.buyer?.nickname ?? buyerName}` }
        const prep = await this.docs.prepare(tx, dto)
        const row = await one(tx, `INSERT INTO sales_orders (company_id, customer_id, seller_id, operation_type_id, payment_term_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [prep.companyId, customerId, c.userId, prep.operation.id, c.paymentTermId])
        await this.docs.save(tx, 'order', row!.id, dto)
        return row!.id as string
      })
      await save('importado', id, null)
      const number = (await one(this.db, `SELECT number FROM sales_orders WHERE id = $1`, [id]))!.number
      await this.integrations.log({ provider: P, direction: 'in', kind: 'venda', status: 'importado', externalId: orderId, docKind: 'order', docId: id, target: o.buyer?.nickname, companyId: c.companyId,
        summary: `Venda ${orderId} → pedido PV-${String(number).padStart(6, '0')} · ${buyerName} · R$ ${o.total_amount}` })
      return 'criado'
    } catch (e) {
      await save('erro', null, (e as Error).message)
      await this.integrations.log({ provider: P, direction: 'in', kind: 'venda', status: 'erro', externalId: orderId, target: o.buyer?.nickname, error: (e as Error).message })
      return 'erro'
    }
  }

  // Cliente pelo CPF/CNPJ dos dados de faturamento da venda (cadastra se não existir).
  private async customer(billing: any, o: any, buyerName: string, branch: string) {
    const b = billing?.billing_info ?? billing?.buyer?.billing_info ?? billing ?? {}
    const doc = String(b.doc_number ?? b.identification?.number ?? '').replace(/\D/g, '')
    if (![11, 14].includes(doc.length)) throw new Error('O Mercado Livre não informou o CPF/CNPJ do comprador (necessário para a nota)')
    const info: Record<string, string> = {}
    for (const a of b.additional_info ?? []) if (a?.type) info[a.type] = a.value
    const addr = b.address ?? {}
    const name = (info.BUSINESS_NAME || [info.FIRST_NAME ?? b.name, info.LAST_NAME ?? b.last_name].filter(Boolean).join(' ') || buyerName).slice(0, 200)
    const uf = String(addr.state?.code ?? info.STATE_CODE ?? '').replace(/^BR-/, '').toUpperCase().slice(0, 2) || null
    const city = addr.city_name ?? info.CITY_NAME ?? null
    const code = uf && city ? municipioPorNome(uf, city) : undefined
    const existing = await one(this.db, `SELECT id FROM customers t WHERE t.document = $1 AND ${visibleIn('t', 2)}`, [doc, branch])
    if (existing) return existing.id as string
    const row = await one(this.db,
      `INSERT INTO customers (document, name, taxpayer, uf, city, city_code, zip, street, number, district, branch_id) VALUES ($1, $2, '9', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [doc, name, uf, code?.name ?? city, code?.code ?? null, String(addr.zip_code ?? info.ZIP_CODE ?? '').replace(/\D/g, '').slice(0, 8) || null,
        addr.street_name ?? info.STREET_NAME ?? null, addr.street_number ?? info.STREET_NUMBER ?? null, addr.neighborhood ?? info.NEIGHBORHOOD ?? null, await branchForInsert(this.db, 'customers', branch)])
    return row!.id as string
  }
}
