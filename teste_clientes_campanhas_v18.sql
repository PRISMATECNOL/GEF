-- Teste no SQL Editor (como dono; ROLLBACK no fim). Depois de migracao_clientes_campanhas_v18.sql.
-- Cobre: consentimento por canal, grupos de público, destinatários únicos, PARAR por WhatsApp, estados de entrega, cliente sem consentimento nunca elegível.
BEGIN;
DO $$
DECLARE s TEXT; u1 UUID := gen_random_uuid(); u2 UUID := gen_random_uuid(); c1 UUID; c2 UUID; camp UUID; n INT;
BEGIN
    SELECT id INTO s FROM public.stores LIMIT 1; IF s IS NULL THEN RAISE EXCEPTION 'Sem loja para testar.'; END IF;
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES (u1, 't1_' || u1 || '@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'), (u2, 't2_' || u2 || '@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.store_customers (store_id, auth_user_id, name, whatsapp) VALUES (s, u1, 'Ana Conceição', '258840000001') RETURNING id INTO c1;
    INSERT INTO public.store_customers (store_id, auth_user_id, name, whatsapp) VALUES (s, u2, 'Bruno Sem Consentimento', '258840000002') RETURNING id INTO c2;
    INSERT INTO public.customer_consents (customer_id, channel, granted) VALUES (c1, 'WHATSAPP', TRUE);           -- c2 NÃO autorizou nada (como quem só instalou a app)
    INSERT INTO public.push_subscriptions (store_id, customer_id, endpoint, p256dh, auth, installed) VALUES (s, c2, 'https://push.test/' || c2, 'k', 'a', TRUE);
    SELECT COUNT(*) INTO n FROM public.fn_campaign_audience(s, 'WHATSAPP', '{"kind":"all"}'); IF n <> (SELECT COUNT(*) FROM public.customer_consents k JOIN public.store_customers c ON c.id = k.customer_id WHERE c.store_id = s AND k.channel = 'WHATSAPP' AND k.granted) THEN RAISE EXCEPTION 'FALHOU: público WhatsApp'; END IF;
    IF EXISTS (SELECT 1 FROM public.fn_campaign_audience(s, 'PUSH', '{"kind":"all"}') a WHERE a.customer_id = c2) THEN RAISE EXCEPTION 'FALHOU: instalar a app não pode dar consentimento'; END IF;
    IF EXISTS (SELECT 1 FROM public.fn_campaign_audience(s, 'WHATSAPP', '{"kind":"all"}') a WHERE a.customer_id = c2) THEN RAISE EXCEPTION 'FALHOU: cliente sem consentimento elegível'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fn_campaign_audience(s, 'WHATSAPP', '{"kind":"never"}') a WHERE a.customer_id = c1) THEN RAISE EXCEPTION 'FALHOU: grupo «nunca compraram»'; END IF;
    INSERT INTO public.campaigns (store_id, channel, title, body, idempotency_key) VALUES (s, 'WHATSAPP', 'T', 'Teste', 'idem-test-1') RETURNING id INTO camp;
    INSERT INTO public.campaign_recipients (campaign_id, customer_id) VALUES (camp, c1);
    BEGIN INSERT INTO public.campaign_recipients (campaign_id, customer_id) VALUES (camp, c1); RAISE EXCEPTION 'FALHOU: destinatário duplicado'; EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN INSERT INTO public.campaigns (store_id, channel, title, body, idempotency_key) VALUES (s, 'PUSH', 'T', 'Teste', 'idem-test-1'); RAISE EXCEPTION 'FALHOU: chave de idempotência repetida'; EXCEPTION WHEN unique_violation THEN NULL; END;
    PERFORM public.fn_campaign_claim_batch(camp, 10);
    PERFORM public.fn_campaign_mark(camp, c1, 'SENT', 'wamid.TEST', NULL);
    PERFORM public.fn_wa_status('wamid.TEST', 'DELIVERED'); PERFORM public.fn_wa_status('wamid.TEST', 'READ'); PERFORM public.fn_wa_status('wamid.TEST', 'DELIVERED');
    IF (SELECT status FROM public.campaign_recipients WHERE campaign_id = camp AND customer_id = c1) <> 'READ' THEN RAISE EXCEPTION 'FALHOU: estado não pode recuar de READ'; END IF;
    INSERT INTO public.store_integrations (store_id, wa_phone_number_id, wa_template_name) VALUES (s, 'PIDTEST1', 'tpl') ON CONFLICT (store_id) DO UPDATE SET wa_phone_number_id = 'PIDTEST1';
    IF public.fn_wa_optout('PIDTEST1', '+258 84 000 0001') <> 1 THEN RAISE EXCEPTION 'FALHOU: PARAR não retirou o consentimento'; END IF;
    IF EXISTS (SELECT 1 FROM public.fn_campaign_audience(s, 'WHATSAPP', '{"kind":"all"}') a WHERE a.customer_id = c1) THEN RAISE EXCEPTION 'FALHOU: após PARAR continua elegível'; END IF;
    RAISE NOTICE 'OK: consentimentos, grupos, unicidade, idempotência, estados WhatsApp e PARAR.';
END $$;
ROLLBACK;
