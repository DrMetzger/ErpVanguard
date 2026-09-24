# ERP Vanguard

ERP completo na nuvem (web + Android), da Prime ERP Soluções.

## Estrutura do repositório

| Pasta      | O que é                                                    | Status           |
|------------|------------------------------------------------------------|------------------|
| `landing/` | Landing page do site www.erpvanguard.com.br (React + Vite) | ✅ v0.1          |
| `web/`     | ERP web (React + Vite), servido pelo Caddy com HTTPS       | ✅ v0.1          |
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

Testes: `npm test` (integração com o Gemini simulada) e `npm run test:compras` (fluxo completo contra
uma API rodando, com `API`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`).

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
