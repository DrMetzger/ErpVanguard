# ERP Vanguard

ERP completo na nuvem (web + Android), da Prime ERP Soluções.

## Estrutura do repositório

| Pasta      | O que é                                                    | Status           |
|------------|------------------------------------------------------------|------------------|
| `landing/` | Landing page do site www.erpvanguard.com.br (React + Vite) | ✅ v0.1          |
| `web/`     | ERP web (React 19 + TypeScript + Mantine), servido pelo Caddy | ✅ v0.2       |
| `api/`     | API (NestJS + TypeORM + PostgreSQL)                        | ✅ v0.1          |
| `infra/`   | Setup da VPS e docker-compose                              | ✅               |
| `mobile/`  | App Android (React Native / Expo)                          | 🔜               |

## ERP (app.erpvanguard.com.br)

Roda na VPS em Docker: `db` (PostgreSQL 16), `api` (NestJS) e `web` (Caddy servindo o React,
fazendo proxy de `/api` e emitindo o certificado HTTPS).

- **Deploy:** automático a cada push em `api/`, `web/` ou `infra/` (workflow *Deploy ERP*).
- **Senhas:** geradas no primeiro deploy em `/opt/vanguard/.env` na VPS, nunca no repositório.
  Senha inicial do administrador: `sudo grep ADMIN_PASSWORD /opt/vanguard/.env`
- **Tarefas na VPS:** workflow *VPS* (aba Actions) com `status` e `setup`.

### Menu

Início · **Cadastros** (Produtos · Clientes e fornecedores · Fiscal) · **Compras** · **Estoque** ·
**Faturamento** · **Financeiro** · **BI Avançado** — e, para administradores, **Empresas**, **Usuários**, **Personalizar cadastros**, **Parâmetros** e **Configurações**.

- **Cadastros › Produtos:** produtos (tipo SPED, grupo, unidade, NCM, origem), grupos, tipos, unidades, NCM
  e tabelas de preço.
- **Cadastros › Clientes e fornecedores:** fornecedores, clientes e amarração produto × fornecedor.
- **Cadastros › Fiscal:** CFOP, tipos de operação, TES (tipos de entrada e saída: CFOP, estoque, financeiro,
  CSTs e impostos) e matriz fiscal (qual TES usar por operação, UF, contribuinte, tipo/grupo e NCM;
  vence a regra mais específica), com simulador por empresa/filial.
- **Administração › Empresas:** matriz e filiais (a UF de cada uma decide CFOP 5xxx × 6xxx), logo para DANFE e
  relatórios (PNG/JPG, sai no cabeçalho dos impressos) e **certificado digital A1** (.pfx): a API confere
  senha, CNPJ (a raiz da matriz vale para as filiais) e validade; arquivo e senha ficam criptografados
  (AES-256-GCM) e nunca voltam para a tela; o sino avisa 30 dias antes de vencer. Só administradores.
- **Notas de entrada (pré-nota → classificação):** o XML importado vira **pré-nota** (nada movimenta). O comprador
  amarra produtos e pedido; o **fiscal** classifica: tipo de operação (E01 compra, E05 devolução de venda…) e **TES por
  item**, sugerida pela matriz fiscal (CFOP 1xxx/2xxx). Ao classificar, a TES decide: *movimenta estoque* (entrada e custo
  médio; em devolução, pelo custo atual) e *gera financeiro* — compra → contas a pagar pelas duplicatas do XML; devolução
  de venda → **NCC** (crédito do cliente) no contas a receber. Na saída, devolução de compra (S03) gera **NDF** (débito do
  fornecedor) no contas a pagar. NCC/NDF abatem o saldo e têm a baixa com o sinal invertido.
- **Estoque:** saldos, custo médio e movimentações.
- **Faturamento:** **orçamento** (em negociação → ganho/perdido com motivo; validade pelo parâmetro MV_ORCVAL) → **ganho gera
  o pedido de venda** → faturar (confere estoque, a não ser que MV_ESTNEG permita). Pedido também pode ser direto. Preço da tabela
  ou do produto, descontos e frete; TES/CFOP pela matriz fiscal; **impostos calculados na hora** enquanto se digita. Faturar gera a
  nota de saída, baixa o estoque e as parcelas a receber (com IPI e ST). Cancelar a nota devolve o estoque e cancela as parcelas.
- **Impostos** (`api/src/taxes/tax-engine.ts`): ICMS (CST ou CSOSN conforme o regime), redução de base, ICMS-ST com MVA (ajustada
  na interestadual), IPI (alíquota da regra ou do NCM), FCP, DIFAL + FCP do destino para não contribuinte, PIS/COFINS pelo regime
  (Presumido cumulativo, Real não cumulativo, Simples/MEI no DAS), crédito do Simples (CSOSN 101/201) e avisos do MEI (NT 2024.001).
  Regras em **Cadastros › Fiscal › Matriz de impostos** (filtros como no emissor do SEBRAE: regime, vigência, operação, UF,
  contribuinte, produto, grupo, tipo, NCM, CFOP); sem regra, vale o padrão do regime. **ICMS por UF** traz a alíquota interna e o
  FCP de cada estado (valores de referência: conferir). O regime (Simples, Simples excesso, MEI, Presumido, Real) fica no cadastro
  da empresa e define o CRT.
- **Parâmetros** (Administração): comportamento do sistema no estilo MV_ (estoque negativo, validade do orçamento, frete e IPI
  na base do ICMS, DIFAL, ICMS fora da base do PIS/COFINS, alíquotas de PIS/COFINS).
- **Personalizar cadastros** (Administração): campos novos em produtos, clientes, fornecedores, empresas e demais cadastros —
  texto (com máscara pronta: CPF, CNPJ, CPF/CNPJ, CEP, telefone, placa, ou personalizada com 9/A/*), texto longo (memo), número,
  inteiro, moeda, data, sim/não, lista suspensa, opções na tela e caixas de marcar —, com opção de coluna na lista. O campo pode
  ser editado depois (inclusive nome interno e tipo: os valores gravados são convertidos ou o sistema avisa quais não servem).
  Ajuste do formulário: esconder, renomear, reordenar.
- **Receita e Serasa:** botão "Receita" no CNPJ de clientes, fornecedores e empresas preenche os dados pela BrasilAPI (gratuita).
  A consulta de crédito da Serasa Experian (API paga) fica pronta em Configurações, esperando as chaves do contrato.
- **Financeiro:** contas a receber e a pagar (manuais, parceladas ou repetidas; das notas de venda; das NF-e de compra
  lançadas, pelas duplicatas do XML), baixa parcial/total com desconto e juros, estorno, bancos e caixa com parâmetros de
  cobrança CNAB 240/400 (carteira, convênio, beneficiário, nosso número, multa, juros, protesto), plano de contas e fluxo de
  caixa dia a dia.
- **BI Avançado:** faturamento, margem bruta (preço − custo médio na hora da venda), ticket médio, compras, a receber/pagar,
  estoque; mês a mês, curva ABC, clientes, UF e vendedores; cada gráfico tem versão em tabela e exporta CSV (Excel).
- **Configurações:** chave e modelos do Gemini (chave criptografada no banco, prioridade sobre o secret do
  servidor) e IA automática no XML.
- **Perfis:** solicitante, comprador, aprovador, cadastro, fiscal, vendedor (só os próprios pedidos), faturamento,
  financeiro e BI (administrador tem todos).
- **Avatar:** "Pessoas" (Avataaars, uso comercial livre) com tom de pele escolhido pela própria pessoa e só
  expressões alegres; "Bichos" são desenhos próprios do Vanguard (`web/src/components/avatars`).

Endereços antigos (`/fiscal/...`, `/cadastros/<aba>`, `/compras/fornecedores`) redirecionam para os novos.

Os cadastros simples são descritos uma vez em `api/src/catalog/resources.ts`; a API
(`/api/catalog/:nome`) e as telas se montam a partir dessa descrição.

### Módulo de Compras

Fluxo: **solicitação (SC)** → **cotação** com vários fornecedores → **análise** (mapa comparativo, menor
preço destacado) → **pedido de compra** por fornecedor vencedor → **aprovação por alçada** →
**entrada da NF-e por XML** (estoque, custo médio e baixa do pedido).

- **Perfis de usuário:** solicitante, comprador, aprovador e administrador (tela *Usuários*).
- **Grupos de compras:** os compradores do grupo atendem as SCs dele; cada grupo aponta para uma alçada.
- **Alçadas:** níveis com limite de valor e aprovadores. O pedido sobe nível a nível até o limite que
  cobre o valor; quem gerou o pedido não pode aprová-lo. Grupo sem alçada gera pedido já aprovado.
- **XML:** a leitura é exata (sem IA). A amarração dos itens usa, nesta ordem: código do fornecedor já
  conhecido, código de barras, descrição parecida com o item do pedido e, sob demanda, o **Gemini**.
  Ao lançar, o sistema aprende a amarração produto × fornecedor.
- **IA (Gemini):** crie o secret `GEMINI_API_KEY` no GitHub; o deploy grava no `.env` da VPS.
  Opcional: a variável `GEMINI_MODEL` (padrão `gemini-3.8-flash`).

Testes: `npm test` (integração com o Gemini simulada), `npm run test:compras` e
`node test/catalog-flow.mjs`, `node test/sales-finance-flow.mjs`, `node test/credit-flow.mjs` (fluxos completos contra uma API rodando, com `API`, `ADMIN_EMAIL` e
`ADMIN_PASSWORD`).

### Desenvolvimento local

```bash
# API (precisa de um PostgreSQL)
cd api && npm install && npm run build
DATABASE_URL=postgres://usuario:senha@localhost:5432/vanguard JWT_SECRET=dev ADMIN_PASSWORD=admin123 npm start

# Web (em outro terminal; faz proxy de /api para localhost:3000)
cd web && npm install && npm run dev
```

As migrações do banco ficam em `api/src/database/migrations` e rodam sozinhas quando a API sobe.

## Landing page

```bash
cd landing
npm install
npm run dev      # desenvolvimento em http://localhost:5173
npm run build    # gera os arquivos estáticos em landing/dist
```

O conteúdo (módulos, integrações, WhatsApp de contato) fica em `landing/src/data.js`.
Troque `WHATSAPP_NUMBER` pelo número comercial antes de publicar.

### Deploy em hospedagem compartilhada (cPanel / public_html)

1. `cd landing && npm run build`
2. Compacte **o conteúdo** de `landing/dist/` (inclusive o `.htaccess` oculto) e envie para `public_html` pelo Gerenciador de Arquivos do cPanel.
3. Extraia lá dentro: o `index.html` precisa ficar direto em `public_html/`, não numa subpasta.

### Deploy na VPS (Nginx + HTTPS)

```bash
# na VPS (Ubuntu/Debian)
sudo apt install -y nginx certbot python3-certbot-nginx
sudo mkdir -p /var/www/erpvanguard
# da sua máquina: envia o build
rsync -avz --delete landing/dist/ usuario@IP_DA_VPS:/var/www/erpvanguard/
```

`/etc/nginx/sites-available/erpvanguard`:

```nginx
server {
    listen 80;
    server_name erpvanguard.com.br www.erpvanguard.com.br;
    root /var/www/erpvanguard;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/erpvanguard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d erpvanguard.com.br -d www.erpvanguard.com.br
```

No painel do registro.br, aponte os registros **A** de `@` e `www` para o IP da VPS.
