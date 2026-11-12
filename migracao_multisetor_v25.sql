-- ==============================================================================
-- GEF/PRUMO | MIGRAÇÃO v25 — ERP MULTI-SECTORIAL (evolutiva e retrocompatível)
-- Executar no Supabase → SQL Editor, DEPOIS da v24. Idempotente: pode repetir.
--
--  1. Tipos de negócio (36: comércio + armazéns) com categorias, subcategorias, unidades, atributos e nomes de locais
--     por sector (business_types + business_type_presets). Novos sectores: fn_admin_save_business_type (clonar).
--  2. stores.business_type (obrigatório nas lojas novas). Lojas EXISTENTES ficam FERRAGENS (valor por omissão), sem
--     alterar IDs, dados nem comportamento. Nenhuma configuração é aplicada às lojas existentes automaticamente.
--  3. Configuração por loja (store_sector_items): carrega os predefinidos do sector e permite personalizar
--     categorias, unidades, atributos e nomes dos 3 locais de stock (LOJA / ARMAZEM / PATIO).
--  4. products.attributes (JSONB) para os atributos sectoriais (tamanho, ISBN, dosagem, compatibilidade…).
--  5. Cadastro de loja com TIPO DE NEGÓCIO obrigatório: Super Admin, Embaixador/Super Embaixador e link público.
--     O tipo acompanha o vínculo (ambassador_referred_stores.business_type). Comissões e activação não mudam.
--  6. Criação de utilizadores com Edge Function (autenticação real do Supabase): funções de âmbito e finalização.
--  Nada é apagado nem recriado. RLS das tabelas existentes mantém-se.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELAS GLOBAIS POR SECTOR
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'COMERCIO' CHECK (kind IN ('COMERCIO', 'ARMAZEM')),
    description TEXT,
    flags JSONB NOT NULL DEFAULT '{}'::JSONB,        -- batch_required, expiry_required
    sort_order INT NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.business_type_presets (
    business_type_id TEXT NOT NULL REFERENCES public.business_types(id) ON DELETE CASCADE ON UPDATE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('CATEGORY', 'UNIT', 'ATTRIBUTE', 'LOCATION')),
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::JSONB,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (business_type_id, kind, code)
);
ALTER TABLE public.business_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_type_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "business_types_read" ON public.business_types;
CREATE POLICY "business_types_read" ON public.business_types FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "business_type_presets_read" ON public.business_type_presets;
CREATE POLICY "business_type_presets_read" ON public.business_type_presets FOR SELECT TO authenticated USING (TRUE);
REVOKE ALL ON public.business_types, public.business_type_presets FROM anon;
-- Sem INSERT/UPDATE/DELETE para ninguém: só as funções do Super Admin escrevem.

-- ------------------------------------------------------------------------------
-- 2. SECTORES (predefinidos). DO NOTHING: não repõe o que o Super Admin editou.
-- ------------------------------------------------------------------------------
INSERT INTO public.business_types (id, name, kind, description, flags, sort_order, is_system) VALUES    ('FERRAGENS', 'Ferragens', 'COMERCIO', 'Ferragens, materiais e ferramentas. É o ramo original do sistema.', '{"batch_required":false,"expiry_required":false}'::JSONB, 10, TRUE),
    ('LIVRARIA', 'Livraria', 'COMERCIO', 'Livros, manuais e material de leitura.', '{"batch_required":false,"expiry_required":false}'::JSONB, 20, TRUE),
    ('PAPELARIA', 'Papelaria', 'COMERCIO', 'Papel, escrita e material escolar e de escritório.', '{"batch_required":false,"expiry_required":false}'::JSONB, 30, TRUE),
    ('VESTUARIO', 'Vestuário', 'COMERCIO', 'Roupa e acessórios, com tamanhos e cores.', '{"batch_required":false,"expiry_required":false}'::JSONB, 40, TRUE),
    ('CALCADO', 'Calçado', 'COMERCIO', 'Sapatos, sandálias e botas, por número e cor.', '{"batch_required":false,"expiry_required":false}'::JSONB, 50, TRUE),
    ('LOUCAS', 'Loiças e utensílios', 'COMERCIO', 'Loiças, panelas e artigos de cozinha e mesa.', '{"batch_required":false,"expiry_required":false}'::JSONB, 60, TRUE),
    ('FARMACIA', 'Farmácia', 'COMERCIO', 'Medicamentos e produtos de saúde, com lote e validade obrigatórios.', '{"batch_required":true,"expiry_required":true}'::JSONB, 70, TRUE),
    ('PERFUMARIA', 'Perfumaria e cosmética', 'COMERCIO', 'Perfumes, cosmética e cuidado pessoal.', '{"batch_required":false,"expiry_required":false}'::JSONB, 80, TRUE),
    ('PECAS_AUTO', 'Peças automóveis', 'COMERCIO', 'Peças e acessórios de automóveis, com marca, modelo e compatibilidade.', '{"batch_required":false,"expiry_required":false}'::JSONB, 90, TRUE),
    ('PECAS_MOTOS', 'Peças de motas', 'COMERCIO', 'Peças e acessórios de motas, com marca, modelo e cilindrada.', '{"batch_required":false,"expiry_required":false}'::JSONB, 100, TRUE),
    ('MOBILIARIO', 'Mobiliário', 'COMERCIO', 'Móveis e decoração, com dimensões e materiais.', '{"batch_required":false,"expiry_required":false}'::JSONB, 110, TRUE),
    ('BRINQUEDOS', 'Brinquedos', 'COMERCIO', 'Brinquedos e jogos.', '{"batch_required":false,"expiry_required":false}'::JSONB, 120, TRUE),
    ('SUPERMERCADO', 'Supermercado', 'COMERCIO', 'Produtos alimentares e de uso doméstico, com validade.', '{"batch_required":false,"expiry_required":true}'::JSONB, 130, TRUE),
    ('MERCEARIA', 'Mercearia', 'COMERCIO', 'Mercearia e produtos alimentares.', '{"batch_required":false,"expiry_required":true}'::JSONB, 140, TRUE),
    ('ELECTRONICA', 'Electrónica', 'COMERCIO', 'Telemóveis, áudio, vídeo e acessórios.', '{"batch_required":false,"expiry_required":false}'::JSONB, 150, TRUE),
    ('INFORMATICA', 'Informática', 'COMERCIO', 'Computadores, periféricos e consumíveis.', '{"batch_required":false,"expiry_required":false}'::JSONB, 160, TRUE),
    ('ELECTRODOMESTICOS', 'Electrodomésticos', 'COMERCIO', 'Electrodomésticos e eletrodomésticos de cozinha e casa.', '{"batch_required":false,"expiry_required":false}'::JSONB, 170, TRUE),
    ('MAT_CONSTRUCAO', 'Materiais de construção', 'COMERCIO', 'Cimento, blocos, ferro, acabamentos e agregados.', '{"batch_required":false,"expiry_required":false}'::JSONB, 180, TRUE),
    ('MAT_ELECTRICO', 'Materiais eléctricos', 'COMERCIO', 'Cabos, quadros, iluminação e aparelhagem eléctrica.', '{"batch_required":false,"expiry_required":false}'::JSONB, 190, TRUE),
    ('CANALIZACAO', 'Canalização', 'COMERCIO', 'Tubagens, acessórios, sanitários e bombas.', '{"batch_required":false,"expiry_required":false}'::JSONB, 200, TRUE),
    ('AGRICOLA', 'Produtos agrícolas', 'COMERCIO', 'Sementes, fertilizantes, produtos e equipamento agrícola.', '{"batch_required":false,"expiry_required":true}'::JSONB, 210, TRUE),
    ('VETERINARIA', 'Veterinária', 'COMERCIO', 'Medicamentos e produtos veterinários, com lote e validade.', '{"batch_required":true,"expiry_required":true}'::JSONB, 220, TRUE),
    ('EQUIP_INDUSTRIAL', 'Equipamentos industriais', 'COMERCIO', 'Máquinas, ferramentas e peças industriais.', '{"batch_required":false,"expiry_required":false}'::JSONB, 230, TRUE),
    ('TECIDOS', 'Tecidos e retrosaria', 'COMERCIO', 'Tecidos vendidos ao metro e artigos de costura.', '{"batch_required":false,"expiry_required":false}'::JSONB, 240, TRUE),
    ('DESPORTO', 'Artigos desportivos', 'COMERCIO', 'Equipamento e vestuário desportivo.', '{"batch_required":false,"expiry_required":false}'::JSONB, 250, TRUE),
    ('BEBIDAS', 'Bebidas', 'COMERCIO', 'Bebidas e águas, por garrafa, caixa e palete.', '{"batch_required":false,"expiry_required":true}'::JSONB, 260, TRUE),
    ('PRODUTOS_ANIMAIS', 'Produtos para animais', 'COMERCIO', 'Ração, acessórios e cuidados para animais.', '{"batch_required":false,"expiry_required":true}'::JSONB, 270, TRUE),
    ('GROSSISTA', 'Grossista', 'COMERCIO', 'Venda por grosso, com embalagens e conversões.', '{"batch_required":false,"expiry_required":false}'::JSONB, 280, TRUE),
    ('DISTRIBUIDORA', 'Distribuidora', 'COMERCIO', 'Distribuição a retalhistas, com entregas.', '{"batch_required":false,"expiry_required":false}'::JSONB, 290, TRUE),
    ('OUTROS', 'Outros', 'COMERCIO', 'Qualquer outro negócio. Configure as suas próprias categorias, unidades e atributos.', '{"batch_required":false,"expiry_required":false}'::JSONB, 900, TRUE),
    ('ARMAZEM_GERAL', 'Armazém geral', 'ARMAZEM', 'Armazenagem geral de mercadorias, com lotes, entradas, saídas e transferências.', '{"batch_required":true,"expiry_required":false}'::JSONB, 310, TRUE),
    ('ARMAZEM_MATERIAS_PRIMAS', 'Armazém de matérias-primas e produtos acabados', 'ARMAZEM', 'Matérias-primas, semi-acabados e produtos acabados, com lote.', '{"batch_required":true,"expiry_required":false}'::JSONB, 320, TRUE),
    ('ARMAZEM_MEDICAMENTOS', 'Armazém de medicamentos', 'ARMAZEM', 'Armazenagem e distribuição de medicamentos, com lote e validade obrigatórios.', '{"batch_required":true,"expiry_required":true}'::JSONB, 330, TRUE),
    ('ARMAZEM_PECAS', 'Armazém de peças', 'ARMAZEM', 'Armazém de peças e componentes, com marca, modelo e compatibilidade.', '{"batch_required":true,"expiry_required":false}'::JSONB, 340, TRUE),
    ('ARMAZEM_ALIMENTOS', 'Armazém de alimentos', 'ARMAZEM', 'Armazenagem de alimentos e bebidas, com lote e validade obrigatórios.', '{"batch_required":true,"expiry_required":true}'::JSONB, 350, TRUE),
    ('ARMAZEM_CONSTRUCAO', 'Armazém de materiais de construção', 'ARMAZEM', 'Armazém e pátio de materiais de construção, com lote.', '{"batch_required":true,"expiry_required":false}'::JSONB, 360, TRUE)
ON CONFLICT (id) DO NOTHING;
-- FERRAGENS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('FERRAGENS','CATEGORY','cimento_argamassa','Cimento & Argamassa','{"subs":[]}'::JSONB,10),
    ('FERRAGENS','CATEGORY','aco_ferro','Aço & Ferro','{"subs":["Varões","Arame","Chapas"]}'::JSONB,20),
    ('FERRAGENS','CATEGORY','tubagens_hidraulica','Tubagens & Hidráulica','{"subs":["PVC","PPR"]}'::JSONB,30),
    ('FERRAGENS','CATEGORY','material_eletrico','Material Elétrico','{"subs":["Cabos","Tomadas e interruptores"]}'::JSONB,40),
    ('FERRAGENS','CATEGORY','tintas_impermeabilizantes','Tintas & Impermeabilizantes','{"subs":[]}'::JSONB,50),
    ('FERRAGENS','CATEGORY','ferramentas','Ferramentas','{"subs":["Manuais","Eléctricas"]}'::JSONB,60),
    ('FERRAGENS','CATEGORY','agregados_areia','Agregados & Areia','{"subs":[]}'::JSONB,70),
    ('FERRAGENS','UNIT','saco','Saco','{"fractional":false}'::JSONB,10),
    ('FERRAGENS','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,20),
    ('FERRAGENS','UNIT','un','Unidade','{"fractional":false}'::JSONB,30),
    ('FERRAGENS','UNIT','barra','Barra','{"fractional":false}'::JSONB,40),
    ('FERRAGENS','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,50),
    ('FERRAGENS','UNIT','m2','Metro quadrado (m²)','{"fractional":true}'::JSONB,60),
    ('FERRAGENS','UNIT','m3','Metro cúbico (m³)','{"fractional":true}'::JSONB,70),
    ('FERRAGENS','UNIT','lata','Lata','{"fractional":false}'::JSONB,80),
    ('FERRAGENS','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,90),
    ('FERRAGENS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('FERRAGENS','ATTRIBUTE','medida','Medida / Espessura','{"type":"text","required":false}'::JSONB,20),
    ('FERRAGENS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('FERRAGENS','LOCATION','ARMAZEM','Armazém Central','{}'::JSONB,20),
    ('FERRAGENS','LOCATION','PATIO','Pátio de Agregados','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- LIVRARIA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('LIVRARIA','CATEGORY','literatura','Literatura','{"subs":["Romance","Poesia","Contos"]}'::JSONB,10),
    ('LIVRARIA','CATEGORY','escolar','Escolar','{"subs":["Ensino primário","Ensino secundário","Universitário"]}'::JSONB,20),
    ('LIVRARIA','CATEGORY','infantil_e_juvenil','Infantil e juvenil','{"subs":[]}'::JSONB,30),
    ('LIVRARIA','CATEGORY','religiao','Religião','{"subs":[]}'::JSONB,40),
    ('LIVRARIA','CATEGORY','tecnicos_e_profissionais','Técnicos e profissionais','{"subs":[]}'::JSONB,50),
    ('LIVRARIA','CATEGORY','revistas_e_jornais','Revistas e jornais','{"subs":[]}'::JSONB,60),
    ('LIVRARIA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('LIVRARIA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,20),
    ('LIVRARIA','UNIT','kit','Kit','{"fractional":false}'::JSONB,30),
    ('LIVRARIA','ATTRIBUTE','isbn','ISBN','{"type":"text","required":true}'::JSONB,10),
    ('LIVRARIA','ATTRIBUTE','autor','Autor','{"type":"text","required":true}'::JSONB,20),
    ('LIVRARIA','ATTRIBUTE','editora','Editora','{"type":"text","required":false}'::JSONB,30),
    ('LIVRARIA','ATTRIBUTE','idioma','Idioma','{"type":"select","required":false,"options":["Português","Inglês","Francês","Espanhol","Outro"]}'::JSONB,40),
    ('LIVRARIA','ATTRIBUTE','ano_edicao','Ano de edição','{"type":"number","required":false}'::JSONB,50),
    ('LIVRARIA','LOCATION','LOJA','Loja (Estante)','{}'::JSONB,10),
    ('LIVRARIA','LOCATION','ARMAZEM','Armazém de livros','{}'::JSONB,20),
    ('LIVRARIA','LOCATION','PATIO','Reserva / Devoluções','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- PAPELARIA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('PAPELARIA','CATEGORY','papel_e_cadernos','Papel e cadernos','{"subs":["Resmas","Cadernos","Blocos"]}'::JSONB,10),
    ('PAPELARIA','CATEGORY','escrita','Escrita','{"subs":["Canetas","Lápis","Marcadores"]}'::JSONB,20),
    ('PAPELARIA','CATEGORY','material_escolar','Material escolar','{"subs":[]}'::JSONB,30),
    ('PAPELARIA','CATEGORY','material_de_escritorio','Material de escritório','{"subs":["Agrafadores","Pastas"]}'::JSONB,40),
    ('PAPELARIA','CATEGORY','arte_e_desenho','Arte e desenho','{"subs":[]}'::JSONB,50),
    ('PAPELARIA','CATEGORY','impressao_e_consumiveis','Impressão e consumíveis','{"subs":[]}'::JSONB,60),
    ('PAPELARIA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('PAPELARIA','UNIT','resma','Resma','{"fractional":false}'::JSONB,20),
    ('PAPELARIA','UNIT','caderno','Caderno','{"fractional":false}'::JSONB,30),
    ('PAPELARIA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,40),
    ('PAPELARIA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,50),
    ('PAPELARIA','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,60),
    ('PAPELARIA','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('PAPELARIA','ATTRIBUTE','formato','Formato','{"type":"select","required":false,"options":["A3","A4","A5","Outro"]}'::JSONB,20),
    ('PAPELARIA','ATTRIBUTE','cor','Cor','{"type":"text","required":false}'::JSONB,30),
    ('PAPELARIA','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('PAPELARIA','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('PAPELARIA','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- VESTUARIO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('VESTUARIO','CATEGORY','homem','Homem','{"subs":["Camisas","Calças","Casacos"]}'::JSONB,10),
    ('VESTUARIO','CATEGORY','mulher','Mulher','{"subs":["Vestidos","Blusas","Calças e saias"]}'::JSONB,20),
    ('VESTUARIO','CATEGORY','crianca','Criança','{"subs":[]}'::JSONB,30),
    ('VESTUARIO','CATEGORY','desporto','Desporto','{"subs":[]}'::JSONB,40),
    ('VESTUARIO','CATEGORY','roupa_interior_e_meias','Roupa interior e meias','{"subs":[]}'::JSONB,50),
    ('VESTUARIO','CATEGORY','acessorios','Acessórios','{"subs":["Cintos","Chapéus","Lenços"]}'::JSONB,60),
    ('VESTUARIO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('VESTUARIO','UNIT','par','Par','{"fractional":false}'::JSONB,20),
    ('VESTUARIO','UNIT','pct','Pacote','{"fractional":false}'::JSONB,30),
    ('VESTUARIO','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,40),
    ('VESTUARIO','ATTRIBUTE','tamanho','Tamanho','{"type":"select","required":true,"options":["XS","S","M","L","XL","XXL","Único"]}'::JSONB,10),
    ('VESTUARIO','ATTRIBUTE','cor','Cor','{"type":"text","required":true}'::JSONB,20),
    ('VESTUARIO','ATTRIBUTE','genero','Género','{"type":"select","required":false,"options":["Homem","Mulher","Criança","Unissexo"]}'::JSONB,30),
    ('VESTUARIO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,40),
    ('VESTUARIO','ATTRIBUTE','material','Material','{"type":"text","required":false}'::JSONB,50),
    ('VESTUARIO','LOCATION','LOJA','Loja (Montra)','{}'::JSONB,10),
    ('VESTUARIO','LOCATION','ARMAZEM','Armazém / Stock','{}'::JSONB,20),
    ('VESTUARIO','LOCATION','PATIO','Devoluções / Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- CALCADO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('CALCADO','CATEGORY','homem','Homem','{"subs":[]}'::JSONB,10),
    ('CALCADO','CATEGORY','mulher','Mulher','{"subs":[]}'::JSONB,20),
    ('CALCADO','CATEGORY','crianca','Criança','{"subs":[]}'::JSONB,30),
    ('CALCADO','CATEGORY','desporto','Desporto','{"subs":[]}'::JSONB,40),
    ('CALCADO','CATEGORY','sandalias_e_chinelos','Sandálias e chinelos','{"subs":[]}'::JSONB,50),
    ('CALCADO','CATEGORY','botas_e_seguranca','Botas e segurança','{"subs":[]}'::JSONB,60),
    ('CALCADO','UNIT','par','Par','{"fractional":false}'::JSONB,10),
    ('CALCADO','UNIT','un','Unidade','{"fractional":false}'::JSONB,20),
    ('CALCADO','UNIT','cx','Caixa','{"fractional":false}'::JSONB,30),
    ('CALCADO','ATTRIBUTE','numero','Número','{"type":"select","required":true,"options":["20","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47","48"]}'::JSONB,10),
    ('CALCADO','ATTRIBUTE','cor','Cor','{"type":"text","required":true}'::JSONB,20),
    ('CALCADO','ATTRIBUTE','genero','Género','{"type":"select","required":false,"options":["Homem","Mulher","Criança","Unissexo"]}'::JSONB,30),
    ('CALCADO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,40),
    ('CALCADO','ATTRIBUTE','material','Material','{"type":"text","required":false}'::JSONB,50),
    ('CALCADO','LOCATION','LOJA','Loja (Montra)','{}'::JSONB,10),
    ('CALCADO','LOCATION','ARMAZEM','Armazém / Stock','{}'::JSONB,20),
    ('CALCADO','LOCATION','PATIO','Devoluções / Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- LOUCAS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('LOUCAS','CATEGORY','pratos_e_talheres','Pratos e talheres','{"subs":[]}'::JSONB,10),
    ('LOUCAS','CATEGORY','copos_e_jarros','Copos e jarros','{"subs":[]}'::JSONB,20),
    ('LOUCAS','CATEGORY','panelas_e_tachos','Panelas e tachos','{"subs":[]}'::JSONB,30),
    ('LOUCAS','CATEGORY','utensilios_de_cozinha','Utensílios de cozinha','{"subs":[]}'::JSONB,40),
    ('LOUCAS','CATEGORY','conjuntos','Conjuntos','{"subs":[]}'::JSONB,50),
    ('LOUCAS','CATEGORY','plasticos_e_recipientes','Plásticos e recipientes','{"subs":[]}'::JSONB,60),
    ('LOUCAS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('LOUCAS','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,20),
    ('LOUCAS','UNIT','kit','Kit','{"fractional":false}'::JSONB,30),
    ('LOUCAS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('LOUCAS','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,50),
    ('LOUCAS','ATTRIBUTE','material','Material','{"type":"select","required":false,"options":["Porcelana","Vidro","Cerâmica","Inox","Alumínio","Plástico","Outro"]}'::JSONB,10),
    ('LOUCAS','ATTRIBUTE','capacidade','Capacidade','{"type":"text","required":false}'::JSONB,20),
    ('LOUCAS','ATTRIBUTE','n_pecas','N.º de peças','{"type":"number","required":false}'::JSONB,30),
    ('LOUCAS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,40),
    ('LOUCAS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('LOUCAS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('LOUCAS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- FARMACIA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('FARMACIA','CATEGORY','medicamentos_com_receita','Medicamentos com receita','{"subs":["Antibióticos","Cardiovasculares","Diabetes"]}'::JSONB,10),
    ('FARMACIA','CATEGORY','medicamentos_sem_receita','Medicamentos sem receita','{"subs":["Analgésicos","Antigripais","Digestivos"]}'::JSONB,20),
    ('FARMACIA','CATEGORY','dermatologia','Dermatologia','{"subs":[]}'::JSONB,30),
    ('FARMACIA','CATEGORY','higiene_e_cuidado','Higiene e cuidado','{"subs":[]}'::JSONB,40),
    ('FARMACIA','CATEGORY','material_de_penso','Material de penso','{"subs":[]}'::JSONB,50),
    ('FARMACIA','CATEGORY','suplementos_e_vitaminas','Suplementos e vitaminas','{"subs":[]}'::JSONB,60),
    ('FARMACIA','CATEGORY','bebe_e_maternidade','Bebé e maternidade','{"subs":[]}'::JSONB,70),
    ('FARMACIA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('FARMACIA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,20),
    ('FARMACIA','UNIT','blister','Blister','{"fractional":false}'::JSONB,30),
    ('FARMACIA','UNIT','frasco','Frasco','{"fractional":false}'::JSONB,40),
    ('FARMACIA','UNIT','tubo','Tubo','{"fractional":false}'::JSONB,50),
    ('FARMACIA','UNIT','ampola','Ampola','{"fractional":false}'::JSONB,60),
    ('FARMACIA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,70),
    ('FARMACIA','UNIT','ml','Mililitro (ml)','{"fractional":true}'::JSONB,80),
    ('FARMACIA','ATTRIBUTE','principio_activo','Princípio activo','{"type":"text","required":true}'::JSONB,10),
    ('FARMACIA','ATTRIBUTE','dosagem','Dosagem','{"type":"text","required":true}'::JSONB,20),
    ('FARMACIA','ATTRIBUTE','forma','Forma farmacêutica','{"type":"select","required":true,"options":["Comprimido","Cápsula","Xarope","Pomada","Injectável","Gotas","Supositório","Outra"]}'::JSONB,30),
    ('FARMACIA','ATTRIBUTE','laboratorio','Laboratório','{"type":"text","required":false}'::JSONB,40),
    ('FARMACIA','ATTRIBUTE','receita','Requer receita médica','{"type":"boolean","required":false}'::JSONB,50),
    ('FARMACIA','LOCATION','LOJA','Balcão / Dispensa','{}'::JSONB,10),
    ('FARMACIA','LOCATION','ARMAZEM','Armazém de medicamentos','{}'::JSONB,20),
    ('FARMACIA','LOCATION','PATIO','Reserva / Quarentena','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- PERFUMARIA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('PERFUMARIA','CATEGORY','perfumes','Perfumes','{"subs":["Homem","Mulher","Unissexo"]}'::JSONB,10),
    ('PERFUMARIA','CATEGORY','maquilhagem','Maquilhagem','{"subs":[]}'::JSONB,20),
    ('PERFUMARIA','CATEGORY','cuidado_da_pele','Cuidado da pele','{"subs":[]}'::JSONB,30),
    ('PERFUMARIA','CATEGORY','cabelo','Cabelo','{"subs":[]}'::JSONB,40),
    ('PERFUMARIA','CATEGORY','higiene_pessoal','Higiene pessoal','{"subs":[]}'::JSONB,50),
    ('PERFUMARIA','CATEGORY','acessorios','Acessórios','{"subs":[]}'::JSONB,60),
    ('PERFUMARIA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('PERFUMARIA','UNIT','ml','Mililitro (ml)','{"fractional":true}'::JSONB,20),
    ('PERFUMARIA','UNIT','frasco','Frasco','{"fractional":false}'::JSONB,30),
    ('PERFUMARIA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('PERFUMARIA','UNIT','kit','Kit','{"fractional":false}'::JSONB,50),
    ('PERFUMARIA','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('PERFUMARIA','ATTRIBUTE','volume_ml','Volume (ml)','{"type":"number","required":false}'::JSONB,20),
    ('PERFUMARIA','ATTRIBUTE','genero','Género','{"type":"select","required":false,"options":["Homem","Mulher","Unissexo"]}'::JSONB,30),
    ('PERFUMARIA','ATTRIBUTE','familia','Família olfactiva','{"type":"text","required":false}'::JSONB,40),
    ('PERFUMARIA','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('PERFUMARIA','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('PERFUMARIA','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- PECAS_AUTO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('PECAS_AUTO','CATEGORY','motor','Motor','{"subs":["Filtros","Correias","Velas"]}'::JSONB,10),
    ('PECAS_AUTO','CATEGORY','travagem','Travagem','{"subs":["Pastilhas","Discos"]}'::JSONB,20),
    ('PECAS_AUTO','CATEGORY','suspensao_e_direccao','Suspensão e direcção','{"subs":[]}'::JSONB,30),
    ('PECAS_AUTO','CATEGORY','electrico_e_iluminacao','Eléctrico e iluminação','{"subs":["Baterias","Lâmpadas"]}'::JSONB,40),
    ('PECAS_AUTO','CATEGORY','lubrificantes_e_fluidos','Lubrificantes e fluidos','{"subs":[]}'::JSONB,50),
    ('PECAS_AUTO','CATEGORY','carrocaria','Carroçaria','{"subs":[]}'::JSONB,60),
    ('PECAS_AUTO','CATEGORY','pneus_e_jantes','Pneus e jantes','{"subs":[]}'::JSONB,70),
    ('PECAS_AUTO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('PECAS_AUTO','UNIT','par','Par','{"fractional":false}'::JSONB,20),
    ('PECAS_AUTO','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,30),
    ('PECAS_AUTO','UNIT','kit','Kit','{"fractional":false}'::JSONB,40),
    ('PECAS_AUTO','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,50),
    ('PECAS_AUTO','UNIT','lata','Lata','{"fractional":false}'::JSONB,60),
    ('PECAS_AUTO','ATTRIBUTE','marca_viatura','Marca da viatura','{"type":"text","required":true}'::JSONB,10),
    ('PECAS_AUTO','ATTRIBUTE','modelo','Modelo','{"type":"text","required":true}'::JSONB,20),
    ('PECAS_AUTO','ATTRIBUTE','ano_inicio','Ano (de)','{"type":"number","required":false}'::JSONB,30),
    ('PECAS_AUTO','ATTRIBUTE','ano_fim','Ano (até)','{"type":"number","required":false}'::JSONB,40),
    ('PECAS_AUTO','ATTRIBUTE','ref_oem','Referência OEM / fabricante','{"type":"text","required":false}'::JSONB,50),
    ('PECAS_AUTO','ATTRIBUTE','lado','Posição','{"type":"select","required":false,"options":["N/A","Frente","Trás","Esquerda","Direita"]}'::JSONB,60),
    ('PECAS_AUTO','ATTRIBUTE','compatibilidade','Compatibilidade (outros modelos)','{"type":"text","required":false}'::JSONB,70),
    ('PECAS_AUTO','LOCATION','LOJA','Balcão','{}'::JSONB,10),
    ('PECAS_AUTO','LOCATION','ARMAZEM','Armazém de peças','{}'::JSONB,20),
    ('PECAS_AUTO','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- PECAS_MOTOS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('PECAS_MOTOS','CATEGORY','motor','Motor','{"subs":[]}'::JSONB,10),
    ('PECAS_MOTOS','CATEGORY','travagem','Travagem','{"subs":[]}'::JSONB,20),
    ('PECAS_MOTOS','CATEGORY','transmissao','Transmissão','{"subs":["Corrente","Cremalheira"]}'::JSONB,30),
    ('PECAS_MOTOS','CATEGORY','electrico','Eléctrico','{"subs":[]}'::JSONB,40),
    ('PECAS_MOTOS','CATEGORY','lubrificantes','Lubrificantes','{"subs":[]}'::JSONB,50),
    ('PECAS_MOTOS','CATEGORY','pneus_e_camaras','Pneus e câmaras','{"subs":[]}'::JSONB,60),
    ('PECAS_MOTOS','CATEGORY','acessorios_e_capacetes','Acessórios e capacetes','{"subs":[]}'::JSONB,70),
    ('PECAS_MOTOS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('PECAS_MOTOS','UNIT','par','Par','{"fractional":false}'::JSONB,20),
    ('PECAS_MOTOS','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,30),
    ('PECAS_MOTOS','UNIT','kit','Kit','{"fractional":false}'::JSONB,40),
    ('PECAS_MOTOS','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,50),
    ('PECAS_MOTOS','ATTRIBUTE','marca_moto','Marca da mota','{"type":"text","required":true}'::JSONB,10),
    ('PECAS_MOTOS','ATTRIBUTE','modelo','Modelo','{"type":"text","required":true}'::JSONB,20),
    ('PECAS_MOTOS','ATTRIBUTE','cilindrada','Cilindrada (cc)','{"type":"number","required":false}'::JSONB,30),
    ('PECAS_MOTOS','ATTRIBUTE','ref_oem','Referência OEM / fabricante','{"type":"text","required":false}'::JSONB,40),
    ('PECAS_MOTOS','ATTRIBUTE','compatibilidade','Compatibilidade','{"type":"text","required":false}'::JSONB,50),
    ('PECAS_MOTOS','LOCATION','LOJA','Balcão','{}'::JSONB,10),
    ('PECAS_MOTOS','LOCATION','ARMAZEM','Armazém de peças','{}'::JSONB,20),
    ('PECAS_MOTOS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- MOBILIARIO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('MOBILIARIO','CATEGORY','sala','Sala','{"subs":["Sofás","Mesas"]}'::JSONB,10),
    ('MOBILIARIO','CATEGORY','quarto','Quarto','{"subs":["Camas","Roupeiros","Colchões"]}'::JSONB,20),
    ('MOBILIARIO','CATEGORY','cozinha_e_sala_de_jantar','Cozinha e sala de jantar','{"subs":[]}'::JSONB,30),
    ('MOBILIARIO','CATEGORY','escritorio','Escritório','{"subs":[]}'::JSONB,40),
    ('MOBILIARIO','CATEGORY','exterior','Exterior','{"subs":[]}'::JSONB,50),
    ('MOBILIARIO','CATEGORY','decoracao','Decoração','{"subs":[]}'::JSONB,60),
    ('MOBILIARIO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('MOBILIARIO','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,20),
    ('MOBILIARIO','UNIT','kit','Kit','{"fractional":false}'::JSONB,30),
    ('MOBILIARIO','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,40),
    ('MOBILIARIO','UNIT','m2','Metro quadrado (m²)','{"fractional":true}'::JSONB,50),
    ('MOBILIARIO','ATTRIBUTE','dimensoes','Dimensões (C × L × A, cm)','{"type":"text","required":true}'::JSONB,10),
    ('MOBILIARIO','ATTRIBUTE','material','Material','{"type":"select","required":true,"options":["Madeira","MDF","Metal","Vidro","Estofado","Plástico","Outro"]}'::JSONB,20),
    ('MOBILIARIO','ATTRIBUTE','cor','Cor','{"type":"text","required":false}'::JSONB,30),
    ('MOBILIARIO','ATTRIBUTE','acabamento','Acabamento','{"type":"text","required":false}'::JSONB,40),
    ('MOBILIARIO','LOCATION','LOJA','Loja (Exposição)','{}'::JSONB,10),
    ('MOBILIARIO','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('MOBILIARIO','LOCATION','PATIO','Reserva / Montagem','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- BRINQUEDOS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('BRINQUEDOS','CATEGORY','bonecas_e_peluches','Bonecas e peluches','{"subs":[]}'::JSONB,10),
    ('BRINQUEDOS','CATEGORY','jogos_de_tabuleiro','Jogos de tabuleiro','{"subs":[]}'::JSONB,20),
    ('BRINQUEDOS','CATEGORY','construcao','Construção','{"subs":[]}'::JSONB,30),
    ('BRINQUEDOS','CATEGORY','veiculos_e_radio_controlo','Veículos e rádio-controlo','{"subs":[]}'::JSONB,40),
    ('BRINQUEDOS','CATEGORY','educativos','Educativos','{"subs":[]}'::JSONB,50),
    ('BRINQUEDOS','CATEGORY','exterior','Exterior','{"subs":[]}'::JSONB,60),
    ('BRINQUEDOS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('BRINQUEDOS','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,20),
    ('BRINQUEDOS','UNIT','kit','Kit','{"fractional":false}'::JSONB,30),
    ('BRINQUEDOS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('BRINQUEDOS','ATTRIBUTE','idade_minima','Idade mínima','{"type":"select","required":false,"options":["0+","3+","6+","12+"]}'::JSONB,10),
    ('BRINQUEDOS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,20),
    ('BRINQUEDOS','ATTRIBUTE','material','Material','{"type":"text","required":false}'::JSONB,30),
    ('BRINQUEDOS','ATTRIBUTE','pilhas','Usa pilhas','{"type":"boolean","required":false}'::JSONB,40),
    ('BRINQUEDOS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('BRINQUEDOS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('BRINQUEDOS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- SUPERMERCADO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('SUPERMERCADO','CATEGORY','mercearia_seca','Mercearia seca','{"subs":["Arroz","Massas","Óleos"]}'::JSONB,10),
    ('SUPERMERCADO','CATEGORY','bebidas','Bebidas','{"subs":[]}'::JSONB,20),
    ('SUPERMERCADO','CATEGORY','frescos_e_refrigerados','Frescos e refrigerados','{"subs":[]}'::JSONB,30),
    ('SUPERMERCADO','CATEGORY','congelados','Congelados','{"subs":[]}'::JSONB,40),
    ('SUPERMERCADO','CATEGORY','higiene_e_limpeza','Higiene e limpeza','{"subs":[]}'::JSONB,50),
    ('SUPERMERCADO','CATEGORY','padaria','Padaria','{"subs":[]}'::JSONB,60),
    ('SUPERMERCADO','CATEGORY','bazar','Bazar','{"subs":[]}'::JSONB,70),
    ('SUPERMERCADO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('SUPERMERCADO','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,20),
    ('SUPERMERCADO','UNIT','g','Grama (g)','{"fractional":true}'::JSONB,30),
    ('SUPERMERCADO','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,40),
    ('SUPERMERCADO','UNIT','cx','Caixa','{"fractional":false}'::JSONB,50),
    ('SUPERMERCADO','UNIT','pct','Pacote','{"fractional":false}'::JSONB,60),
    ('SUPERMERCADO','UNIT','saco','Saco','{"fractional":false}'::JSONB,70),
    ('SUPERMERCADO','UNIT','fardo','Fardo','{"fractional":false}'::JSONB,80),
    ('SUPERMERCADO','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,90),
    ('SUPERMERCADO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('SUPERMERCADO','ATTRIBUTE','peso_liquido','Peso / Volume líquido','{"type":"text","required":false}'::JSONB,20),
    ('SUPERMERCADO','ATTRIBUTE','origem','Origem','{"type":"text","required":false}'::JSONB,30),
    ('SUPERMERCADO','LOCATION','LOJA','Loja (Prateleira)','{}'::JSONB,10),
    ('SUPERMERCADO','LOCATION','ARMAZEM','Armazém seco','{}'::JSONB,20),
    ('SUPERMERCADO','LOCATION','PATIO','Câmara / Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- MERCEARIA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('MERCEARIA','CATEGORY','cereais_e_farinhas','Cereais e farinhas','{"subs":[]}'::JSONB,10),
    ('MERCEARIA','CATEGORY','oleos_e_condimentos','Óleos e condimentos','{"subs":[]}'::JSONB,20),
    ('MERCEARIA','CATEGORY','enlatados','Enlatados','{"subs":[]}'::JSONB,30),
    ('MERCEARIA','CATEGORY','bebidas','Bebidas','{"subs":[]}'::JSONB,40),
    ('MERCEARIA','CATEGORY','higiene_e_limpeza','Higiene e limpeza','{"subs":[]}'::JSONB,50),
    ('MERCEARIA','CATEGORY','doces_e_snacks','Doces e snacks','{"subs":[]}'::JSONB,60),
    ('MERCEARIA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('MERCEARIA','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,20),
    ('MERCEARIA','UNIT','g','Grama (g)','{"fractional":true}'::JSONB,30),
    ('MERCEARIA','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,40),
    ('MERCEARIA','UNIT','saco','Saco','{"fractional":false}'::JSONB,50),
    ('MERCEARIA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,60),
    ('MERCEARIA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,70),
    ('MERCEARIA','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,80),
    ('MERCEARIA','UNIT','lata','Lata','{"fractional":false}'::JSONB,90),
    ('MERCEARIA','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('MERCEARIA','ATTRIBUTE','peso_liquido','Peso / Volume líquido','{"type":"text","required":false}'::JSONB,20),
    ('MERCEARIA','ATTRIBUTE','origem','Origem','{"type":"text","required":false}'::JSONB,30),
    ('MERCEARIA','LOCATION','LOJA','Loja (Prateleira)','{}'::JSONB,10),
    ('MERCEARIA','LOCATION','ARMAZEM','Armazém seco','{}'::JSONB,20),
    ('MERCEARIA','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ELECTRONICA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ELECTRONICA','CATEGORY','telemoveis_e_tablets','Telemóveis e tablets','{"subs":[]}'::JSONB,10),
    ('ELECTRONICA','CATEGORY','audio_e_video','Áudio e vídeo','{"subs":[]}'::JSONB,20),
    ('ELECTRONICA','CATEGORY','acessorios','Acessórios','{"subs":["Cabos","Carregadores","Auriculares"]}'::JSONB,30),
    ('ELECTRONICA','CATEGORY','pilhas_e_baterias','Pilhas e baterias','{"subs":[]}'::JSONB,40),
    ('ELECTRONICA','CATEGORY','camaras_e_seguranca','Câmaras e segurança','{"subs":[]}'::JSONB,50),
    ('ELECTRONICA','CATEGORY','televisores','Televisores','{"subs":[]}'::JSONB,60),
    ('ELECTRONICA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('ELECTRONICA','UNIT','par','Par','{"fractional":false}'::JSONB,20),
    ('ELECTRONICA','UNIT','kit','Kit','{"fractional":false}'::JSONB,30),
    ('ELECTRONICA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('ELECTRONICA','ATTRIBUTE','marca','Marca','{"type":"text","required":true}'::JSONB,10),
    ('ELECTRONICA','ATTRIBUTE','modelo','Modelo','{"type":"text","required":true}'::JSONB,20),
    ('ELECTRONICA','ATTRIBUTE','garantia_meses','Garantia (meses)','{"type":"number","required":false}'::JSONB,30),
    ('ELECTRONICA','ATTRIBUTE','numero_serie','N.º de série / IMEI','{"type":"text","required":false}'::JSONB,40),
    ('ELECTRONICA','ATTRIBUTE','cor','Cor','{"type":"text","required":false}'::JSONB,50),
    ('ELECTRONICA','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('ELECTRONICA','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('ELECTRONICA','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- INFORMATICA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('INFORMATICA','CATEGORY','computadores_e_portateis','Computadores e portáteis','{"subs":[]}'::JSONB,10),
    ('INFORMATICA','CATEGORY','perifericos','Periféricos','{"subs":["Teclados","Ratos","Monitores"]}'::JSONB,20),
    ('INFORMATICA','CATEGORY','armazenamento','Armazenamento','{"subs":[]}'::JSONB,30),
    ('INFORMATICA','CATEGORY','redes','Redes','{"subs":[]}'::JSONB,40),
    ('INFORMATICA','CATEGORY','impressao_e_consumiveis','Impressão e consumíveis','{"subs":["Tinteiros","Toners"]}'::JSONB,50),
    ('INFORMATICA','CATEGORY','software','Software','{"subs":[]}'::JSONB,60),
    ('INFORMATICA','CATEGORY','acessorios','Acessórios','{"subs":[]}'::JSONB,70),
    ('INFORMATICA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('INFORMATICA','UNIT','kit','Kit','{"fractional":false}'::JSONB,20),
    ('INFORMATICA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,30),
    ('INFORMATICA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,40),
    ('INFORMATICA','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,50),
    ('INFORMATICA','ATTRIBUTE','marca','Marca','{"type":"text","required":true}'::JSONB,10),
    ('INFORMATICA','ATTRIBUTE','modelo','Modelo','{"type":"text","required":true}'::JSONB,20),
    ('INFORMATICA','ATTRIBUTE','especificacoes','Especificações','{"type":"text","required":false}'::JSONB,30),
    ('INFORMATICA','ATTRIBUTE','garantia_meses','Garantia (meses)','{"type":"number","required":false}'::JSONB,40),
    ('INFORMATICA','ATTRIBUTE','numero_serie','N.º de série','{"type":"text","required":false}'::JSONB,50),
    ('INFORMATICA','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('INFORMATICA','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('INFORMATICA','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ELECTRODOMESTICOS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ELECTRODOMESTICOS','CATEGORY','frio','Frio','{"subs":["Frigoríficos","Arcas"]}'::JSONB,10),
    ('ELECTRODOMESTICOS','CATEGORY','cozinha','Cozinha','{"subs":["Fogões","Micro-ondas","Liquidificadores"]}'::JSONB,20),
    ('ELECTRODOMESTICOS','CATEGORY','lavagem','Lavagem','{"subs":[]}'::JSONB,30),
    ('ELECTRODOMESTICOS','CATEGORY','climatizacao','Climatização','{"subs":["Ventoinhas","Ar condicionado"]}'::JSONB,40),
    ('ELECTRODOMESTICOS','CATEGORY','pequenos_electrodomesticos','Pequenos electrodomésticos','{"subs":[]}'::JSONB,50),
    ('ELECTRODOMESTICOS','CATEGORY','televisao_e_som','Televisão e som','{"subs":[]}'::JSONB,60),
    ('ELECTRODOMESTICOS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('ELECTRODOMESTICOS','UNIT','kit','Kit','{"fractional":false}'::JSONB,20),
    ('ELECTRODOMESTICOS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,30),
    ('ELECTRODOMESTICOS','ATTRIBUTE','marca','Marca','{"type":"text","required":true}'::JSONB,10),
    ('ELECTRODOMESTICOS','ATTRIBUTE','modelo','Modelo','{"type":"text","required":false}'::JSONB,20),
    ('ELECTRODOMESTICOS','ATTRIBUTE','potencia_w','Potência (W)','{"type":"number","required":false}'::JSONB,30),
    ('ELECTRODOMESTICOS','ATTRIBUTE','voltagem','Voltagem','{"type":"select","required":false,"options":["110V","220V","Bivolt"]}'::JSONB,40),
    ('ELECTRODOMESTICOS','ATTRIBUTE','garantia_meses','Garantia (meses)','{"type":"number","required":false}'::JSONB,50),
    ('ELECTRODOMESTICOS','ATTRIBUTE','numero_serie','N.º de série','{"type":"text","required":false}'::JSONB,60),
    ('ELECTRODOMESTICOS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('ELECTRODOMESTICOS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('ELECTRODOMESTICOS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- MAT_CONSTRUCAO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('MAT_CONSTRUCAO','CATEGORY','cimento_e_argamassas','Cimento e argamassas','{"subs":[]}'::JSONB,10),
    ('MAT_CONSTRUCAO','CATEGORY','blocos_e_tijolos','Blocos e tijolos','{"subs":[]}'::JSONB,20),
    ('MAT_CONSTRUCAO','CATEGORY','ferro_e_aco','Ferro e aço','{"subs":[]}'::JSONB,30),
    ('MAT_CONSTRUCAO','CATEGORY','agregados','Agregados','{"subs":["Areia","Brita"]}'::JSONB,40),
    ('MAT_CONSTRUCAO','CATEGORY','telhas_e_coberturas','Telhas e coberturas','{"subs":[]}'::JSONB,50),
    ('MAT_CONSTRUCAO','CATEGORY','acabamentos','Acabamentos','{"subs":["Tintas","Revestimentos"]}'::JSONB,60),
    ('MAT_CONSTRUCAO','CATEGORY','ferramentas','Ferramentas','{"subs":[]}'::JSONB,70),
    ('MAT_CONSTRUCAO','UNIT','saco','Saco','{"fractional":false}'::JSONB,10),
    ('MAT_CONSTRUCAO','UNIT','un','Unidade','{"fractional":false}'::JSONB,20),
    ('MAT_CONSTRUCAO','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,30),
    ('MAT_CONSTRUCAO','UNIT','ton','Tonelada','{"fractional":true}'::JSONB,40),
    ('MAT_CONSTRUCAO','UNIT','barra','Barra','{"fractional":false}'::JSONB,50),
    ('MAT_CONSTRUCAO','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,60),
    ('MAT_CONSTRUCAO','UNIT','m2','Metro quadrado (m²)','{"fractional":true}'::JSONB,70),
    ('MAT_CONSTRUCAO','UNIT','m3','Metro cúbico (m³)','{"fractional":true}'::JSONB,80),
    ('MAT_CONSTRUCAO','UNIT','lata','Lata','{"fractional":false}'::JSONB,90),
    ('MAT_CONSTRUCAO','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,100),
    ('MAT_CONSTRUCAO','UNIT','palete','Palete','{"fractional":false}'::JSONB,110),
    ('MAT_CONSTRUCAO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('MAT_CONSTRUCAO','ATTRIBUTE','medida','Medida','{"type":"text","required":false}'::JSONB,20),
    ('MAT_CONSTRUCAO','ATTRIBUTE','classe','Classe / Resistência','{"type":"text","required":false}'::JSONB,30),
    ('MAT_CONSTRUCAO','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('MAT_CONSTRUCAO','LOCATION','ARMAZEM','Armazém Central','{}'::JSONB,20),
    ('MAT_CONSTRUCAO','LOCATION','PATIO','Pátio de Agregados','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- MAT_ELECTRICO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('MAT_ELECTRICO','CATEGORY','cabos_e_fios','Cabos e fios','{"subs":[]}'::JSONB,10),
    ('MAT_ELECTRICO','CATEGORY','quadros_e_disjuntores','Quadros e disjuntores','{"subs":[]}'::JSONB,20),
    ('MAT_ELECTRICO','CATEGORY','tomadas_e_interruptores','Tomadas e interruptores','{"subs":[]}'::JSONB,30),
    ('MAT_ELECTRICO','CATEGORY','iluminacao','Iluminação','{"subs":["Lâmpadas","Candeeiros"]}'::JSONB,40),
    ('MAT_ELECTRICO','CATEGORY','tubos_e_calhas','Tubos e calhas','{"subs":[]}'::JSONB,50),
    ('MAT_ELECTRICO','CATEGORY','energia_solar','Energia solar','{"subs":[]}'::JSONB,60),
    ('MAT_ELECTRICO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('MAT_ELECTRICO','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,20),
    ('MAT_ELECTRICO','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,30),
    ('MAT_ELECTRICO','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('MAT_ELECTRICO','UNIT','par','Par','{"fractional":false}'::JSONB,50),
    ('MAT_ELECTRICO','UNIT','kit','Kit','{"fractional":false}'::JSONB,60),
    ('MAT_ELECTRICO','UNIT','bobina','Bobina','{"fractional":false}'::JSONB,70),
    ('MAT_ELECTRICO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('MAT_ELECTRICO','ATTRIBUTE','tensao','Tensão (V)','{"type":"text","required":false}'::JSONB,20),
    ('MAT_ELECTRICO','ATTRIBUTE','amperagem','Amperagem (A)','{"type":"text","required":false}'::JSONB,30),
    ('MAT_ELECTRICO','ATTRIBUTE','seccao','Secção (mm²)','{"type":"text","required":false}'::JSONB,40),
    ('MAT_ELECTRICO','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('MAT_ELECTRICO','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('MAT_ELECTRICO','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- CANALIZACAO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('CANALIZACAO','CATEGORY','tubos','Tubos','{"subs":["PVC","PPR","Cobre"]}'::JSONB,10),
    ('CANALIZACAO','CATEGORY','acessorios_e_ligacoes','Acessórios e ligações','{"subs":[]}'::JSONB,20),
    ('CANALIZACAO','CATEGORY','torneiras_e_misturadoras','Torneiras e misturadoras','{"subs":[]}'::JSONB,30),
    ('CANALIZACAO','CATEGORY','sanitarios','Sanitários','{"subs":[]}'::JSONB,40),
    ('CANALIZACAO','CATEGORY','reservatorios_e_bombas','Reservatórios e bombas','{"subs":[]}'::JSONB,50),
    ('CANALIZACAO','CATEGORY','colas_e_vedantes','Colas e vedantes','{"subs":[]}'::JSONB,60),
    ('CANALIZACAO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('CANALIZACAO','UNIT','barra','Barra','{"fractional":false}'::JSONB,20),
    ('CANALIZACAO','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,30),
    ('CANALIZACAO','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,40),
    ('CANALIZACAO','UNIT','cx','Caixa','{"fractional":false}'::JSONB,50),
    ('CANALIZACAO','UNIT','kit','Kit','{"fractional":false}'::JSONB,60),
    ('CANALIZACAO','UNIT','lata','Lata','{"fractional":false}'::JSONB,70),
    ('CANALIZACAO','UNIT','tubo','Tubo','{"fractional":false}'::JSONB,80),
    ('CANALIZACAO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('CANALIZACAO','ATTRIBUTE','diametro','Diâmetro','{"type":"text","required":false}'::JSONB,20),
    ('CANALIZACAO','ATTRIBUTE','material','Material','{"type":"select","required":false,"options":["PVC","PPR","Cobre","Aço","Ferro","Inox","Outro"]}'::JSONB,30),
    ('CANALIZACAO','ATTRIBUTE','pressao','Pressão nominal','{"type":"text","required":false}'::JSONB,40),
    ('CANALIZACAO','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('CANALIZACAO','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('CANALIZACAO','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- AGRICOLA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('AGRICOLA','CATEGORY','sementes','Sementes','{"subs":[]}'::JSONB,10),
    ('AGRICOLA','CATEGORY','fertilizantes','Fertilizantes','{"subs":[]}'::JSONB,20),
    ('AGRICOLA','CATEGORY','pesticidas_e_herbicidas','Pesticidas e herbicidas','{"subs":[]}'::JSONB,30),
    ('AGRICOLA','CATEGORY','ferramentas_e_equipamento','Ferramentas e equipamento','{"subs":[]}'::JSONB,40),
    ('AGRICOLA','CATEGORY','rega','Rega','{"subs":[]}'::JSONB,50),
    ('AGRICOLA','CATEGORY','produtos_agricolas','Produtos agrícolas','{"subs":[]}'::JSONB,60),
    ('AGRICOLA','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,10),
    ('AGRICOLA','UNIT','saco','Saco','{"fractional":false}'::JSONB,20),
    ('AGRICOLA','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,30),
    ('AGRICOLA','UNIT','un','Unidade','{"fractional":false}'::JSONB,40),
    ('AGRICOLA','UNIT','ton','Tonelada','{"fractional":true}'::JSONB,50),
    ('AGRICOLA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,60),
    ('AGRICOLA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,70),
    ('AGRICOLA','UNIT','lata','Lata','{"fractional":false}'::JSONB,80),
    ('AGRICOLA','ATTRIBUTE','variedade','Variedade / Tipo','{"type":"text","required":false}'::JSONB,10),
    ('AGRICOLA','ATTRIBUTE','origem','Origem','{"type":"text","required":false}'::JSONB,20),
    ('AGRICOLA','ATTRIBUTE','embalagem','Embalagem','{"type":"text","required":false}'::JSONB,30),
    ('AGRICOLA','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('AGRICOLA','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('AGRICOLA','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- VETERINARIA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('VETERINARIA','CATEGORY','medicamentos','Medicamentos','{"subs":["Antibióticos","Antiparasitários"]}'::JSONB,10),
    ('VETERINARIA','CATEGORY','vacinas','Vacinas','{"subs":[]}'::JSONB,20),
    ('VETERINARIA','CATEGORY','suplementos','Suplementos','{"subs":[]}'::JSONB,30),
    ('VETERINARIA','CATEGORY','higiene_animal','Higiene animal','{"subs":[]}'::JSONB,40),
    ('VETERINARIA','CATEGORY','material_veterinario','Material veterinário','{"subs":[]}'::JSONB,50),
    ('VETERINARIA','CATEGORY','racao_medicada','Ração medicada','{"subs":[]}'::JSONB,60),
    ('VETERINARIA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('VETERINARIA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,20),
    ('VETERINARIA','UNIT','frasco','Frasco','{"fractional":false}'::JSONB,30),
    ('VETERINARIA','UNIT','ampola','Ampola','{"fractional":false}'::JSONB,40),
    ('VETERINARIA','UNIT','ml','Mililitro (ml)','{"fractional":true}'::JSONB,50),
    ('VETERINARIA','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,60),
    ('VETERINARIA','UNIT','saco','Saco','{"fractional":false}'::JSONB,70),
    ('VETERINARIA','UNIT','blister','Blister','{"fractional":false}'::JSONB,80),
    ('VETERINARIA','ATTRIBUTE','principio_activo','Princípio activo','{"type":"text","required":true}'::JSONB,10),
    ('VETERINARIA','ATTRIBUTE','dosagem','Dosagem','{"type":"text","required":false}'::JSONB,20),
    ('VETERINARIA','ATTRIBUTE','especie','Espécie-alvo','{"type":"select","required":false,"options":["Bovinos","Caprinos","Suínos","Aves","Cães","Gatos","Outra"]}'::JSONB,30),
    ('VETERINARIA','ATTRIBUTE','laboratorio','Laboratório','{"type":"text","required":false}'::JSONB,40),
    ('VETERINARIA','LOCATION','LOJA','Balcão','{}'::JSONB,10),
    ('VETERINARIA','LOCATION','ARMAZEM','Armazém de medicamentos','{}'::JSONB,20),
    ('VETERINARIA','LOCATION','PATIO','Reserva / Frio','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- EQUIP_INDUSTRIAL
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('EQUIP_INDUSTRIAL','CATEGORY','maquinas','Máquinas','{"subs":[]}'::JSONB,10),
    ('EQUIP_INDUSTRIAL','CATEGORY','ferramentas_industriais','Ferramentas industriais','{"subs":[]}'::JSONB,20),
    ('EQUIP_INDUSTRIAL','CATEGORY','pecas_e_componentes','Peças e componentes','{"subs":[]}'::JSONB,30),
    ('EQUIP_INDUSTRIAL','CATEGORY','seguranca_e_epi','Segurança e EPI','{"subs":[]}'::JSONB,40),
    ('EQUIP_INDUSTRIAL','CATEGORY','lubrificantes','Lubrificantes','{"subs":[]}'::JSONB,50),
    ('EQUIP_INDUSTRIAL','CATEGORY','geradores_e_energia','Geradores e energia','{"subs":[]}'::JSONB,60),
    ('EQUIP_INDUSTRIAL','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('EQUIP_INDUSTRIAL','UNIT','kit','Kit','{"fractional":false}'::JSONB,20),
    ('EQUIP_INDUSTRIAL','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,30),
    ('EQUIP_INDUSTRIAL','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('EQUIP_INDUSTRIAL','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,50),
    ('EQUIP_INDUSTRIAL','ATTRIBUTE','marca','Marca','{"type":"text","required":true}'::JSONB,10),
    ('EQUIP_INDUSTRIAL','ATTRIBUTE','modelo','Modelo','{"type":"text","required":true}'::JSONB,20),
    ('EQUIP_INDUSTRIAL','ATTRIBUTE','potencia','Potência','{"type":"text","required":false}'::JSONB,30),
    ('EQUIP_INDUSTRIAL','ATTRIBUTE','numero_serie','N.º de série','{"type":"text","required":false}'::JSONB,40),
    ('EQUIP_INDUSTRIAL','ATTRIBUTE','garantia_meses','Garantia (meses)','{"type":"number","required":false}'::JSONB,50),
    ('EQUIP_INDUSTRIAL','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('EQUIP_INDUSTRIAL','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('EQUIP_INDUSTRIAL','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- TECIDOS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('TECIDOS','CATEGORY','algodao','Algodão','{"subs":[]}'::JSONB,10),
    ('TECIDOS','CATEGORY','capulana_e_estampados','Capulana e estampados','{"subs":[]}'::JSONB,20),
    ('TECIDOS','CATEGORY','malhas','Malhas','{"subs":[]}'::JSONB,30),
    ('TECIDOS','CATEGORY','cetim_e_sedas','Cetim e sedas','{"subs":[]}'::JSONB,40),
    ('TECIDOS','CATEGORY','fardamento','Fardamento','{"subs":[]}'::JSONB,50),
    ('TECIDOS','CATEGORY','retrosaria','Retrosaria','{"subs":["Linhas","Botões","Fechos"]}'::JSONB,60),
    ('TECIDOS','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,10),
    ('TECIDOS','UNIT','rolo','Rolo','{"fractional":false}'::JSONB,20),
    ('TECIDOS','UNIT','un','Unidade','{"fractional":false}'::JSONB,30),
    ('TECIDOS','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,40),
    ('TECIDOS','UNIT','pct','Pacote','{"fractional":false}'::JSONB,50),
    ('TECIDOS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,60),
    ('TECIDOS','ATTRIBUTE','composicao','Composição','{"type":"text","required":false}'::JSONB,10),
    ('TECIDOS','ATTRIBUTE','largura_cm','Largura (cm)','{"type":"number","required":false}'::JSONB,20),
    ('TECIDOS','ATTRIBUTE','cor','Cor','{"type":"text","required":false}'::JSONB,30),
    ('TECIDOS','ATTRIBUTE','gramagem','Gramagem','{"type":"text","required":false}'::JSONB,40),
    ('TECIDOS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('TECIDOS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('TECIDOS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- DESPORTO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('DESPORTO','CATEGORY','futebol','Futebol','{"subs":[]}'::JSONB,10),
    ('DESPORTO','CATEGORY','fitness','Fitness','{"subs":[]}'::JSONB,20),
    ('DESPORTO','CATEGORY','calcado_desportivo','Calçado desportivo','{"subs":[]}'::JSONB,30),
    ('DESPORTO','CATEGORY','vestuario_desportivo','Vestuário desportivo','{"subs":[]}'::JSONB,40),
    ('DESPORTO','CATEGORY','ciclismo','Ciclismo','{"subs":[]}'::JSONB,50),
    ('DESPORTO','CATEGORY','acessorios','Acessórios','{"subs":[]}'::JSONB,60),
    ('DESPORTO','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('DESPORTO','UNIT','par','Par','{"fractional":false}'::JSONB,20),
    ('DESPORTO','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,30),
    ('DESPORTO','UNIT','kit','Kit','{"fractional":false}'::JSONB,40),
    ('DESPORTO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('DESPORTO','ATTRIBUTE','tamanho','Tamanho','{"type":"text","required":false}'::JSONB,20),
    ('DESPORTO','ATTRIBUTE','modalidade','Modalidade','{"type":"text","required":false}'::JSONB,30),
    ('DESPORTO','ATTRIBUTE','cor','Cor','{"type":"text","required":false}'::JSONB,40),
    ('DESPORTO','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('DESPORTO','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('DESPORTO','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- BEBIDAS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('BEBIDAS','CATEGORY','aguas','Águas','{"subs":[]}'::JSONB,10),
    ('BEBIDAS','CATEGORY','refrigerantes_e_sumos','Refrigerantes e sumos','{"subs":[]}'::JSONB,20),
    ('BEBIDAS','CATEGORY','cervejas','Cervejas','{"subs":[]}'::JSONB,30),
    ('BEBIDAS','CATEGORY','vinhos','Vinhos','{"subs":[]}'::JSONB,40),
    ('BEBIDAS','CATEGORY','espirituosas','Espirituosas','{"subs":[]}'::JSONB,50),
    ('BEBIDAS','CATEGORY','energeticas','Energéticas','{"subs":[]}'::JSONB,60),
    ('BEBIDAS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('BEBIDAS','UNIT','garrafa','Garrafa','{"fractional":false}'::JSONB,20),
    ('BEBIDAS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,30),
    ('BEBIDAS','UNIT','lata','Lata','{"fractional":false}'::JSONB,40),
    ('BEBIDAS','UNIT','fardo','Fardo','{"fractional":false}'::JSONB,50),
    ('BEBIDAS','UNIT','palete','Palete','{"fractional":false}'::JSONB,60),
    ('BEBIDAS','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,70),
    ('BEBIDAS','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,80),
    ('BEBIDAS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('BEBIDAS','ATTRIBUTE','volume_ml','Volume (ml)','{"type":"number","required":false}'::JSONB,20),
    ('BEBIDAS','ATTRIBUTE','teor','Teor alcoólico (%)','{"type":"number","required":false}'::JSONB,30),
    ('BEBIDAS','ATTRIBUTE','embalagem','Embalagem','{"type":"select","required":false,"options":["Garrafa","Lata","Barril","Pack"]}'::JSONB,40),
    ('BEBIDAS','LOCATION','LOJA','Loja / Balcão','{}'::JSONB,10),
    ('BEBIDAS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('BEBIDAS','LOCATION','PATIO','Cais / Paletes','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- PRODUTOS_ANIMAIS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('PRODUTOS_ANIMAIS','CATEGORY','racao','Ração','{"subs":["Cães","Gatos","Aves"]}'::JSONB,10),
    ('PRODUTOS_ANIMAIS','CATEGORY','acessorios','Acessórios','{"subs":[]}'::JSONB,20),
    ('PRODUTOS_ANIMAIS','CATEGORY','higiene','Higiene','{"subs":[]}'::JSONB,30),
    ('PRODUTOS_ANIMAIS','CATEGORY','brinquedos','Brinquedos','{"subs":[]}'::JSONB,40),
    ('PRODUTOS_ANIMAIS','CATEGORY','aquarismo','Aquarismo','{"subs":[]}'::JSONB,50),
    ('PRODUTOS_ANIMAIS','CATEGORY','cuidados','Cuidados','{"subs":[]}'::JSONB,60),
    ('PRODUTOS_ANIMAIS','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,10),
    ('PRODUTOS_ANIMAIS','UNIT','saco','Saco','{"fractional":false}'::JSONB,20),
    ('PRODUTOS_ANIMAIS','UNIT','un','Unidade','{"fractional":false}'::JSONB,30),
    ('PRODUTOS_ANIMAIS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,40),
    ('PRODUTOS_ANIMAIS','UNIT','pct','Pacote','{"fractional":false}'::JSONB,50),
    ('PRODUTOS_ANIMAIS','UNIT','lata','Lata','{"fractional":false}'::JSONB,60),
    ('PRODUTOS_ANIMAIS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('PRODUTOS_ANIMAIS','ATTRIBUTE','especie','Espécie-alvo','{"type":"select","required":false,"options":["Cães","Gatos","Aves","Peixes","Outra"]}'::JSONB,20),
    ('PRODUTOS_ANIMAIS','ATTRIBUTE','peso_embalagem','Peso da embalagem','{"type":"text","required":false}'::JSONB,30),
    ('PRODUTOS_ANIMAIS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('PRODUTOS_ANIMAIS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('PRODUTOS_ANIMAIS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- GROSSISTA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('GROSSISTA','CATEGORY','alimentar','Alimentar','{"subs":[]}'::JSONB,10),
    ('GROSSISTA','CATEGORY','bebidas','Bebidas','{"subs":[]}'::JSONB,20),
    ('GROSSISTA','CATEGORY','higiene_e_limpeza','Higiene e limpeza','{"subs":[]}'::JSONB,30),
    ('GROSSISTA','CATEGORY','bazar','Bazar','{"subs":[]}'::JSONB,40),
    ('GROSSISTA','CATEGORY','outros','Outros','{"subs":[]}'::JSONB,50),
    ('GROSSISTA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('GROSSISTA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,20),
    ('GROSSISTA','UNIT','fardo','Fardo','{"fractional":false}'::JSONB,30),
    ('GROSSISTA','UNIT','palete','Palete','{"fractional":false}'::JSONB,40),
    ('GROSSISTA','UNIT','saco','Saco','{"fractional":false}'::JSONB,50),
    ('GROSSISTA','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,60),
    ('GROSSISTA','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,70),
    ('GROSSISTA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,80),
    ('GROSSISTA','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('GROSSISTA','ATTRIBUTE','ref_fornecedor','Referência do fornecedor','{"type":"text","required":false}'::JSONB,20),
    ('GROSSISTA','ATTRIBUTE','un_por_caixa','Unidades por caixa','{"type":"number","required":false}'::JSONB,30),
    ('GROSSISTA','LOCATION','LOJA','Expedição / Balcão','{}'::JSONB,10),
    ('GROSSISTA','LOCATION','ARMAZEM','Armazém principal','{}'::JSONB,20),
    ('GROSSISTA','LOCATION','PATIO','Zona de receção','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- DISTRIBUIDORA
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('DISTRIBUIDORA','CATEGORY','alimentar','Alimentar','{"subs":[]}'::JSONB,10),
    ('DISTRIBUIDORA','CATEGORY','bebidas','Bebidas','{"subs":[]}'::JSONB,20),
    ('DISTRIBUIDORA','CATEGORY','higiene_e_limpeza','Higiene e limpeza','{"subs":[]}'::JSONB,30),
    ('DISTRIBUIDORA','CATEGORY','bazar','Bazar','{"subs":[]}'::JSONB,40),
    ('DISTRIBUIDORA','CATEGORY','outros','Outros','{"subs":[]}'::JSONB,50),
    ('DISTRIBUIDORA','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('DISTRIBUIDORA','UNIT','cx','Caixa','{"fractional":false}'::JSONB,20),
    ('DISTRIBUIDORA','UNIT','fardo','Fardo','{"fractional":false}'::JSONB,30),
    ('DISTRIBUIDORA','UNIT','palete','Palete','{"fractional":false}'::JSONB,40),
    ('DISTRIBUIDORA','UNIT','saco','Saco','{"fractional":false}'::JSONB,50),
    ('DISTRIBUIDORA','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,60),
    ('DISTRIBUIDORA','UNIT','dz','Dúzia','{"fractional":false}'::JSONB,70),
    ('DISTRIBUIDORA','UNIT','pct','Pacote','{"fractional":false}'::JSONB,80),
    ('DISTRIBUIDORA','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('DISTRIBUIDORA','ATTRIBUTE','ref_fornecedor','Referência do fornecedor','{"type":"text","required":false}'::JSONB,20),
    ('DISTRIBUIDORA','ATTRIBUTE','un_por_caixa','Unidades por caixa','{"type":"number","required":false}'::JSONB,30),
    ('DISTRIBUIDORA','LOCATION','LOJA','Expedição','{}'::JSONB,10),
    ('DISTRIBUIDORA','LOCATION','ARMAZEM','Armazém principal','{}'::JSONB,20),
    ('DISTRIBUIDORA','LOCATION','PATIO','Zona de receção','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- OUTROS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('OUTROS','CATEGORY','geral','Geral','{"subs":[]}'::JSONB,10),
    ('OUTROS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('OUTROS','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,20),
    ('OUTROS','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,30),
    ('OUTROS','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,40),
    ('OUTROS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,50),
    ('OUTROS','UNIT','pct','Pacote','{"fractional":false}'::JSONB,60),
    ('OUTROS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('OUTROS','ATTRIBUTE','referencia','Referência','{"type":"text","required":false}'::JSONB,20),
    ('OUTROS','LOCATION','LOJA','Loja (Balcão)','{}'::JSONB,10),
    ('OUTROS','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('OUTROS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ARMAZEM_GERAL
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ARMAZEM_GERAL','CATEGORY','mercadoria_geral','Mercadoria geral','{"subs":[]}'::JSONB,10),
    ('ARMAZEM_GERAL','CATEGORY','paletes','Paletes','{"subs":[]}'::JSONB,20),
    ('ARMAZEM_GERAL','CATEGORY','granel','Granel','{"subs":[]}'::JSONB,30),
    ('ARMAZEM_GERAL','CATEGORY','fragil','Frágil','{"subs":[]}'::JSONB,40),
    ('ARMAZEM_GERAL','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('ARMAZEM_GERAL','UNIT','cx','Caixa','{"fractional":false}'::JSONB,20),
    ('ARMAZEM_GERAL','UNIT','palete','Palete','{"fractional":false}'::JSONB,30),
    ('ARMAZEM_GERAL','UNIT','fardo','Fardo','{"fractional":false}'::JSONB,40),
    ('ARMAZEM_GERAL','UNIT','saco','Saco','{"fractional":false}'::JSONB,50),
    ('ARMAZEM_GERAL','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,60),
    ('ARMAZEM_GERAL','UNIT','ton','Tonelada','{"fractional":true}'::JSONB,70),
    ('ARMAZEM_GERAL','UNIT','m3','Metro cúbico (m³)','{"fractional":true}'::JSONB,80),
    ('ARMAZEM_GERAL','ATTRIBUTE','referencia','Referência / SKU','{"type":"text","required":false}'::JSONB,10),
    ('ARMAZEM_GERAL','ATTRIBUTE','cliente','Proprietário da mercadoria','{"type":"text","required":false}'::JSONB,20),
    ('ARMAZEM_GERAL','ATTRIBUTE','peso_kg','Peso (kg)','{"type":"number","required":false}'::JSONB,30),
    ('ARMAZEM_GERAL','LOCATION','LOJA','Expedição','{}'::JSONB,10),
    ('ARMAZEM_GERAL','LOCATION','ARMAZEM','Armazém geral','{}'::JSONB,20),
    ('ARMAZEM_GERAL','LOCATION','PATIO','Receção / Cais','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ARMAZEM_MATERIAS_PRIMAS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ARMAZEM_MATERIAS_PRIMAS','CATEGORY','materias_primas','Matérias-primas','{"subs":[]}'::JSONB,10),
    ('ARMAZEM_MATERIAS_PRIMAS','CATEGORY','semi_acabados','Semi-acabados','{"subs":[]}'::JSONB,20),
    ('ARMAZEM_MATERIAS_PRIMAS','CATEGORY','produtos_acabados','Produtos acabados','{"subs":[]}'::JSONB,30),
    ('ARMAZEM_MATERIAS_PRIMAS','CATEGORY','embalagens','Embalagens','{"subs":[]}'::JSONB,40),
    ('ARMAZEM_MATERIAS_PRIMAS','CATEGORY','consumiveis','Consumíveis','{"subs":[]}'::JSONB,50),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,10),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','ton','Tonelada','{"fractional":true}'::JSONB,20),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,30),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','un','Unidade','{"fractional":false}'::JSONB,40),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,50),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','saco','Saco','{"fractional":false}'::JSONB,60),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','palete','Palete','{"fractional":false}'::JSONB,70),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','bobina','Bobina','{"fractional":false}'::JSONB,80),
    ('ARMAZEM_MATERIAS_PRIMAS','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,90),
    ('ARMAZEM_MATERIAS_PRIMAS','ATTRIBUTE','tipo','Tipo','{"type":"select","required":true,"options":["Matéria-prima","Semi-acabado","Produto acabado"]}'::JSONB,10),
    ('ARMAZEM_MATERIAS_PRIMAS','ATTRIBUTE','especificacao','Especificação','{"type":"text","required":false}'::JSONB,20),
    ('ARMAZEM_MATERIAS_PRIMAS','ATTRIBUTE','origem','Origem / Fornecedor','{"type":"text","required":false}'::JSONB,30),
    ('ARMAZEM_MATERIAS_PRIMAS','LOCATION','LOJA','Expedição','{}'::JSONB,10),
    ('ARMAZEM_MATERIAS_PRIMAS','LOCATION','ARMAZEM','Matérias-primas','{}'::JSONB,20),
    ('ARMAZEM_MATERIAS_PRIMAS','LOCATION','PATIO','Produtos acabados','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ARMAZEM_MEDICAMENTOS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ARMAZEM_MEDICAMENTOS','CATEGORY','medicamentos','Medicamentos','{"subs":[]}'::JSONB,10),
    ('ARMAZEM_MEDICAMENTOS','CATEGORY','material_hospitalar','Material hospitalar','{"subs":[]}'::JSONB,20),
    ('ARMAZEM_MEDICAMENTOS','CATEGORY','vacinas_e_frio','Vacinas e frio','{"subs":[]}'::JSONB,30),
    ('ARMAZEM_MEDICAMENTOS','CATEGORY','consumiveis','Consumíveis','{"subs":[]}'::JSONB,40),
    ('ARMAZEM_MEDICAMENTOS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('ARMAZEM_MEDICAMENTOS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,20),
    ('ARMAZEM_MEDICAMENTOS','UNIT','blister','Blister','{"fractional":false}'::JSONB,30),
    ('ARMAZEM_MEDICAMENTOS','UNIT','frasco','Frasco','{"fractional":false}'::JSONB,40),
    ('ARMAZEM_MEDICAMENTOS','UNIT','ampola','Ampola','{"fractional":false}'::JSONB,50),
    ('ARMAZEM_MEDICAMENTOS','UNIT','pct','Pacote','{"fractional":false}'::JSONB,60),
    ('ARMAZEM_MEDICAMENTOS','UNIT','palete','Palete','{"fractional":false}'::JSONB,70),
    ('ARMAZEM_MEDICAMENTOS','ATTRIBUTE','principio_activo','Princípio activo','{"type":"text","required":true}'::JSONB,10),
    ('ARMAZEM_MEDICAMENTOS','ATTRIBUTE','dosagem','Dosagem','{"type":"text","required":false}'::JSONB,20),
    ('ARMAZEM_MEDICAMENTOS','ATTRIBUTE','forma','Forma farmacêutica','{"type":"text","required":false}'::JSONB,30),
    ('ARMAZEM_MEDICAMENTOS','ATTRIBUTE','laboratorio','Laboratório','{"type":"text","required":false}'::JSONB,40),
    ('ARMAZEM_MEDICAMENTOS','ATTRIBUTE','conservacao','Conservação','{"type":"select","required":false,"options":["Ambiente","Refrigerado","Congelado"]}'::JSONB,50),
    ('ARMAZEM_MEDICAMENTOS','LOCATION','LOJA','Dispensa / Expedição','{}'::JSONB,10),
    ('ARMAZEM_MEDICAMENTOS','LOCATION','ARMAZEM','Armazém de medicamentos','{}'::JSONB,20),
    ('ARMAZEM_MEDICAMENTOS','LOCATION','PATIO','Quarentena / Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ARMAZEM_PECAS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ARMAZEM_PECAS','CATEGORY','pecas_auto','Peças auto','{"subs":[]}'::JSONB,10),
    ('ARMAZEM_PECAS','CATEGORY','pecas_de_motas','Peças de motas','{"subs":[]}'::JSONB,20),
    ('ARMAZEM_PECAS','CATEGORY','componentes','Componentes','{"subs":[]}'::JSONB,30),
    ('ARMAZEM_PECAS','CATEGORY','lubrificantes','Lubrificantes','{"subs":[]}'::JSONB,40),
    ('ARMAZEM_PECAS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('ARMAZEM_PECAS','UNIT','par','Par','{"fractional":false}'::JSONB,20),
    ('ARMAZEM_PECAS','UNIT','jogo','Jogo','{"fractional":false}'::JSONB,30),
    ('ARMAZEM_PECAS','UNIT','kit','Kit','{"fractional":false}'::JSONB,40),
    ('ARMAZEM_PECAS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,50),
    ('ARMAZEM_PECAS','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,60),
    ('ARMAZEM_PECAS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('ARMAZEM_PECAS','ATTRIBUTE','modelo','Modelo','{"type":"text","required":false}'::JSONB,20),
    ('ARMAZEM_PECAS','ATTRIBUTE','ref_oem','Referência OEM / fabricante','{"type":"text","required":false}'::JSONB,30),
    ('ARMAZEM_PECAS','ATTRIBUTE','compatibilidade','Compatibilidade','{"type":"text","required":false}'::JSONB,40),
    ('ARMAZEM_PECAS','LOCATION','LOJA','Balcão / Expedição','{}'::JSONB,10),
    ('ARMAZEM_PECAS','LOCATION','ARMAZEM','Armazém de peças','{}'::JSONB,20),
    ('ARMAZEM_PECAS','LOCATION','PATIO','Reserva','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ARMAZEM_ALIMENTOS
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ARMAZEM_ALIMENTOS','CATEGORY','secos','Secos','{"subs":[]}'::JSONB,10),
    ('ARMAZEM_ALIMENTOS','CATEGORY','refrigerados','Refrigerados','{"subs":[]}'::JSONB,20),
    ('ARMAZEM_ALIMENTOS','CATEGORY','congelados','Congelados','{"subs":[]}'::JSONB,30),
    ('ARMAZEM_ALIMENTOS','CATEGORY','bebidas','Bebidas','{"subs":[]}'::JSONB,40),
    ('ARMAZEM_ALIMENTOS','UNIT','un','Unidade','{"fractional":false}'::JSONB,10),
    ('ARMAZEM_ALIMENTOS','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,20),
    ('ARMAZEM_ALIMENTOS','UNIT','cx','Caixa','{"fractional":false}'::JSONB,30),
    ('ARMAZEM_ALIMENTOS','UNIT','palete','Palete','{"fractional":false}'::JSONB,40),
    ('ARMAZEM_ALIMENTOS','UNIT','saco','Saco','{"fractional":false}'::JSONB,50),
    ('ARMAZEM_ALIMENTOS','UNIT','fardo','Fardo','{"fractional":false}'::JSONB,60),
    ('ARMAZEM_ALIMENTOS','UNIT','l','Litro (l)','{"fractional":true}'::JSONB,70),
    ('ARMAZEM_ALIMENTOS','UNIT','ton','Tonelada','{"fractional":true}'::JSONB,80),
    ('ARMAZEM_ALIMENTOS','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('ARMAZEM_ALIMENTOS','ATTRIBUTE','origem','Origem','{"type":"text","required":false}'::JSONB,20),
    ('ARMAZEM_ALIMENTOS','ATTRIBUTE','peso_liquido','Peso líquido','{"type":"text","required":false}'::JSONB,30),
    ('ARMAZEM_ALIMENTOS','ATTRIBUTE','temperatura','Temperatura','{"type":"select","required":true,"options":["Ambiente","Refrigerado","Congelado"]}'::JSONB,40),
    ('ARMAZEM_ALIMENTOS','LOCATION','LOJA','Expedição','{}'::JSONB,10),
    ('ARMAZEM_ALIMENTOS','LOCATION','ARMAZEM','Armazém seco','{}'::JSONB,20),
    ('ARMAZEM_ALIMENTOS','LOCATION','PATIO','Câmara fria','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;
-- ARMAZEM_CONSTRUCAO
INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
    ('ARMAZEM_CONSTRUCAO','CATEGORY','cimento_e_argamassas','Cimento e argamassas','{"subs":[]}'::JSONB,10),
    ('ARMAZEM_CONSTRUCAO','CATEGORY','ferro_e_aco','Ferro e aço','{"subs":[]}'::JSONB,20),
    ('ARMAZEM_CONSTRUCAO','CATEGORY','agregados','Agregados','{"subs":[]}'::JSONB,30),
    ('ARMAZEM_CONSTRUCAO','CATEGORY','blocos','Blocos','{"subs":[]}'::JSONB,40),
    ('ARMAZEM_CONSTRUCAO','CATEGORY','acabamentos','Acabamentos','{"subs":[]}'::JSONB,50),
    ('ARMAZEM_CONSTRUCAO','UNIT','saco','Saco','{"fractional":false}'::JSONB,10),
    ('ARMAZEM_CONSTRUCAO','UNIT','un','Unidade','{"fractional":false}'::JSONB,20),
    ('ARMAZEM_CONSTRUCAO','UNIT','kg','Quilograma (kg)','{"fractional":true}'::JSONB,30),
    ('ARMAZEM_CONSTRUCAO','UNIT','ton','Tonelada','{"fractional":true}'::JSONB,40),
    ('ARMAZEM_CONSTRUCAO','UNIT','barra','Barra','{"fractional":false}'::JSONB,50),
    ('ARMAZEM_CONSTRUCAO','UNIT','m','Metro linear (m)','{"fractional":true}'::JSONB,60),
    ('ARMAZEM_CONSTRUCAO','UNIT','m2','Metro quadrado (m²)','{"fractional":true}'::JSONB,70),
    ('ARMAZEM_CONSTRUCAO','UNIT','m3','Metro cúbico (m³)','{"fractional":true}'::JSONB,80),
    ('ARMAZEM_CONSTRUCAO','UNIT','palete','Palete','{"fractional":false}'::JSONB,90),
    ('ARMAZEM_CONSTRUCAO','ATTRIBUTE','marca','Marca','{"type":"text","required":false}'::JSONB,10),
    ('ARMAZEM_CONSTRUCAO','ATTRIBUTE','medida','Medida','{"type":"text","required":false}'::JSONB,20),
    ('ARMAZEM_CONSTRUCAO','ATTRIBUTE','classe','Classe / Resistência','{"type":"text","required":false}'::JSONB,30),
    ('ARMAZEM_CONSTRUCAO','LOCATION','LOJA','Balcão','{}'::JSONB,10),
    ('ARMAZEM_CONSTRUCAO','LOCATION','ARMAZEM','Armazém','{}'::JSONB,20),
    ('ARMAZEM_CONSTRUCAO','LOCATION','PATIO','Pátio','{}'::JSONB,30)
ON CONFLICT (business_type_id, kind, code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. COLUNAS NOVAS (todas com valor por omissão: lojas existentes = FERRAGENS, sem perda de dados)
-- ------------------------------------------------------------------------------
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'FERRAGENS' REFERENCES public.business_types(id) ON UPDATE CASCADE;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS sector_configured_at TIMESTAMPTZ;       -- NULL = predefinidos ainda não carregados na loja
ALTER TABLE public.ambassador_referred_stores ADD COLUMN IF NOT EXISTS business_type TEXT REFERENCES public.business_types(id) ON UPDATE CASCADE;
ALTER TABLE public.ambassador_referred_stores ADD COLUMN IF NOT EXISTS users_authorized BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.ambassadors ADD COLUMN IF NOT EXISTS can_create_store_users BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::JSONB;

-- vínculos existentes herdam o tipo da loja (FERRAGENS)
UPDATE public.ambassador_referred_stores r SET business_type = s.business_type
  FROM public.stores s WHERE s.id = COALESCE(r.store_id, r.id) AND r.business_type IS NULL;

-- configuração por loja (uma tabela genérica: categorias, unidades, atributos e nomes dos locais)
CREATE TABLE IF NOT EXISTS public.store_sector_items (
    store_id TEXT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('CATEGORY', 'UNIT', 'ATTRIBUTE', 'LOCATION')),
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::JSONB,
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    source TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (source IN ('PRESET', 'CUSTOM')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, kind, code)
);
CREATE INDEX IF NOT EXISTS idx_store_sector_items_store ON public.store_sector_items(store_id, kind);
ALTER TABLE public.store_sector_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "store_sector_items_select" ON public.store_sector_items;
CREATE POLICY "store_sector_items_select" ON public.store_sector_items FOR SELECT TO authenticated
USING (store_id = public.get_auth_user_store_id() OR public.fn_is_superadmin());
REVOKE ALL ON public.store_sector_items FROM anon;
-- Sem escrita directa: só fn_store_item_save (ADMIN da loja) e fn_apply_business_type (servidor).

CREATE TABLE IF NOT EXISTS public.user_creation_audit (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID, actor_kind TEXT, store_id TEXT, new_user_id UUID, role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_creation_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_creation_audit_superadmin" ON public.user_creation_audit;
CREATE POLICY "user_creation_audit_superadmin" ON public.user_creation_audit FOR SELECT TO authenticated USING (public.fn_is_superadmin());
REVOKE ALL ON public.user_creation_audit FROM anon;

-- ------------------------------------------------------------------------------
-- 4. FUNÇÕES AUXILIARES
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_business_type(p TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v TEXT := upper(trim(COALESCE(p, '')));
BEGIN
    IF v = '' THEN RAISE EXCEPTION 'Seleccione o tipo de negócio da loja (campo obrigatório).'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_types WHERE id = v AND active) THEN RAISE EXCEPTION 'Tipo de negócio inválido ou desactivado.'; END IF;
    RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.fn_validate_business_type(TEXT) FROM PUBLIC, anon, authenticated;

-- Autoriza (só nesta transacção) a escrita de business_type / sector_configured_at por funções do servidor.
CREATE OR REPLACE FUNCTION public.fn__sector_unlock() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('gef.allow_sector_change', 'on', TRUE); END $$;
REVOKE ALL ON FUNCTION public.fn__sector_unlock() FROM PUBLIC, anon, authenticated;

-- Lista pública dos tipos activos (usada também no cadastro por link do embaixador)
CREATE OR REPLACE FUNCTION public.fn_business_types() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'description', description)
                     ORDER BY CASE kind WHEN 'COMERCIO' THEN 0 ELSE 1 END, sort_order, name), '[]'::JSONB)
      FROM public.business_types WHERE active;
$$;
GRANT EXECUTE ON FUNCTION public.fn_business_types() TO anon, authenticated;

-- Protecção (acrescenta à v24): só o Super Admin muda o tipo de negócio e o estado de configuração
CREATE OR REPLACE FUNCTION public.fn_protect_vstore_fields() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_restricted BOOLEAN;
BEGIN
    IF auth.uid() IS NOT NULL AND public.get_auth_user_role() IS DISTINCT FROM 'SUPERADMIN' THEN
        NEW.slug := OLD.slug;
        NEW.vstore_enabled := OLD.vstore_enabled;
        NEW.vstore_theme_grant := OLD.vstore_theme_grant;
        NEW.vstore_theme_grant_by := OLD.vstore_theme_grant_by;
        NEW.vstore_theme_grant_at := OLD.vstore_theme_grant_at;
        IF NEW.vstore_theme IS DISTINCT FROM OLD.vstore_theme THEN
            SELECT t.restricted INTO v_restricted FROM public.vstore_themes t WHERE t.id = NEW.vstore_theme;
            IF COALESCE(v_restricted, FALSE) AND NEW.vstore_theme IS DISTINCT FROM NEW.vstore_theme_grant THEN
                NEW.vstore_theme := OLD.vstore_theme;
            END IF;
        END IF;
        IF COALESCE(current_setting('gef.allow_sector_change', TRUE), '') <> 'on' THEN
            NEW.business_type := OLD.business_type;
            NEW.sector_configured_at := OLD.sector_configured_at;
        END IF;
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_protect_vstore_fields ON public.stores;
CREATE TRIGGER trg_protect_vstore_fields BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.fn_protect_vstore_fields();

-- Carrega os predefinidos do sector na loja. Aditivo e idempotente: nunca apaga nem toca em produtos.
--  · itens PRESET de um tipo anterior que não existem no novo ficam inactivos (não se apagam);
--  · itens editados pela loja (source = CUSTOM) nunca são sobrescritos.
CREATE OR REPLACE FUNCTION public.fn_apply_business_type(p_store_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE;
BEGIN
    SELECT * INTO s FROM public.stores WHERE id = p_store_id;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
    PERFORM public.fn__sector_unlock();
    UPDATE public.store_sector_items i SET active = FALSE, updated_at = NOW()
     WHERE i.store_id = s.id AND i.source = 'PRESET' AND i.kind IN ('CATEGORY', 'UNIT', 'ATTRIBUTE')
       AND NOT EXISTS (SELECT 1 FROM public.business_type_presets p WHERE p.business_type_id = s.business_type AND p.kind = i.kind AND p.code = i.code);
    INSERT INTO public.store_sector_items (store_id, kind, code, label, data, sort_order, active, source)
    SELECT s.id, p.kind, p.code, p.label, p.data, p.sort_order, TRUE, 'PRESET'
      FROM public.business_type_presets p WHERE p.business_type_id = s.business_type
    ON CONFLICT (store_id, kind, code) DO UPDATE
       SET label = CASE WHEN store_sector_items.source = 'PRESET' THEN EXCLUDED.label ELSE store_sector_items.label END,
           data = CASE WHEN store_sector_items.source = 'PRESET' THEN EXCLUDED.data ELSE store_sector_items.data END,
           sort_order = CASE WHEN store_sector_items.source = 'PRESET' THEN EXCLUDED.sort_order ELSE store_sector_items.sort_order END,
           active = CASE WHEN store_sector_items.source = 'PRESET' THEN TRUE ELSE store_sector_items.active END,
           updated_at = NOW();
    UPDATE public.stores SET sector_configured_at = NOW() WHERE id = s.id;
END $$;
REVOKE ALL ON FUNCTION public.fn_apply_business_type(TEXT) FROM PUBLIC, anon, authenticated;

-- Configuração efectiva da loja (lida por qualquer perfil da loja; o Super Admin pode passar p_store_id).
-- Loja ainda sem configuração carregada (ex.: lojas antigas): devolve os predefinidos do seu tipo, só para leitura.
CREATE OR REPLACE FUNCTION public.fn_store_sector_config(p_store_id TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT; s public.stores%ROWTYPE; bt public.business_types%ROWTYPE; v_conf BOOLEAN; v_out JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão não autenticada.'; END IF;
    IF public.fn_is_superadmin() AND NULLIF(p_store_id, '') IS NOT NULL AND p_store_id <> 'ALL' THEN v_store := p_store_id;
    ELSE v_store := public.get_auth_user_store_id(); END IF;
    IF v_store IS NULL THEN RETURN jsonb_build_object('configured', FALSE, 'business_type', NULL); END IF;
    SELECT * INTO s FROM public.stores WHERE id = v_store;
    IF s.id IS NULL THEN RETURN jsonb_build_object('configured', FALSE, 'business_type', NULL); END IF;
    SELECT * INTO bt FROM public.business_types WHERE id = s.business_type;
    v_conf := s.sector_configured_at IS NOT NULL;
    WITH items AS (
        SELECT kind, code, label, data, sort_order, active, source FROM public.store_sector_items WHERE store_id = s.id AND v_conf
        UNION ALL
        SELECT kind, code, label, data, sort_order, TRUE, 'PRESET' FROM public.business_type_presets WHERE business_type_id = s.business_type AND NOT v_conf)
    SELECT jsonb_build_object(
        'store_id', s.id, 'business_type', s.business_type, 'business_type_name', bt.name, 'kind', bt.kind,
        'flags', COALESCE(bt.flags, '{}'::JSONB), 'configured', v_conf,
        'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', label, 'subs', COALESCE(data -> 'subs', '[]'::JSONB), 'active', active, 'source', source) ORDER BY sort_order, label) FROM items WHERE kind = 'CATEGORY'), '[]'::JSONB),
        'units', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', label, 'fractional', COALESCE((data ->> 'fractional')::BOOLEAN, FALSE), 'active', active, 'source', source) ORDER BY sort_order, label) FROM items WHERE kind = 'UNIT'), '[]'::JSONB),
        'attributes', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', code, 'label', label, 'type', COALESCE(data ->> 'type', 'text'), 'options', COALESCE(data -> 'options', '[]'::JSONB), 'required', COALESCE((data ->> 'required')::BOOLEAN, FALSE), 'active', active, 'source', source) ORDER BY sort_order, label) FROM items WHERE kind = 'ATTRIBUTE'), '[]'::JSONB),
        'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'label', label, 'enabled', active, 'source', source) ORDER BY sort_order) FROM items WHERE kind = 'LOCATION'), '[]'::JSONB)
    ) INTO v_out;
    RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.fn_store_sector_config(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_store_sector_config(TEXT) TO authenticated;

-- Personalização pela própria loja (só ADMIN): categorias, unidades, atributos e nome dos locais.
-- Nunca apaga: «desactivar» esconde o item das listas; os produtos existentes mantêm os seus valores.
CREATE OR REPLACE FUNCTION public.fn_store_item_save(p_kind TEXT, p_code TEXT, p_label TEXT, p_data JSONB DEFAULT '{}'::JSONB,
                                                     p_active BOOLEAN DEFAULT TRUE, p_sort INT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN']); v_kind TEXT := upper(trim(COALESCE(p_kind, ''))); v_label TEXT := LEFT(TRIM(COALESCE(p_label, '')), 80);
        v_code TEXT; v_data JSONB := '{}'::JSONB; v_sort INT; v_conf TIMESTAMPTZ; v_type TEXT; v_opts JSONB; v_n INT;
BEGIN
    IF v_kind NOT IN ('CATEGORY', 'UNIT', 'ATTRIBUTE', 'LOCATION') THEN RAISE EXCEPTION 'Tipo de item inválido.'; END IF;
    IF v_label = '' THEN RAISE EXCEPTION 'Indique o nome.'; END IF;
    IF pg_column_size(COALESCE(p_data, '{}'::JSONB)) > 4000 THEN RAISE EXCEPTION 'Dados demasiado grandes.'; END IF;
    PERFORM public.fn_rate_limit('sectoritem:' || auth.uid()::TEXT, 120, 600);
    SELECT sector_configured_at INTO v_conf FROM public.stores WHERE id = v_store;
    IF v_conf IS NULL THEN PERFORM public.fn_apply_business_type(v_store); END IF;
    IF v_kind = 'LOCATION' THEN
        v_code := upper(trim(COALESCE(p_code, '')));
        IF v_code NOT IN ('LOJA', 'ARMAZEM', 'PATIO') THEN RAISE EXCEPTION 'Local inválido (LOJA, ARMAZEM ou PATIO).'; END IF;
    ELSE
        v_code := COALESCE(NULLIF(regexp_replace(public.fn_norm(COALESCE(NULLIF(trim(p_code), ''), v_label)), '[^a-z0-9]+', '_', 'g'), ''), 'item');
        v_code := LEFT(trim(both '_' from v_code), 40);
        IF v_code = '' THEN RAISE EXCEPTION 'Nome inválido.'; END IF;
    END IF;
    IF v_kind = 'CATEGORY' THEN
        v_data := jsonb_build_object('subs', COALESCE((SELECT jsonb_agg(LEFT(TRIM(x), 60)) FROM (SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_data -> 'subs') = 'array' THEN p_data -> 'subs' ELSE '[]'::JSONB END) x WHERE NULLIF(TRIM(x), '') IS NOT NULL LIMIT 50) q), '[]'::JSONB));
    ELSIF v_kind = 'UNIT' THEN
        v_data := jsonb_build_object('fractional', COALESCE((p_data ->> 'fractional')::BOOLEAN, FALSE));
    ELSIF v_kind = 'ATTRIBUTE' THEN
        v_type := COALESCE(p_data ->> 'type', 'text');
        IF v_type NOT IN ('text', 'number', 'select', 'date', 'boolean') THEN RAISE EXCEPTION 'Tipo de atributo inválido.'; END IF;
        v_opts := COALESCE((SELECT jsonb_agg(LEFT(TRIM(x), 60)) FROM (SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_data -> 'options') = 'array' THEN p_data -> 'options' ELSE '[]'::JSONB END) x WHERE NULLIF(TRIM(x), '') IS NOT NULL LIMIT 60) q), '[]'::JSONB);
        IF v_type = 'select' AND jsonb_array_length(v_opts) = 0 THEN RAISE EXCEPTION 'Indique as opções da lista.'; END IF;
        v_data := jsonb_build_object('type', v_type, 'required', COALESCE((p_data ->> 'required')::BOOLEAN, FALSE)) || CASE WHEN v_type = 'select' THEN jsonb_build_object('options', v_opts) ELSE '{}'::JSONB END;
    END IF;
    SELECT COUNT(*) INTO v_n FROM public.store_sector_items WHERE store_id = v_store;
    IF v_n >= 400 AND NOT EXISTS (SELECT 1 FROM public.store_sector_items WHERE store_id = v_store AND kind = v_kind AND code = v_code) THEN RAISE EXCEPTION 'Limite de itens atingido.'; END IF;
    SELECT COALESCE(p_sort, (SELECT sort_order FROM public.store_sector_items WHERE store_id = v_store AND kind = v_kind AND code = v_code),
                    (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM public.store_sector_items WHERE store_id = v_store AND kind = v_kind)) INTO v_sort;
    INSERT INTO public.store_sector_items (store_id, kind, code, label, data, sort_order, active, source)
    VALUES (v_store, v_kind, v_code, v_label, v_data, v_sort, COALESCE(p_active, TRUE), 'CUSTOM')
    ON CONFLICT (store_id, kind, code) DO UPDATE SET label = EXCLUDED.label, data = EXCLUDED.data, sort_order = EXCLUDED.sort_order,
        active = EXCLUDED.active, source = 'CUSTOM', updated_at = NOW();
    RETURN jsonb_build_object('success', TRUE, 'kind', v_kind, 'code', v_code);
END $$;
REVOKE ALL ON FUNCTION public.fn_store_item_save(TEXT, TEXT, TEXT, JSONB, BOOLEAN, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_store_item_save(TEXT, TEXT, TEXT, JSONB, BOOLEAN, INT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. SUPER ADMIN: corrigir o tipo de uma loja, gerir sectores
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_set_store_business_type(p_store_id TEXT, p_business_type TEXT, p_load BOOLEAN DEFAULT TRUE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; v_bt TEXT;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    v_bt := public.fn_validate_business_type(p_business_type);
    SELECT * INTO s FROM public.stores WHERE id = p_store_id FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
    PERFORM public.fn__sector_unlock();
    UPDATE public.stores SET business_type = v_bt, updated_at = NOW() WHERE id = s.id;
    UPDATE public.ambassador_referred_stores SET business_type = v_bt WHERE COALESCE(store_id, id) = s.id;
    IF COALESCE(p_load, TRUE) THEN PERFORM public.fn_apply_business_type(s.id); END IF;
    PERFORM public.fn_amb_audit('STORE_BUSINESS_TYPE_SET', NULL, s.id, NULL, jsonb_build_object('from', s.business_type, 'to', v_bt, 'loaded', COALESCE(p_load, TRUE)));
    RETURN jsonb_build_object('success', TRUE, 'business_type', v_bt, 'loaded', COALESCE(p_load, TRUE));
END $$;
REVOKE ALL ON FUNCTION public.fn_admin_set_store_business_type(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_store_business_type(TEXT, TEXT, BOOLEAN) TO authenticated;

-- Novo sector (opcionalmente clonando os predefinidos de outro) ou edição/activação de um existente
CREATE OR REPLACE FUNCTION public.fn_admin_save_business_type(p_id TEXT, p_name TEXT, p_kind TEXT DEFAULT 'COMERCIO', p_description TEXT DEFAULT NULL,
                                                              p_clone_from TEXT DEFAULT NULL, p_active BOOLEAN DEFAULT TRUE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id TEXT := upper(regexp_replace(trim(COALESCE(p_id, '')), '[^A-Za-z0-9]+', '_', 'g')); v_new BOOLEAN;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    v_id := trim(both '_' from v_id);
    IF v_id !~ '^[A-Z][A-Z0-9_]{1,39}$' THEN RAISE EXCEPTION 'Código do sector inválido (letras, números e _; 2 a 40).'; END IF;
    IF NULLIF(TRIM(COALESCE(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Indique o nome do sector.'; END IF;
    IF COALESCE(p_kind, 'COMERCIO') NOT IN ('COMERCIO', 'ARMAZEM') THEN RAISE EXCEPTION 'Tipo inválido.'; END IF;
    v_new := NOT EXISTS (SELECT 1 FROM public.business_types WHERE id = v_id);
    INSERT INTO public.business_types (id, name, kind, description, sort_order, active, is_system)
    VALUES (v_id, LEFT(TRIM(p_name), 80), COALESCE(p_kind, 'COMERCIO'), NULLIF(LEFT(TRIM(COALESCE(p_description, '')), 300), ''),
            (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM public.business_types WHERE sort_order < 900), COALESCE(p_active, TRUE), FALSE)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description, active = EXCLUDED.active;
    IF v_new AND NULLIF(p_clone_from, '') IS NOT NULL THEN
        UPDATE public.business_types t SET flags = COALESCE((SELECT flags FROM public.business_types WHERE id = upper(p_clone_from)), '{}'::JSONB) WHERE t.id = v_id;
        INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order)
        SELECT v_id, kind, code, label, data, sort_order FROM public.business_type_presets WHERE business_type_id = upper(p_clone_from)
        ON CONFLICT DO NOTHING;
    ELSIF v_new THEN
        INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order) VALUES
            (v_id, 'LOCATION', 'LOJA', 'Loja (Balcão)', '{}'::JSONB, 10), (v_id, 'LOCATION', 'ARMAZEM', 'Armazém', '{}'::JSONB, 20), (v_id, 'LOCATION', 'PATIO', 'Reserva', '{}'::JSONB, 30),
            (v_id, 'UNIT', 'un', 'Unidade', '{"fractional":false}'::JSONB, 10), (v_id, 'CATEGORY', 'geral', 'Geral', '{"subs":[]}'::JSONB, 10);
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'id', v_id, 'created', v_new);
END $$;
REVOKE ALL ON FUNCTION public.fn_admin_save_business_type(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_save_business_type(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- Predefinidos de um sector (Super Admin): adicionar/editar/remover categoria, unidade, atributo ou nome de local
CREATE OR REPLACE FUNCTION public.fn_admin_save_preset(p_type TEXT, p_kind TEXT, p_code TEXT, p_label TEXT, p_data JSONB DEFAULT '{}'::JSONB,
                                                       p_sort INT DEFAULT 0, p_delete BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind TEXT := upper(trim(COALESCE(p_kind, ''))); v_code TEXT := LEFT(regexp_replace(public.fn_norm(COALESCE(NULLIF(trim(p_code), ''), p_label)), '[^a-z0-9]+', '_', 'g'), 40);
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    IF v_kind NOT IN ('CATEGORY', 'UNIT', 'ATTRIBUTE', 'LOCATION') THEN RAISE EXCEPTION 'Tipo de item inválido.'; END IF;
    IF v_kind = 'LOCATION' THEN v_code := upper(trim(p_code)); IF v_code NOT IN ('LOJA', 'ARMAZEM', 'PATIO') THEN RAISE EXCEPTION 'Local inválido.'; END IF; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_types WHERE id = upper(p_type)) THEN RAISE EXCEPTION 'Sector não encontrado.'; END IF;
    IF pg_column_size(COALESCE(p_data, '{}'::JSONB)) > 4000 THEN RAISE EXCEPTION 'Dados demasiado grandes.'; END IF;
    IF COALESCE(p_delete, FALSE) THEN
        IF v_kind = 'LOCATION' THEN RAISE EXCEPTION 'Os 3 locais não se removem.'; END IF;
        DELETE FROM public.business_type_presets WHERE business_type_id = upper(p_type) AND kind = v_kind AND code = v_code;
    ELSE
        IF NULLIF(TRIM(COALESCE(p_label, '')), '') IS NULL THEN RAISE EXCEPTION 'Indique o nome.'; END IF;
        INSERT INTO public.business_type_presets (business_type_id, kind, code, label, data, sort_order)
        VALUES (upper(p_type), v_kind, v_code, LEFT(TRIM(p_label), 80), COALESCE(p_data, '{}'::JSONB), COALESCE(p_sort, 0))
        ON CONFLICT (business_type_id, kind, code) DO UPDATE SET label = EXCLUDED.label, data = EXCLUDED.data, sort_order = EXCLUDED.sort_order;
    END IF;
    RETURN jsonb_build_object('success', TRUE);
END $$;
REVOKE ALL ON FUNCTION public.fn_admin_save_preset(TEXT, TEXT, TEXT, TEXT, JSONB, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_save_preset(TEXT, TEXT, TEXT, TEXT, JSONB, INT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. CADASTRO DE LOJAS COM TIPO DE NEGÓCIO OBRIGATÓRIO (corpo igual ao anterior + 1 parâmetro e o carregamento do sector)
--    As assinaturas antigas são removidas: um cliente desactualizado recebe «tipo de negócio obrigatório».
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_admin_create_store(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION public.fn_admin_create_store(
    p_name TEXT, p_trade_name TEXT, p_owner_name TEXT, p_phone TEXT, p_city TEXT, p_province TEXT, p_address TEXT,
    p_nuit_nif TEXT, p_email TEXT, p_currency TEXT, p_language TEXT, p_monthly_fee NUMERIC, p_trial_days INT,
    p_admin_email TEXT, p_admin_password TEXT, p_admin_name TEXT,
    p_ambassador_id TEXT DEFAULT NULL, p_contract_months INT DEFAULT 12, p_business_type TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp AS $$
DECLARE v_store_id TEXT; v_code TEXT; v_uid UUID; v_amb public.ambassadors%ROWTYPE; v_days INT := COALESCE(p_trial_days, 30); v_bt TEXT := public.fn_validate_business_type(p_business_type);
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    IF NULLIF(TRIM(COALESCE(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Nome da loja é obrigatório.'; END IF;
    IF NULLIF(TRIM(COALESCE(p_phone, '')), '') IS NULL THEN RAISE EXCEPTION 'Telefone é obrigatório.'; END IF;
    IF NULLIF(TRIM(COALESCE(p_city, '')), '') IS NULL THEN RAISE EXCEPTION 'Cidade é obrigatória.'; END IF;
    IF NOT public.fn_valid_currency(p_currency) THEN RAISE EXCEPTION 'Seleccione a moeda da loja.'; END IF;
    IF NOT public.fn_valid_language(p_language) THEN RAISE EXCEPTION 'Seleccione o idioma da loja.'; END IF;
    IF COALESCE(p_monthly_fee, 0) < 0 THEN RAISE EXCEPTION 'Mensalidade inválida.'; END IF;
    IF v_days < 0 OR v_days > 3650 THEN RAISE EXCEPTION 'Período inicial inválido.'; END IF;
    IF NULLIF(TRIM(COALESCE(p_admin_email, '')), '') IS NULL OR p_admin_password IS NULL THEN RAISE EXCEPTION 'Indique email e palavra-passe do administrador da loja.'; END IF;

    IF NULLIF(TRIM(COALESCE(p_ambassador_id, '')), '') IS NOT NULL THEN
        SELECT * INTO v_amb FROM public.ambassadors WHERE id = p_ambassador_id AND deleted_at IS NULL;
        IF v_amb.id IS NULL OR COALESCE(v_amb.status, 'ATIVO') <> 'ATIVO' THEN RAISE EXCEPTION 'O embaixador escolhido não existe ou não está activo.'; END IF;
    END IF;

    v_store_id := 'store-' || SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 16);
    v_code := 'LJ-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8));

    INSERT INTO public.stores (id, code, name, trade_name, nuit_nif, city, province, address, phone, email, currency, language,
                               is_headquarters, valor_mensalidade, data_inicio_teste, data_fim_teste, acesso_ativo)
    VALUES (v_store_id, v_code, TRIM(p_name), COALESCE(NULLIF(TRIM(COALESCE(p_trade_name, '')), ''), TRIM(p_name)),
            NULLIF(TRIM(COALESCE(p_nuit_nif, '')), ''), TRIM(p_city), NULLIF(TRIM(COALESCE(p_province, '')), ''),
            NULLIF(TRIM(COALESCE(p_address, '')), ''), TRIM(p_phone), NULLIF(TRIM(COALESCE(p_email, '')), ''), p_currency, p_language,
            FALSE, COALESCE(p_monthly_fee, 0), NOW(), CURRENT_DATE + v_days, TRUE);

    v_uid := public.fn_internal_create_store_user(p_admin_email, p_admin_password,
                COALESCE(NULLIF(TRIM(COALESCE(p_admin_name, '')), ''), NULLIF(TRIM(COALESCE(p_owner_name, '')), ''), TRIM(p_name)), 'ADMIN', v_store_id);

    IF v_amb.id IS NOT NULL THEN
        INSERT INTO public.ambassador_referred_stores (id, store_id, ambassador_id, name, owner_name, phone, city, monthly_fee, payment_status,
                                                       next_due_date, commission_rate, contract_duration_months, months_active, total_commission_earned)
        VALUES (v_store_id, v_store_id, v_amb.id, TRIM(p_name), COALESCE(NULLIF(TRIM(COALESCE(p_owner_name, '')), ''), TRIM(p_name)), TRIM(p_phone), TRIM(p_city),
                COALESCE(p_monthly_fee, 0), 'PENDENTE', CURRENT_DATE + v_days, COALESCE(v_amb.commission_rate, 15),
                COALESCE(NULLIF(p_contract_months, 0), 12), 0, 0);
    END IF;

    PERFORM public.fn__sector_unlock();
    UPDATE public.stores SET business_type = v_bt WHERE id = v_store_id;
    UPDATE public.ambassador_referred_stores SET business_type = v_bt WHERE id = v_store_id;
    PERFORM public.fn_apply_business_type(v_store_id);

    PERFORM public.fn_amb_audit('STORE_CREATED', v_amb.id, v_store_id, NULL,
        jsonb_build_object('name', TRIM(p_name), 'currency', p_currency, 'language', p_language, 'monthly_fee', COALESCE(p_monthly_fee, 0), 'ambassador', v_amb.id, 'admin_user', v_uid, 'business_type', v_bt));
    RETURN jsonb_build_object('success', TRUE, 'store_id', v_store_id, 'store_code', v_code, 'admin_user_id', v_uid);
END; $$;
REVOKE ALL ON FUNCTION public.fn_admin_create_store(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_create_store(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT, INT, TEXT) TO authenticated;
DROP FUNCTION IF EXISTS public.fn_ambassador_create_store(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_ambassador_create_store(
    p_ambassador_id TEXT,
    p_store_name TEXT,
    p_owner_name TEXT,
    p_phone TEXT,
    p_city TEXT,
    p_monthly_fee NUMERIC,
    p_contract_months INT,
    p_admin_email TEXT,
    p_admin_password TEXT,
    p_address TEXT DEFAULT NULL,
    p_nuit_nif TEXT DEFAULT NULL,
    p_business_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
    v_amb public.ambassadors%ROWTYPE;
    v_store_id TEXT;
    v_store_code TEXT;
    v_uid UUID;
    v_bt TEXT := public.fn_validate_business_type(p_business_type);
BEGIN
    v_amb := public.fn_ambassador_resolve(p_ambassador_id, TRUE);

    IF NULLIF(TRIM(p_store_name), '') IS NULL THEN RAISE EXCEPTION 'Nome da loja é obrigatório.'; END IF;
    IF NULLIF(TRIM(p_owner_name), '') IS NULL THEN RAISE EXCEPTION 'Nome do responsável é obrigatório.'; END IF;
    IF NULLIF(TRIM(p_phone), '') IS NULL THEN RAISE EXCEPTION 'Telefone é obrigatório.'; END IF;
    IF NULLIF(TRIM(p_city), '') IS NULL THEN RAISE EXCEPTION 'Cidade é obrigatória.'; END IF;
    IF COALESCE(p_monthly_fee, 0) < 0 THEN RAISE EXCEPTION 'Mensalidade inválida.'; END IF;

    v_store_id := 'store-' || SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 16);
    v_store_code := 'REF-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8));

    INSERT INTO public.stores (
        id, code, name, trade_name, nuit_nif, city, address, phone,
        currency, language, is_headquarters,
        valor_mensalidade, data_inicio_teste, data_fim_teste, acesso_ativo
    ) VALUES (
        v_store_id, v_store_code, TRIM(p_store_name), TRIM(p_store_name),
        NULLIF(TRIM(p_nuit_nif), ''), TRIM(p_city), NULLIF(TRIM(p_address), ''), TRIM(p_phone),
        COALESCE(v_amb.currency, 'MT'), COALESCE(v_amb.language, 'pt'), FALSE,
        COALESCE(p_monthly_fee, 0), NOW(), CURRENT_DATE + 30, TRUE
    );

    -- Administrador inicial da loja (definido pelo embaixador; a loja pode trocar a senha)
    v_uid := public.fn_internal_create_store_user(p_admin_email, p_admin_password, p_owner_name, 'ADMIN', v_store_id);

    INSERT INTO public.ambassador_referred_stores (
        id, store_id, ambassador_id, name, owner_name, phone, city,
        monthly_fee, payment_status, next_due_date,
        commission_rate, contract_duration_months, months_active, total_commission_earned
    ) VALUES (
        v_store_id, v_store_id, v_amb.id, TRIM(p_store_name), TRIM(p_owner_name), TRIM(p_phone), TRIM(p_city),
        COALESCE(p_monthly_fee, 0), 'PENDENTE', CURRENT_DATE + 30,
        COALESCE(v_amb.commission_rate, 15), COALESCE(NULLIF(p_contract_months, 0), 12), 0, 0
    );

    PERFORM public.fn__sector_unlock();
    UPDATE public.stores SET business_type = v_bt WHERE id = v_store_id;
    UPDATE public.ambassador_referred_stores SET business_type = v_bt WHERE id = v_store_id;
    PERFORM public.fn_apply_business_type(v_store_id);

    RETURN jsonb_build_object(
        'success', TRUE,
        'business_type', v_bt,
        'store_id', v_store_id,
        'store_code', v_store_code,
        'admin_user_id', v_uid,
        'admin_email', LOWER(TRIM(p_admin_email)),
        'commission_rate', COALESCE(v_amb.commission_rate, 15)
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_ambassador_create_store(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
DROP FUNCTION IF EXISTS public.fn_public_store_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.fn_public_store_signup(
    p_referral_code TEXT, p_store_name TEXT, p_owner_name TEXT, p_phone TEXT, p_address TEXT, p_password TEXT,
    p_city TEXT DEFAULT NULL, p_nuit_nif TEXT DEFAULT NULL, p_monthly_fee NUMERIC DEFAULT 0,
    p_marketing_email TEXT DEFAULT NULL, p_email_optin BOOLEAN DEFAULT FALSE,
    p_business_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp AS $$
DECLARE
    v_amb public.ambassadors%ROWTYPE;
    v_login TEXT := public.fn_login_email(p_phone);
    v_digits TEXT := REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_mail TEXT := NULLIF(LOWER(TRIM(COALESCE(p_marketing_email, ''))), '');
    v_ip TEXT := public.fn_client_ip();
    v_store_id TEXT; v_code TEXT; v_uid UUID; v_old auth.users%ROWTYPE; v_city TEXT; v_bt TEXT := public.fn_validate_business_type(p_business_type);
BEGIN
    -- validações (mensagens curtas, sem revelar nada interno)
    IF char_length(TRIM(COALESCE(p_store_name, ''))) < 2 THEN RAISE EXCEPTION 'Indique o nome da loja.'; END IF;
    IF char_length(TRIM(COALESCE(p_owner_name, ''))) < 2 THEN RAISE EXCEPTION 'Indique o seu nome.'; END IF;
    IF v_login IS NULL OR POSITION('@' IN COALESCE(p_phone, '')) > 0 THEN RAISE EXCEPTION 'Indique um contacto (telemóvel) válido.'; END IF;
    IF char_length(TRIM(COALESCE(p_address, ''))) < 3 THEN RAISE EXCEPTION 'Indique o endereço.'; END IF;
    IF p_password IS NULL OR char_length(p_password) < 8 OR char_length(p_password) > 128 THEN RAISE EXCEPTION 'A palavra-passe deve ter pelo menos 8 caracteres.'; END IF;
    IF p_password ~ '^(.)\1+$' OR REGEXP_REPLACE(p_password, '[^0-9]', '', 'g') = v_digits THEN RAISE EXCEPTION 'Escolha uma palavra-passe mais segura (não use o telemóvel nem caracteres repetidos).'; END IF;
    IF v_mail IS NOT NULL AND (v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR char_length(v_mail) > 120) THEN RAISE EXCEPTION 'Email inválido (pode deixá-lo em branco).'; END IF;

    SELECT * INTO v_amb FROM public.ambassadors
     WHERE UPPER(TRIM(referral_code)) = UPPER(TRIM(p_referral_code))
       AND COALESCE(status, CASE WHEN active THEN 'ATIVO' ELSE 'DESATIVADO' END) = 'ATIVO' LIMIT 1;
    IF v_amb.id IS NULL THEN RAISE EXCEPTION 'Link de embaixador inválido ou inativo.'; END IF;

    -- limites generosos (muitos utilizadores partilham o mesmo IP de operadora móvel): travam só abuso real
    IF v_ip <> 'unknown' AND NOT public.fn_rl_hit('ip:' || v_ip, 'store_signup', 300, 3600) THEN   -- sem IP identificável: não limita (nunca juntar todos num só balde)
        RAISE EXCEPTION 'Demasiadas tentativas deste dispositivo. Tente novamente dentro de alguns minutos.'; END IF;
    IF NOT public.fn_rl_hit('ph:' || v_login, 'store_signup', 20, 86400) THEN RAISE EXCEPTION 'Demasiadas tentativas com este telemóvel. Tente novamente mais tarde.'; END IF;

    -- só pedidos do MESMO telemóvel esperam uns pelos outros (microssegundos); todos os outros correm em paralelo
    PERFORM pg_advisory_xact_lock(hashtextextended('login:' || v_login, 0));

    -- pedido repetido (duplo clique, falha de rede, voltar a enviar): se o telemóvel+palavra-passe coincidem, devolve o mesmo resultado
    SELECT * INTO v_old FROM auth.users WHERE LOWER(email) = v_login LIMIT 1;
    IF v_old.id IS NOT NULL THEN
        IF v_old.encrypted_password = crypt(p_password, v_old.encrypted_password) THEN
            RETURN jsonb_build_object('success', TRUE, 'already', TRUE, 'admin_user_id', v_old.id,
                                      'store_id', (SELECT store_id FROM public.profiles WHERE id = v_old.id));
        END IF;
        RAISE EXCEPTION 'Já existe uma conta com este telemóvel. Use «Entrar».';
    END IF;

    v_store_id := 'store-' || SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 16);
    v_code := 'REF-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8));
    v_city := COALESCE(NULLIF(TRIM(COALESCE(p_city, '')), ''), LEFT(TRIM(p_address), 60));   -- cidade é opcional: usa o endereço

    INSERT INTO public.stores (id, code, name, trade_name, nuit_nif, city, address, phone, email, currency, language, is_headquarters,
                               valor_mensalidade, data_inicio_teste, data_fim_teste, acesso_ativo)
    VALUES (v_store_id, v_code, TRIM(p_store_name), TRIM(p_store_name), NULLIF(TRIM(COALESCE(p_nuit_nif, '')), ''), v_city,
            TRIM(p_address), LEFT(TRIM(p_phone), 30), v_mail, 'MT', 'pt', FALSE,
            GREATEST(COALESCE(p_monthly_fee, 0), 0), NOW(), CURRENT_DATE + 30, TRUE);

    v_uid := public.fn_internal_create_store_user(p_phone, p_password, TRIM(p_owner_name), 'ADMIN', v_store_id);
    UPDATE public.profiles SET contact_email = v_mail, email_optin = (v_mail IS NOT NULL AND COALESCE(p_email_optin, FALSE)) WHERE id = v_uid;

    INSERT INTO public.ambassador_referred_stores (id, store_id, ambassador_id, name, owner_name, phone, city, monthly_fee, payment_status, next_due_date,
                                                   commission_rate, contract_duration_months, months_active, total_commission_earned)
    VALUES (v_store_id, v_store_id, v_amb.id, TRIM(p_store_name), TRIM(p_owner_name), LEFT(TRIM(p_phone), 30), v_city,
            GREATEST(COALESCE(p_monthly_fee, 0), 0), 'PENDENTE', CURRENT_DATE + 30, COALESCE(v_amb.commission_rate, 15), 12, 0, 0);

    PERFORM public.fn__sector_unlock();
    UPDATE public.stores SET business_type = v_bt WHERE id = v_store_id;
    UPDATE public.ambassador_referred_stores SET business_type = v_bt WHERE id = v_store_id;
    PERFORM public.fn_apply_business_type(v_store_id);

    RETURN jsonb_build_object('success', TRUE, 'store_id', v_store_id, 'admin_user_id', v_uid, 'business_type', v_bt);
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma conta com este telemóvel. Use «Entrar».';
END $$;
GRANT EXECUTE ON FUNCTION public.fn_public_store_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. CRIAÇÃO DE UTILIZADORES COM AUTENTICAÇÃO REAL (Edge Function create-store-user)
--    A função de borda valida o chamador com o JWT dele (fn_user_creation_scope), cria o utilizador no Supabase Auth
--    (admin API) e finaliza o perfil (fn_user_finalize, só service_role). A Service Role Key nunca sai do servidor.
-- ------------------------------------------------------------------------------
-- Âmbito do actor: SUPERADMIN = qualquer loja; SUPER EMBAIXADOR = lojas da sua rede; EMBAIXADOR = lojas directamente vinculadas.
-- Perfis que se podem criar: ADMIN, GERENTE, CASHIER, ESTOQUISTA, LOGISTA, MARKETING (nunca SUPERADMIN nem EMBAIXADOR).
CREATE OR REPLACE FUNCTION public.fn__creation_scope(p_actor UUID, p_store TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT; v_store TEXT; a public.ambassadors%ROWTYPE; v_kind TEXT;
        v_roles JSONB := '["ADMIN","GERENTE","CASHIER","ESTOQUISTA","LOGISTA","MARKETING"]'::JSONB;
BEGIN
    SELECT role INTO v_role FROM public.profiles WHERE id = p_actor AND COALESCE(active, TRUE);
    IF v_role IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
    SELECT COALESCE(rs.store_id, rs.id) INTO v_store FROM public.ambassador_referred_stores rs WHERE rs.id = p_store OR rs.store_id = p_store LIMIT 1;
    v_store := COALESCE(v_store, p_store);
    IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_store) THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
    IF v_role = 'SUPERADMIN' THEN
        RETURN jsonb_build_object('actor_kind', 'SUPERADMIN', 'store_id', v_store, 'allowed_roles', v_roles);
    END IF;
    IF v_role <> 'EMBAIXADOR' THEN RAISE EXCEPTION 'O seu perfil não pode criar utilizadores por este mecanismo.'; END IF;
    SELECT * INTO a FROM public.ambassadors WHERE user_id = p_actor AND deleted_at IS NULL LIMIT 1;
    IF a.id IS NULL OR COALESCE(a.status, 'ATIVO') <> 'ATIVO' THEN RAISE EXCEPTION 'A sua conta de embaixador não está activa.'; END IF;
    IF NOT COALESCE(a.can_create_store_users, TRUE) THEN RAISE EXCEPTION 'O Super Admin não autorizou a criação de utilizadores para este perfil.'; END IF;
    IF EXISTS (SELECT 1 FROM public.ambassador_referred_stores rs WHERE COALESCE(rs.store_id, rs.id) = v_store AND rs.ambassador_id = a.id AND COALESCE(rs.users_authorized, TRUE)) THEN
        v_kind := CASE WHEN COALESCE(a.is_super, FALSE) THEN 'SUPER_EMBAIXADOR' ELSE 'EMBAIXADOR' END;
    ELSIF COALESCE(a.is_super, FALSE) AND EXISTS (
            SELECT 1 FROM public.ambassador_referred_stores rs JOIN public.ambassadors o ON o.id = rs.ambassador_id
             WHERE COALESCE(rs.store_id, rs.id) = v_store AND o.parent_ambassador_id = a.id AND o.deleted_at IS NULL AND COALESCE(rs.users_authorized, TRUE)) THEN
        v_kind := 'SUPER_EMBAIXADOR';
    ELSE
        RAISE EXCEPTION 'Esta loja não pertence ao seu âmbito ou não está autorizada.';
    END IF;
    RETURN jsonb_build_object('actor_kind', v_kind, 'store_id', v_store, 'allowed_roles', v_roles);
END $$;
REVOKE ALL ON FUNCTION public.fn__creation_scope(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_user_creation_scope(p_store_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão não autenticada.'; END IF;
    RETURN public.fn__creation_scope(auth.uid(), p_store_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_user_creation_scope(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_user_creation_scope(TEXT) TO authenticated;

-- Só a Edge Function (service_role) chama esta função; revalida o âmbito por defesa em profundidade.
CREATE OR REPLACE FUNCTION public.fn_user_finalize(p_actor UUID, p_user_id UUID, p_store_id TEXT, p_role TEXT, p_full_name TEXT, p_phone TEXT, p_contact_email TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_scope JSONB; v_role TEXT := upper(trim(COALESCE(p_role, '')));
BEGIN
    v_scope := public.fn__creation_scope(p_actor, p_store_id);
    IF NOT (v_scope -> 'allowed_roles') ? v_role THEN RAISE EXCEPTION 'Perfil não permitido: %', v_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'Utilizador de autenticação não encontrado.'; END IF;
    UPDATE public.profiles SET email = (SELECT email FROM auth.users WHERE id = p_user_id), full_name = LEFT(TRIM(p_full_name), 120), role = v_role,
           store_id = v_scope ->> 'store_id', active = TRUE, phone = NULLIF(LEFT(TRIM(COALESCE(p_phone, '')), 30), ''),
           contact_email = NULLIF(LEFT(TRIM(COALESCE(p_contact_email, '')), 120), ''), updated_at = NOW()
     WHERE id = p_user_id;
    IF NOT FOUND THEN
        INSERT INTO public.profiles (id, email, full_name, role, store_id, active, phone, contact_email)
        VALUES (p_user_id, (SELECT email FROM auth.users WHERE id = p_user_id), LEFT(TRIM(p_full_name), 120), v_role, v_scope ->> 'store_id', TRUE,
                NULLIF(LEFT(TRIM(COALESCE(p_phone, '')), 30), ''), NULLIF(LEFT(TRIM(COALESCE(p_contact_email, '')), 120), ''));
    END IF;
    INSERT INTO public.user_creation_audit (actor_id, actor_kind, store_id, new_user_id, role) VALUES (p_actor, v_scope ->> 'actor_kind', v_scope ->> 'store_id', p_user_id, v_role);
    RETURN jsonb_build_object('success', TRUE, 'store_id', v_scope ->> 'store_id', 'role', v_role);
END $$;
REVOKE ALL ON FUNCTION public.fn_user_finalize(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_finalize(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Super Admin: autorizar / retirar a criação de utilizadores a um embaixador (ou só a uma loja dele)
CREATE OR REPLACE FUNCTION public.fn_admin_set_user_creation_auth(p_ambassador_id TEXT, p_enabled BOOLEAN, p_store_id TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    IF NULLIF(p_store_id, '') IS NULL THEN
        UPDATE public.ambassadors SET can_create_store_users = COALESCE(p_enabled, TRUE) WHERE id = p_ambassador_id;
    ELSE
        UPDATE public.ambassador_referred_stores SET users_authorized = COALESCE(p_enabled, TRUE)
         WHERE ambassador_id = p_ambassador_id AND COALESCE(store_id, id) = p_store_id;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registo não encontrado.'; END IF;
    PERFORM public.fn_amb_audit('USER_CREATION_AUTH', p_ambassador_id, p_store_id, NULL, jsonb_build_object('enabled', COALESCE(p_enabled, TRUE)));
    RETURN jsonb_build_object('success', TRUE);
END $$;
REVOKE ALL ON FUNCTION public.fn_admin_set_user_creation_auth(TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_user_creation_auth(TEXT, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- VERIFICAÇÃO (opcional, depois de executar):
--   SELECT business_type, COUNT(*) FROM public.stores GROUP BY 1;                 -- lojas existentes = FERRAGENS
--   SELECT COUNT(*) FROM public.business_types;                                    -- 36
--   SELECT kind, COUNT(*) FROM public.business_type_presets GROUP BY 1;
--   SELECT proname FROM pg_proc WHERE proname IN ('fn_store_sector_config','fn_user_finalize','fn_apply_business_type');
-- ------------------------------------------------------------------------------
