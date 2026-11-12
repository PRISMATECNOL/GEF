# v19 – Conta sem email, limite de tentativas, canal Email, roles Marketing & Logista

## 1. Ordem de instalação
1. **SQL** (Supabase → SQL Editor): `migracao_conta_roles_v19.sql` (depois da v18; idempotente, pode repetir).
2. **Authentication → Providers → Email**: desligar **«Confirm email»** (já não há códigos/links). Não é preciso configurar SMTP para contas de clientes.
3. **Edge Functions** (a pasta `supabase/functions` deste zip):
   - `supabase functions deploy customer-auth --no-verify-jwt` (criar conta + entrar, com limite de tentativas)
   - `supabase functions deploy send-email-campaign` (envio de email)
   - `send-campaign` e `whatsapp-webhook` (os que já tem) **não foram alterados**.
4. **Secrets** (só para email): `supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Loja <loja@seudominio.com>" SITE_URL=https://seu-site` (domínio verificado no Resend).
   Opcionais: `CUSTOMER_LOGIN_DOMAIN` (def. `cliente.invalid`; se o Supabase recusar este domínio, ponha um domínio seu — nunca é enviado email para ele), `ALLOWED_ORIGINS`.
5. Publicar o front-end (`sw.js` passou a `gef-v19`).

## 2. Conta de cliente
- Obrigatórios: **nome, contacto (telemóvel) e endereço**. Email e WhatsApp são opcionais. Sem código de confirmação.
- Acesso = telemóvel + palavra-passe (contas antigas continuam a entrar com o email). O pedido passa pela função `customer-auth`.
- **Limites** (ficheiro `customer-auth/index.ts`, topo): 5 falhas/15 min por telemóvel, 25 falhas/15 min por IP, 6 contas novas/hora por IP, 3 pedidos/dia por telemóvel. Mensagem de erro única (não revela se a conta existe).
- «Recuperar acesso» e «Esqueci a palavra-passe» foram **removidos**.
- Promoções: continuam só para quem autorizou cada canal (PWA, WhatsApp, Email), na Área do cliente ou no registo.
- Associar compras antigas: por código da encomenda + telefone (sem email). Por email só nas contas antigas com email confirmado.

## 3. Notificações em massa (Loja virtual → Promoções e notificações)
Canais: 🔔 PWA, 💬 WhatsApp (as suas funções), ✉️ **Email** (novo). Limites em `fn_campaign_limits()` (email usa o limite do WhatsApp).

## 4. Fase 2 – novos roles (criados pelo Super Administrador em Lojas → utilizadores; **vários utilizadores por função**)
| Função | Pode |
|---|---|
| **Marketing & Vendas** (`MARKETING`) | promoções; campanhas PWA/WhatsApp/Email; lista de clientes; ver encomendas e comprovativos de pagamento; botão **Enviar para logística**; ver notificações «pronta para entrega» |
| **Logista** (`LOGISTA`) | menu **Preparação de Encomendas**: vê produtos/quantidades/cor e dados de entrega; botão **Pronta para entrega**; recebe notificação de novas encomendas |
- Marketing **não** confirma pagamentos nem muda o estado da encomenda (fica para Admin/Gerente). Para permitir, acrescente `'MARKETING'` em `fn_store_order_set_status`.
- Fluxo: encomenda → Marketing/Admin/Gerente «Enviar para logística» (estado passa a *Em preparação*) → Logista «Pronta para entrega» → **notificação interna** (Admin, Gerente, Marketing) + **cliente**: vê «Pronta para entrega» na Área do cliente e recebe PWA/WhatsApp/Email se autorizou. Cliente sem conta: o logista pode abrir o WhatsApp já escrito.
- Cada passo guarda **quem** (nome + função) e **quando** (`order_events`, colunas `sent_logistics_*` / `ready_*`). Duas pessoas não conseguem marcar a mesma encomenda (bloqueio na base de dados).
- Admin e Gerente também têm o menu «Logística de Encomendas».
