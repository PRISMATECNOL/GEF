# v21 – Perfil do cliente, confirmação com PDF/Imprimir/Comprovativo, instruções de pagamento, estado do pagamento e notificações

## 1. Ordem de instalação
1. **SQL** (Supabase → SQL Editor): `migracao_pagamentos_v21.sql` (depois da v20; idempotente, pode repetir).
2. Publicar o front-end (`sw.js` passou a `gef-v21`; ficheiros novos: `js/core/order-ui.js`, `js/core/order-pdf.js`, `assets/sounds/notify.wav`).
3. Nenhuma Edge Function nova ou alterada. `send-campaign` e `send-email-campaign` continuam a ser usadas como até aqui.
4. Para as notificações PWA funcionarem tem de existir a chave pública em `js/config.js` (`VAPID_PUBLIC_KEY`) e as chaves nos Secrets (ver LEIA-ME_V18).

## 2. O que mudou, tarefa a tarefa
**1. Área do cliente (mais elaborada, com miniaturas)**
- Cabeçalho com avatar, contacto, morada e selos («App instalada», «Notificações ativas/desligadas»); 3 indicadores: Compras, Total pago, Pagamentos pendentes.
- Separadores: Compras · Perfil · Como pagar · Notificações. O Perfil tem dados pessoais e alterar palavra-passe.
- Lista de compras: miniaturas dos produtos (as mesmas imagens do catálogo; se a cor tem imagem própria, usa-se essa), código, data, nº de produtos, total, estado da encomenda e estado do pagamento. Filtros por pagamento (Pendente / Validado / Recusado).
- Detalhe da compra: cada linha com miniatura, estado do pagamento em destaque, instruções de pagamento (se por pagar), envio de comprovativo, PDF, imprimir e WhatsApp da loja.

**2. Confirmação da compra** (logo a seguir a «Enviar encomenda»): três botões grandes — **Descarregar PDF · Imprimir · Enviar comprovativo** — e, abaixo, as instruções de pagamento com botão «Copiar» em cada conta.
- *Descarregar PDF*: gera um PDF verdadeiro e descarrega com 1 toque (sem janelas pop-up, sem «Guardar como PDF»).
- *Imprimir*: abre directamente a caixa de impressão do dispositivo.
- *Enviar comprovativo*: com conta iniciada, escolhe a foto/PDF e envia ali mesmo (a encomenda fica «Pagamento pendente» até a loja validar). Sem conta (convidado), abre o WhatsApp da loja com a mensagem já escrita; se a loja não tiver WhatsApp indicado, propõe entrar/criar conta.

**3. Logótipo e instruções no PDF**
- O PDF (e a impressão) levam o logótipo da própria loja (ícone/logótipo da identidade da app; se não houver, o logótipo da «Personalização»), nome e contactos da loja, e o bloco «Como pagar» com as contas.
- **Editável pelo Administrador/Gerente:** Loja virtual → separador de personalização → cartão «Instruções de pagamento e contas» (texto geral + até 10 contas: forma/banco, titular, nº/IBAN/referência, nota). Guarda por loja.

**4. Estado do pagamento + aviso ao cliente**
- Estados: **Pagamento validado · Pagamento pendente · Pagamento recusado** (novo estado `REJEITADO`), sempre visíveis na lista de compras e no detalhe.
- No painel da loja (Encomendas → abrir encomenda): botões **✅ Validar pagamento** e **⛔ Recusar pagamento** (com motivo opcional que o cliente vê). Ao validar/recusar, o cliente é avisado por PWA/WhatsApp/Email (os canais que tiver activos) e a lista dele muda sozinha.
- Independente das notificações: a Área do Cliente actualiza o estado ao abrir, ao voltar à app e de minuto em minuto, e mostra um aviso («✅ Pagamento validado — encomenda …») com som curto.
- Depois de uma recusa, o cliente pode enviar novo comprovativo (volta a «pendente»).
- Clientes que compraram sem conta não têm lista: o painel oferece abrir o WhatsApp com a mensagem pronta.

**5. Promoções e campanhas — app instalada recebe directamente**
- A app instalada pede a permissão de notificações no 1.º toque e mostra uma barra «Ativar» enquanto não estiver ativa (sem conta, a barra convida a entrar/criar conta). Aceite a permissão, a subscrição liga-se à conta e o consentimento fica registado com origem `app_instalada`.
- No servidor, quem tem **app instalada + subscrição activa** passa a estar sempre no público das campanhas PUSH (mesmo sem o interruptor «Autorizar»).
- Som: com a app aberta toca um som curto e rápido (`assets/sounds/notify.wav`, ~0,3 s); a notificação também vibra.

## 3. Limites a conhecer (honestos)
- **O sistema operativo não deixa «obrigar» notificações:** o utilizador tem sempre de aceitar a permissão do dispositivo (e pode desligá-la nas definições). O sistema insiste (barra permanente + pedido no 1.º toque), mas não consegue contornar uma recusa/bloqueio.
- **Só clientes com conta** recebem notificações (a subscrição fica ligada à conta). Quem usa a app como convidado não pode ser alcançado por push.
- **Som em segundo plano:** os navegadores não permitem sons próprios em notificações push; com a app fechada/em segundo plano toca o som padrão do telemóvel. O som curto personalizado toca com a app aberta.
- Enviar comprovativo dentro da app exige conta iniciada (o armazenamento dos comprovativos é privado por cliente). Convidados usam o WhatsApp.
- O envio efectivo das notificações continua a ser feito pela função `send-campaign` que já tem (não está neste ZIP e não foi alterada).

## 4. Para testar (5 minutos)
1. Executar o SQL. 2. Admin: guardar instruções de pagamento. 3. Cliente (com conta): comprar → confirmar que aparecem PDF/Imprimir/Enviar comprovativo e as contas. 4. Abrir o PDF (logótipo + instruções). 5. Enviar comprovativo → lista mostra «Pagamento pendente». 6. Admin: Validar → cliente vê «Pagamento validado» (e recebe a notificação, se activa); repetir com «Recusar».

## v22 – Notificações no aparelho SEM Edge Functions
1. Executar `migracao_notificacoes_v22.sql` (depois da v21).
2. Campanhas «PUSH», pagamento validado/recusado e «encomenda pronta» passam a ser entregues por SQL (`customer_notifications`). Email/WhatsApp mantêm as suas funções.
3. A app do cliente (instalada) vai buscar as novas a cada 30 s e mostra a notificação do sistema com som curto. O cliente desativa em Perfil → Notificações; sem autorização não se entrega nada.
4. Limite: só chega com a app aberta ou em segundo plano. Com a app totalmente fechada, só um servidor de push (Edge Function) consegue entregar.
