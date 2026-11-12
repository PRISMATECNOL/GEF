-- Teste no SQL Editor (corre como dono; faz ROLLBACK no fim — não deixa dados). Depois de migracao_promocoes_v16.sql.
BEGIN;
DO $$
DECLARE p public.products%ROWTYPE; a UUID; b UUID; r NUMERIC; sp NUMERIC;
BEGIN
    SELECT * INTO p FROM public.products WHERE sale_price > 10 AND COALESCE(active, TRUE) AND store_id IS NOT NULL LIMIT 1;
    IF p.id IS NULL THEN RAISE EXCEPTION 'Sem produto para testar.'; END IF; sp := p.sale_price;
    INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, 'T10', 'PERCENT', 10, NOW() - INTERVAL '1 h', NOW() + INTERVAL '1 h') RETURNING id INTO a;
    INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, 'T30', 'PERCENT', 30, NOW() - INTERVAL '1 h', NOW() + INTERVAL '1 h') RETURNING id INTO b;
    INSERT INTO public.promotion_items VALUES (a, p.id, p.store_id), (b, p.id, p.store_id);
    SELECT eff_price INTO r FROM public.fn_price_info(p);
    IF r <> ROUND(sp * 0.70, 2) THEN RAISE EXCEPTION 'FALHOU simultâneas: esperado menor preço (%), obtido %', ROUND(sp * 0.70, 2), r; END IF;
    UPDATE public.promotions SET ends_at = NOW() - INTERVAL '1 second', starts_at = NOW() - INTERVAL '2 h' WHERE id = b;   -- expirou
    SELECT eff_price INTO r FROM public.fn_price_info(p);
    IF r <> ROUND(sp * 0.90, 2) THEN RAISE EXCEPTION 'FALHOU expiração: esperado %, obtido %', ROUND(sp * 0.90, 2), r; END IF;
    UPDATE public.promotions SET status = 'CANCELLED' WHERE id = a;
    SELECT eff_price INTO r FROM public.fn_price_info(p);
    IF r <> sp THEN RAISE EXCEPTION 'FALHOU restauro do preço normal: %', r; END IF;
    BEGIN INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, 'X', 'PERCENT', 95, NOW(), NOW() + INTERVAL '1 h');
          RAISE EXCEPTION 'FALHOU: aceitou 95%%'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, 'Y', 'AMOUNT', 1, NOW(), NOW() - INTERVAL '1 h');
          RAISE EXCEPTION 'FALHOU: aceitou fim < início'; EXCEPTION WHEN check_violation THEN NULL; END;
    -- nome: aceita acentos/espaços; recusa vazio, 1 caractere e >80
    INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, 'Promoção de Verão – Ação Única', 'PERCENT', 5, NOW(), NOW() + INTERVAL '1 h');
    BEGIN INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, '   ', 'PERCENT', 5, NOW(), NOW() + INTERVAL '1 h'); RAISE EXCEPTION 'FALHOU: aceitou nome vazio'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, 'A', 'PERCENT', 5, NOW(), NOW() + INTERVAL '1 h'); RAISE EXCEPTION 'FALHOU: aceitou 1 caractere'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN INSERT INTO public.promotions (store_id, name, discount_type, discount_value, starts_at, ends_at) VALUES (p.store_id, REPEAT('ç', 81), 'PERCENT', 5, NOW(), NOW() + INTERVAL '1 h'); RAISE EXCEPTION 'FALHOU: aceitou 81 caracteres'; EXCEPTION WHEN check_violation THEN NULL; END;
    IF regexp_replace(BTRIM('  Black   Friday  ', E' \t\r\n'), '\s+', ' ', 'g') <> 'Black Friday' THEN RAISE EXCEPTION 'FALHOU normalização'; END IF;
    RAISE NOTICE 'OK: simultâneas (menor preço), expiração exacta, cancelamento, validações.';
END $$;
ROLLBACK;
