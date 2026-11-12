-- ==============================================================================
-- GEF | MIGRAÇÃO v24 — TEMAS POR LOJA (Super Admin) + MARKETING VALIDA PAGAMENTOS
-- Executar no Supabase → SQL Editor, DEPOIS da v22. Idempotente: pode repetir sem efeitos duplicados.
--
--  1. Marketing & Vendas pode VALIDAR / RECUSAR pagamentos (fn_store_order_set_payment, v22 → v24).
--     Só PAGO / REJEITADO; não repõe nem altera outros estados. Admin/Gerente mantêm tudo.
--  2. Gestão de temas por loja, exclusiva do SUPER ADMIN:
--       vstore_themes.restricted ......... tema que só existe para lojas com atribuição do Super Admin
--       stores.vstore_theme_grant ........ tema restrito ATRIBUÍDO à loja (NULL = «Tema Padrão», sem atribuição)
--       stores.vstore_theme .............. tema ACTIVO na loja online (continua a ser escolhido pelo Admin na Personalização)
--     A atribuição NÃO altera a loja online. O Admin decide em «Loja virtual → Personalização».
--     Remover a atribuição repõe o tema «classico» (o padrão actual) na loja.
--  3. Novos temas no futuro: ver o fim deste ficheiro (basta 1 INSERT + 1 ficheiro CSS).
--  Nada é apagado; temas, RLS e funções existentes mantêm-se.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. MARKETING VALIDA PAGAMENTOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_store_order_set_payment(p_order_id TEXT, p_payment_status TEXT, p_note TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'MARKETING']); o public.web_orders%ROWTYPE; c public.store_customers%ROWTYPE; v_name TEXT;
        v_ids JSONB := '[]'::JSONB; v_ch TEXT; v_cid UUID; v_ok BOOLEAN; v_title TEXT; v_msg TEXT; v_note TEXT := NULLIF(LEFT(TRIM(COALESCE(p_note, '')), 300), '');
BEGIN
    IF p_payment_status NOT IN ('NAO_PAGO', 'COMPROVATIVO_ENVIADO', 'PAGO', 'REJEITADO') THEN RAISE EXCEPTION 'Estado de pagamento inválido.'; END IF;
    -- v24: o Marketing valida ou recusa; não repõe nem altera para outros estados (isso fica com Admin/Gerente)
    IF public.get_auth_user_role() = 'MARKETING' AND p_payment_status NOT IN ('PAGO', 'REJEITADO') THEN RAISE EXCEPTION 'O Marketing só pode validar ou recusar pagamentos.'; END IF;
    PERFORM public.fn_rate_limit('payset:' || auth.uid()::TEXT, 300, 600);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND store_id = v_store FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    IF o.payment_status = p_payment_status AND v_note IS NOT DISTINCT FROM o.payment_note THEN
        RETURN jsonb_build_object('success', TRUE, 'changed', FALSE, 'campaigns', '[]'::JSONB, 'has_account', o.customer_id IS NOT NULL, 'phone', o.phone, 'message', '');
    END IF;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    UPDATE public.web_orders SET payment_status = p_payment_status, payment_note = CASE WHEN p_payment_status = 'REJEITADO' THEN v_note END,
           payment_reviewed_at = NOW(), payment_reviewed_by_name = v_name, updated_at = NOW() WHERE id = o.id;
    IF p_payment_status = 'PAGO' THEN
        v_title := 'Pagamento validado'; v_msg := 'O pagamento da sua encomenda ' || o.code || ' foi validado. Obrigado!';
    ELSIF p_payment_status = 'REJEITADO' THEN
        v_title := 'Pagamento recusado'; v_msg := 'O pagamento da sua encomenda ' || o.code || ' foi recusado.' || COALESCE(' Motivo: ' || v_note || '.', '') || ' Envie um novo comprovativo ou contacte a loja.';
    END IF;
    IF v_title IS NOT NULL AND o.customer_id IS NOT NULL THEN
        SELECT * INTO c FROM public.store_customers WHERE id = o.customer_id;
        PERFORM public.fn_notify_inapp(v_store, c.id, v_title, v_msg, NULL, 'PAYMENT', o.id, NULL);
        FOREACH v_ch IN ARRAY ARRAY['WHATSAPP', 'EMAIL'] LOOP
            v_ok := COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = v_ch), FALSE)
                AND CASE v_ch WHEN 'WHATSAPP' THEN c.whatsapp IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_integrations WHERE store_id = v_store AND wa_phone_number_id IS NOT NULL AND wa_template_name IS NOT NULL)
                              ELSE c.email IS NOT NULL END;
            IF v_ok THEN
                v_cid := NULL;
                INSERT INTO public.campaigns (store_id, channel, title, body, url, audience, idempotency_key, kind, order_id)
                VALUES (v_store, v_ch, v_title, v_msg, NULL, '{}'::JSONB, 'pay:' || o.id || ':' || p_payment_status || ':' || v_ch || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MI'), 'PAYMENT', o.id)
                ON CONFLICT (store_id, idempotency_key) DO NOTHING RETURNING id INTO v_cid;
                IF v_cid IS NOT NULL THEN
                    INSERT INTO public.campaign_recipients (campaign_id, customer_id) VALUES (v_cid, c.id);
                    v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_cid, 'channel', v_ch));
                END IF;
            END IF;
        END LOOP;
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'changed', TRUE, 'campaigns', v_ids, 'has_account', o.customer_id IS NOT NULL, 'phone', o.phone, 'message', COALESCE(v_msg, ''));
END; $$;
REVOKE ALL ON FUNCTION public.fn_store_order_set_payment(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_store_order_set_payment(TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. TEMAS POR LOJA
-- ------------------------------------------------------------------------------
ALTER TABLE public.vstore_themes ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.vstore_themes ADD COLUMN IF NOT EXISTS description TEXT;

INSERT INTO public.vstore_themes (id, name, sort_order, enabled, restricted, description)
VALUES ('liquid_glass', 'Liquid Glass Premium', 50, TRUE, TRUE, 'Vidro translúcido com desfoque, brilho suave e cantos arredondados.')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, restricted = TRUE, description = EXCLUDED.description;   -- não mexe em «enabled»

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS vstore_theme_grant TEXT REFERENCES public.vstore_themes(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS vstore_theme_grant_by UUID;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS vstore_theme_grant_at TIMESTAMPTZ;

-- Tema efectivo: um tema restrito só conta se estiver atribuído à loja; caso contrário, o padrão actual («classico»).
CREATE OR REPLACE FUNCTION public.fn_vstore_effective_theme(p_theme TEXT, p_grant TEXT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT t.id FROM public.vstore_themes t WHERE t.id = p_theme AND t.enabled AND (NOT t.restricted OR t.id = p_grant)), 'classico');
$$;
REVOKE ALL ON FUNCTION public.fn_vstore_effective_theme(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vstore_effective_theme(TEXT, TEXT) TO authenticated;

-- Protecção contra API directa: o ADMIN da loja tem UPDATE em stores (RLS da v1), por isso o trigger impede que
-- altere a atribuição e que ponha um tema restrito sem atribuição. (Só SUPERADMIN, ou o SQL Editor/serviço, passam.)
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
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_protect_vstore_fields ON public.stores;
CREATE TRIGGER trg_protect_vstore_fields BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.fn_protect_vstore_fields();

-- Super Admin: ver as opções e a atribuição actual de UMA loja
CREATE OR REPLACE FUNCTION public.fn_admin_store_theme_info(p_store_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    SELECT * INTO s FROM public.stores WHERE id = p_store_id;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
    RETURN jsonb_build_object('store_id', s.id, 'store_name', COALESCE(s.trade_name, s.name), 'grant', s.vstore_theme_grant,
        'active', public.fn_vstore_effective_theme(s.vstore_theme, s.vstore_theme_grant), 'granted_at', s.vstore_theme_grant_at,
        'themes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'description', t.description) ORDER BY t.sort_order)
                              FROM public.vstore_themes t WHERE t.restricted AND t.enabled), '[]'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.fn_admin_store_theme_info(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_store_theme_info(TEXT) TO authenticated;

-- Super Admin: atribuir «Tema Padrão» (p_theme NULL / '' / 'padrao') ou um tema restrito (ex.: 'liquid_glass') a UMA loja.
-- Atribuir NÃO muda o tema que a loja online mostra: o Administrador da loja aplica-o na Personalização.
-- Remover (voltar ao Padrão) ou trocar por outro tema restrito repõe de imediato o tema «classico» se a loja estava a usar o anterior.
CREATE OR REPLACE FUNCTION public.fn_admin_set_store_theme(p_store_id TEXT, p_theme TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; v_theme TEXT := NULLIF(lower(TRIM(COALESCE(p_theme, ''))), ''); v_reverted BOOLEAN := FALSE; v_cur_restricted BOOLEAN;
BEGIN
    IF NOT public.fn_is_superadmin() THEN RAISE EXCEPTION 'Acesso reservado ao Super Administrador.'; END IF;
    SELECT * INTO s FROM public.stores WHERE id = p_store_id FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
    IF v_theme = 'padrao' THEN v_theme := NULL; END IF;
    IF v_theme IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vstore_themes WHERE id = v_theme AND restricted AND enabled) THEN
        RAISE EXCEPTION 'Tema não disponível para atribuição.';
    END IF;
    -- se a loja estava a usar um tema restrito diferente do novo (ou nenhum), repõe o padrão: nada fica «escondido» à espera de reaparecer
    SELECT COALESCE(t.restricted, FALSE) INTO v_cur_restricted FROM public.vstore_themes t WHERE t.id = s.vstore_theme;
    IF COALESCE(v_cur_restricted, FALSE) AND s.vstore_theme IS DISTINCT FROM v_theme THEN v_reverted := TRUE; END IF;
    UPDATE public.stores
       SET vstore_theme_grant = v_theme,
           vstore_theme_grant_by = CASE WHEN v_theme IS NULL THEN NULL ELSE auth.uid() END,
           vstore_theme_grant_at = CASE WHEN v_theme IS NULL THEN NULL ELSE NOW() END,
           vstore_theme = CASE WHEN v_reverted THEN 'classico' ELSE vstore_theme END,
           updated_at = NOW()
     WHERE id = s.id;
    PERFORM public.fn_amb_audit('STORE_THEME_ASSIGNED', NULL, s.id, NULL, jsonb_build_object('from', s.vstore_theme_grant, 'to', v_theme, 'active_reverted', v_reverted));
    RETURN jsonb_build_object('success', TRUE, 'grant', v_theme, 'active_reverted', v_reverted);
END; $$;
REVOKE ALL ON FUNCTION public.fn_admin_set_store_theme(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_store_theme(TEXT, TEXT) TO authenticated;

-- Funções existentes, agora cientes da atribuição (corpo igual ao anterior, com a regra de tema acrescentada)

CREATE OR REPLACE FUNCTION public.fn_vstore_my_info() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE;
BEGIN
    SELECT * INTO s FROM public.stores WHERE id = public.get_auth_user_store_id();
    IF s.id IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
    RETURN jsonb_build_object('store_id', s.id, 'slug', s.slug, 'enabled', s.vstore_enabled, 'store_active', COALESCE(s.acesso_ativo, TRUE),
        'theme', public.fn_vstore_effective_theme(s.vstore_theme, s.vstore_theme_grant), 'config', s.vstore_config, 'max_images', public.fn_max_product_images(),
        'theme_grant', s.vstore_theme_grant,
        'themes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'premium', t.restricted) ORDER BY t.sort_order)
                              FROM public.vstore_themes t WHERE t.enabled AND (NOT t.restricted OR t.id = s.vstore_theme_grant)), '[]'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.fn_vstore_my_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vstore_my_info() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_public_store(p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; v_theme TEXT;
BEGIN
    SELECT * INTO s FROM public.stores WHERE slug = lower(TRIM(COALESCE(p_slug, '')));
    IF s.id IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'code', 'NOT_FOUND'); END IF;
    IF NOT s.vstore_enabled OR COALESCE(s.acesso_ativo, TRUE) = FALSE THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'DISABLED', 'name', COALESCE(s.trade_name, s.name));
    END IF;
    PERFORM public.fn_rate_limit('pstore:' || public.fn_client_ip(), 120, 60);
    v_theme := public.fn_vstore_effective_theme(s.vstore_theme, s.vstore_theme_grant);   -- v24: tema restrito só aparece se atribuído pelo Super Admin
    RETURN jsonb_build_object('ok', TRUE, 'slug', s.slug, 'name', COALESCE(s.trade_name, s.name), 'city', s.city, 'province', s.province,
        'address', s.address, 'phone', s.phone, 'email', s.email, 'currency', COALESCE(s.currency, 'MT'), 'language', COALESCE(s.language, 'pt'),
        'theme', COALESCE(v_theme, 'classico'), 'config', s.vstore_config,
        'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', c.category, 'count', c.n, 'subs', c.subs) ORDER BY c.category)
                                  FROM (SELECT p.category, COUNT(*) AS n,
                                               COALESCE((SELECT jsonb_agg(jsonb_build_object('name', t.subcategory, 'count', t.n) ORDER BY t.subcategory)
                                                           FROM (SELECT x.subcategory, COUNT(*) AS n FROM public.products x
                                                                  WHERE x.store_id = s.id AND x.published AND COALESCE(x.active, TRUE) AND x.category = p.category
                                                                    AND NULLIF(TRIM(COALESCE(x.subcategory, '')), '') IS NOT NULL GROUP BY x.subcategory) t), '[]'::JSONB) AS subs
                                          FROM public.products p WHERE p.store_id = s.id AND p.published AND COALESCE(p.active, TRUE) GROUP BY p.category) c
                                 WHERE NOT (COALESCE(s.vstore_config -> 'categories_hidden', '[]'::JSONB) ? c.category)), '[]'::JSONB));
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_public_store(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_vstore_save_config(p_theme TEXT, p_config JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); v_cfg JSONB; v_sections JSONB;
BEGIN
    -- v24: temas «restritos» (ex.: Liquid Glass) só podem ser escolhidos se o Super Admin os atribuiu a ESTA loja
    IF NOT EXISTS (SELECT 1 FROM public.vstore_themes t
                    WHERE t.id = p_theme AND t.enabled
                      AND (NOT t.restricted OR t.id = (SELECT s.vstore_theme_grant FROM public.stores s WHERE s.id = v_store))) THEN
        RAISE EXCEPTION 'Tema não disponível para esta loja.';
    END IF;
    SELECT COALESCE(jsonb_agg(x ORDER BY n), '[]'::JSONB) INTO v_sections
      FROM (SELECT x, n FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_config -> 'sections') = 'array' THEN p_config -> 'sections' ELSE '[]'::JSONB END) WITH ORDINALITY t(x, n)
             WHERE x IN ('promos', 'featured', 'categories', 'catalog') LIMIT 4) z;
    v_cfg := jsonb_strip_nulls(jsonb_build_object(
        'primary', CASE WHEN p_config ->> 'primary' ~ '^#[0-9A-Fa-f]{6}$' THEN p_config ->> 'primary' END,
        'accent', CASE WHEN p_config ->> 'accent' ~ '^#[0-9A-Fa-f]{6}$' THEN p_config ->> 'accent' END,
        'tagline', NULLIF(LEFT(TRIM(COALESCE(p_config ->> 'tagline', '')), 160), ''),
        'about', NULLIF(LEFT(TRIM(COALESCE(p_config ->> 'about', '')), 600), ''),
        'whatsapp', NULLIF(LEFT(regexp_replace(COALESCE(p_config ->> 'whatsapp', ''), '[^0-9]', '', 'g'), 20), ''),
        'logo_path', CASE WHEN COALESCE(p_config ->> 'logo_path', '') LIKE v_store || '/%' THEN p_config ->> 'logo_path' END,
        'hero_path', CASE WHEN COALESCE(p_config ->> 'hero_path', '') LIKE v_store || '/%' THEN p_config ->> 'hero_path' END,
        'bg_path', CASE WHEN COALESCE(p_config ->> 'bg_path', '') LIKE v_store || '/%' THEN p_config ->> 'bg_path' END,
        'sections', CASE WHEN jsonb_array_length(v_sections) > 0 THEN v_sections END,
        'categories_hidden', CASE WHEN jsonb_typeof(p_config -> 'categories_hidden') = 'array' THEN (SELECT jsonb_agg(LEFT(x, 60)) FROM (SELECT x FROM jsonb_array_elements_text(p_config -> 'categories_hidden') x LIMIT 50) q) END));
    UPDATE public.stores SET vstore_theme = p_theme, vstore_config = v_cfg, updated_at = NOW() WHERE id = v_store;
    RETURN jsonb_build_object('success', TRUE);
END; $$;
REVOKE ALL ON FUNCTION public.fn_vstore_save_config(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vstore_save_config(TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- COMO ADICIONAR UM TEMA NOVO NO FUTURO (sem mexer em funções nem no front-end):
--   1) criar  css/themes/<id>.css  com as regras limitadas a [data-theme=<id>] (modelo: css/themes/liquid_glass.css);
--   2) INSERT INTO public.vstore_themes (id, name, sort_order, enabled, restricted, description)
--      VALUES ('<id>', 'Nome do tema', 60, TRUE, TRUE, 'Descrição');   -- restricted = TRUE => só por atribuição do Super Admin
--                                                                        -- restricted = FALSE => qualquer loja pode escolher
--   O botão TEMA do Super Admin passa a listar o novo tema automaticamente.
--
-- VERIFICAÇÃO (opcional):
--   SELECT id, name, enabled, restricted FROM public.vstore_themes ORDER BY sort_order;
--   SELECT id, vstore_theme, vstore_theme_grant FROM public.stores;
-- ------------------------------------------------------------------------------
