import { MigrationInterface, QueryRunner } from 'typeorm'

// Modelos de e-mail editáveis em Administração e histórico de envio de orçamentos/pedidos.
export class Email1728700000000 implements MigrationInterface {
  name = 'Email1728700000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE email_templates (
        key varchar(20) PRIMARY KEY,
        name varchar(80) NOT NULL,
        subject varchar(200) NOT NULL,
        header text NOT NULL DEFAULT '',
        body text NOT NULL DEFAULT '',
        signature text NOT NULL DEFAULT '',
        footer text NOT NULL DEFAULT '',
        show_logo boolean NOT NULL DEFAULT true,
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(
      `INSERT INTO email_templates (key, name, subject, header, body, signature, footer) VALUES
       ('quote', 'Orçamento para o cliente', 'Orçamento {{numero}} - {{empresa}}', '<b>{{empresa}}</b>',
        E'Olá, {{cliente}}!\\n\\nSegue o orçamento {{numero}}, válido até {{validade}}.\\n\\n{{itens}}\\n\\nCondição de pagamento: {{condicao}}.\\nQualquer dúvida, é só responder este e-mail.',
        E'Atenciosamente,\\n<b>{{vendedor}}</b>\\n{{empresa}}', 'Orçamento sem valor fiscal. Preços e disponibilidade válidos até {{validade}}.'),
       ('order', 'Pedido de venda', 'Pedido de venda {{numero}} - {{empresa}}', '<b>{{empresa}}</b>',
        E'Olá, {{cliente}}!\\n\\nConfirmamos o seu pedido {{numero}}, no total de {{total}}.\\n\\n{{itens}}\\n\\nCondição de pagamento: {{condicao}}.',
        E'Obrigado pela preferência,\\n<b>{{vendedor}}</b>\\n{{empresa}}', 'Este e-mail não tem valor fiscal.')`,
    )
    await q.query(`
      CREATE TABLE sales_doc_emails (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_kind varchar(5) NOT NULL CHECK (doc_kind IN ('quote', 'order')),
        doc_id uuid NOT NULL,
        to_addr text NOT NULL,
        cc text,
        subject varchar(250) NOT NULL,
        status varchar(8) NOT NULL CHECK (status IN ('enviado', 'erro')),
        error text,
        message_id varchar(250),
        user_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX sales_doc_emails_doc ON sales_doc_emails (doc_kind, doc_id, created_at DESC)`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE sales_doc_emails`)
    await q.query(`DROP TABLE email_templates`)
  }
}
