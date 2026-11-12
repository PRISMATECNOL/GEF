-- ==============================================================================
-- GEF | v22 — Notificações no aparelho SEM Edge Functions (só SQL)
-- Instalar depois da v21. Idempotente.
-- As campanhas «PUSH» e os avisos de pagamento / encomenda pronta passam a ser guardados em customer_notifications.
-- A app do cliente (instalada ou aberta/em segundo plano) vai buscá-los e mostra a notificação do sistema com som curto.
-- O cliente pode desativar a qualquer momento (consentimento PUSH): sem consentimento nada é entregue.
-- Email e WhatsApp continuam a usar as suas funções.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.customer_notifications (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
    title TEXT NOT NULL, body TEXT NOT NULL, url TEXT,
    kind TEXT NOT NULL DEFAULT 'PROMO', order_id TEXT, campaign_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cust_notif ON public.customer_notifications(customer_id, id DESC);
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;   -- sem políticas: só por funções

-- interna: só guarda se o cliente autorizou notificações
CREATE OR REPLACE FUNCTION public.fn_notify_inapp(p_store TEXT, p_customer UUID, p_title TEXT, p_body TEXT, p_url TEXT, p_kind TEXT, p_order TEXT, p_campaign UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = p_customer AND channel = 'PUSH'), FALSE) THEN RETURN FALSE; END IF;
    INSERT INTO public.customer_notifications (store_id, customer_id, title, body, url, kind, order_id, campaign_id) VALUES (p_store, p_customer, LEFT(p_title, 80), LEFT(p_body, 240), p_url, p_kind, p_order, p_campaign);
    RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION public.fn_notify_inapp(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- cliente: devolve as novas (e marca como entregues) + as últimas 30
CREATE OR REPLACE FUNCTION public.fn_customer_notifications(p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; v_ok BOOLEAN; v_new JSONB; v_items JSONB;
BEGIN
    c := public.fn_cust(p_slug);
    v_ok := COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = 'PUSH'), FALSE);
    WITH u AS (UPDATE public.customer_notifications n SET delivered_at = NOW()
                WHERE v_ok AND n.id IN (SELECT id FROM public.customer_notifications WHERE customer_id = c.id AND delivered_at IS NULL AND created_at > NOW() - INTERVAL '3 days' ORDER BY id LIMIT 10)
                RETURNING n.id, n.title, n.body, n.url, n.kind, n.created_at)
    SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.id), '[]'::JSONB) INTO v_new FROM u;
    SELECT COALESCE(jsonb_agg(to_jsonb(z) ORDER BY z.id DESC), '[]'::JSONB) INTO v_items
      FROM (SELECT id, title, body, url, kind, created_at FROM public.customer_notifications WHERE customer_id = c.id ORDER BY id DESC LIMIT 30) z;
    RETURN jsonb_build_object('enabled', v_ok, 'new', v_new, 'items', v_items);
END; $$;
REVOKE ALL ON FUNCTION public.fn_customer_notifications(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_notifications(TEXT) TO authenticated;

-- público das campanhas PUSH = quem autorizou (já não depende de subscrição push)
CREATE OR REPLACE FUNCTION public.fn_campaign_audience(p_store TEXT, p_channel TEXT, p_aud JSONB) RETURNS TABLE (customer_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind TEXT := COALESCE(p_aud ->> 'kind', 'all'); v_min INT := LEAST(GREATEST(COALESCE((p_aud ->> 'min_orders')::INT, 3), 1), 1000); v_days INT := LEAST(GREATEST(COALESCE((p_aud ->> 'days')::INT, 90), 1), 3650);
BEGIN
    IF v_kind NOT IN ('all', 'frequent', 'inactive', 'buyers', 'never', 'new') THEN RAISE EXCEPTION 'Grupo de clientes inválido.'; END IF;
    RETURN QUERY
    SELECT c.id FROM public.store_customers c
      JOIN public.customer_consents k ON k.customer_id = c.id AND k.channel = p_channel AND k.granted
      LEFT JOIN LATERAL (SELECT COUNT(*) AS n, MAX(w.created_at) AS last_order FROM public.web_orders w WHERE w.customer_id = c.id AND w.store_id = c.store_id AND w.status <> 'CANCELADA') o ON TRUE
     WHERE c.store_id = p_store
       AND (p_channel = 'PUSH'
            OR (p_channel = 'WHATSAPP' AND c.whatsapp IS NOT NULL)
            OR (p_channel = 'EMAIL' AND c.email IS NOT NULL AND c.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
       AND CASE v_kind WHEN 'frequent' THEN o.n >= v_min WHEN 'inactive' THEN o.n > 0 AND o.last_order < NOW() - (v_days || ' days')::INTERVAL
                       WHEN 'buyers' THEN o.n > 0 WHEN 'never' THEN o.n = 0 WHEN 'new' THEN c.created_at >= NOW() - (v_days || ' days')::INTERVAL ELSE TRUE END;
END; $$;
REVOKE ALL ON FUNCTION public.fn_campaign_audience(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- «Enviar» uma campanha PUSH: entrega a todos os destinatários que autorizam (sem Edge Function)
CREATE OR REPLACE FUNCTION public.fn_campaign_deliver_inapp(p_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'MARKETING', 'LOGISTA']); c public.campaigns%ROWTYPE; r RECORD; n INT := 0; s INT := 0;
BEGIN
    SELECT * INTO c FROM public.campaigns WHERE id = p_id AND store_id = v_store FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
    IF c.channel <> 'PUSH' THEN RAISE EXCEPTION 'Esta função é só para notificações no aparelho.'; END IF;
    IF public.get_auth_user_role() = 'LOGISTA' AND c.kind <> 'ORDER_READY' THEN RAISE EXCEPTION 'Sem permissão para esta operação.'; END IF;
    IF c.status NOT IN ('QUEUED', 'SENDING') THEN RAISE EXCEPTION 'Esta campanha já não pode ser enviada (estado: %).', c.status; END IF;
    FOR r IN SELECT customer_id FROM public.campaign_recipients WHERE campaign_id = c.id AND status IN ('PENDING', 'SENDING') LOOP
        IF public.fn_notify_inapp(v_store, r.customer_id, c.title, c.body, c.url, c.kind, c.order_id, c.id) THEN
            UPDATE public.campaign_recipients SET status = 'SENT', sent_at = NOW() WHERE campaign_id = c.id AND customer_id = r.customer_id; n := n + 1;
        ELSE
            UPDATE public.campaign_recipients SET status = 'SKIPPED', error = 'Sem autorização' WHERE campaign_id = c.id AND customer_id = r.customer_id; s := s + 1;
        END IF;
    END LOOP;
    UPDATE public.campaigns SET status = 'DONE', finished_at = NOW() WHERE id = c.id;
    RETURN jsonb_build_object('success', TRUE, 'sent', n, 'skipped', s, 'remaining', 0);
END; $$;
REVOKE ALL ON FUNCTION public.fn_campaign_deliver_inapp(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_campaign_deliver_inapp(UUID) TO authenticated;

-- Pagamento validado/recusado: notificação no aparelho directa (WhatsApp/Email continuam por campanha)
CREATE OR REPLACE FUNCTION public.fn_store_order_set_payment(p_order_id TEXT, p_payment_status TEXT, p_note TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); o public.web_orders%ROWTYPE; c public.store_customers%ROWTYPE; v_name TEXT;
        v_ids JSONB := '[]'::JSONB; v_ch TEXT; v_cid UUID; v_ok BOOLEAN; v_title TEXT; v_msg TEXT; v_note TEXT := NULLIF(LEFT(TRIM(COALESCE(p_note, '')), 300), '');
BEGIN
    IF p_payment_status NOT IN ('NAO_PAGO', 'COMPROVATIVO_ENVIADO', 'PAGO', 'REJEITADO') THEN RAISE EXCEPTION 'Estado de pagamento inválido.'; END IF;
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

-- Encomenda pronta para entrega: notificação no aparelho directa (igual à v19 nos restantes canais)
CREATE OR REPLACE FUNCTION public.fn_order_mark_ready(p_order_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'LOGISTA']); o public.web_orders%ROWTYPE; c public.store_customers%ROWTYPE; v_name TEXT; v_role TEXT := public.get_auth_user_role();
        v_ids JSONB := '[]'::JSONB; v_ch TEXT; v_cid UUID; v_msg TEXT; v_ok BOOLEAN;
BEGIN
    PERFORM public.fn_rate_limit('markready:' || auth.uid()::TEXT, 120, 600);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND store_id = v_store FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    IF o.status = 'CANCELADA' THEN RAISE EXCEPTION 'Encomenda cancelada.'; END IF;
    IF o.fulfillment = 'PRONTA' THEN RAISE EXCEPTION 'Esta encomenda já foi marcada como pronta.'; END IF;
    IF o.fulfillment <> 'LOGISTICA' THEN RAISE EXCEPTION 'Esta encomenda ainda não foi enviada para a logística.'; END IF;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    UPDATE public.web_orders SET fulfillment = 'PRONTA', ready_at = NOW(), ready_by = auth.uid(), ready_by_name = v_name, updated_at = NOW() WHERE id = o.id;
    INSERT INTO public.order_events (store_id, order_id, order_code, event, actor_id, actor_name, actor_role) VALUES (v_store, o.id, o.code, 'READY', auth.uid(), v_name, v_role);
    v_msg := 'A sua encomenda ' || o.code || ' está pronta para entrega.';
    IF o.customer_id IS NOT NULL THEN
        SELECT * INTO c FROM public.store_customers WHERE id = o.customer_id;
        PERFORM public.fn_notify_inapp(v_store, c.id, 'Encomenda pronta para entrega', v_msg, NULL, 'ORDER_READY', o.id, NULL);
        FOREACH v_ch IN ARRAY ARRAY['WHATSAPP', 'EMAIL'] LOOP
            v_ok := COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = v_ch), FALSE)
                AND CASE v_ch WHEN 'WHATSAPP' THEN c.whatsapp IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_integrations WHERE store_id = v_store AND wa_phone_number_id IS NOT NULL AND wa_template_name IS NOT NULL)
                              ELSE c.email IS NOT NULL END;
            IF v_ok THEN
                v_cid := NULL;
                INSERT INTO public.campaigns (store_id, channel, title, body, url, audience, idempotency_key, kind, order_id)
                VALUES (v_store, v_ch, 'Encomenda pronta para entrega', v_msg, NULL, '{}'::JSONB, 'ready:' || o.id || ':' || v_ch, 'ORDER_READY', o.id)
                ON CONFLICT (store_id, idempotency_key) DO NOTHING RETURNING id INTO v_cid;
                IF v_cid IS NOT NULL THEN
                    INSERT INTO public.campaign_recipients (campaign_id, customer_id) VALUES (v_cid, c.id);
                    v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_cid, 'channel', v_ch));
                END IF;
            END IF;
        END LOOP;
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'campaigns', v_ids, 'has_account', o.customer_id IS NOT NULL, 'phone', o.phone, 'message', v_msg);
END; $$;
REVOKE ALL ON FUNCTION public.fn_order_mark_ready(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_order_mark_ready(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
