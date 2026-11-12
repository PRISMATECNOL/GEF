# v16 – Promoções programadas
1. Supabase → SQL Editor: executar `migracao_promocoes_v16.sql` (depois de v10, v10_1, v11). Opcional: `teste_promocoes_v16.sql` (faz ROLLBACK).
2. Publicar os ficheiros alterados (CACHE_VERSION → gef-v16).
- Novo: `modules/loja-virtual/promocoes.js`, `js/core/order-receipt.js`. Alterados: `modules/loja-virtual/loja-virtual.js` (separador Promoções, impressão), `js/loja-publica.js` (período, carrinho, recibo, expiração), `sw.js`.
- Regras: sem acumulação; vence o menor preço final (empate: a mais antiga); a promoção antiga por produto entra na mesma comparação. Promoção iniciada só se cancela. Compras gravam original, desconto, preço final e promoção; triggers impedem alterá-las.

# GEF – Alterações desta versão

## Passos obrigatórios (Supabase → SQL Editor)
1. Se ainda não correu: `migracao_embaixadores_v2.sql`.
2. Executar `migracao_embaixadores_v3.sql` (idempotente). Cria a função de liquidação que o
   front-end já chamava mas que não estava definida em nenhum .sql (só se ainda não existir),
   reforça o vínculo loja↔embaixador, enriquece o painel e liga o Realtime.
2b. Executar `migracao_embaixadores_v4.sql` (idempotente; já não depende da v3 ter corrido bem): cria
   `fn_ambassador_portal()` (uma só chamada com tudo o que o painel do embaixador mostra), repara o vínculo
   loja↔embaixador em registos antigos, reafirma as permissões de leitura e liga o Realtime.
2c. (Opcional, recomendado se vende metros decimais) `migracao_precisao_metros_v5.sql`: alarga a precisão do
   stock e dos custos/preços (não perde dados; cada alteração corre isolada).
3. Editar `js/config.js`: `ADMIN_CONTACT` (contacto da administração) e `SITE_URL`.
4. Publicar em HTTPS (PWA exige HTTPS). Ao publicar nova versão, alterar `CACHE_VERSION` em `sw.js`.

## O que mudou
- Embaixador: lojas regulares/atrasadas/bloqueadas/próximas do vencimento, comissão disponível/
  pendente/recebida/previsão, comissão por loja, localização, contacto, histórico de liquidações;
  actualiza sozinho (Realtime + verificação a cada 60 s + ao voltar ao separador).
- PDV: divisores entre produtos. Estoque: categoria + ordenação. Compras: pesquisa/filtros/ordenação
  nas listas e pesquisa/categoria de produto na janela de compra.
- Idioma/moeda: gravados só na loja activa (UPDATE protegido por RLS); "MT" fixo substituído pela
  moeda da loja nos módulos da loja.
- PWA: manifest.webmanifest, sw.js, offline.html, js/pwa.js. Supabase nunca passa pelo cache.

## Correcção: embaixador não via as suas lojas (v4)
- Causa 1 (painel): a tabela de lojas só era desenhada a partir de uma única chamada (`fn_ambassador_tracking`).
  Se essa chamada falhasse, o erro era engolido, a tabela ficava vazia e aparecia um aviso enganador.
  Agora, se falhar, as lojas vinculadas continuam a aparecer (estado registado) e o erro real é mostrado.
- Causa 2 (actualização): ao entrar em estado de erro/vazio, a actualização automática desligava-se para sempre.
  Agora só pára quando o utilizador sai do painel; verifica a cada 30 s, em tempo real e ao voltar ao separador.
- Causa 3 (dados): registos de loja indicada sem `store_id` apareciam como "SEM LOJA" e nunca geravam comissão.
  A v4 liga-os (mesmo id; ou nome+telefone só quando a correspondência é única).
- `sw.js`: `CACHE_VERSION` passou a `gef-v2`.

## Correcção definitiva: painel do Embaixador (v4 + front-end)
- O painel agora usa `fn_ambassador_portal()` (SECURITY DEFINER): não depende de RLS nem de `get_auth_user_role()`
  e cada secção falha isolada (devolve o resto + `warnings`). Se a v4 ainda não foi executada, o painel cai
  automaticamente para o caminho antigo e continua a mostrar as lojas vinculadas.
- A informação PERMANECE: o último estado bom fica em memória e em `localStorage`; se uma actualização falhar
  mostra a última informação guardada com aviso, e volta a tentar sozinho (30 s, Realtime, ao voltar ao separador).
- Um "perfil não encontrado" vindo de uma falha temporária já não apaga o que estava a ser mostrado.
- Diagnóstico (opcional): consulta no fim do `migracao_embaixadores_v4.sql` mostra, por embaixador, se o login
  está ligado (`user_id`), a função do login, as lojas vinculadas e as sem loja real.

## Dashboard do Administrador: vendido, custo e lucro
- Novo painel (só Administrador da loja): Vendido / Custo / Lucro de hoje e Lucro do mês, e tabela de lucro por
  item vendido (quantidade, vendido, custo, lucro, margem). Actualiza sozinho (15 s, ao voltar ao separador e a
  cada venda via Realtime). Só conta vendas CONCLUÍDAS (estornos ficam de fora). Custo = custo real do lote vendido.
- "Hoje" passou a ser o dia LOCAL (antes usava UTC: vendas depois das 22h contavam para o dia seguinte).

## Preços em metros (inteiros e decimais)
- Total da linha = quantidade × preço unitário, arredondado a 2 casas por linha (igual ao servidor), em vez de
  somar valores sem arredondar (podia diferir 0,01 do total gravado). Quantidades a 3 casas, sem deriva binária
  (0,1+0,2), aceita vírgula, e campo de quantidade mais largo para caber 12,345.
- Preço de embalagem sem preço próprio = preço por metro × metros da embalagem (proporcional).
- `sw.js`: `CACHE_VERSION` passou a `gef-v3`. `pwa.js`: já não recarrega a página na primeira instalação.

## Correcção: página `adesao.html` só mostrava o botão «Cadastrar» (v5-painel)
- Causa: `adesao.html` é a página PÚBLICA do link do embaixador. `adesao-publica.js` escondia sempre as secções
  de resumo e lojas (`display:none`), a função que desenhava as lojas nunca era chamada, e a página não tinha
  nenhuma ligação ao painel real (`index.html?tab=EMBAIXADORES`). Quem abria o link só via o botão.
- Agora, na mesma página: visitante anónimo continua a ver só o nome/código e o botão (sem dados privados);
  o Embaixador autenticado (perfil EMBAIXADOR, confirmado por `fn_ambassador_portal`, que liga ao `auth.uid()`)
  vê resumo, lojas com estado real, comissões, link pessoal + WhatsApp e notificações; estado vazio informativo.
- Sessão expirada, perfil errado, sem cadastro, link de outro embaixador e falha de rede têm mensagem própria;
  numa falha temporária mantém-se a última informação carregada.
- Se o dono do link regista uma loja nesta página, usa `fn_ambassador_create_store` (não troca a sessão dele).
- Painel do SPA (`modules/embaixadores`): acrescentados botão WhatsApp e cartão de Notificações.
- Novo ficheiro `js/core/ambassador-view.js` (lógica pura, partilhada). `sw.js`: `gef-v4` + novo ficheiro no cache.
- Não é preciso executar SQL novo. Requer a `migracao_embaixadores_v4.sql` já executada (cria `fn_ambassador_portal`).

## Super Admin: Rede & Finanças (v6)
- Executar `migracao_rede_v6.sql` (idempotente; exige v2 e v4). Cria hierarquia Super Embaixador → Embaixador,
  comissão indirecta (linha própria em `ambassador_commission_payments`, `kind='INDIRECT'`, nunca conta como receita),
  auditoria de taxas/hierarquia e `fn_admin_network_report` (só SUPERADMIN).
- Painel: Gestão de Embaixadores → botão «Rede & Finanças». `sw.js`: `gef-v5`.
- Depois de executar, marque quem é Super em Comissões → Hierarquia e defina a taxa indirecta em Taxas.

## v7 — Embaixadores e Super Embaixadores (Super Admin cria, promove, transfere; permissões no servidor)
**Executar no Supabase (SQL Editor), nesta ordem:** v2 → v3 → v4 → (v5 opcional) → v6 → **`migracao_super_embaixadores_v7.sql`** (idempotente, sem DROP/CASCADE).
Depois publicar o front-end (`sw.js` já em `gef-v6`).

- **Super Admin → Gestão de Embaixadores → «Perfis & Transferências»** (e botões «+ Novo Super Embaixador» / «+ Novo Embaixador»):
  criar os dois perfis (idioma e moeda obrigatórios, listas do `i18n.js`), editar contactos/área/idioma/moeda, comissões com data de vigência,
  promover/despromover e transferir embaixadores e lojas (sempre com pré-visualização + motivo), bloquear/desbloquear, eliminação lógica,
  pacotes de mensalidade editáveis e auditoria.
- **Super Embaixador** (`ambassadors.is_super`, decidido no servidor): vê a sua rede (embaixadores, lojas directas/indirectas, subscrições, as suas comissões) e cadastra Embaixadores normais. Lojas directas: o cadastro existente.
- **Embaixador normal**: painel actual + cartão com nome/telefone/WhatsApp do Super Embaixador (ou «sem Super Embaixador»).
- **Bloqueio**: `fn_ambassador_resolve` passa a bloquear sempre (antes `fn_ambassador_tracking` deixava ler); `fn_ambassador_portal` e as políticas RLS de leitura recusam contas bloqueadas; o ecrã só mostra mensagem + motivo + contacto e apaga o snapshot local.
- Funções novas: ver o cabeçalho do SQL. Tabelas novas: `ambassador_audit_log`, `ambassador_transfers`, `ambassador_fee_packages`, `ambassador_rate_schedule`.
- Decisões pendentes (não implementado de propósito): ver relatório de entrega.

## v8 — ícone PWA, pacotes 300/500/750/1000, vínculo e título do painel
- **Ícones PWA** (`assets/icons/pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`, `apple-touch-icon.png`): eram blocos de cor, agora são a render do `icon.svg` em uso (o `icon.svg` não foi tocado). Maskable = mesma logo a 80% (zona segura); Apple = fundo sólido (iOS pinta transparência de preto). `sw.js` → `gef-v7`. **Para ver o ícone novo: desinstalar o PWA, limpar dados do site e instalar de novo.**
- **Pacotes** 300, 500, 750 e 1000: no formulário de lojas (por omissão) e em `migracao_pacotes_v8.sql` (executar depois da v7).
- **Lista de embaixadores** (Super Admin): mostra «Super Embaixador» ou «Embaixador · Super Embaixador: <nome | sem vínculo>».
- **Título do painel**: «Painel do Super Embaixador: <nome>» / «Painel do Embaixador: <nome>» (cabeçalho e menu lateral).

## v9 — Angola (formas de pagamento), embaixador na lista de lojas, Super Admin gere lojas e utilizadores
**Executar no Supabase depois da v7 (e v8): `migracao_angola_lojas_v9.sql`** (idempotente). Front-end: `sw.js` → `gef-v8`.
- **Loja com moeda Kz (Angola)** passa automaticamente a ter: Numerário (Kz), Multicaixa Express, TPA/POS, Transferência bancária (IBAN), Referência Multicaixa, Carteira móvel (+ «Crédito Fiado», que é venda a crédito e foi mantido). Aplica-se ao POS, histórico de vendas, recebimento de clientes, recibo e resumo do caixa (`js/core/payment-methods.js`). As outras moedas ficam como estavam. Sem a v9 as vendas com os 3 códigos novos são recusadas pela base de dados.
- Lojas criadas por embaixador herdam moeda/idioma do embaixador (antes ficavam sempre MT/pt).
- **Gestão de Filiais / Monitor (Super Admin)**: coluna «Embaixador / Super Embaixador» por loja; botões «+ Nova Loja», «Editar loja» e «Utilizadores» (criar, editar função/nome/activo e repor palavra-passe). Funções SQL: `fn_admin_create_store`, `fn_admin_update_store`, `fn_admin_list_store_users`, `fn_admin_create_store_user`, `fn_admin_update_store_user`, `fn_admin_reset_store_user_password` (todas só SUPERADMIN, auditadas).

## v9.1 — barra de pesquisa nas listas
Pesquisa (sem distinguir maiúsculas nem acentos) em: lista de embaixadores do Super Admin (inclui o Super Embaixador vinculado), «Perfis & Transferências», Gestão de Filiais/Monitor (loja, cidade, embaixador, Super Embaixador, estado), rede do Super Embaixador (embaixadores e lojas) e tabela de lojas do painel do Embaixador. Nas listas com paginação o filtro aplica-se a todos os registos, não só à página visível. `sw.js` → `gef-v9`. Sem alterações de SQL.

## v15 — Ícone personalizado da loja virtual (corrige: a loja pública mostrava sempre o ícone padrão)
**Executar no Supabase (SQL Editor), depois da v12: `migracao_icone_loja_virtual_v15.sql`** (idempotente; só acrescenta a função `fn_public_store_identity`). `sw.js` → `gef-v15`.
- **Causa:** (1) `loja.html` tinha o favicon fixo em `icon.svg` e nenhum `apple-touch-icon`/manifesto; (2) o cabeçalho da loja só usava o «Logótipo» de Loja virtual → Personalização, nunca a Identidade da Aplicação; (3) a identidade só era legível por utilizadores autenticados, por isso um visitante anónimo não a podia obter.
- **Correcção:** nova função pública só de leitura (resolve a loja pelo endereço `slug`, só responde com a loja activa e a loja virtual activada, devolve apenas campos públicos). Novo `js/core/store-identity.js`; `js/loja-publica.js` e `loja.html` ligados a ele.
- **Onde aparece:** favicon do separador, `apple-touch-icon`, manifesto da loja (atalho/«instalar», com nome, ícones e cores da loja e `start_url` da própria loja), `theme-color` e cabeçalho (ordem: ícone/logótipo da Identidade > logótipo da Personalização > nada).
- **Sem cache preso:** cada upload gera ficheiro com nome único e todos os URLs levam `?v=<versão>`; a loja aberta volta a perguntar ao voltar ao separador e de 5 em 5 min; o último ícone conhecido DESTA loja (chave por endereço) é pintado logo à abertura e corrigido pelo servidor.
- **Limitação:** atalhos/apps JÁ instalados no telemóvel só mudam de ícone quando o sistema operativo o decidir (iOS: remover e voltar a adicionar). O HTML estático continua a ter o ícone GEF para quem lê a página sem executar JavaScript (pré-visualizações de links).
- Testes: ver `tests/` (unitários + ponta a ponta em Chromium).

## v14 — Cadastro de produto com fotos/informações opcionais + PWA personalizado por loja
**Executar no Supabase (SQL Editor), depois da v10/v11: `migracao_identidade_pwa_v12.sql`** (idempotente; só acrescenta a tabela `store_app_identity` e 4 funções; não altera nenhuma tabela/política existente). `sw.js` → `gef-v14`.

### Cadastro de produto (sem SQL novo)
- **Produtos → Cadastrar:** nova secção **«🛒 Loja virtual — fotografias e informações (opcional)»**: fotografias (até ao limite da loja, a 1.ª é a principal; reordenar/remover), marca, modelo, unidade de venda, descrição, detalhes técnicos, notas e «Publicar na loja virtual». Tudo opcional: sem preencher nada o cadastro é igual ao anterior.
- O produto grava-se primeiro; depois enviam-se as fotos e os dados com as mesmas funções da janela «Loja virtual» do produto. Se essa 2.ª fase falhar, o produto fica gravado e aparece um aviso (completa-se em «Loja virtual» do produto).
- Ficheiros novos: `modules/produtos/cadastro-loja.js`; alterado: `modules/produtos/produtos.js`.

### PWA por loja
- **Loja identificada só no servidor** (`fn_app_identity_get` usa `auth.uid()` → `profiles.store_id`; perfil tem de estar activo). Nunca pelo e-mail ou dados locais.
- **Configurações → «Identidade da Aplicação (PWA)»:** nome (≤40), nome curto (≤12), logótipo, ícone opcional, cor da barra e cor de fundo, pré-visualização (cabeçalho, ícone do ecrã principal, círculo Android, convite). Super Admin: qualquer loja + opção «Permitir que o Administrador altere». Administrador: só a sua e só se autorizado. Ficheiros validados pelo conteúdo (JPG/PNG/WebP, ≤12 MB, ≥192 px); ícones PNG 192/512/maskable/Apple 180 gerados no navegador e guardados em `<loja>/identity/` no bucket `product-images`.
- **Cabeçalho:** ícone + nome da loja autenticada (padrão GEF se não houver configuração); actualiza ao guardar, ao voltar ao separador e de 5 em 5 min.
- **Manifesto:** `index.html` já não tem `<link rel="manifest">`; `js/core/app-identity.js` injecta-o **só depois de login válido** (manifesto da loja gerado como `blob:` com URLs absolutas, ou `manifest.webmanifest` se a loja não tiver identidade). Antes do login/depois do logout não há manifesto (não há instalação).
- **Convite de instalação** (`js/pwa.js`): só após login; ícone + nome da loja; «Instalar aplicação» (Chrome/Edge/Android, `beforeinstallprompt`) / «Agora não» (silencia 14 dias); Safari/iOS: só instruções «Adicionar ao ecrã principal» (sem botão); não aparece se já instalada/standalone, nem em navegadores sem instalação; no máximo 1 vez por carregamento.
- **Service Worker:** só ficheiros estáticos do próprio domínio, nunca pedidos com `Authorization` nem dados; manifesto/ícones das lojas não passam por ele. Logout limpa identidade, manifesto, título e ícones da loja anterior.
- Ficheiros novos: `js/core/app-identity.js`, `modules/configuracoes/identidade-app.js`, `migracao_identidade_pwa_v12.sql`. Alterados: `index.html`, `js/app.js`, `js/pwa.js`, `js/core/auth.js`, `js/core/image-utils.js` (exporta `decode`), `js/components/navbar.js`, `modules/configuracoes/configuracoes.js`, `sw.js`, `js/config.js`.
- **Limitação:** apps já instaladas não actualizam nome/ícone de imediato (Android: o sistema actualiza mais tarde; iOS: remover e voltar a adicionar; computador: reinstalar). O manifesto `blob:` não pode ser revalidado pelo navegador depois da instalação; para actualização automática fiável seria preciso um manifesto servido por URL estável no mesmo domínio (função serverless no alojamento).

## v13 — Gerir categorias/subcategorias e alocar produtos; garantia de versão nova
- **Produtos → «🗂 Gerir categorias»:** lista as categorias e subcategorias em uso (com nº de produtos); renomear categoria (escrever o nome de outra junta as duas), renomear subcategoria, mover subcategoria para outra categoria, remover subcategoria (produtos ficam sem subcategoria). Aplica-se a todos os produtos da loja de uma vez, no ERP e na loja virtual.
- **Alocar produtos:** caixas de selecção na lista de Produtos (e «seleccionar todos»); barra «Mover para: categoria / subcategoria» → Aplicar.
- Categoria e subcategoria continuam a definir-se ao cadastrar e a editar-se depois no botão «Editar» do produto.
- **Versão visível:** o ecrã de Produtos mostra «versão v13» (config.js → APP_VERSION). Se não aparecer, o site ainda está a servir ficheiros antigos.
- `sw.js` → `gef-v13`; os ficheiros passam a revalidar sempre com o servidor (evita JS antigo em cache). Sem SQL novo além da v11.

## v11 — Categoria + subcategoria, imagem de fundo, nome automático da cor, departamentos
**Executar no Supabase (SQL Editor), depois da v10.1: `migracao_loja_virtual_v11.sql`** (idempotente). `sw.js` → `gef-v12`.
- **Produtos:** Categoria (escolher da lista ou escrever uma nova) e **Subcategoria** (opcional, sugere as já usadas na categoria). A lista de Produtos mostra a subcategoria e o filtro de categorias passa a incluir as que criar.
- **Cores:** ao escolher a cor na amostra, o sistema escreve sozinho o nome (ex.: «Azul-marinho», «Cinzento claro»). Pode corrigir à mão; nomes repetidos no mesmo produto recebem número. Novo ficheiro `js/core/color-names.js`.
- **Loja Virtual → Personalização:** nova **Imagem de fundo da loja** (como o logótipo e a imagem de destaque) + botão «Remover imagem» nas três.
- **Loja pública:** categorias funcionam como **departamentos** na mesma página (sem abrir outra): a categoria escolhida fica destacada, aparece o cabeçalho «Departamento» com as subcategorias, e o catálogo mostra só esse departamento. Pesquisa de produtos (nome, marca, modelo, código, categoria, subcategoria), sem distinção de maiúsculas/acentos, a actualizar enquanto escreve sem perder o foco; resposta antiga já não sobrepõe a nova.
- Antes de executar a v11 o cadastro de produtos continua a funcionar (a subcategoria só é enviada quando preenchida).

## v10.1 — CORRECÇÃO: loja virtual não abria ("cannot execute INSERT in a read-only transaction")
**Executar no Supabase (SQL Editor): `migracao_loja_virtual_v10_1_fix.sql`** (idempotente). `sw.js` → `gef-v11`.
- Causa: `fn_public_store`, `fn_public_products` e `fn_public_product` eram `STABLE` mas chamam `fn_rate_limit` (INSERT). Agora são `VOLATILE` (também corrigido em `migracao_loja_virtual_v10.sql`).
- Todo produto do ERP fica publicado na loja virtual por omissão (`products.published` = TRUE; os produtos existentes são publicados na 1.ª execução). Na lista de Produtos há a coluna «Loja virtual» (Visível/Oculto) para activar/desactivar por produto; a janela «Loja virtual» do produto continua a ter a opção «Publicar».

## v10 — Loja virtual, catálogo com fotos/cores, links partilháveis, encomendas e desempenho
**Executar no Supabase (SQL Editor) depois da v9: `migracao_loja_virtual_v10.sql`** (idempotente). Front-end: `sw.js` → `gef-v10`.
- **Loja pública:** `loja.html?s=<endereço>` e `loja.html?s=<endereço>&p=<id-do-produto>` (link estável: usa o id do produto). Catálogo paginado por cursor (24/pedido), pesquisa, categorias, ordenação, promoções, destaques, popup do produto com galeria/cores/quantidade, carrinho flutuante persistente, encomenda e pedido de cotação, partilha (Web Share + copiar).
- **Super Admin → Gestão de Filiais:** botão «Loja virtual» por loja (activar/desactivar, endereço), «Temas», indicadores por loja e globais. Estado da loja e da loja virtual são independentes; loja virtual desactivada ou loja suspensa = o endereço público não aceita encomendas nem cotações (histórico preservado).
- **Administrador/Gerente → «Loja Virtual & Encomendas»:** link da loja, personalização (tema autorizado, cores, logótipo, imagem, secções), encomendas (estado, pagamento manual, cor por linha, impressão).
- **Produtos → botão «Loja virtual»** (fotografias até ao limite, principal/ordem/substituir/remover, cores com stock opcional, promoção com validade, destaque, publicação, link) e botão 🔗 para partilhar o link na lista.
- **Servidor:** preços/promoção/cor/stock por cor validados na RPC; encomendas idempotentes; rate limiting (`api_rate_limits`) na pesquisa, produto, encomenda e cotação; RLS por loja; bucket público `product-images` com escrita só na pasta da própria loja.
- **Desempenho:** painel de lucro só descarrega vendas quando a «impressão digital» (`fn_sales_fingerprint`) muda; refresco de segurança 15 s → 120 s (dashboard) e 30 s → 120 s (embaixadores); índices novos.
- **Limite de fotografias:** uma só constante no SQL, `fn_max_product_images()` (por omissão **5**; o pedido tinha 5 e 7 — mude o número na função se quiser 7).
