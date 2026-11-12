# v24 – Temas por loja (Super Admin) · Marketing valida pagamentos · Estoquista sem custos · Conferência na logística

## 1. Ordem de instalação
1. **SQL** (Supabase → SQL Editor): `migracao_temas_pagamentos_v24.sql` (depois da v22; idempotente).
2. Publicar o front-end (`sw.js` passou a `gef-v24`). Ficheiro novo: `css/themes/liquid_glass.css`.
3. Nenhuma Edge Function nova ou alterada.

## 2. O que mudou

### A) Marketing & Vendas valida pagamentos
- Na encomenda aberta, o Marketing vê **✅ Validar pagamento** e **⛔ Recusar pagamento** (com motivo opcional), ao lado de «Enviar para logística».
- No servidor (`fn_store_order_set_payment`): o perfil MARKETING só pode pôr **PAGO** ou **REJEITADO**. Não altera o estado da encomenda nem repõe estados (isso continua com Admin/Gerente). O cliente é avisado como antes e fica registado quem validou.

### B) Estoquista sem valores nem custos (confidencial)
O Estoquista continua a ver e a mexer **só em quantidades**. Deixa de ver:
- Estoque: «Valor Total em Estoque (Venda)», coluna «Valor Custo», ordenação «Maior valor», «Custo Unit.» dos lotes.
- Compras: coluna «Total», campo «Custo unit.», total da compra. (A entrada é registada sem custo; o servidor não altera o custo médio quando o custo é 0.)
- Perdas: «Custo Total», «Custo Unitário», «Impacto Total».
- Auditoria/Inventário: «Impacto Financeiro Líquido», «Custo Unit.», «Impacto», também no histórico, detalhes e relatório impresso.
- Catálogo (Produtos): já era só leitura e sem custo/margem para este perfil (inalterado).
Regra central: `canViewStockValues()` em `js/core/permissions.js`. Os restantes perfis veem exactamente o que viam.

### C) Temas por loja – exclusivo do Super Admin
- **Gestão de Filiais → botão TEMA** em cada loja: escolher **Tema Padrão (actual)** ou **Liquid Glass Premium**.
- Guardado no Supabase, na própria loja: `stores.vstore_theme_grant` (+ quem e quando). Tema activo na loja online: `stores.vstore_theme` (como antes).
- **Atribuir não altera a loja online.** O Administrador vê o tema em «Loja virtual → Personalização» (marcado ★ Premium) e aplica-o com «Guardar personalização».
- Sem atribuição, o Liquid Glass **não aparece** e **não pode ser escolhido**, nem por API directa (RPC + trigger em `stores`). Admin e outros perfis não conseguem atribuir, remover nem forçar o tema.
- Voltar ao Padrão (ou trocar de tema premium) repõe de imediato `classico` na loja online. A loja pública também resolve o tema no servidor, por isso só mostra o que lhe foi atribuído.
- Os 4 temas existentes (Clássico, Moderno, Natureza, Minimal) e as cores/logótipo/secções da personalização ficam como estavam.
- Cada atribuição fica na auditoria (`STORE_THEME_ASSIGNED`).

### D) Conferência de produtos na Logística
- Cada linha da encomenda «A preparar» tem um visto «Conferido» (e o botão «Conferir tudo»).
- O botão **✔ Pronta para entrega** só activa quando todas as linhas estão conferidas. Os vistos ficam guardados na sessão do dispositivo e não se perdem na actualização automática.

## 3. Novo tema no futuro (sem reconstruir nada)
1. Criar `css/themes/<id>.css` com regras limitadas a `[data-theme=<id>]` (modelo: `liquid_glass.css`).
2. `INSERT INTO public.vstore_themes (id, name, sort_order, enabled, restricted, description) VALUES ('<id>', 'Nome', 60, TRUE, TRUE, '…');`
   `restricted = TRUE` → só por atribuição do Super Admin; `FALSE` → qualquer loja pode escolher.
3. O botão TEMA e a Personalização listam-no sozinhos; o carregador (`applyTheme` em `js/loja-publica.js`) carrega o CSS só nas lojas que o usam.
(Nota: a atribuição guarda **um** tema premium por loja. Para várias atribuições em simultâneo seria preciso uma tabela de atribuições.)

## 4. Limites a conhecer (honestos)
- **Custos do Estoquista:** a ocultação é na interface. As policies RLS da tabela `products` deixam o utilizador da loja ler as colunas da linha; quem abrir as ferramentas do navegador consegue ver `cost_price` na resposta. Fechar isto a 100% exige uma vista/RPC sem custos para este perfil (mexe em RLS e em todos os módulos) — não foi feito para não afectar o que já funciona. Posso fazê-lo numa versão seguinte.
- **Conferência na Logística:** é uma salvaguarda de interface (não é imposta pelo servidor).
- O SQL e o código foram escritos a partir das definições existentes (v10, v11, v22) e a sintaxe JS foi verificada, mas **não foi executado contra o seu Supabase**. Teste primeiro numa loja de ensaio.

## 5. Teste rápido (5 minutos)
1. SQL v24. 2. Super Admin → Gestão de Filiais → TEMA → Liquid Glass → Guardar. A loja online continua igual.
3. Admin dessa loja → Personalização → tema «Liquid Glass Premium ★» → Guardar → abrir a loja: tema aplicado. Outra loja sem atribuição: sem essa opção.
4. Super Admin → TEMA → Tema Padrão: a loja volta ao padrão.
5. Marketing → encomenda com comprovativo → Validar → cliente vê «Pagamento validado».
6. Estoquista → Estoque, Compras, Perdas, Auditoria: sem custos/valores.
7. Logista → encomenda: «Pronta» só depois de conferir todas as linhas.

## 6. Ficheiros alterados / novos
Alterados: `js/core/permissions.js`, `js/loja-publica.js`, `sw.js`, `modules/estoque/estoque.js`, `modules/compras/compras.js`, `modules/perdas/perdas.js`, `modules/auditoria/auditoria.js`, `modules/loja-virtual/loja-virtual.js`, `modules/logistica/logistica.js`, `modules/monitor/monitor.js`, `modules/monitor/gestao-lojas.js`.
Novos: `migracao_temas_pagamentos_v24.sql`, `css/themes/liquid_glass.css`, este ficheiro.
