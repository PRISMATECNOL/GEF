# v25 – GEF/PRUMO multi-sectorial (evolução retrocompatível)

## 1. Diagnóstico (o que existia)
- `stores` não tinha tipo de negócio; categorias eram uma lista fixa de Ferragens no ecrã de Produtos; unidades fixas no formulário; locais de stock fixos em 3 códigos (LOJA, ARMAZEM, PATIO) com nomes de Ferragens ("Pátio de Agregados") espalhados por 8 ficheiros.
- **Não existe fluxo de aprovação de lojas.** Loja criada pelo Super Admin, pelo Embaixador ou pelo link público fica activa na hora (teste de 30 dias); a comissão nasce no 1.º pagamento lançado. Por isso "carregar a configuração após aprovação" foi implementado como **carregar no momento da criação/activação** (mesma transacção). Não inventei um fluxo de aprovação que mudasse o comportamento actual.
- Utilizadores eram criados por SQL (`fn_internal_create_store_user` escreve em `auth.users`), com o Embaixador limitado a ADMIN/CASHIER.
- RLS, trava de subscrição, comissões e loja online não foram alterados.

## 2. O que foi feito
| Requisito | Implementação |
|---|---|
| 1 Tipos de negócio | 36 sectores semeados (30 comércios incl. OUTROS + 6 armazéns). Super Admin cria novos (clonando) em Monitor → «Tipos de negócio». |
| 2 Config. automática | Por sector: categorias+subcategorias, unidades, atributos, nomes dos 3 locais, obrigatoriedade de lote/validade. A loja personaliza em Configurações → «Tipo de negócio e catálogo» (ADMIN). |
| 3 Cadastro | Campo **obrigatório** em: Super Admin (nova loja), Embaixador/Super Embaixador (criar loja), link público do embaixador (adesao.html). O tipo fica em `stores.business_type` e em `ambassador_referred_stores.business_type`. Super Admin corrige em «Editar loja». Activação e comissões inalteradas. |
| 4 Utilizadores | Edge Function `create-store-user` (Auth Admin API; a Service Role Key só existe no servidor). Âmbito validado no SQL: Super Admin = todas; Super Embaixador = lojas da sua rede; Embaixador = lojas directamente vinculadas. Perfis: ADMIN, GERENTE, CASHIER, ESTOQUISTA, LOGISTA, MARKETING (nunca SUPERADMIN nem EMBAIXADOR). Autorizações: `ambassadors.can_create_store_users` e `ambassador_referred_stores.users_authorized` (RPC `fn_admin_set_user_creation_auth`). Auditoria em `user_creation_audit`. |
| 5 Armazéns | 6 tipos de armazém (geral, matérias-primas/produtos acabados, medicamentos, peças, alimentos, construção) com nomes de locais próprios, lotes, entradas (Compras), saídas (vendas/entregas/perdas) e transferências. |
| 6 Migração | Colunas novas com valor por omissão: todas as lojas existentes ficam **FERRAGENS**; nada é apagado, recriado nem muda de ID. Lojas antigas continuam a ver os mesmos predefinidos de Ferragens (lidos do sector, sem copiar). |
| 7 Implementação | Novas tabelas com RLS: `business_types`, `business_type_presets`, `store_sector_items`. `products.attributes` (JSONB). Formulários de Produtos (categoria, unidade, atributos), Compras (lote/validade obrigatórios por sector), Estoque, Transferências, Perdas, Auditoria e barra superior usam os nomes do sector. |

## 3. Deploy
**Supabase**
1. SQL Editor → executar `migracao_multisetor_v25.sql` (depois da v24; idempotente).
2. Edge Function (verificação de JWT **ligada**):
   `supabase functions deploy create-store-user`
   Opcional: `supabase secrets set ALLOWED_ORIGINS="https://SEU-PROJECTO.pages.dev,https://seu-dominio.com"`
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente das funções; nunca as ponha no front-end.)
3. Authentication → Providers → Email: «Confirm email» desligado (como já estava).
**Cloudflare Pages**
1. Projecto estático (sem build): Git ou «Direct upload» da pasta `deploy/`. Build command vazio, output directory `/`.
2. `js/config.js` continua a ser o seu (URL e anon key do Supabase).
3. `sw.js` passou a `gef-v25`: após publicar, os utilizadores recebem a nova versão ao recarregar.
**Ordem:** SQL primeiro, depois a Edge Function, por fim o front-end.

## 4. Como testar (15 min)
1. Super Admin → Monitor → «Tipos de negócio»: 36 sectores. Criar «Óptica» clonando «Electrónica».
2. Gestão de Filiais → Nova loja: sem tipo, o botão recusa. Criar loja «Farmácia».
3. Entrar como ADMIN dessa loja: Produtos → atributos Dosagem/Forma (obrigatórios); unidades cx/blister; Compras recusa entrada sem lote/validade; locais com nomes de farmácia.
4. Embaixador → Criar Nova Loja (tipo obrigatório) → «Utilizadores» (6 perfis). Outro embaixador: a loja não aparece/é recusada.
5. Super Embaixador → A minha rede → «Utilizadores» numa loja da rede.
6. Loja antiga: tudo igual (Ferragens). Editar loja → mudar tipo com «Carregar predefinidos».
7. Link público do embaixador: o tipo é obrigatório.

## 5. Testes que fiz e limites (honestos)
- Feitos: sintaxe de todos os ficheiros JS alterados; verificação de todos os imports/exports do projecto (0 problemas); 17 testes unitários de `sector.js` (padrões de Ferragens sem configuração, farmácia, locais desactivados, unidades preservadas, atributos obrigatórios); revisão das assinaturas SQL (DROP/GRANT) e de parênteses/aspas.
- **Não feito:** o SQL e a Edge Function **não foram executados** contra um Supabase real (não tenho acesso). Execute primeiro numa base de ensaio.
- Locais: continuam **3 por loja** (LOJA/ARMAZEM/PATIO), com nomes por sector e personalizáveis. Vários armazéns independentes por loja exigiriam alterar as RPCs de venda/compra/transferência (uma fase própria, com mais risco).
- Lote/validade obrigatórios e atributos obrigatórios são validados na interface; o servidor não os impõe (`fn_confirm_purchase` mantém-se).
- Cadastro de lojas: o ADMIN inicial continua a ser criado pela função SQL existente (não mudei o que funciona); os restantes utilizadores usam a Edge Function. Clientes antigos (sem a nova versão) recebem «tipo de negócio obrigatório».
- Lojas antigas não recebem configuração automática; quando o ADMIN guarda o 1.º item (ou o Super Admin muda o tipo com «carregar») os predefinidos são copiados para a loja.
- Autorizar/retirar a criação de utilizadores a um embaixador: só por RPC (`fn_admin_set_user_creation_auth`), sem ecrã.
- Itens da análise de permissões anterior (ex.: ADMIN pode alterar roles em `profiles`) continuam por resolver; não foram tocados.

## 6. Ficheiros
Novos: `migracao_multisetor_v25.sql`, `supabase/functions/create-store-user/index.ts`, `js/core/sector.js`, `js/components/store-user-modal.js`, `modules/configuracoes/sector-config.js`.
Alterados: `js/core/database.js`, `js/app.js`, `sw.js`, `adesao.html`, `js/adesao.js`, `js/components/navbar.js`, `js/components/transfer-modal.js`, `modules/monitor/gestao-lojas.js`, `modules/monitor/monitor.js`, `modules/embaixadores/embaixadores.js`, `modules/embaixadores/perfil-embaixador.js`, `modules/produtos/produtos.js`, `modules/compras/compras.js`, `modules/estoque/estoque.js`, `modules/perdas/perdas.js`, `modules/auditoria/auditoria.js`, `modules/configuracoes/configuracoes.js`.
