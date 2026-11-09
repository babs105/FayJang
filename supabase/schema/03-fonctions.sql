CREATE OR REPLACE FUNCTION public.jwt_role_app() RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role_app' $$;

CREATE OR REPLACE FUNCTION public.jwt_ecole_id() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt() ->> 'ecole_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION public.jwt_parent_id() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt() ->> 'parent_id', '')::uuid $$;

-- Tentatives : 5 échecs (ou le seuil donné) en 15 minutes bloquent la clé 15 minutes (erreur FJ429)
CREATE OR REPLACE FUNCTION public.controler_tentatives(p_cle TEXT)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.tentatives_connexion WHERE cle = p_cle AND bloque_jusqu_a > now()) THEN
        RAISE EXCEPTION 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' USING ERRCODE = 'FJ429';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.controler_tentatives(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.controler_tentatives(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.noter_echec_plafonne(p_cle TEXT, p_seuil INTEGER)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM public.tentatives_connexion
    WHERE cle IN (
        SELECT cle FROM public.tentatives_connexion
        WHERE premier_echec_at < now() - interval '1 day'
          AND (bloque_jusqu_a IS NULL OR bloque_jusqu_a < now())
        LIMIT 100
        FOR UPDATE SKIP LOCKED
    );

    INSERT INTO public.tentatives_connexion AS t (cle, echecs, premier_echec_at)
    VALUES (p_cle, 1, now())
    ON CONFLICT (cle) DO UPDATE SET
        echecs = CASE WHEN t.premier_echec_at < now() - interval '15 minutes' THEN 1 ELSE t.echecs + 1 END,
        bloque_jusqu_a = CASE WHEN t.premier_echec_at < now() - interval '15 minutes' THEN NULL ELSE t.bloque_jusqu_a END,
        premier_echec_at = CASE WHEN t.premier_echec_at < now() - interval '15 minutes' THEN now() ELSE t.premier_echec_at END;

    UPDATE public.tentatives_connexion
    SET bloque_jusqu_a = now() + interval '15 minutes'
    WHERE cle = p_cle AND echecs >= p_seuil;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.noter_echec_plafonne(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.noter_echec_plafonne(TEXT, INTEGER) TO service_role;


CREATE OR REPLACE FUNCTION public.effacer_tentatives(p_cle TEXT)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM public.tentatives_connexion WHERE cle = p_cle
$$;
REVOKE EXECUTE ON FUNCTION public.effacer_tentatives(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effacer_tentatives(TEXT) TO service_role;


-- IP utilisable comme clé de compteur
CREATE OR REPLACE FUNCTION public.ip_pour_cle(p_ip TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_ip ~ '^[0-9A-Fa-f:.]{2,45}$' THEN lower(p_ip) ELSE 'inconnue' END
$$;

-- Codes : le serveur envoie le sha256 du code, la base le stocke et le compare en bcrypt.
-- pgcrypto est dans le schéma extensions sur Supabase : d'où search_path = extensions, public.
CREATE OR REPLACE FUNCTION public.code_correspond(p_stocke TEXT, p_fourni TEXT)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE COST 10000 SET search_path = extensions, public AS $$
    SELECT CASE
        WHEN p_fourni IS NULL OR p_fourni !~ '^[0-9a-fA-F]{64}$' THEN false
        -- Identifiant inconnu : bcrypt leurre, même temps de réponse
        WHEN p_stocke IS NULL THEN crypt(lower(p_fourni), gen_salt('bf', 10)) IS NULL
        WHEN p_stocke ~ '^\$2[aby]\$[0-9]{2}\$.{53}$' THEN crypt(lower(p_fourni), p_stocke) = p_stocke
        ELSE false
    END
$$;
REVOKE EXECUTE ON FUNCTION public.code_correspond(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hacher_code_bcrypt()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = extensions, public AS $$
BEGIN
    IF NEW.code_hash ~ '^[0-9a-fA-F]{64}$' THEN
        NEW.code_hash := crypt(lower(NEW.code_hash), gen_salt('bf', 10));
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

-- Connexion à l'Espace École (slug ou e-mail + code). L'IP n'est crue que si l'appel vient du serveur
-- Next.js (JWT « connexion »). 5 échecs par IP et identifiant, 30 par identifiant, 50 par IP.
CREATE OR REPLACE FUNCTION public.echanger_acces_ecole(p_identifiant TEXT, p_code_hash TEXT, p_ip TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ident TEXT := lower(trim(coalesce(p_identifiant, '')));
    v_ident_cle TEXT := md5(left(v_ident, 100));
    v_cle TEXT := 'ecole:' || v_ident_cle;
    v_ip TEXT := public.ip_pour_cle(CASE WHEN public.jwt_role_app() = 'connexion' THEN p_ip END);
    v_cle_ip TEXT := 'ecoleip:' || v_ip || '|' || v_ident_cle;
    v_cle_glob TEXT := CASE WHEN v_ip <> 'inconnue' THEN 'ecoleipglob:' || v_ip END;
    v_id UUID;
    v_stocke TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cle, 0));
    PERFORM public.controler_tentatives(v_cle);
    PERFORM public.controler_tentatives(v_cle_ip);
    IF v_cle_glob IS NOT NULL THEN
        PERFORM public.controler_tentatives(v_cle_glob);
    END IF;

    SELECT e.id, a.code_hash INTO v_id, v_stocke
    FROM public.ecoles e
    JOIN public.acces_ecole a ON a.ecole_id = e.id
    WHERE CASE WHEN position('@' IN v_ident) > 0
               THEN lower(e.email_contact) = v_ident
               ELSE e.slug = v_ident END
      AND e.is_active
    LIMIT 1;
    IF NOT public.code_correspond(v_stocke, p_code_hash) THEN
        v_id := NULL;
    END IF;

    IF v_id IS NULL THEN
        IF v_cle_glob IS NOT NULL THEN
            PERFORM public.noter_echec_plafonne(v_cle_glob, 50);
        END IF;
        PERFORM public.noter_echec_plafonne(v_cle_ip, 5);
        PERFORM public.noter_echec_plafonne(v_cle, 30);
    ELSE
        PERFORM public.effacer_tentatives(v_cle_ip);
    END IF;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.echanger_acces_ecole(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.echanger_acces_ecole(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Session École : école active, code inchangé depuis l'émission du cookie
CREATE OR REPLACE FUNCTION public.session_ecole_valide(p_ecole_id UUID, p_emis_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.ecoles e
        JOIN public.acces_ecole a ON a.ecole_id = e.id
        WHERE e.id = p_ecole_id AND e.is_active
          AND a.updated_at <= p_emis_at + interval '30 seconds'
    )
$$;
REVOKE EXECUTE ON FUNCTION public.session_ecole_valide(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_ecole_valide(UUID, TIMESTAMPTZ) TO anon, authenticated, service_role;

-- Lien magique parent : parent et école actifs
CREATE OR REPLACE FUNCTION public.echanger_jeton_parent(p_token TEXT)
RETURNS TABLE (parent_id UUID, ecole_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.id, p.ecole_id FROM public.parents p
    JOIN public.ecoles e ON e.id = p.ecole_id
    WHERE p.token = p_token AND p.is_active AND e.is_active
    LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.echanger_jeton_parent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.echanger_jeton_parent(TEXT) TO anon, authenticated, service_role;

-- Changement du code École : vérifie l'ancien code sans que l'école lise jamais le hash
CREATE OR REPLACE FUNCTION public.changer_code_ecole(p_ancien_hash TEXT, p_nouveau_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_cle TEXT;
    v_stocke TEXT;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé';
    END IF;
    IF p_nouveau_hash IS NULL OR p_nouveau_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Nouveau code invalide';
    END IF;

    v_cle := 'changecode:' || v_ecole::text;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cle, 0));
    PERFORM public.controler_tentatives(v_cle);

    SELECT code_hash INTO v_stocke FROM public.acces_ecole WHERE ecole_id = v_ecole;
    IF NOT public.code_correspond(v_stocke, p_ancien_hash) THEN
        PERFORM public.noter_echec_plafonne(v_cle, 5);
        RETURN false;
    END IF;
    PERFORM public.effacer_tentatives(v_cle);

    UPDATE public.acces_ecole SET code_hash = p_nouveau_hash, updated_at = now() WHERE ecole_id = v_ecole;
    RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.changer_code_ecole(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.changer_code_ecole(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.proteger_colonnes_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF public.jwt_role_app() IS NOT NULL AND (
        NEW.slug IS DISTINCT FROM OLD.slug
        OR NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.plan IS DISTINCT FROM OLD.plan
        OR NEW.statut_abonnement IS DISTINCT FROM OLD.statut_abonnement
        OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
        OR NEW.abonnement_fin IS DISTINCT FROM OLD.abonnement_fin
    ) THEN
        RAISE EXCEPTION 'Ces informations ne peuvent être modifiées que par FayJàng.' USING ERRCODE = 'FJ403';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verifier_meme_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'eleves' AND NEW.parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.parents WHERE id = NEW.parent_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Parent introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'inscriptions' THEN
        IF NOT EXISTS (SELECT 1 FROM public.eleves WHERE id = NEW.eleve_id AND ecole_id = NEW.ecole_id)
           OR NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Élève ou classe introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'paiements' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inscriptions WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Inscription introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verifier_meme_ecole() FROM PUBLIC, anon, authenticated;

-- Numéro de reçu attribué par la base (FJ-2026-00001), jamais par le client
CREATE OR REPLACE FUNCTION public.numeroter_recu()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_annee INTEGER := extract(year FROM NEW.paye_le)::int;
    v_num INTEGER;
BEGIN
    INSERT INTO public.compteurs_recus AS c (ecole_id, annee, dernier)
    VALUES (NEW.ecole_id, v_annee, 1)
    ON CONFLICT (ecole_id, annee) DO UPDATE SET dernier = c.dernier + 1
    RETURNING dernier INTO v_num;
    NEW.numero_recu := 'FJ-' || v_annee || '-' || lpad(v_num::text, 5, '0');
    NEW.annule := false;
    NEW.motif_annulation := NULL;
    NEW.annule_at := NULL;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.numeroter_recu() FROM PUBLIC, anon, authenticated;
-- Un paiement encaissé ne change plus : seule l'annulation (définitive, motivée) est permise
CREATE OR REPLACE FUNCTION public.proteger_paiement()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.annule THEN
        RAISE EXCEPTION 'Ce paiement est déjà annulé.' USING ERRCODE = 'FJ412';
    END IF;
    IF NEW.inscription_id IS DISTINCT FROM OLD.inscription_id
       OR NEW.ecole_id IS DISTINCT FROM OLD.ecole_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.mois IS DISTINCT FROM OLD.mois
       OR NEW.montant IS DISTINCT FROM OLD.montant
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.numero_recu IS DISTINCT FROM OLD.numero_recu
       OR NEW.paye_le IS DISTINCT FROM OLD.paye_le
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Un paiement encaissé ne se modifie pas : annulez-le puis saisissez le bon.' USING ERRCODE = 'FJ412';
    END IF;
    IF NEW.annule AND length(trim(coalesce(NEW.motif_annulation, ''))) < 3 THEN
        RAISE EXCEPTION 'Indiquez le motif de l''annulation.' USING ERRCODE = 'FJ422';
    END IF;
    IF NEW.annule THEN
        NEW.annule_at := now();
    END IF;
    RETURN NEW;
END;
$$;

-- Une inscription qui a des paiements ne se supprime pas (on passe son statut à « abandon »)
CREATE OR REPLACE FUNCTION public.proteger_inscription()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.paiements WHERE inscription_id = OLD.id) THEN
        RAISE EXCEPTION 'Cette inscription a des paiements : passez-la en abandon au lieu de la supprimer.' USING ERRCODE = 'FJ412';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.eleve_id IS DISTINCT FROM OLD.eleve_id OR NEW.annee_scolaire IS DISTINCT FROM OLD.annee_scolaire) THEN
        RAISE EXCEPTION 'Élève et année d''une inscription payée ne changent pas.' USING ERRCODE = 'FJ412';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;