import { MigrationInterface, QueryRunner } from 'typeorm'

// Cadastros (unidades, tipos, grupos, NCM, clientes, tabelas de preço),
// fiscal (CFOP, tipos de operação, TES, matriz fiscal), configurações e avatar.
export class CatalogsFiscal1727400000000 implements MigrationInterface {
  name = 'CatalogsFiscal1727400000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE users ADD COLUMN avatar varchar`)
    await q.query(`
      CREATE TABLE app_settings (
        key varchar PRIMARY KEY,
        value jsonb NOT NULL,
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)

    // ---- Cadastros
    await q.query(`
      CREATE TABLE units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(6) NOT NULL UNIQUE,
        description varchar NOT NULL,
        decimals int NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`
      CREATE TABLE product_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(2) NOT NULL UNIQUE,
        description varchar NOT NULL,
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`
      CREATE TABLE product_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(10) NOT NULL UNIQUE,
        name varchar NOT NULL,
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`
      CREATE TABLE ncm (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(8) NOT NULL UNIQUE,
        description varchar NOT NULL,
        ipi_rate numeric(6,2),
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`ALTER TABLE products ADD COLUMN type_id uuid REFERENCES product_types(id)`)
    await q.query(`ALTER TABLE products ADD COLUMN group_id uuid REFERENCES product_groups(id)`)
    await q.query(`ALTER TABLE products ADD COLUMN origin smallint NOT NULL DEFAULT 0`)
    await q.query(`
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document varchar(14) NOT NULL UNIQUE,
        name varchar NOT NULL,
        trade_name varchar,
        ie varchar(20),
        taxpayer varchar(1) NOT NULL DEFAULT '9',
        email varchar,
        phone varchar,
        zip varchar(8),
        street varchar,
        number varchar(20),
        district varchar,
        city varchar,
        uf varchar(2),
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE price_tables (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(10) NOT NULL UNIQUE,
        name varchar NOT NULL,
        valid_from date,
        valid_to date,
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`
      CREATE TABLE price_table_items (
        price_table_id uuid NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price numeric(14,4) NOT NULL CHECK (price >= 0),
        PRIMARY KEY (price_table_id, product_id)
      )`)
    // Amarração produto x fornecedor ganha id para edição pela tela.
    await q.query(`ALTER TABLE supplier_products ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE`)
    await q.query(`ALTER TABLE supplier_products ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()`)

    // ---- Fiscal
    await q.query(`
      CREATE TABLE cfop (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(4) NOT NULL UNIQUE,
        description varchar NOT NULL,
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`
      CREATE TABLE operation_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(4) NOT NULL UNIQUE,
        name varchar NOT NULL,
        kind varchar(1) NOT NULL CHECK (kind IN ('E', 'S')),
        active boolean NOT NULL DEFAULT true
      )`)
    // TES: tipo de entrada/saída (como calcular e o que movimentar).
    await q.query(`
      CREATE TABLE tes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(3) NOT NULL UNIQUE,
        kind varchar(1) NOT NULL CHECK (kind IN ('E', 'S')),
        description varchar NOT NULL,
        cfop_internal varchar(4) NOT NULL,
        cfop_interstate varchar(4),
        updates_stock boolean NOT NULL DEFAULT true,
        generates_financial boolean NOT NULL DEFAULT true,
        icms_cst varchar(3),
        calc_icms boolean NOT NULL DEFAULT true,
        calc_ipi boolean NOT NULL DEFAULT false,
        ipi_cst varchar(2),
        pis_cofins_cst varchar(2),
        calc_pis_cofins boolean NOT NULL DEFAULT true,
        notes text,
        active boolean NOT NULL DEFAULT true
      )`)
    // Matriz fiscal: qual TES usar para cada combinação (campo vazio = qualquer).
    await q.query(`
      CREATE TABLE fiscal_matrix (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        operation_type_id uuid NOT NULL REFERENCES operation_types(id),
        uf varchar(2),
        taxpayer varchar(1),
        product_type_id uuid REFERENCES product_types(id),
        product_group_id uuid REFERENCES product_groups(id),
        ncm_prefix varchar(8),
        tes_id uuid NOT NULL REFERENCES tes(id),
        notes varchar,
        active boolean NOT NULL DEFAULT true
      )`)

    // ---- Carga inicial
    const units: [string, string, number][] = [
      ['UN', 'Unidade', 0], ['PC', 'Peça', 0], ['CX', 'Caixa', 0], ['PCT', 'Pacote', 0], ['FD', 'Fardo', 0], ['DZ', 'Dúzia', 0],
      ['PAR', 'Par', 0], ['JG', 'Jogo', 0], ['KIT', 'Kit', 0], ['CJ', 'Conjunto', 0], ['RL', 'Rolo', 0], ['SC', 'Saco', 0],
      ['KG', 'Quilograma', 3], ['G', 'Grama', 3], ['TON', 'Tonelada', 3], ['LT', 'Litro', 3], ['ML', 'Mililitro', 0],
      ['M', 'Metro', 2], ['M2', 'Metro quadrado', 2], ['M3', 'Metro cúbico', 3], ['CM', 'Centímetro', 1], ['H', 'Hora', 2],
    ]
    for (const [code, description, decimals] of units) {
      await q.query(`INSERT INTO units (code, description, decimals) VALUES ($1, $2, $3)`, [code, description, decimals])
    }
    // Tipos de item do SPED (registro 0200).
    const types: [string, string][] = [
      ['00', 'Mercadoria para revenda'], ['01', 'Matéria-prima'], ['02', 'Embalagem'], ['03', 'Produto em processo'],
      ['04', 'Produto acabado'], ['05', 'Subproduto'], ['06', 'Produto intermediário'], ['07', 'Material de uso e consumo'],
      ['08', 'Ativo imobilizado'], ['09', 'Serviços'], ['10', 'Outros insumos'], ['99', 'Outras'],
    ]
    for (const [code, description] of types) await q.query(`INSERT INTO product_types (code, description) VALUES ($1, $2)`, [code, description])

    const cfops: [string, string][] = [
      ['1101', 'Compra para industrialização'], ['1102', 'Compra para comercialização'], ['1111', 'Compra para industrialização de mercadoria recebida anteriormente em consignação'],
      ['1201', 'Devolução de venda de produção do estabelecimento'], ['1202', 'Devolução de venda de mercadoria adquirida de terceiros'],
      ['1403', 'Compra para comercialização em operação com mercadoria sujeita a ST'], ['1407', 'Compra de mercadoria para uso ou consumo com ST'],
      ['1551', 'Compra de bem para o ativo imobilizado'], ['1556', 'Compra de material para uso ou consumo'],
      ['1910', 'Entrada de bonificação, doação ou brinde'], ['1915', 'Entrada de mercadoria recebida para conserto ou reparo'],
      ['1949', 'Outra entrada de mercadoria não especificada'],
      ['2101', 'Compra para industrialização (interestadual)'], ['2102', 'Compra para comercialização (interestadual)'],
      ['2202', 'Devolução de venda de mercadoria adquirida de terceiros (interestadual)'],
      ['2403', 'Compra para comercialização com ST (interestadual)'], ['2551', 'Compra de bem para o ativo imobilizado (interestadual)'],
      ['2556', 'Compra de material para uso ou consumo (interestadual)'], ['2910', 'Entrada de bonificação, doação ou brinde (interestadual)'],
      ['2949', 'Outra entrada não especificada (interestadual)'],
      ['3102', 'Compra para comercialização (importação)'],
      ['5101', 'Venda de produção do estabelecimento'], ['5102', 'Venda de mercadoria adquirida de terceiros'],
      ['5124', 'Industrialização efetuada para outra empresa'], ['5202', 'Devolução de compra para comercialização'],
      ['5401', 'Venda de produção com ST (substituto)'], ['5403', 'Venda de mercadoria adquirida com ST (substituto)'],
      ['5405', 'Venda de mercadoria adquirida com ST (substituído)'], ['5409', 'Transferência de mercadoria com ST'],
      ['5152', 'Transferência de mercadoria adquirida de terceiros'], ['5556', 'Devolução de compra de material de uso ou consumo'],
      ['5910', 'Remessa em bonificação, doação ou brinde'], ['5915', 'Remessa para conserto ou reparo'],
      ['5929', 'Lançamento de operação registrada em ECF'], ['5949', 'Outra saída de mercadoria não especificada'],
      ['6101', 'Venda de produção do estabelecimento (interestadual)'], ['6102', 'Venda de mercadoria adquirida de terceiros (interestadual)'],
      ['6108', 'Venda de mercadoria adquirida a não contribuinte (interestadual)'], ['6202', 'Devolução de compra para comercialização (interestadual)'],
      ['6403', 'Venda de mercadoria adquirida com ST (interestadual)'], ['6404', 'Venda de mercadoria com ST já retido (interestadual)'],
      ['6910', 'Remessa em bonificação, doação ou brinde (interestadual)'], ['6949', 'Outra saída não especificada (interestadual)'],
      ['7101', 'Venda de produção do estabelecimento (exportação)'], ['7102', 'Venda de mercadoria adquirida (exportação)'],
    ]
    for (const [code, description] of cfops) await q.query(`INSERT INTO cfop (code, description) VALUES ($1, $2)`, [code, description])

    const operations: [string, string, string][] = [
      ['E01', 'Compra para revenda', 'E'], ['E02', 'Compra para industrialização', 'E'], ['E03', 'Compra de uso e consumo', 'E'],
      ['E04', 'Compra de ativo imobilizado', 'E'], ['E05', 'Devolução de venda', 'E'], ['E06', 'Bonificação recebida', 'E'],
      ['S01', 'Venda de mercadoria', 'S'], ['S02', 'Venda de produção própria', 'S'], ['S03', 'Devolução de compra', 'S'],
      ['S04', 'Bonificação / brinde', 'S'], ['S05', 'Remessa para conserto', 'S'], ['S06', 'Transferência entre filiais', 'S'],
    ]
    for (const [code, name, kind] of operations) await q.query(`INSERT INTO operation_types (code, name, kind) VALUES ($1, $2, $3)`, [code, name, kind])

    // TES básicas para começar (ajustar com a contabilidade).
    const tes: [string, string, string, string, string | null, boolean, boolean, string][] = [
      ['001', 'E', 'Compra para revenda', '1102', '2102', true, true, '00'],
      ['002', 'E', 'Compra de uso e consumo', '1556', '2556', true, true, '90'],
      ['003', 'E', 'Compra de ativo imobilizado', '1551', '2551', false, true, '90'],
      ['004', 'E', 'Devolução de venda', '1202', '2202', true, false, '00'],
      ['501', 'S', 'Venda de mercadoria', '5102', '6102', true, true, '00'],
      ['502', 'S', 'Venda com ST (substituído)', '5405', '6404', true, true, '60'],
      ['503', 'S', 'Devolução de compra', '5202', '6202', true, false, '00'],
      ['504', 'S', 'Bonificação / brinde', '5910', '6910', true, false, '00'],
    ]
    for (const [code, kind, description, internal, interstate, stock, financial, cst] of tes) {
      await q.query(
        `INSERT INTO tes (code, kind, description, cfop_internal, cfop_interstate, updates_stock, generates_financial, icms_cst) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [code, kind, description, internal, interstate, stock, financial, cst],
      )
    }
  }

  async down(q: QueryRunner) {
    for (const t of ['fiscal_matrix', 'tes', 'operation_types', 'cfop', 'price_table_items', 'price_tables', 'customers', 'ncm', 'product_groups', 'product_types', 'units', 'app_settings']) {
      if (t === 'product_groups') {
        await q.query(`ALTER TABLE products DROP COLUMN group_id, DROP COLUMN type_id, DROP COLUMN origin`)
      }
      await q.query(`DROP TABLE ${t}`)
    }
    await q.query(`ALTER TABLE supplier_products DROP COLUMN id, DROP COLUMN created_at`)
    await q.query(`ALTER TABLE users DROP COLUMN avatar`)
  }
}
