# v18 – Instalação, Conta/Área do Cliente, Comprovativo, Clientes e Campanhas

## 1. Supabase – SQL (por ordem)
v10, v10_1, v11, v16 (+ v16_1) já executados → **`migracao_clientes_campanhas_v18.sql`** → (opcional) `teste_clientes_campanhas_v18.sql` (ROLLBACK).
Cria: contas de cliente, consentimentos (+ registo), subscrições push, campanhas/destinatários, comprovativos (bucket **privado** `payment-proofs`), RLS e RPC.

## 2. Supabase – Authentication (obrigatório para criar conta/recuperar acesso)
- Authentication → URL Configuration: **Site URL** = endereço público do site; **Redirect URLs** = `https://SEU-SITE/loja.html*`.
- Providers → Email activo. Recomendado manter «Confirm email» ligado (a associação de compras antigas exige email confirmado).
- Personalizar templates de email (confirmação / recuperação) em Authentication → Email Templates. Para envio em volume configure SMTP próprio.
- Contas de cliente e de utilizadores do ERP partilham o Supabase Auth; um email que já é utilizador do ERP não pode ser conta de cliente (a função recusa).

## 3. Notificações PWA (Web Push)
1. `npx web-push generate-vapid-keys`
2. Chave **pública** → `js/config.js` (`VAPID_PUBLIC_KEY`). Chave **privada** só nos Secrets.
3. `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:o-seu-email`
4. `supabase functions deploy send-campaign`
iPhone: notificações só funcionam com a app instalada no ecrã principal (iOS 16.4+).

## 4. WhatsApp Business Platform (API oficial da Meta) – CONFIGURAÇÃO EXTERNA
1. Conta Meta Business + app com produto WhatsApp; número verificado; token permanente (utilizador de sistema).
2. Criar e **aprovar** um modelo de categoria *Marketing*, idioma `pt_PT`, corpo com 3 variáveis: `{{1}}` nome · `{{2}}` mensagem · `{{3}}` link, terminando com «Responda PARAR para deixar de receber».
3. `supabase secrets set WHATSAPP_TOKEN=… WHATSAPP_VERIFY_TOKEN=um-texto-secreto WHATSAPP_APP_SECRET=…` (por loja, opcional: `WHATSAPP_TOKENS='{"<store_id>":"<token>"}'`).
4. `supabase functions deploy whatsapp-webhook --no-verify-jwt` e, na Meta, webhook = `https://<projeto>.supabase.co/functions/v1/whatsapp-webhook`, token de verificação = `WHATSAPP_VERIFY_TOKEN`, subscrever `messages`.
5. No ERP: Loja virtual → Promoções e notificações → **Integração WhatsApp** (Phone Number ID, nome e idioma do modelo).
Custos e limites: a Meta cobra cada conversa de marketing e limita o volume diário por nível do número. O sistema limita ainda a 5 campanhas/dia por loja, 1000 destinatários WhatsApp e 5000 push por campanha (`fn_campaign_limits()`).

## 5. Publicar o front-end
Ficheiros novos: `js/loja-install.js`, `js/loja-cliente.js`, `modules/loja-virtual/clientes-loja.js`, `modules/loja-virtual/campanhas.js`, `supabase/functions/*`. Alterados: `js/loja-publica.js`, `css/loja.css`, `modules/loja-virtual/loja-virtual.js`, `sw.js` (push + cache gef-v18), `js/config.js`.

## Regras implementadas
- Popup de instalação 1 vez; depois de dispensado fica só o botão discreto «⬇ Instalar app» (enquanto não instalada). Com a app instalada, o popup só reaparece quando há actualização.
- Instalar a app ≠ consentimento. Notificações e WhatsApp são autorizações separadas, desligáveis na Área do Cliente (WhatsApp também por «PARAR»).
- Envio duplicado impedido por chave primária (campanha, cliente), chave de idempotência e reserva atómica de lotes. O consentimento é revalidado no momento do envio.
- Compras antigas só se associam com email confirmado + (código da encomenda + telefone da compra) ou email igual ao da compra.
