export const WHATSAPP_NUMBER = '5500000000000' // TODO: trocar pelo número comercial
export const CONTACT_EMAIL = 'contato@erpvanguard.com.br'

export const modules = [
  {
    id: 'compras',
    icon: 'cart',
    title: 'Compras',
    description: 'Da requisição ao recebimento: cotações, pedidos, aprovações por alçada e importação de XML do fornecedor.',
    features: ['Cotação entre fornecedores', 'Aprovação por alçada', 'Entrada por XML da NF-e'],
  },
  {
    id: 'estoque',
    icon: 'box',
    title: 'Estoque',
    description: 'Estoque multidepósito com lote, validade e grade, além de custo médio, reposição e curva ABC.',
    features: ['Multidepósito e endereçamento', 'Custo médio e reposição', 'Lote, validade e grade'],
  },
  {
    id: 'faturamento',
    icon: 'receipt',
    title: 'Faturamento',
    description: 'Pedidos de venda, orçamentos, tabelas de preço e emissão de NF-e, NFC-e e NFS-e em poucos cliques.',
    features: ['NF-e, NFC-e e NFS-e', 'Tabelas de preço e comissões', 'Pedidos dos marketplaces'],
  },
  {
    id: 'financeiro',
    icon: 'wallet',
    title: 'Financeiro',
    description: 'Contas a pagar e a receber, boletos, PIX, conciliação bancária automática e fluxo de caixa projetado.',
    features: ['Boleto e PIX integrados', 'Conciliação via OFX e API', 'Fluxo de caixa e DRE gerencial'],
  },
  {
    id: 'bi',
    icon: 'chart',
    title: 'BI Avançado',
    featured: true,
    description: 'Painéis prontos e personalizáveis com os dados de compras, estoque, vendas e financeiro em tempo real, para decidir com números e não com achismo.',
    features: ['Dashboards em tempo real', 'Margem por produto, canal e marketplace', 'Metas, rankings e alertas', 'Exportação para Excel e PDF'],
  },
]

export const integrations = [
  {
    id: 'whatsapp',
    name: 'WhatsApp (Meta)',
    color: '#25D366',
    description: 'Envie orçamentos, boletos, NF-e e cobranças pelo WhatsApp oficial (Cloud API da Meta) e atenda clientes direto do ERP.',
  },
  {
    id: 'mercado-livre',
    name: 'Mercado Livre',
    color: '#FFE600',
    textColor: '#2D3277',
    description: 'Anúncios, estoque e preços sincronizados. Os pedidos entram faturados e as etiquetas saem do próprio ERP.',
  },
  {
    id: 'shopee',
    name: 'Shopee',
    color: '#EE4D2D',
    description: 'Importação automática de pedidos, atualização de estoque em tempo real e emissão de nota para cada venda.',
  },
  {
    id: 'magalu',
    name: 'Magalu',
    color: '#0086FF',
    description: 'Catálogo, estoque e pedidos do Magalu Marketplace integrados ao faturamento e ao financeiro.',
  },
]
