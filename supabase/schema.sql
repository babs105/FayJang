-- ==============================================================================
-- FAYJÀNG — SCHÉMA SUPABASE
-- Fichier GÉNÉRÉ par supabase/scripts/build-schema.sh. Ne pas éditer à la main.
-- Sources : supabase/schema/*.sql
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 01-tables.sql
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- FAYJÀNG — SCHÉMA SUPABASE
-- Version: 1.0 — écoles (tenants), accès École, classes, parents, élèves, inscriptions,
--               paiements (inscription / mensualités), reçus numérotés, limite des tentatives,
--               RLS par claims JWT (pattern hybride « token -> JWT court » repris de Cantine Pro)
-- Script IDEMPOTENT : il est relancé en entier dans l'éditeur SQL Supabase.
-- ==============================================================================

SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migrations de données exécutées une seule fois (voir le skill /migration-schema)
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    nom TEXT PRIMARY KEY,
    applique_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.schema_migrations FROM PUBLIC, anon, authenticated;

-- 1. ÉCOLES (un tenant = une école privée)
CREATE TABLE IF NOT EXISTS public.ecoles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    ville TEXT,
    adresse TEXT,
    responsable_nom TEXT,
    email_contact TEXT,
    telephone_contact TEXT,
    -- Année scolaire courante (ex : 2026-2027) et calendrier des mensualités
    annee_scolaire TEXT NOT NULL DEFAULT '2026-2027',
    mois_debut INTEGER NOT NULL DEFAULT 10 CHECK (mois_debut BETWEEN 1 AND 12), -- octobre
    nb_mensualites INTEGER NOT NULL DEFAULT 9 CHECK (nb_mensualites BETWEEN 1 AND 12), -- octobre → juin
    jour_echeance INTEGER NOT NULL DEFAULT 5 CHECK (jour_echeance BETWEEN 1 AND 28), -- mensualité due le 5
    -- Abonnement FayJàng (réservé au SuperAdmin, voir trigger section 10)
    plan TEXT NOT NULL DEFAULT 'essai' CHECK (plan IN ('essai', 'standard', 'premium')),
    statut_abonnement TEXT NOT NULL DEFAULT 'essai' CHECK (statut_abonnement IN ('essai', 'actif', 'expire', 'suspendu')),
    trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days'),
    abonnement_fin DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ecoles_email ON public.ecoles (lower(email_contact)) WHERE email_contact IS NOT NULL;

-- Code d'accès de l'Espace École, hors de la table ecoles (lisible par les parents) : bcrypt
CREATE TABLE IF NOT EXISTS public.acces_ecole (
    ecole_id UUID PRIMARY KEY REFERENCES public.ecoles(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.acces_ecole FROM PUBLIC, anon, authenticated;

-- 2. CLASSES (tarifs par classe et par année scolaire)
CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    nom TEXT NOT NULL, -- ex : CI, CM2 A, 6e B, Terminale L2
    niveau TEXT NOT NULL DEFAULT 'elementaire'
        CHECK (niveau IN ('prescolaire', 'elementaire', 'moyen', 'secondaire')),
    annee_scolaire TEXT NOT NULL,
    frais_inscription INTEGER NOT NULL DEFAULT 0 CHECK (frais_inscription >= 0), -- FCFA
    mensualite INTEGER NOT NULL DEFAULT 0 CHECK (mensualite >= 0), -- FCFA
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ecole_id, annee_scolaire, nom)
);
CREATE INDEX IF NOT EXISTS idx_classes_ecole ON public.classes (ecole_id);

-- 3. PARENTS (tuteurs) : lien magique /p/[token] pour suivre la scolarité de leurs enfants
CREATE TABLE IF NOT EXISTS public.parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    telephone TEXT NOT NULL, -- E.164 (+221...)
    token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ecole_id, telephone)
);
CREATE INDEX IF NOT EXISTS idx_parents_ecole ON public.parents (ecole_id);

-- 4. ÉLÈVES
CREATE TABLE IF NOT EXISTS public.eleves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES public.parents(id) ON DELETE SET NULL,
    matricule TEXT NOT NULL,
    prenom TEXT NOT NULL,
    nom TEXT NOT NULL,
    sexe TEXT CHECK (sexe IN ('M', 'F')),
    date_naissance DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ecole_id, matricule)
);
CREATE INDEX IF NOT EXISTS idx_eleves_ecole ON public.eleves (ecole_id);
CREATE INDEX IF NOT EXISTS idx_eleves_parent ON public.eleves (parent_id);

-- 5. INSCRIPTIONS (un élève dans une classe pour une année ; tarifs figés à l'inscription)
CREATE TABLE IF NOT EXISTS public.inscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    eleve_id UUID NOT NULL REFERENCES public.eleves(id) ON DELETE CASCADE,
    classe_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
    annee_scolaire TEXT NOT NULL,
    frais_inscription INTEGER NOT NULL CHECK (frais_inscription >= 0),
    mensualite INTEGER NOT NULL CHECK (mensualite >= 0),
    -- Réduction mensuelle (fratrie, bourse, enfant du personnel), en FCFA
    reduction_mensuelle INTEGER NOT NULL DEFAULT 0 CHECK (reduction_mensuelle >= 0),
    statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'abandon', 'transfert')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (eleve_id, annee_scolaire),
    CHECK (reduction_mensuelle <= mensualite)
);
CREATE INDEX IF NOT EXISTS idx_inscriptions_ecole_annee ON public.inscriptions (ecole_id, annee_scolaire);

-- 6. PAIEMENTS (jamais supprimés : une erreur se corrige par annulation motivée)
CREATE TABLE IF NOT EXISTS public.paiements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES public.inscriptions(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('inscription', 'mensualite', 'autre')),
    mois DATE, -- 1er du mois couvert, pour une mensualité
    montant INTEGER NOT NULL CHECK (montant > 0), -- FCFA
    mode TEXT NOT NULL CHECK (mode IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque')),
    reference TEXT, -- n° de transaction Wave / OM, n° de chèque
    libelle TEXT, -- pour type « autre » : tenue, transport, cantine...
    numero_recu TEXT, -- attribué par trigger : FJ-2026-00001
    paye_le DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Dakar')::date,
    encaisse_par TEXT,
    annule BOOLEAN NOT NULL DEFAULT false,
    motif_annulation TEXT,
    annule_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ecole_id, numero_recu),
    CHECK (type <> 'mensualite' OR mois IS NOT NULL),
    CHECK (mois IS NULL OR extract(day FROM mois) = 1)
);
CREATE INDEX IF NOT EXISTS idx_paiements_inscription ON public.paiements (inscription_id);
CREATE INDEX IF NOT EXISTS idx_paiements_ecole_date ON public.paiements (ecole_id, paye_le);

-- Compteur des reçus par école et par année civile
CREATE TABLE IF NOT EXISTS public.compteurs_recus (
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    annee INTEGER NOT NULL,
    dernier INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ecole_id, annee)
);
REVOKE ALL ON public.compteurs_recus FROM PUBLIC, anon, authenticated;

-- 7. LIMITE DES TENTATIVES DE CONNEXION (Espace École, SuperAdmin)
CREATE TABLE IF NOT EXISTS public.tentatives_connexion (
    cle TEXT PRIMARY KEY,
    echecs INTEGER NOT NULL DEFAULT 0,
    premier_echec_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    bloque_jusqu_a TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tentatives_connexion_premier_echec ON public.tentatives_connexion (premier_echec_at);
REVOKE ALL ON public.tentatives_connexion FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 03-fonctions.sql
-- ------------------------------------------------------------------------------

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
-- ------------------------------------------------------------------------------
-- 02-securite.sql
-- ------------------------------------------------------------------------------

-- 8. SÉCURITÉ : RLS ACTIVÉE SUR TOUTES LES TABLES
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecoles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acces_ecole ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eleves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paiements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compteurs_recus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tentatives_connexion ENABLE ROW LEVEL SECURITY;

-- ecoles
DROP POLICY IF EXISTS ecole_lit_sa_fiche ON public.ecoles;
CREATE POLICY ecole_lit_sa_fiche ON public.ecoles FOR SELECT TO authenticated
    USING (public.jwt_role_app() IN ('ecole', 'parent') AND id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_modifie_sa_fiche ON public.ecoles;
CREATE POLICY ecole_modifie_sa_fiche ON public.ecoles FOR UPDATE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND id = public.jwt_ecole_id());

-- classes
DROP POLICY IF EXISTS ecole_gere_ses_classes ON public.classes;
CREATE POLICY ecole_gere_ses_classes ON public.classes FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS parent_lit_les_classes ON public.classes;
CREATE POLICY parent_lit_les_classes ON public.classes FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id());

-- parents
DROP POLICY IF EXISTS ecole_gere_ses_parents ON public.parents;
CREATE POLICY ecole_gere_ses_parents ON public.parents FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS parent_lit_sa_fiche ON public.parents;
CREATE POLICY parent_lit_sa_fiche ON public.parents FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'parent' AND id = public.jwt_parent_id());

-- eleves
DROP POLICY IF EXISTS ecole_gere_ses_eleves ON public.eleves;
CREATE POLICY ecole_gere_ses_eleves ON public.eleves FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS parent_lit_ses_enfants ON public.eleves;
CREATE POLICY parent_lit_ses_enfants ON public.eleves FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id()
           AND parent_id = public.jwt_parent_id());

-- inscriptions
DROP POLICY IF EXISTS ecole_gere_ses_inscriptions ON public.inscriptions;
CREATE POLICY ecole_gere_ses_inscriptions ON public.inscriptions FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS parent_lit_les_inscriptions ON public.inscriptions;
CREATE POLICY parent_lit_les_inscriptions ON public.inscriptions FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id()
           AND EXISTS (SELECT 1 FROM public.eleves el
                       WHERE el.id = inscriptions.eleve_id AND el.parent_id = public.jwt_parent_id()));

-- paiements : l'école lit, encaisse et annule ; jamais de suppression
DROP POLICY IF EXISTS ecole_lit_ses_paiements ON public.paiements;
CREATE POLICY ecole_lit_ses_paiements ON public.paiements FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_encaisse ON public.paiements;
CREATE POLICY ecole_encaisse ON public.paiements FOR INSERT TO authenticated
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id() AND NOT annule);
DROP POLICY IF EXISTS ecole_annule ON public.paiements;
CREATE POLICY ecole_annule ON public.paiements FOR UPDATE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS parent_lit_ses_paiements ON public.paiements;
CREATE POLICY parent_lit_ses_paiements ON public.paiements FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id() AND NOT annule
           AND EXISTS (SELECT 1 FROM public.inscriptions i
                       JOIN public.eleves el ON el.id = i.eleve_id
                       WHERE i.id = paiements.inscription_id AND el.parent_id = public.jwt_parent_id()));

-- ------------------------------------------------------------------------------
-- 04-triggers.sql
-- ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_hacher_code_bcrypt ON public.acces_ecole;
CREATE TRIGGER trg_hacher_code_bcrypt
    BEFORE INSERT OR UPDATE OF code_hash ON public.acces_ecole
    FOR EACH ROW EXECUTE FUNCTION public.hacher_code_bcrypt();


DROP TRIGGER IF EXISTS trg_proteger_colonnes_ecole ON public.ecoles;
CREATE TRIGGER trg_proteger_colonnes_ecole BEFORE UPDATE ON public.ecoles
    FOR EACH ROW EXECUTE FUNCTION public.proteger_colonnes_ecole();

DROP TRIGGER IF EXISTS trg_meme_ecole ON public.eleves;
CREATE TRIGGER trg_meme_ecole BEFORE INSERT OR UPDATE OF parent_id, ecole_id ON public.eleves
    FOR EACH ROW EXECUTE FUNCTION public.verifier_meme_ecole();
DROP TRIGGER IF EXISTS trg_meme_ecole ON public.inscriptions;
CREATE TRIGGER trg_meme_ecole BEFORE INSERT OR UPDATE OF eleve_id, classe_id, ecole_id ON public.inscriptions
    FOR EACH ROW EXECUTE FUNCTION public.verifier_meme_ecole();
DROP TRIGGER IF EXISTS trg_meme_ecole ON public.paiements;
CREATE TRIGGER trg_meme_ecole BEFORE INSERT OR UPDATE OF inscription_id, ecole_id ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.verifier_meme_ecole();
REVOKE EXECUTE ON FUNCTION public.verifier_meme_ecole() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_paiement ON public.paiements;
CREATE TRIGGER trg_proteger_paiement BEFORE UPDATE ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.proteger_paiement();

DROP TRIGGER IF EXISTS trg_numeroter_recu ON public.paiements;
CREATE TRIGGER trg_numeroter_recu BEFORE INSERT ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.numeroter_recu();
REVOKE EXECUTE ON FUNCTION public.numeroter_recu() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_inscription ON public.inscriptions;
CREATE TRIGGER trg_proteger_inscription BEFORE DELETE ON public.inscriptions
    FOR EACH ROW EXECUTE FUNCTION public.proteger_inscription();
DROP TRIGGER IF EXISTS trg_proteger_inscription_maj ON public.inscriptions;
CREATE TRIGGER trg_proteger_inscription_maj BEFORE UPDATE OF eleve_id, annee_scolaire ON public.inscriptions
    FOR EACH ROW EXECUTE FUNCTION public.proteger_inscription();






-- ------------------------------------------------------------------------------
-- 05-migrations.sql
-- ------------------------------------------------------------------------------

-- v1.2 : paiement du dernier mois de scolarité par tranches.
-- Quand l'option est active, la mensualité du dernier mois (ex : juin) est répartie en tranches égales,
-- dues avec les mensualités à partir du mois mois_debut_tranches (numéro de mois 1-12, ex : 1 = janvier)
-- jusqu'à l'avant-dernier mois. Les tranches sont des paiements « mensualite » sur le dernier mois.
ALTER TABLE public.ecoles
    ADD COLUMN IF NOT EXISTS tranches_dernier_mois BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ecoles
    ADD COLUMN IF NOT EXISTS mois_debut_tranches INTEGER;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecoles_mois_debut_tranches_check') THEN
        ALTER TABLE public.ecoles ADD CONSTRAINT ecoles_mois_debut_tranches_check
            CHECK (mois_debut_tranches IS NULL OR mois_debut_tranches BETWEEN 1 AND 12);
    END IF;
END $$;

-- v1.3 : nombre de tranches du dernier mois choisi par l'école. NULL = une tranche par mois, du mois de
-- début jusqu'à l'avant-dernier mois (comportement de la v1.2). Les tranches doivent finir avant le dernier mois
-- (contrôlé par l'application, qui connaît le calendrier).
ALTER TABLE public.ecoles
    ADD COLUMN IF NOT EXISTS nb_tranches INTEGER;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecoles_nb_tranches_check') THEN
        ALTER TABLE public.ecoles ADD CONSTRAINT ecoles_nb_tranches_check
            CHECK (nb_tranches IS NULL OR nb_tranches BETWEEN 1 AND 11);
    END IF;
END $$;

-- v1.4 : un reçu peut regrouper plusieurs lignes encaissées ensemble (ex : mensualité de janvier + tranche
-- du dernier mois, ou plusieurs mois d'un coup). Les lignes d'un même encaissement partagent lot_id et le même
-- numero_recu (attribué par numeroter_recu, bloc final). Le numéro n'est donc plus unique par ligne.
ALTER TABLE public.paiements
    ADD COLUMN IF NOT EXISTS lot_id UUID;
CREATE INDEX IF NOT EXISTS idx_paiements_lot ON public.paiements (ecole_id, lot_id) WHERE lot_id IS NOT NULL;
ALTER TABLE public.paiements DROP CONSTRAINT IF EXISTS paiements_ecole_id_numero_recu_key;
CREATE INDEX IF NOT EXISTS idx_paiements_numero_recu ON public.paiements (ecole_id, numero_recu);

-- v1.5 : frais de classe paramétrables.
-- 1) Mensualité spécifique pour le dernier mois (NULL = mensualité ordinaire), figée sur l'inscription.
-- 2) Réglages d'école : 1er et/ou dernier mois exigibles dès l'inscription ; mois payé par tranches choisi par son
--    rang depuis la fin (1 = dernier, 2 = avant-dernier, 3 = antépénultième). Les colonnes tranches_dernier_mois,
--    mois_debut_tranches et nb_tranches (v1.2, v1.3) gardent leur nom : « tranches activées », mois de la première
--    tranche, nombre de tranches.
-- 3) Catalogue d'articles par classe (tenue, blouson, jacket : frais uniques ; pensionnat, transport : services
--    mensuels), obligatoires ou optionnels, avec prix unitaire et quantité. Copie figée par élève dans
--    articles_inscription ; un paiement d'article porte article_id (type « autre »).
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS mensualite_dernier_mois INTEGER;
ALTER TABLE public.inscriptions ADD COLUMN IF NOT EXISTS mensualite_dernier_mois INTEGER;
ALTER TABLE public.ecoles ADD COLUMN IF NOT EXISTS premier_mois_a_linscription BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ecoles ADD COLUMN IF NOT EXISTS dernier_mois_a_linscription BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ecoles ADD COLUMN IF NOT EXISTS rang_mois_tranches INTEGER NOT NULL DEFAULT 1;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_mensualite_dernier_mois_check') THEN
        ALTER TABLE public.classes ADD CONSTRAINT classes_mensualite_dernier_mois_check
            CHECK (mensualite_dernier_mois IS NULL OR mensualite_dernier_mois >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inscriptions_mensualite_dernier_mois_check') THEN
        ALTER TABLE public.inscriptions ADD CONSTRAINT inscriptions_mensualite_dernier_mois_check
            CHECK (mensualite_dernier_mois IS NULL OR mensualite_dernier_mois >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecoles_rang_mois_tranches_check') THEN
        ALTER TABLE public.ecoles ADD CONSTRAINT ecoles_rang_mois_tranches_check
            CHECK (rang_mois_tranches BETWEEN 1 AND 3);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.articles_classe (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    classe_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    libelle TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('unique', 'mensuel')), -- unique : tenue, blouson ; mensuel : transport
    prix_unitaire INTEGER NOT NULL CHECK (prix_unitaire >= 0), -- FCFA (par mois pour un service mensuel)
    quantite_defaut INTEGER NOT NULL DEFAULT 1 CHECK (quantite_defaut BETWEEN 0 AND 99),
    obligatoire BOOLEAN NOT NULL DEFAULT true,
    ordre INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_articles_classe_classe ON public.articles_classe (classe_id);


CREATE TABLE IF NOT EXISTS public.articles_inscription (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    inscription_id UUID NOT NULL REFERENCES public.inscriptions(id) ON DELETE CASCADE,
    article_classe_id UUID REFERENCES public.articles_classe(id) ON DELETE SET NULL,
    libelle TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('unique', 'mensuel')),
    prix_unitaire INTEGER NOT NULL CHECK (prix_unitaire >= 0),
    quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite BETWEEN 0 AND 99),
    obligatoire BOOLEAN NOT NULL DEFAULT true,
    mois_debut DATE, -- service mensuel : premier mois dû (1er du mois)
    mois_fin DATE,   -- service mensuel : dernier mois dû (NULL = jusqu'à la fin de l'année)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (mois_debut IS NULL OR extract(day FROM mois_debut) = 1),
    CHECK (mois_fin IS NULL OR extract(day FROM mois_fin) = 1),
    CHECK (mois_fin IS NULL OR mois_debut IS NULL OR mois_fin >= mois_debut)
);
CREATE INDEX IF NOT EXISTS idx_articles_inscription_inscription ON public.articles_inscription (inscription_id);

ALTER TABLE public.articles_classe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles_inscription ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.paiements
    ADD COLUMN IF NOT EXISTS article_id UUID REFERENCES public.articles_inscription(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_paiements_article ON public.paiements (article_id) WHERE article_id IS NOT NULL;
-- Un paiement d'article est toujours de type « autre » (sinon il fausserait le solde d'un mois).
-- NOT VALID : les paiements existants ne sont pas relus.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paiements_article_type_check') THEN
        ALTER TABLE public.paiements ADD CONSTRAINT paiements_article_type_check
            CHECK (article_id IS NULL OR type = 'autre') NOT VALID;
    END IF;
END $$;

-- ---------------------------------------------------------------- v1.6 : départ d'un élève
-- Date de départ (abandon, transfert) : les mois jusqu'au mois du départ restent dus, ceux d'après
-- ne le sont plus (calcul dans src/lib/scolarite.ts). Interdite sur une inscription active.
-- NOT VALID : les inscriptions existantes ne sont pas relues.
ALTER TABLE public.inscriptions ADD COLUMN IF NOT EXISTS date_depart DATE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inscriptions_date_depart_check') THEN
        ALTER TABLE public.inscriptions ADD CONSTRAINT inscriptions_date_depart_check
            CHECK (date_depart IS NULL OR statut <> 'active') NOT VALID;
    END IF;
END $$;


-- 11. DROITS : Supabase accorde les tables à anon par défaut, REVOKE FROM PUBLIC ne suffit pas
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
-- Les tables techniques restent fermées à authenticated (aucune politique, et pas de droit)
REVOKE ALL ON public.acces_ecole, public.compteurs_recus, public.tentatives_connexion, public.schema_migrations
    FROM authenticated;

-- ==============================================================================
-- v1.1 : correctif du trigger verifier_meme_ecole (erreur 42703 à chaque inscription).
-- PL/pgSQL évaluait « TG_TABLE_NAME = 'eleves' AND NEW.parent_id IS NOT NULL » sans court-circuit :
-- sur une ligne d'inscriptions ou de paiements, NEW.parent_id n'existe pas. Chaque table a désormais
-- sa propre branche, et NEW n'est lu qu'à l'intérieur de la bonne branche.
-- Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.verifier_meme_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'eleves' THEN
        IF NEW.parent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.parents WHERE id = NEW.parent_id AND ecole_id = NEW.ecole_id) THEN
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

-- ==============================================================================
-- v1.4 : reçus regroupés (lot_id). Remplace numeroter_recu et proteger_paiement (section 10).
-- Une ligne qui porte le lot_id d'une ligne insérée dans la MÊME transaction reprend son numéro de reçu.
-- Un lot_id déjà utilisé par une transaction précédente est refusé : on ne peut pas ajouter une ligne
-- à un reçu déjà remis. Un reçu ne concerne qu'une inscription (un élève).
-- Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.numeroter_recu()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_annee INTEGER := extract(year FROM NEW.paye_le)::int;
    v_num INTEGER;
    v_numero TEXT;
    v_inscription UUID;
    v_created TIMESTAMPTZ;
BEGIN
    NEW.annule := false;
    NEW.motif_annulation := NULL;
    NEW.annule_at := NULL;

    IF NEW.lot_id IS NOT NULL THEN
        SELECT numero_recu, inscription_id, created_at INTO v_numero, v_inscription, v_created
        FROM public.paiements
        WHERE ecole_id = NEW.ecole_id AND lot_id = NEW.lot_id
        LIMIT 1;
        IF FOUND THEN
            IF v_created IS DISTINCT FROM now() THEN
                RAISE EXCEPTION 'Ce reçu est déjà émis : impossible d''y ajouter une ligne.' USING ERRCODE = 'FJ412';
            END IF;
            IF v_inscription IS DISTINCT FROM NEW.inscription_id THEN
                RAISE EXCEPTION 'Un reçu ne concerne qu''un seul élève.' USING ERRCODE = 'FJ422';
            END IF;
            NEW.numero_recu := v_numero;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.compteurs_recus AS c (ecole_id, annee, dernier)
    VALUES (NEW.ecole_id, v_annee, 1)
    ON CONFLICT (ecole_id, annee) DO UPDATE SET dernier = c.dernier + 1
    RETURNING dernier INTO v_num;
    NEW.numero_recu := 'FJ-' || v_annee || '-' || lpad(v_num::text, 5, '0');
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.numeroter_recu() FROM PUBLIC, anon, authenticated;

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
       OR NEW.libelle IS DISTINCT FROM OLD.libelle
       OR NEW.numero_recu IS DISTINCT FROM OLD.numero_recu
       OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
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

-- ==============================================================================
-- v1.5 : politiques, cohérence multi-écoles et protections des articles.
-- Remplace verifier_meme_ecole (v1.1) et proteger_paiement (v1.4). Bloc final : garder en dernier.
-- ==============================================================================
DROP POLICY IF EXISTS ecole_gere_ses_articles_classe ON public.articles_classe;
CREATE POLICY ecole_gere_ses_articles_classe ON public.articles_classe FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());

DROP POLICY IF EXISTS ecole_gere_ses_articles_inscription ON public.articles_inscription;
CREATE POLICY ecole_gere_ses_articles_inscription ON public.articles_inscription FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS parent_lit_ses_articles ON public.articles_inscription;
CREATE POLICY parent_lit_ses_articles ON public.articles_inscription FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id()
           AND EXISTS (SELECT 1 FROM public.inscriptions i JOIN public.eleves el ON el.id = i.eleve_id
                       WHERE i.id = articles_inscription.inscription_id AND el.parent_id = public.jwt_parent_id()));

-- Une branche par table ; NEW n'est lu que dans sa branche (pas de court-circuit en PL/pgSQL)
CREATE OR REPLACE FUNCTION public.verifier_meme_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'eleves' THEN
        IF NEW.parent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.parents WHERE id = NEW.parent_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Parent introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'inscriptions' THEN
        IF NOT EXISTS (SELECT 1 FROM public.eleves WHERE id = NEW.eleve_id AND ecole_id = NEW.ecole_id)
           OR NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Élève ou classe introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'articles_classe' THEN
        IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Classe introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'articles_inscription' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inscriptions WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id)
           OR (NEW.article_classe_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.articles_classe WHERE id = NEW.article_classe_id AND ecole_id = NEW.ecole_id)) THEN
            RAISE EXCEPTION 'Inscription ou article introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'paiements' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inscriptions WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Inscription introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
        -- Un paiement d'article vise un article de la même inscription
        IF NEW.article_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.articles_inscription
                           WHERE id = NEW.article_id AND inscription_id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Article introuvable pour cet élève.' USING ERRCODE = 'FJ404';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verifier_meme_ecole() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_meme_ecole ON public.articles_classe;
CREATE TRIGGER trg_meme_ecole BEFORE INSERT OR UPDATE OF classe_id, ecole_id ON public.articles_classe
    FOR EACH ROW EXECUTE FUNCTION public.verifier_meme_ecole();
DROP TRIGGER IF EXISTS trg_meme_ecole ON public.articles_inscription;
CREATE TRIGGER trg_meme_ecole BEFORE INSERT OR UPDATE OF inscription_id, article_classe_id, ecole_id ON public.articles_inscription
    FOR EACH ROW EXECUTE FUNCTION public.verifier_meme_ecole();
DROP TRIGGER IF EXISTS trg_meme_ecole ON public.paiements;
CREATE TRIGGER trg_meme_ecole BEFORE INSERT OR UPDATE OF inscription_id, ecole_id, article_id ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.verifier_meme_ecole();

-- Paiement encaissé : seule l'annulation motivée passe (article_id ajouté à la liste immuable)
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
       OR NEW.libelle IS DISTINCT FROM OLD.libelle
       OR NEW.numero_recu IS DISTINCT FROM OLD.numero_recu
       OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
       OR NEW.article_id IS DISTINCT FROM OLD.article_id
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

-- Article d'un élève déjà payé : prix, quantité, nature et début figés ; seule la fin d'un service peut bouger.
-- Un article qui a des paiements ne se supprime pas (on arrête le service, ou on annule les reçus d'abord).
CREATE OR REPLACE FUNCTION public.proteger_article_inscription()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.paiements WHERE article_id = OLD.id AND NOT annule) THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cet article a des paiements : arrêtez le service ou annulez les reçus.' USING ERRCODE = 'FJ412';
        END IF;
        IF NEW.prix_unitaire IS DISTINCT FROM OLD.prix_unitaire
           OR NEW.quantite IS DISTINCT FROM OLD.quantite
           OR NEW.nature IS DISTINCT FROM OLD.nature
           OR NEW.inscription_id IS DISTINCT FROM OLD.inscription_id
           OR NEW.mois_debut IS DISTINCT FROM OLD.mois_debut THEN
            RAISE EXCEPTION 'Article déjà payé : son prix et sa quantité ne changent plus.' USING ERRCODE = 'FJ412';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_proteger_article_inscription ON public.articles_inscription;
CREATE TRIGGER trg_proteger_article_inscription BEFORE UPDATE OR DELETE ON public.articles_inscription
    FOR EACH ROW EXECUTE FUNCTION public.proteger_article_inscription();


-- ==============================================================================
-- v1.7 : inscription d'un élève en une seule transaction (fonction inscrire_eleve).
-- Parent (dédoublonné par téléphone), élève (matricule calculé sous verrou), inscription (tarifs recopiés
-- depuis la classe) et articles (recopiés depuis le catalogue de la classe) sont créés ensemble : un échec
-- n'en laisse aucun. SECURITY INVOKER : la RLS École s'applique à chaque lecture et écriture ; ecole_id vient
-- du JWT, jamais d'un paramètre. Le téléphone arrive normalisé (E.164) par le serveur.
-- Encaissement à l'inscription (tranche 2) : p_mode, p_reference et p_lignes_paiement [{type, mois,
-- article_classe_id, montant, libelle}] créent, dans la même transaction, les lignes d'un seul reçu (lot_id
-- généré ici, numéro attribué par le trigger numeroter_recu). Le dû est calculé par le serveur (TypeScript) ;
-- la base ne recalcule pas, elle vérifie que chaque ligne correspond à un élément réellement dû, sans doublon,
-- avec 0 < montant <= reste dû d'une inscription neuve. Échec : FJ422 et tout est annulé (aucun numéro consommé).
-- Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.inscrire_eleve(
    p_classe_id UUID,
    p_eleve_id UUID DEFAULT NULL,
    p_prenom TEXT DEFAULT NULL,
    p_nom TEXT DEFAULT NULL,
    p_sexe TEXT DEFAULT NULL,
    p_date_naissance DATE DEFAULT NULL,
    p_parent_nom TEXT DEFAULT NULL,
    p_parent_telephone TEXT DEFAULT NULL,
    p_reduction INTEGER DEFAULT 0,
    p_articles JSONB DEFAULT '[]'::jsonb,
    p_mois_debut_services DATE DEFAULT NULL,
    p_mode TEXT DEFAULT NULL,
    p_reference TEXT DEFAULT NULL,
    p_lignes_paiement JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_annee TEXT;
    v_classe public.classes%ROWTYPE;
    v_choix JSONB := coalesce(p_articles, '[]'::jsonb);
    v_lignes JSONB := coalesce(p_lignes_paiement, '[]'::jsonb);
    v_prenom TEXT := btrim(coalesce(p_prenom, ''));
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_parent_nom TEXT := btrim(coalesce(p_parent_nom, ''));
    v_manquant TEXT;
    v_eleve UUID;
    v_parent UUID;
    v_parent_cree BOOLEAN := false;
    v_prefixe TEXT;
    v_num BIGINT;
    v_matricule TEXT;
    v_inscription UUID;
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_lot UUID;
    v_numero_recu TEXT;
    v_montant_encaisse BIGINT := 0;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    -- Encaissement demandé : mode valide, référence (obligatoire pour le mobile money), lignes bien formées.
    -- Aucun cast avant que la forme de chaque champ soit vérifiée.
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IS NULL THEN
        IF v_reference IS NOT NULL OR jsonb_array_length(v_lignes) > 0 THEN
            RAISE EXCEPTION 'Mode de paiement manquant.' USING ERRCODE = 'FJ422';
        END IF;
    ELSE
        IF p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
            RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
        END IF;
        IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
            RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_reference) > 60 THEN
            RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                      WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                         OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                         OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                         OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                         OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'article_classe_id'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                         OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                         OR coalesce(c.e ->> 'article_classe_id', '00000000-0000-0000-0000-000000000000')
                            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         OR length(coalesce(c.e ->> 'libelle', '')) > 120
                         -- Cohérence du type : inscription sans mois ni article, mensualité avec mois, article avec type « autre »
                         OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'autre' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NULL)))
           OR (SELECT count(*) FROM jsonb_array_elements(v_lignes))
              <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_classe_id', '')))
                  FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
            RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
        END IF;
    END IF;

    -- Année scolaire de l'école et classe choisie (active, de la même année)
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    SELECT * INTO v_classe FROM public.classes WHERE id = p_classe_id AND ecole_id = v_ecole AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Choisissez une classe.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
        RAISE EXCEPTION 'Cette classe appartient à l''année %.', v_classe.annee_scolaire USING ERRCODE = 'FJ412';
    END IF;
    IF p_reduction IS NULL OR p_reduction < 0 THEN
        RAISE EXCEPTION 'Réduction invalide.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_reduction > v_classe.mensualite THEN
        RAISE EXCEPTION 'La réduction dépasse la mensualité.' USING ERRCODE = 'FJ422';
    END IF;

    -- Articles retenus : [{article_classe_id, quantite}], chacun du catalogue de cette classe, une seule fois
    IF jsonb_typeof(v_choix) IS DISTINCT FROM 'array' OR jsonb_array_length(v_choix) > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR coalesce(c.e ->> 'quantite', '') !~ '^[0-9]{1,2}$')
       OR (SELECT count(*) FROM jsonb_array_elements(v_choix))
          <> (SELECT count(DISTINCT lower(e ->> 'article_classe_id')) FROM jsonb_array_elements(v_choix) AS c(e)) THEN
        RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
               WHERE NOT EXISTS (SELECT 1 FROM public.articles_classe a
                                 WHERE a.id = (c.e ->> 'article_classe_id')::uuid
                                   AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole)) THEN
        RAISE EXCEPTION 'Article introuvable pour cette classe.' USING ERRCODE = 'FJ404';
    END IF;
    -- Un article obligatoire (service mensuel, ou frais unique avec une quantité par défaut) doit être retenu
    SELECT a.libelle INTO v_manquant
    FROM public.articles_classe a
    WHERE a.classe_id = v_classe.id AND a.ecole_id = v_ecole AND a.obligatoire
      AND (a.nature = 'mensuel' OR a.quantite_defaut > 0)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                      WHERE (c.e ->> 'article_classe_id')::uuid = a.id
                        AND (a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0))
    ORDER BY a.ordre
    LIMIT 1;
    IF v_manquant IS NOT NULL THEN
        RAISE EXCEPTION '« % » est obligatoire pour cette classe.', v_manquant USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                   JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                   WHERE a.nature = 'mensuel') THEN
        RAISE EXCEPTION 'Mois de début des services manquant.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NOT NULL AND extract(day FROM p_mois_debut_services) <> 1 THEN
        RAISE EXCEPTION 'Mois de début des services invalide.' USING ERRCODE = 'FJ422';
    END IF;

    IF p_eleve_id IS NOT NULL THEN
        -- Réinscription : l'élève existe dans l'école, son parent ne change pas
        SELECT id, parent_id INTO v_eleve, v_parent FROM public.eleves WHERE id = p_eleve_id AND ecole_id = v_ecole;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Élève introuvable.' USING ERRCODE = 'FJ404';
        END IF;
    ELSE
        IF v_prenom = '' OR v_nom = '' THEN
            RAISE EXCEPTION 'Prénom et nom de l''élève obligatoires.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_prenom) > 60 OR length(v_nom) > 60 THEN
            RAISE EXCEPTION 'Prénom ou nom de l''élève trop long.' USING ERRCODE = 'FJ422';
        END IF;
        IF v_parent_nom = '' OR length(v_parent_nom) > 80 OR coalesce(p_parent_telephone, '') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION 'Nom et téléphone du parent obligatoires (ex : 77 123 45 67).' USING ERRCODE = 'FJ422';
        END IF;
        IF p_sexe IS NOT NULL AND p_sexe NOT IN ('M', 'F') THEN
            RAISE EXCEPTION 'Sexe invalide.' USING ERRCODE = 'FJ422';
        END IF;

        -- Parent : le même téléphone dans l'école désigne le même parent (son nom et son lien ne changent pas)
        INSERT INTO public.parents AS p (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, p_parent_telephone)
        ON CONFLICT (ecole_id, telephone) DO UPDATE SET nom = p.nom
        RETURNING p.id, (p.xmax = 0) INTO v_parent, v_parent_cree;

        -- Matricule : 2 chiffres de l'année + plus grand numéro existant + 1 (au moins 4 chiffres).
        -- Le verrou sérialise les inscriptions simultanées de l'école jusqu'à la fin de la transaction.
        v_prefixe := substr(v_annee, 3, 2);
        PERFORM pg_advisory_xact_lock(hashtextextended('matricule:' || v_ecole::text || ':' || v_prefixe, 0));
        SELECT coalesce(max(substr(matricule, 3)::bigint), 0) + 1 INTO v_num
        FROM public.eleves
        WHERE ecole_id = v_ecole AND matricule ~ ('^' || v_prefixe || '[0-9]{1,12}$');
        v_matricule := v_prefixe || lpad(v_num::text, greatest(4, length(v_num::text)), '0');

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, p_sexe, p_date_naissance)
        RETURNING id INTO v_eleve;
    END IF;

    -- Inscription : tarifs figés depuis la classe (un élève déjà inscrit cette année lève 23505)
    INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                     mensualite_dernier_mois, reduction_mensuelle)
    VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
            v_classe.mensualite_dernier_mois, p_reduction)
    RETURNING id INTO v_inscription;

    -- Articles : libellé, nature, prix et obligation recopiés du catalogue ; un service mensuel compte pour 1
    INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                             prix_unitaire, quantite, obligatoire, mois_debut)
    SELECT v_ecole, v_inscription, a.id, a.libelle, a.nature, a.prix_unitaire,
           CASE WHEN a.nature = 'mensuel' THEN 1 ELSE (c.e ->> 'quantite')::int END,
           a.obligatoire,
           CASE WHEN a.nature = 'mensuel' THEN p_mois_debut_services END
    FROM jsonb_array_elements(v_choix) AS c(e)
    JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                                  AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole
    WHERE a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0
    ORDER BY a.ordre;

    -- Encaissement : chaque ligne doit correspondre à un élément réellement dû d'une inscription neuve
    -- (aucun paiement antérieur), avec 0 < montant <= reste dû. Le montant exact est calculé par le serveur.
    IF p_mode IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_lignes) AS c(e)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            WHERE CASE c.e ->> 'type'
                WHEN 'inscription' THEN (c.e ->> 'montant')::int > v_classe.frais_inscription
                WHEN 'mensualite' THEN
                    (c.e ->> 'mois')::date NOT IN (
                        SELECT (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date
                        FROM generate_series(0, v_nb_mois - 1) AS g(i))
                    -- Dû exact du mois (comme situationInscription) : tarif du dernier mois pour le dernier, mensualité sinon
                    OR (c.e ->> 'montant')::int >
                       CASE WHEN (c.e ->> 'mois')::date =
                                 (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + v_nb_mois - 1) * interval '1 month'))::date
                            THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                            ELSE v_classe.mensualite END - p_reduction
                ELSE ai.id IS NULL OR ai.nature <> 'unique' OR (c.e ->> 'montant')::int > ai.prix_unitaire * ai.quantite
            END
        ) THEN
            RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
        END IF;

        -- Un seul INSERT : les lignes partagent le lot_id, donc le même numéro de reçu (trigger numeroter_recu).
        -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
        v_lot := gen_random_uuid();
        WITH inseres AS (
            INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id)
            SELECT v_ecole, v_inscription, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
                   p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), v_lot, ai.id
            FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            ORDER BY c.n
            RETURNING numero_recu, montant
        )
        SELECT min(numero_recu), sum(montant) INTO v_numero_recu, v_montant_encaisse FROM inseres;
    END IF;

    RETURN jsonb_build_object(
        'eleve_id', v_eleve,
        'inscription_id', v_inscription,
        'parent_id', v_parent,
        'parent_cree', v_parent_cree,
        'matricule', v_matricule,
        'numero_recu', v_numero_recu,
        'montant_encaisse', v_montant_encaisse
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    TO authenticated;

-- ==============================================================================
-- v1.8 : encaissement atomique (fonction encaisser_paiement).
-- Les lignes d'un encaissement sont créées en une seule transaction, sous verrou de l'inscription
-- (SELECT … FOR NO KEY UPDATE) : deux encaissements simultanés pour un même élève passent l'un après l'autre.
--  1. Rejeu : si p_lot_id a déjà servi pour exactement cet encaissement (même élève, même total, même nombre
--     de lignes), la fonction renvoie le reçu existant (rejoue = true) sans rien insérer. Autre contenu : FJ412.
--  2. Empreinte : le serveur envoie ce qu'il a lu (nombre de paiements annulés compris, total non annulé) ;
--     si la base voit autre chose sous verrou, un autre encaissement ou une annulation est passé : FJ412.
--  3. Plafonds : pour chaque ligne, cumul des paiements non annulés du même élément + montant <= dû, d'après
--     les tarifs figés de l'inscription (borne haute : le calcul fin reste celui de situationInscription).
--     Le rejeu compare le contenu (type, mois, article, montant, libellé du paiement libre) ; un lot annulé
--     n'est jamais rejoué (FJ412).
--  4. Un seul INSERT … SELECT avec lot_id = p_lot_id : le trigger numeroter_recu donne un seul numéro.
-- Verrou advisory (école, lot_id) pris après celui de l'inscription : un même lot_id présenté pour deux élèves
-- à la fois est sérialisé (le trigger numeroter_recu ne voit pas les lignes non validées d'une autre transaction).
-- SECURITY INVOKER : la RLS École s'applique ; ecole_id vient du JWT. Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.encaisser_paiement(
    p_inscription_id UUID,
    p_lot_id UUID,
    p_mode TEXT,
    p_reference TEXT,
    p_lignes JSONB,
    p_nb_paiements INTEGER,
    p_total_actif BIGINT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_lignes JSONB := coalesce(p_lignes, '[]'::jsonb);
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_ins public.inscriptions%ROWTYPE;
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_mois_liste DATE[];
    v_dernier DATE;
    v_nb_demande INTEGER;
    v_total_demande BIGINT;
    v_nb_lot INTEGER;
    v_total_lot BIGINT;
    v_ins_lot INTEGER;
    v_ins_lot_id UUID;
    v_lot_annule BOOLEAN;
    v_identique BOOLEAN;
    v_nb_actuel INTEGER;
    v_total_actuel BIGINT;
    v_l RECORD;
    v_type TEXT;
    v_montant INTEGER;
    v_mois DATE;
    v_article UUID;
    v_art public.articles_inscription%ROWTYPE;
    v_du BIGINT;
    v_deja BIGINT;
    v_numero TEXT;
    v_encaisse BIGINT;
    v_ids UUID[];
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_inscription_id IS NULL OR p_lot_id IS NULL OR p_nb_paiements IS NULL OR p_total_actif IS NULL
       OR p_nb_paiements < 0 OR p_total_actif < 0 THEN
        RAISE EXCEPTION 'Encaissement incomplet, réessayez.' USING ERRCODE = 'FJ422';
    END IF;

    -- Mode et référence (obligatoire pour le mobile money)
    IF p_mode IS NULL OR p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
        RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
        RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
    END IF;
    IF length(v_reference) > 60 THEN
        RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
    END IF;

    -- Forme des lignes, vérifiée champ par champ avant tout cast
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                     OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                     OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                     OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                     OR coalesce(jsonb_typeof(c.e -> 'article_id'), 'null') NOT IN ('string', 'null')
                     OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                     OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                     OR coalesce(c.e ->> 'article_id', '00000000-0000-0000-0000-000000000000')
                        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR length(coalesce(c.e ->> 'libelle', '')) > 120
                     OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_id' IS NOT NULL))
                     OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_id' IS NOT NULL))
                     -- Paiement libre (sans article) : un libellé de 1 à 80 caractères, pas de mois
                     OR (c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL
                         AND (c.e ->> 'mois' IS NOT NULL
                              OR length(btrim(coalesce(c.e ->> 'libelle', ''))) NOT BETWEEN 1 AND 80)))
       OR (SELECT count(*) FROM jsonb_array_elements(v_lignes))
          <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_id', ''))
                                    || '|' || CASE WHEN c.e ->> 'article_id' IS NULL AND c.e ->> 'type' = 'autre' THEN btrim(c.e ->> 'libelle') ELSE '' END)
              FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    SELECT count(*), sum((c.e ->> 'montant')::int) INTO v_nb_demande, v_total_demande FROM jsonb_array_elements(v_lignes) AS c(e);

    -- Verrou de l'inscription : les encaissements simultanés d'un même élève passent l'un après l'autre
    SELECT * INTO v_ins FROM public.inscriptions WHERE id = p_inscription_id AND ecole_id = v_ecole FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Inscription introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_ins.annee_scolaire !~ '^[0-9]{4}-[0-9]{4}$' THEN
        RAISE EXCEPTION 'Année scolaire invalide pour cette inscription.' USING ERRCODE = 'FJ422';
    END IF;
    -- Un même lot_id demandé pour deux élèves à la fois ne doit pas échapper au contrôle du trigger numeroter_recu
    PERFORM pg_advisory_xact_lock(hashtextextended('lot:' || v_ecole::text || ':' || p_lot_id::text, 0));
    SELECT mois_debut, nb_mensualites INTO v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_mois_debut IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;

    -- 1. Rejeu : la clé a déjà servi
    SELECT count(*), coalesce(sum(montant), 0), count(DISTINCT inscription_id), min(inscription_id::text)::uuid,
           min(numero_recu), array_agg(id ORDER BY created_at, id), bool_or(annule)
      INTO v_nb_lot, v_total_lot, v_ins_lot, v_ins_lot_id, v_numero, v_ids, v_lot_annule
    FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id;
    IF v_nb_lot > 0 THEN
        IF v_lot_annule THEN
            RAISE EXCEPTION 'Ce reçu a été annulé : recommencez un nouvel encaissement.' USING ERRCODE = 'FJ412';
        END IF;
        -- Même élève et exactement les mêmes lignes (comparaison de multiensembles dans les deux sens)
        v_identique := v_ins_lot = 1 AND v_ins_lot_id = p_inscription_id AND v_total_lot = v_total_demande AND v_nb_lot = v_nb_demande
            AND NOT EXISTS (
                (SELECT type, mois, article_id, montant::bigint,
                        CASE WHEN type = 'autre' AND article_id IS NULL THEN nullif(btrim(coalesce(libelle, '')), '') END
                 FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id
                 EXCEPT ALL
                 SELECT c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'article_id')::uuid, (c.e ->> 'montant')::bigint,
                        CASE WHEN c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL THEN nullif(btrim(coalesce(c.e ->> 'libelle', '')), '') END
                 FROM jsonb_array_elements(v_lignes) AS c(e))
                UNION ALL
                (SELECT c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'article_id')::uuid, (c.e ->> 'montant')::bigint,
                        CASE WHEN c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL THEN nullif(btrim(coalesce(c.e ->> 'libelle', '')), '') END
                 FROM jsonb_array_elements(v_lignes) AS c(e)
                 EXCEPT ALL
                 SELECT type, mois, article_id, montant::bigint,
                        CASE WHEN type = 'autre' AND article_id IS NULL THEN nullif(btrim(coalesce(libelle, '')), '') END
                 FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id)
            );
        IF v_identique THEN
            RETURN jsonb_build_object('numero_recu', v_numero, 'montant_encaisse', v_total_lot, 'ids', to_jsonb(v_ids), 'rejoue', true);
        END IF;
        RAISE EXCEPTION 'Cette clé d''encaissement a déjà servi pour un autre encaissement : rechargez la page et recommencez.'
            USING ERRCODE = 'FJ412';
    END IF;

    -- 2. Empreinte : rien n'a bougé pour cet élève depuis la lecture du serveur
    SELECT count(*), coalesce(sum(montant) FILTER (WHERE NOT annule), 0) INTO v_nb_actuel, v_total_actuel
    FROM public.paiements WHERE inscription_id = p_inscription_id AND ecole_id = v_ecole;
    IF v_nb_actuel <> p_nb_paiements OR v_total_actuel <> p_total_actif THEN
        RAISE EXCEPTION 'Un autre encaissement ou une annulation vient d''être enregistré pour cet élève : vérifiez la fiche et recommencez.'
            USING ERRCODE = 'FJ412';
    END IF;

    -- 3. Plafonds, d'après les tarifs figés de l'inscription
    SELECT array_agg((make_date(substr(v_ins.annee_scolaire, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date ORDER BY i)
      INTO v_mois_liste FROM generate_series(0, v_nb_mois - 1) AS g(i);
    v_dernier := v_mois_liste[array_length(v_mois_liste, 1)];

    FOR v_l IN SELECT c.e AS e FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n) ORDER BY c.n LOOP
        v_type := v_l.e ->> 'type';
        v_montant := (v_l.e ->> 'montant')::int;
        v_mois := (v_l.e ->> 'mois')::date;
        v_article := (v_l.e ->> 'article_id')::uuid;

        IF v_type = 'inscription' THEN
            v_du := v_ins.frais_inscription;
            SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
            WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND type = 'inscription';

        ELSIF v_type = 'mensualite' THEN
            IF NOT (v_mois = ANY (v_mois_liste)) THEN
                RAISE EXCEPTION 'Mois invalide pour cette année scolaire.' USING ERRCODE = 'FJ422';
            END IF;
            -- Dû du mois : tarif du dernier mois pour le dernier, mensualité sinon, moins la réduction
            v_du := greatest(0, (CASE WHEN v_mois = v_dernier THEN coalesce(v_ins.mensualite_dernier_mois, v_ins.mensualite)
                                      ELSE v_ins.mensualite END) - v_ins.reduction_mensuelle);
            SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
            WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND type = 'mensualite' AND mois = v_mois;

        ELSIF v_article IS NOT NULL THEN
            SELECT * INTO v_art FROM public.articles_inscription
            WHERE id = v_article AND inscription_id = v_ins.id AND ecole_id = v_ecole;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Article introuvable pour cet élève.' USING ERRCODE = 'FJ404';
            END IF;
            IF v_art.nature = 'unique' THEN
                IF v_mois IS NOT NULL THEN
                    RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
                END IF;
                v_du := v_art.prix_unitaire::bigint * v_art.quantite;
                SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
                WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND article_id = v_art.id;
            ELSE
                -- Service mensuel : un mois de l'année, prix_unitaire par mois
                IF v_mois IS NULL OR NOT (v_mois = ANY (v_mois_liste)) THEN
                    RAISE EXCEPTION 'Mois invalide pour cette année scolaire.' USING ERRCODE = 'FJ422';
                END IF;
                v_du := v_art.prix_unitaire;
                SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
                WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND article_id = v_art.id AND mois = v_mois;
            END IF;

        ELSE
            -- Paiement libre hors catalogue : réservé à un élève encore inscrit, sans plafond de cumul
            IF v_ins.statut <> 'active' THEN
                RAISE EXCEPTION 'Élève parti : seul le solde dû peut être encaissé.' USING ERRCODE = 'FJ412';
            END IF;
            v_du := 99999999;
            v_deja := 0;
        END IF;

        IF v_deja + v_montant > v_du THEN
            RAISE EXCEPTION 'Le montant dépasse ce qui reste dû pour cet élément : vérifiez la fiche et recommencez.' USING ERRCODE = 'FJ412';
        END IF;
    END LOOP;

    -- 4. Un seul INSERT : les lignes partagent p_lot_id, donc le même numéro de reçu (trigger numeroter_recu).
    -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
    WITH inseres AS (
        INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id)
        SELECT v_ecole, v_ins.id, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
               p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), p_lot_id, (c.e ->> 'article_id')::uuid
        FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
        ORDER BY c.n
        RETURNING id, numero_recu, montant
    )
    SELECT min(numero_recu), sum(montant), array_agg(id) INTO v_numero, v_encaisse, v_ids FROM inseres;

    RETURN jsonb_build_object('numero_recu', v_numero, 'montant_encaisse', v_encaisse, 'ids', to_jsonb(v_ids), 'rejoue', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encaisser_paiement(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, BIGINT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encaisser_paiement(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, BIGINT)
    TO authenticated;

-- ==============================================================================
-- v1.9 : enregistrement d'une classe et de son catalogue en une seule transaction (fonction enregistrer_classe).
-- Création ou modification de la classe, puis catalogue d'articles (lignes gardées mises à jour sur place,
-- nouvelles lignes insérées, lignes retirées supprimées) : un échec n'écrit rien.
-- SECURITY INVOKER : la RLS École s'applique ; ecole_id vient du JWT, jamais d'un paramètre.
--  - p_articles NULL : le catalogue n'est pas touché ; '[]' : le catalogue est vidé.
--  - Une ligne garde son id (donc le lien articles_inscription.article_classe_id) si cet id appartient à la classe ;
--    un id inconnu de la classe donne une nouvelle ligne. Supprimer une ligne met à NULL le lien des élèves déjà
--    inscrits (ON DELETE SET NULL) : ils gardent leur copie et leur prix.
--  - Modification : la classe est verrouillée (FOR NO KEY UPDATE) avant le catalogue : deux postes ne mélangent pas
--    deux catalogues, et une inscription dans cette classe (inscrire_eleve, FOR SHARE de la classe, v1.10) attend
--    la fin de l'enregistrement au lieu de lire un catalogue en cours de modification.
--  - Création : l'année scolaire est lue dans la base sous FOR SHARE de l'école (sérialisée avec un changement
--    d'année). Nom déjà pris cette année : l'erreur 23505 remonte telle quelle.
-- La validation métier reste en TypeScript (lireArticles, src/lib/classe-catalogue.ts) ; la base revérifie les
-- formes et les plafonds avant tout cast (FJ422, un message par cause).
-- ==============================================================================
DO $$
BEGIN
    -- Plafonds du catalogue (NOT VALID : les lignes existantes ne sont pas revérifiées, les nouvelles le sont)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_classe_prix_unitaire_max') THEN
        ALTER TABLE public.articles_classe ADD CONSTRAINT articles_classe_prix_unitaire_max
            CHECK (prix_unitaire <= 99999999) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_classe_libelle_longueur') THEN
        ALTER TABLE public.articles_classe ADD CONSTRAINT articles_classe_libelle_longueur
            CHECK (length(libelle) <= 120) NOT VALID;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enregistrer_classe(
    p_classe_id UUID DEFAULT NULL,
    p_nom TEXT DEFAULT NULL,
    p_niveau TEXT DEFAULT NULL,
    p_frais_inscription INTEGER DEFAULT NULL,
    p_mensualite INTEGER DEFAULT NULL,
    p_mensualite_dernier_mois INTEGER DEFAULT NULL,
    p_articles JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_annee TEXT;
    v_classe UUID;
    v_ligne JSONB;
    v_libelle TEXT;
    v_nb_articles INTEGER := 0;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;

    -- Classe
    IF length(v_nom) NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'Indiquez le nom de la classe (ex : CM2 A).' USING ERRCODE = 'FJ422';
    END IF;
    IF p_niveau IS NULL OR p_niveau NOT IN ('prescolaire', 'elementaire', 'moyen', 'secondaire') THEN
        RAISE EXCEPTION 'Niveau inconnu.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_frais_inscription IS NULL OR p_mensualite IS NULL
       OR p_frais_inscription NOT BETWEEN 0 AND 99999999 OR p_mensualite NOT BETWEEN 0 AND 99999999 THEN
        RAISE EXCEPTION 'Montants invalides (en FCFA, sans décimales).' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mensualite_dernier_mois IS NOT NULL AND p_mensualite_dernier_mois NOT BETWEEN 0 AND 99999999 THEN
        RAISE EXCEPTION 'Mensualité du dernier mois invalide.' USING ERRCODE = 'FJ422';
    END IF;

    -- Catalogue : forme de chaque ligne vérifiée avant tout cast
    IF p_articles IS NOT NULL THEN
        IF jsonb_typeof(p_articles) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_array_length(p_articles) > 30 THEN
            RAISE EXCEPTION '30 articles au plus par classe.' USING ERRCODE = 'FJ422';
        END IF;
        FOR v_ligne IN SELECT e FROM jsonb_array_elements(p_articles) AS c(e) LOOP
            IF jsonb_typeof(v_ligne) IS DISTINCT FROM 'object'
               OR coalesce(jsonb_typeof(v_ligne -> 'id'), 'null') NOT IN ('string', 'null')
               OR coalesce(v_ligne ->> 'id', '00000000-0000-0000-0000-000000000000')
                  !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               OR jsonb_typeof(v_ligne -> 'libelle') IS DISTINCT FROM 'string'
               OR jsonb_typeof(v_ligne -> 'obligatoire') IS DISTINCT FROM 'boolean'
               OR jsonb_typeof(v_ligne -> 'ordre') IS DISTINCT FROM 'number'
               OR coalesce(v_ligne ->> 'ordre', '') !~ '^[0-9]{1,3}$' THEN
                RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
            END IF;
            v_libelle := v_ligne ->> 'libelle';
            IF btrim(v_libelle) = '' OR length(v_libelle) > 60 THEN
                RAISE EXCEPTION 'Libellé d''article vide ou trop long (60 caractères au plus).' USING ERRCODE = 'FJ422';
            END IF;
            IF coalesce(v_ligne ->> 'nature', '') NOT IN ('unique', 'mensuel') THEN
                RAISE EXCEPTION 'Nature inconnue pour « % ».', v_libelle USING ERRCODE = 'FJ422';
            END IF;
            IF jsonb_typeof(v_ligne -> 'prix_unitaire') IS DISTINCT FROM 'number'
               OR coalesce(v_ligne ->> 'prix_unitaire', '') !~ '^(0|[1-9][0-9]{0,7})$' THEN
                RAISE EXCEPTION 'Prix invalide pour « % ».', v_libelle USING ERRCODE = 'FJ422';
            END IF;
            IF jsonb_typeof(v_ligne -> 'quantite_defaut') IS DISTINCT FROM 'number'
               OR coalesce(v_ligne ->> 'quantite_defaut', '') !~ '^[0-9]{1,2}$'
               OR (v_ligne ->> 'nature' = 'mensuel' AND v_ligne ->> 'quantite_defaut' <> '1') THEN
                RAISE EXCEPTION 'Quantité invalide pour « % ».', v_libelle USING ERRCODE = 'FJ422';
            END IF;
        END LOOP;
        -- Un même id ne peut désigner qu'une ligne
        IF (SELECT count(*) FROM jsonb_array_elements(p_articles) AS c(e) WHERE c.e ->> 'id' IS NOT NULL)
           <> (SELECT count(DISTINCT lower(c.e ->> 'id')) FROM jsonb_array_elements(p_articles) AS c(e) WHERE c.e ->> 'id' IS NOT NULL) THEN
            RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
        END IF;
    END IF;

    -- Écriture de la classe
    IF p_classe_id IS NOT NULL THEN
        SELECT id INTO v_classe FROM public.classes WHERE id = p_classe_id AND ecole_id = v_ecole FOR NO KEY UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Classe introuvable.' USING ERRCODE = 'FJ404';
        END IF;
        UPDATE public.classes
        SET nom = v_nom, niveau = p_niveau, frais_inscription = p_frais_inscription,
            mensualite = p_mensualite, mensualite_dernier_mois = p_mensualite_dernier_mois
        WHERE id = v_classe AND ecole_id = v_ecole;
    ELSE
        SELECT annee_scolaire INTO v_annee FROM public.ecoles WHERE id = v_ecole FOR SHARE;
        IF v_annee IS NULL THEN
            RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
        END IF;
        INSERT INTO public.classes (ecole_id, annee_scolaire, nom, niveau, frais_inscription, mensualite, mensualite_dernier_mois)
        VALUES (v_ecole, v_annee, v_nom, p_niveau, p_frais_inscription, p_mensualite, p_mensualite_dernier_mois)
        RETURNING id INTO v_classe;
    END IF;

    -- Écriture du catalogue
    IF p_articles IS NOT NULL THEN
        -- 1. Lignes gardées (id de cette classe) : mises à jour sur place
        UPDATE public.articles_classe a
        SET libelle = c.e ->> 'libelle', nature = c.e ->> 'nature', prix_unitaire = (c.e ->> 'prix_unitaire')::int,
            quantite_defaut = (c.e ->> 'quantite_defaut')::int, obligatoire = (c.e ->> 'obligatoire')::boolean,
            ordre = (c.e ->> 'ordre')::int
        FROM jsonb_array_elements(p_articles) AS c(e)
        WHERE c.e ->> 'id' IS NOT NULL AND a.id = (c.e ->> 'id')::uuid
          AND a.classe_id = v_classe AND a.ecole_id = v_ecole;
        -- 2. Lignes retirées de la saisie : supprimées
        DELETE FROM public.articles_classe a
        WHERE a.classe_id = v_classe AND a.ecole_id = v_ecole
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_articles) AS c(e)
                          WHERE c.e ->> 'id' IS NOT NULL AND (c.e ->> 'id')::uuid = a.id);
        -- 3. Nouvelles lignes (sans id, ou id inconnu de cette classe) : insérées avec un nouvel id
        INSERT INTO public.articles_classe (ecole_id, classe_id, libelle, nature, prix_unitaire, quantite_defaut, obligatoire, ordre)
        SELECT v_ecole, v_classe, c.e ->> 'libelle', c.e ->> 'nature', (c.e ->> 'prix_unitaire')::int,
               (c.e ->> 'quantite_defaut')::int, (c.e ->> 'obligatoire')::boolean, (c.e ->> 'ordre')::int
        FROM jsonb_array_elements(p_articles) WITH ORDINALITY AS c(e, n)
        WHERE c.e ->> 'id' IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.articles_classe a
                          WHERE a.id = (c.e ->> 'id')::uuid AND a.classe_id = v_classe AND a.ecole_id = v_ecole)
        ORDER BY c.n;
    END IF;

    SELECT count(*) INTO v_nb_articles FROM public.articles_classe WHERE classe_id = v_classe AND ecole_id = v_ecole;
    RETURN jsonb_build_object('classe_id', v_classe, 'creee', p_classe_id IS NULL, 'nb_articles', v_nb_articles);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enregistrer_classe(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enregistrer_classe(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB)
    TO authenticated;

-- ==============================================================================
-- v1.10 : prix d'article plafonné, produit prix × quantité en bigint (finding H4), classe verrouillée à l'inscription.
-- articles_inscription.prix_unitaire reçoit le même plafond que le catalogue (v1.9) ; NOT VALID : les lignes
-- existantes ne sont pas revérifiées. inscrire_eleve est redéfinie à l'identique du bloc v1.7, sauf le contrôle
-- d'un paiement d'article unique : ai.prix_unitaire::bigint * ai.quantite (99 999 999 × 99 dépasse l'entier
-- 32 bits : erreur 22003 et inscription refusée sans message clair), et le verrou partagé de la classe
-- (SELECT … FOR SHARE) : un article retiré du catalogue pendant l'inscription ne peut plus disparaître en silence
-- de l'inscription (l'inscription attend la fin de enregistrer_classe, puis voit le catalogue à jour).
-- Même signature : aucune surcharge.
-- Bloc final : garder en dernier.
-- ==============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_inscription_prix_unitaire_max') THEN
        ALTER TABLE public.articles_inscription ADD CONSTRAINT articles_inscription_prix_unitaire_max
            CHECK (prix_unitaire <= 99999999) NOT VALID;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inscrire_eleve(
    p_classe_id UUID,
    p_eleve_id UUID DEFAULT NULL,
    p_prenom TEXT DEFAULT NULL,
    p_nom TEXT DEFAULT NULL,
    p_sexe TEXT DEFAULT NULL,
    p_date_naissance DATE DEFAULT NULL,
    p_parent_nom TEXT DEFAULT NULL,
    p_parent_telephone TEXT DEFAULT NULL,
    p_reduction INTEGER DEFAULT 0,
    p_articles JSONB DEFAULT '[]'::jsonb,
    p_mois_debut_services DATE DEFAULT NULL,
    p_mode TEXT DEFAULT NULL,
    p_reference TEXT DEFAULT NULL,
    p_lignes_paiement JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_annee TEXT;
    v_classe public.classes%ROWTYPE;
    v_choix JSONB := coalesce(p_articles, '[]'::jsonb);
    v_lignes JSONB := coalesce(p_lignes_paiement, '[]'::jsonb);
    v_prenom TEXT := btrim(coalesce(p_prenom, ''));
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_parent_nom TEXT := btrim(coalesce(p_parent_nom, ''));
    v_manquant TEXT;
    v_eleve UUID;
    v_parent UUID;
    v_parent_cree BOOLEAN := false;
    v_prefixe TEXT;
    v_num BIGINT;
    v_matricule TEXT;
    v_inscription UUID;
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_lot UUID;
    v_numero_recu TEXT;
    v_montant_encaisse BIGINT := 0;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    -- Encaissement demandé : mode valide, référence (obligatoire pour le mobile money), lignes bien formées.
    -- Aucun cast avant que la forme de chaque champ soit vérifiée.
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IS NULL THEN
        IF v_reference IS NOT NULL OR jsonb_array_length(v_lignes) > 0 THEN
            RAISE EXCEPTION 'Mode de paiement manquant.' USING ERRCODE = 'FJ422';
        END IF;
    ELSE
        IF p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
            RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
        END IF;
        IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
            RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_reference) > 60 THEN
            RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                      WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                         OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                         OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                         OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                         OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'article_classe_id'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                         OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                         OR coalesce(c.e ->> 'article_classe_id', '00000000-0000-0000-0000-000000000000')
                            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         OR length(coalesce(c.e ->> 'libelle', '')) > 120
                         -- Cohérence du type : inscription sans mois ni article, mensualité avec mois, article avec type « autre »
                         OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'autre' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NULL)))
           OR (SELECT count(*) FROM jsonb_array_elements(v_lignes))
              <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_classe_id', '')))
                  FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
            RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
        END IF;
    END IF;

    -- Année scolaire de l'école et classe choisie (active, de la même année)
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    -- Verrou partagé de la classe (v1.10) : un enregistrement du catalogue (enregistrer_classe, FOR NO KEY UPDATE)
    -- passe avant ou après cette inscription, jamais pendant. Deux inscriptions dans la même classe ne se bloquent pas.
    SELECT * INTO v_classe FROM public.classes WHERE id = p_classe_id AND ecole_id = v_ecole AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Choisissez une classe.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
        RAISE EXCEPTION 'Cette classe appartient à l''année %.', v_classe.annee_scolaire USING ERRCODE = 'FJ412';
    END IF;
    IF p_reduction IS NULL OR p_reduction < 0 THEN
        RAISE EXCEPTION 'Réduction invalide.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_reduction > v_classe.mensualite THEN
        RAISE EXCEPTION 'La réduction dépasse la mensualité.' USING ERRCODE = 'FJ422';
    END IF;

    -- Articles retenus : [{article_classe_id, quantite}], chacun du catalogue de cette classe, une seule fois
    IF jsonb_typeof(v_choix) IS DISTINCT FROM 'array' OR jsonb_array_length(v_choix) > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR coalesce(c.e ->> 'quantite', '') !~ '^[0-9]{1,2}$')
       OR (SELECT count(*) FROM jsonb_array_elements(v_choix))
          <> (SELECT count(DISTINCT lower(e ->> 'article_classe_id')) FROM jsonb_array_elements(v_choix) AS c(e)) THEN
        RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
               WHERE NOT EXISTS (SELECT 1 FROM public.articles_classe a
                                 WHERE a.id = (c.e ->> 'article_classe_id')::uuid
                                   AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole)) THEN
        RAISE EXCEPTION 'Article introuvable pour cette classe.' USING ERRCODE = 'FJ404';
    END IF;
    -- Un article obligatoire (service mensuel, ou frais unique avec une quantité par défaut) doit être retenu
    SELECT a.libelle INTO v_manquant
    FROM public.articles_classe a
    WHERE a.classe_id = v_classe.id AND a.ecole_id = v_ecole AND a.obligatoire
      AND (a.nature = 'mensuel' OR a.quantite_defaut > 0)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                      WHERE (c.e ->> 'article_classe_id')::uuid = a.id
                        AND (a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0))
    ORDER BY a.ordre
    LIMIT 1;
    IF v_manquant IS NOT NULL THEN
        RAISE EXCEPTION '« % » est obligatoire pour cette classe.', v_manquant USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                   JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                   WHERE a.nature = 'mensuel') THEN
        RAISE EXCEPTION 'Mois de début des services manquant.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NOT NULL AND extract(day FROM p_mois_debut_services) <> 1 THEN
        RAISE EXCEPTION 'Mois de début des services invalide.' USING ERRCODE = 'FJ422';
    END IF;

    IF p_eleve_id IS NOT NULL THEN
        -- Réinscription : l'élève existe dans l'école, son parent ne change pas
        SELECT id, parent_id INTO v_eleve, v_parent FROM public.eleves WHERE id = p_eleve_id AND ecole_id = v_ecole;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Élève introuvable.' USING ERRCODE = 'FJ404';
        END IF;
    ELSE
        IF v_prenom = '' OR v_nom = '' THEN
            RAISE EXCEPTION 'Prénom et nom de l''élève obligatoires.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_prenom) > 60 OR length(v_nom) > 60 THEN
            RAISE EXCEPTION 'Prénom ou nom de l''élève trop long.' USING ERRCODE = 'FJ422';
        END IF;
        IF v_parent_nom = '' OR length(v_parent_nom) > 80 OR coalesce(p_parent_telephone, '') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION 'Nom et téléphone du parent obligatoires (ex : 77 123 45 67).' USING ERRCODE = 'FJ422';
        END IF;
        IF p_sexe IS NOT NULL AND p_sexe NOT IN ('M', 'F') THEN
            RAISE EXCEPTION 'Sexe invalide.' USING ERRCODE = 'FJ422';
        END IF;

        -- Parent : le même téléphone dans l'école désigne le même parent (son nom et son lien ne changent pas)
        INSERT INTO public.parents AS p (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, p_parent_telephone)
        ON CONFLICT (ecole_id, telephone) DO UPDATE SET nom = p.nom
        RETURNING p.id, (p.xmax = 0) INTO v_parent, v_parent_cree;

        -- Matricule : 2 chiffres de l'année + plus grand numéro existant + 1 (au moins 4 chiffres).
        -- Le verrou sérialise les inscriptions simultanées de l'école jusqu'à la fin de la transaction.
        v_prefixe := substr(v_annee, 3, 2);
        PERFORM pg_advisory_xact_lock(hashtextextended('matricule:' || v_ecole::text || ':' || v_prefixe, 0));
        SELECT coalesce(max(substr(matricule, 3)::bigint), 0) + 1 INTO v_num
        FROM public.eleves
        WHERE ecole_id = v_ecole AND matricule ~ ('^' || v_prefixe || '[0-9]{1,12}$');
        v_matricule := v_prefixe || lpad(v_num::text, greatest(4, length(v_num::text)), '0');

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, p_sexe, p_date_naissance)
        RETURNING id INTO v_eleve;
    END IF;

    -- Inscription : tarifs figés depuis la classe (un élève déjà inscrit cette année lève 23505)
    INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                     mensualite_dernier_mois, reduction_mensuelle)
    VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
            v_classe.mensualite_dernier_mois, p_reduction)
    RETURNING id INTO v_inscription;

    -- Articles : libellé, nature, prix et obligation recopiés du catalogue ; un service mensuel compte pour 1
    INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                             prix_unitaire, quantite, obligatoire, mois_debut)
    SELECT v_ecole, v_inscription, a.id, a.libelle, a.nature, a.prix_unitaire,
           CASE WHEN a.nature = 'mensuel' THEN 1 ELSE (c.e ->> 'quantite')::int END,
           a.obligatoire,
           CASE WHEN a.nature = 'mensuel' THEN p_mois_debut_services END
    FROM jsonb_array_elements(v_choix) AS c(e)
    JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                                  AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole
    WHERE a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0
    ORDER BY a.ordre;

    -- Encaissement : chaque ligne doit correspondre à un élément réellement dû d'une inscription neuve
    -- (aucun paiement antérieur), avec 0 < montant <= reste dû. Le montant exact est calculé par le serveur.
    IF p_mode IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_lignes) AS c(e)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            WHERE CASE c.e ->> 'type'
                WHEN 'inscription' THEN (c.e ->> 'montant')::int > v_classe.frais_inscription
                WHEN 'mensualite' THEN
                    (c.e ->> 'mois')::date NOT IN (
                        SELECT (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date
                        FROM generate_series(0, v_nb_mois - 1) AS g(i))
                    -- Dû exact du mois (comme situationInscription) : tarif du dernier mois pour le dernier, mensualité sinon
                    OR (c.e ->> 'montant')::int >
                       CASE WHEN (c.e ->> 'mois')::date =
                                 (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + v_nb_mois - 1) * interval '1 month'))::date
                            THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                            ELSE v_classe.mensualite END - p_reduction
                ELSE ai.id IS NULL OR ai.nature <> 'unique' OR (c.e ->> 'montant')::int > ai.prix_unitaire::bigint * ai.quantite
            END
        ) THEN
            RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
        END IF;

        -- Un seul INSERT : les lignes partagent le lot_id, donc le même numéro de reçu (trigger numeroter_recu).
        -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
        v_lot := gen_random_uuid();
        WITH inseres AS (
            INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id)
            SELECT v_ecole, v_inscription, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
                   p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), v_lot, ai.id
            FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            ORDER BY c.n
            RETURNING numero_recu, montant
        )
        SELECT min(numero_recu), sum(montant) INTO v_numero_recu, v_montant_encaisse FROM inseres;
    END IF;

    RETURN jsonb_build_object(
        'eleve_id', v_eleve,
        'inscription_id', v_inscription,
        'parent_id', v_parent,
        'parent_cree', v_parent_cree,
        'matricule', v_matricule,
        'numero_recu', v_numero_recu,
        'montant_encaisse', v_montant_encaisse
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    TO authenticated;

-- ==============================================================================
-- v1.11 : paramètres de l'école et passage à l'année suivante en une seule transaction (fonction
-- enregistrer_parametres). Réglages de l'école, puis, si l'année change et que la nouvelle année n'a encore
-- aucune classe : copie des classes actives de l'année quittée et de leur catalogue d'articles. Un échec n'écrit
-- rien (ni année changée sans classes, ni classes sans catalogue).
-- SECURITY INVOKER : la RLS École s'applique (ecole_modifie_sa_fiche, ecole_gere_ses_classes, …) ; ecole_id vient
-- du JWT. L'école est verrouillée (FOR NO KEY UPDATE) avant toute lecture : deux enregistrements simultanés passent
-- l'un après l'autre, et une création de classe (enregistrer_classe, FOR SHARE de l'école) ne peut pas se glisser
-- entre le comptage et la copie. Classes de la nouvelle année déjà présentes (archivées comprises) : aucune copie,
-- l'année change quand même (classes_deja_presentes > 0, l'école est prévenue).
-- Les règles croisées du calendrier (verifierReglages, tranches) restent en TypeScript ; la base revérifie les formes
-- et les bornes (FJ422). Tranches désactivées : mois_debut_tranches et nb_tranches à NULL, rang_mois_tranches à 1.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.enregistrer_parametres(
    p_nom TEXT DEFAULT NULL,
    p_ville TEXT DEFAULT NULL,
    p_adresse TEXT DEFAULT NULL,
    p_responsable_nom TEXT DEFAULT NULL,
    p_telephone_contact TEXT DEFAULT NULL,
    p_annee_scolaire TEXT DEFAULT NULL,
    p_mois_debut INTEGER DEFAULT NULL,
    p_nb_mensualites INTEGER DEFAULT NULL,
    p_jour_echeance INTEGER DEFAULT NULL,
    p_tranches_dernier_mois BOOLEAN DEFAULT false,
    p_mois_debut_tranches INTEGER DEFAULT NULL,
    p_nb_tranches INTEGER DEFAULT NULL,
    p_rang_mois_tranches INTEGER DEFAULT 1,
    p_premier_mois_a_linscription BOOLEAN DEFAULT false,
    p_dernier_mois_a_linscription BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_ville TEXT := nullif(btrim(coalesce(p_ville, '')), '');
    v_adresse TEXT := nullif(btrim(coalesce(p_adresse, '')), '');
    v_responsable TEXT := nullif(btrim(coalesce(p_responsable_nom, '')), '');
    v_telephone TEXT := nullif(btrim(coalesce(p_telephone_contact, '')), '');
    v_annee TEXT := btrim(coalesce(p_annee_scolaire, ''));
    v_tranches BOOLEAN := coalesce(p_tranches_dernier_mois, false);
    v_ancienne TEXT;
    v_deja INTEGER := 0;
    v_classes INTEGER := 0;
    v_articles INTEGER := 0;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;

    -- Formes et bornes (messages identiques à enregistrerParametres)
    IF length(v_nom) NOT BETWEEN 2 AND 100 THEN
        RAISE EXCEPTION 'Nom de l''école obligatoire.' USING ERRCODE = 'FJ422';
    END IF;
    IF length(v_ville) > 60 OR length(v_adresse) > 120 OR length(v_responsable) > 80 OR length(v_telephone) > 30 THEN
        RAISE EXCEPTION 'Coordonnées de l''école trop longues.' USING ERRCODE = 'FJ422';
    END IF;
    -- CASE : le cast n'est évalué qu'après la regex (l'ordre d'un OR n'est pas garanti)
    IF (CASE WHEN v_annee ~ '^[0-9]{4}-[0-9]{4}$'
             THEN substr(v_annee, 6, 4)::int <> substr(v_annee, 1, 4)::int + 1
             ELSE true END) THEN
        RAISE EXCEPTION 'Année scolaire au format 2026-2027.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut IS NULL OR p_mois_debut NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'Mois de rentrée invalide.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_nb_mensualites IS NULL OR p_nb_mensualites NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'Nombre de mensualités entre 1 et 12.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_jour_echeance IS NULL OR p_jour_echeance NOT BETWEEN 1 AND 28 THEN
        RAISE EXCEPTION 'Jour d''échéance entre 1 et 28.' USING ERRCODE = 'FJ422';
    END IF;
    IF v_tranches THEN
        IF p_rang_mois_tranches IS NULL OR p_rang_mois_tranches NOT BETWEEN 1 AND 3 THEN
            RAISE EXCEPTION 'Mois payé par tranches invalide.' USING ERRCODE = 'FJ422';
        END IF;
        IF p_mois_debut_tranches IS NULL OR p_mois_debut_tranches NOT BETWEEN 1 AND 12 THEN
            RAISE EXCEPTION 'Choisissez le mois de la première tranche.' USING ERRCODE = 'FJ422';
        END IF;
        IF p_nb_tranches IS NULL OR p_nb_tranches NOT BETWEEN 1 AND 11 THEN
            RAISE EXCEPTION 'Nombre de tranches invalide.' USING ERRCODE = 'FJ422';
        END IF;
    END IF;

    -- École verrouillée : l'année quittée est lue sous verrou
    SELECT annee_scolaire INTO v_ancienne FROM public.ecoles WHERE id = v_ecole FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;

    -- Nouvelle année sans classe : reprise des classes actives et de leur catalogue (correspondance par nom,
    -- unique par école et par année)
    IF v_annee <> v_ancienne THEN
        SELECT count(*) INTO v_deja FROM public.classes WHERE ecole_id = v_ecole AND annee_scolaire = v_annee;
        IF v_deja = 0 THEN
            WITH nouvelles AS (
                INSERT INTO public.classes (ecole_id, annee_scolaire, nom, niveau, frais_inscription, mensualite, mensualite_dernier_mois)
                SELECT v_ecole, v_annee, c.nom, c.niveau, c.frais_inscription, c.mensualite, c.mensualite_dernier_mois
                FROM public.classes c
                WHERE c.ecole_id = v_ecole AND c.annee_scolaire = v_ancienne AND c.is_active
                RETURNING id
            )
            SELECT count(*) INTO v_classes FROM nouvelles;

            INSERT INTO public.articles_classe (ecole_id, classe_id, libelle, nature, prix_unitaire, quantite_defaut, obligatoire, ordre)
            SELECT v_ecole, n.id, a.libelle, a.nature, a.prix_unitaire, a.quantite_defaut, a.obligatoire, a.ordre
            FROM public.articles_classe a
            JOIN public.classes o ON o.id = a.classe_id AND o.ecole_id = v_ecole
                                 AND o.annee_scolaire = v_ancienne AND o.is_active
            JOIN public.classes n ON n.ecole_id = v_ecole AND n.annee_scolaire = v_annee AND n.nom = o.nom
            WHERE a.ecole_id = v_ecole;
            GET DIAGNOSTICS v_articles = ROW_COUNT;
        END IF;
    END IF;

    UPDATE public.ecoles
    SET nom = v_nom, ville = v_ville, adresse = v_adresse, responsable_nom = v_responsable,
        telephone_contact = v_telephone, annee_scolaire = v_annee,
        mois_debut = p_mois_debut, nb_mensualites = p_nb_mensualites, jour_echeance = p_jour_echeance,
        tranches_dernier_mois = v_tranches,
        mois_debut_tranches = CASE WHEN v_tranches THEN p_mois_debut_tranches END,
        nb_tranches = CASE WHEN v_tranches THEN p_nb_tranches END,
        rang_mois_tranches = CASE WHEN v_tranches THEN p_rang_mois_tranches ELSE 1 END,
        premier_mois_a_linscription = coalesce(p_premier_mois_a_linscription, false),
        dernier_mois_a_linscription = coalesce(p_dernier_mois_a_linscription, false)
    WHERE id = v_ecole;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;

    RETURN jsonb_build_object(
        'annee_changee', v_annee <> v_ancienne,
        'classes_copiees', v_classes,
        'articles_copies', v_articles,
        'classes_deja_presentes', CASE WHEN v_annee <> v_ancienne THEN v_deja ELSE 0 END
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enregistrer_parametres(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enregistrer_parametres(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN)
    TO authenticated;

-- ==============================================================================
-- v1.13 : un service mensuel ne s'arrête pas avant son dernier mois payé (remplace proteger_article_inscription, v1.5).
-- La règle était tenue seulement par retirerArticleInscription ; elle l'est désormais par la base, quel que soit le
-- chemin (application, éditeur SQL, import). Dernier mois payé = max(mois) des paiements non annulés de l'article
-- (un reçu annulé ne compte plus). Aucun paiement : rien ne bloque. mois_fin NULL (jusqu'à la fin de l'année) :
-- toujours accepté. Le contrôle ne joue que si mois_fin change : une ligne ancienne déjà en violation reste
-- modifiable pour ses autres colonnes (FK SET NULL du catalogue, quantité à 0).
-- Concurrence : sur tout UPDATE, l'inscription est verrouillée (FOR NO KEY UPDATE, même verrou que
-- encaisser_paiement) en tête de fonction, avant de lire les paiements : un encaissement en cours est terminé et
-- visible au moment des contrôles (fin de service, et prix/quantité figés dès le premier paiement).
-- SECURITY INVOKER (comme en v1.5). Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.proteger_article_inscription()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_dernier DATE;
BEGIN
    -- Verrou de l'inscription d'abord (UPDATE) : un encaissement en cours est terminé et visible avant les deux
    -- contrôles ci-dessous, y compris le tout premier paiement de l'article.
    IF TG_OP = 'UPDATE' THEN
        PERFORM 1 FROM public.inscriptions
        WHERE id = OLD.inscription_id AND ecole_id = OLD.ecole_id
        FOR NO KEY UPDATE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.paiements WHERE article_id = OLD.id AND NOT annule) THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cet article a des paiements : arrêtez le service ou annulez les reçus.' USING ERRCODE = 'FJ412';
        END IF;
        IF NEW.prix_unitaire IS DISTINCT FROM OLD.prix_unitaire
           OR NEW.quantite IS DISTINCT FROM OLD.quantite
           OR NEW.nature IS DISTINCT FROM OLD.nature
           OR NEW.inscription_id IS DISTINCT FROM OLD.inscription_id
           OR NEW.mois_debut IS DISTINCT FROM OLD.mois_debut THEN
            RAISE EXCEPTION 'Article déjà payé : son prix et sa quantité ne changent plus.' USING ERRCODE = 'FJ412';
        END IF;
    END IF;

    -- Fin d'un service : jamais avant le dernier mois payé non annulé
    IF TG_OP = 'UPDATE' AND NEW.mois_fin IS NOT NULL AND NEW.mois_fin IS DISTINCT FROM OLD.mois_fin THEN
        SELECT max(mois) INTO v_dernier FROM public.paiements
        WHERE article_id = OLD.id AND ecole_id = OLD.ecole_id AND NOT annule AND mois IS NOT NULL;
        IF v_dernier IS NOT NULL AND NEW.mois_fin < v_dernier THEN
            RAISE EXCEPTION 'Ce service est payé jusqu''à % : il ne peut pas s''arrêter avant.', to_char(v_dernier, 'MM/YYYY')
                USING ERRCODE = 'FJ412';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proteger_article_inscription() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_proteger_article_inscription ON public.articles_inscription;
CREATE TRIGGER trg_proteger_article_inscription BEFORE UPDATE OR DELETE ON public.articles_inscription
    FOR EACH ROW EXECUTE FUNCTION public.proteger_article_inscription();

-- ==============================================================================
-- v1.14 : un article d'élève vient du catalogue de SA classe (remplace verifier_meme_ecole, v1.5).
-- L'invariant était tenu seulement par le code (inscrire_eleve, ajouterArticleInscription) ; la base le tient
-- désormais, quel que soit le chemin (éditeur SQL, import) :
--  - articles_inscription : un article_classe_id renseigné doit appartenir à la classe de l'inscription (FJ422).
--    Article sans lien (NULL, retiré du catalogue) : exempté.
--  - inscriptions : changer classe_id est refusé tant que l'inscription porte des articles liés au catalogue d'une
--    autre classe (FJ412) ; le futur « changement de classe » devra les retirer ou les remplacer explicitement.
--  - articles_classe : déplacer une ligne du catalogue vers une autre classe est refusé si des élèves l'ont déjà
--    (FJ412) ; enregistrer_classe ne déplace jamais une ligne, il la supprime (FK SET NULL) ou la recrée.
-- Les contrôles « même école » (FJ404) et les branches eleves et paiements sont inchangés. SECURITY DEFINER (comme
-- en v1.5) : chaque sous-requête filtre ecole_id. Les lignes anciennes ne sont relues que si elles sont modifiées
-- sur une colonne surveillée par trg_meme_ecole (UPDATE OF … des triggers).
-- Concurrence : à l'écriture d'un article, l'inscription est verrouillée (FOR NO KEY UPDATE) et la ligne du
-- catalogue lue en FOR SHARE : un changement de classe ou un déplacement de catalogue simultané attend, puis voit
-- l'article. Index partiel sur articles_inscription(article_classe_id) : contrôle du déplacement et FK SET NULL.
-- Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.verifier_meme_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_classe UUID;
    v_classe_article UUID;
BEGIN
    IF TG_TABLE_NAME = 'eleves' THEN
        IF NEW.parent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.parents WHERE id = NEW.parent_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Parent introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
    ELSIF TG_TABLE_NAME = 'inscriptions' THEN
        IF NOT EXISTS (SELECT 1 FROM public.eleves WHERE id = NEW.eleve_id AND ecole_id = NEW.ecole_id)
           OR NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Élève ou classe introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
        -- Changement de classe : pas d'article resté lié au catalogue d'une autre classe
        IF TG_OP = 'UPDATE' AND NEW.classe_id IS DISTINCT FROM OLD.classe_id
           AND EXISTS (SELECT 1 FROM public.articles_inscription ai
                       JOIN public.articles_classe ac ON ac.id = ai.article_classe_id AND ac.ecole_id = NEW.ecole_id
                       WHERE ai.inscription_id = NEW.id AND ai.ecole_id = NEW.ecole_id
                         AND ac.classe_id <> NEW.classe_id) THEN
            RAISE EXCEPTION 'Cet élève a des articles de son ancienne classe : retirez-les avant de changer de classe.'
                USING ERRCODE = 'FJ412';
        END IF;
    ELSIF TG_TABLE_NAME = 'articles_classe' THEN
        IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Classe introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
        -- Ligne du catalogue déplacée vers une autre classe : refusée si des élèves l'ont déjà
        IF TG_OP = 'UPDATE' AND NEW.classe_id IS DISTINCT FROM OLD.classe_id
           AND EXISTS (SELECT 1 FROM public.articles_inscription
                       WHERE article_classe_id = NEW.id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Cet article est déjà attribué à des élèves : il ne change pas de classe.' USING ERRCODE = 'FJ412';
        END IF;
    ELSIF TG_TABLE_NAME = 'articles_inscription' THEN
        -- Inscription verrouillée (même mode que encaisser_paiement et proteger_article_inscription, pas de montée
        -- de verrou) : un changement de classe concurrent attend, ou est vu.
        SELECT classe_id INTO v_classe FROM public.inscriptions
        WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id
        FOR NO KEY UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inscription ou article introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
        IF NEW.article_classe_id IS NOT NULL THEN
            -- Ligne du catalogue verrouillée en partage : un déplacement concurrent vers une autre classe attend
            SELECT classe_id INTO v_classe_article FROM public.articles_classe
            WHERE id = NEW.article_classe_id AND ecole_id = NEW.ecole_id
            FOR SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Inscription ou article introuvable dans cette école.' USING ERRCODE = 'FJ404';
            END IF;
            -- L'article vient du catalogue de la classe de l'inscription
            IF v_classe_article IS DISTINCT FROM v_classe THEN
                RAISE EXCEPTION 'Cet article n''appartient pas au catalogue de la classe de l''élève.' USING ERRCODE = 'FJ422';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'paiements' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inscriptions WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Inscription introuvable dans cette école.' USING ERRCODE = 'FJ404';
        END IF;
        -- Un paiement d'article vise un article de la même inscription
        IF NEW.article_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.articles_inscription
                           WHERE id = NEW.article_id AND inscription_id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Article introuvable pour cet élève.' USING ERRCODE = 'FJ404';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verifier_meme_ecole() FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_articles_inscription_article_classe
    ON public.articles_inscription (article_classe_id) WHERE article_classe_id IS NOT NULL;

-- ==============================================================================
-- v1.15 : date de dernière modification (updated_at) sur eleves, classes, inscriptions, parents et
-- articles_inscription (finding M1). Pas de journal : seulement la date de la dernière modification réelle.
--  - Lignes existantes : updated_at = created_at (« aucune modification connue ») ; l'interface n'affiche la date
--    que si updated_at > created_at. Le rattrapage ne touche que les lignes encore NULL : relancer le schéma ne
--    change rien.
--  - Trigger set_updated_at (BEFORE UPDATE) : une valeur envoyée par le client est ignorée ; un UPDATE qui ne change
--    rien (modifierEleve qui réécrit le parent, ON CONFLICT DO UPDATE de inscrire_eleve) ne bouge pas la date.
--  - Le trigger est créé après le rattrapage. Son nom (trg_updated_at) le fait passer après trg_meme_ecole et
--    trg_proteger_* (ordre alphabétique) : un UPDATE refusé par un contrôle ne fait rien.
-- Hors champ : paiements (immuables, annule_at), ecoles, articles_classe (réécrit en bloc par enregistrer_classe).
-- Le code de l'Espace École lit la colonne : appliquer ce bloc AVANT de déployer. Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    -- La valeur du client ne compte pas : on compare la ligne sans updated_at.
    -- Comparaison de la ligne entière : toute colonne ajoutée à ces tables doit avoir une égalité (jsonb, pas json).
    NEW.updated_at := OLD.updated_at;
    IF NEW IS DISTINCT FROM OLD THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['eleves', 'classes', 'inscriptions', 'parents', 'articles_inscription'] LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ', t);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN updated_at SET DEFAULT now()', t);
        EXECUTE format('UPDATE public.%I SET updated_at = created_at WHERE updated_at IS NULL', t);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN updated_at SET NOT NULL', t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
    END LOOP;
END $$;

-- ==============================================================================
-- v1.16 : un service mensuel ne s'encaisse que dans sa période (finding H4 du BACKLOG).
-- Remplace encaisser_paiement (v1.8) : recopie à l'identique, seul ajout = le contrôle de période pour une
-- ligne d'article mensuel : mois < mois_debut ou mois > mois_fin -> FJ412. mois_debut NULL = depuis le premier
-- mois de l'année scolaire ; mois_fin NULL = jusqu'au dernier. Frais uniques et mensualités inchangés.
-- Un service arrêté puis repris a une ligne par période : chaque paiement doit tomber dans la période de SA ligne.
-- Bloc final de la migration de encaisser_paiement : garder en dernier pour cette fonction.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.encaisser_paiement(
    p_inscription_id UUID,
    p_lot_id UUID,
    p_mode TEXT,
    p_reference TEXT,
    p_lignes JSONB,
    p_nb_paiements INTEGER,
    p_total_actif BIGINT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_lignes JSONB := coalesce(p_lignes, '[]'::jsonb);
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_ins public.inscriptions%ROWTYPE;
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_mois_liste DATE[];
    v_dernier DATE;
    v_nb_demande INTEGER;
    v_total_demande BIGINT;
    v_nb_lot INTEGER;
    v_total_lot BIGINT;
    v_ins_lot INTEGER;
    v_ins_lot_id UUID;
    v_lot_annule BOOLEAN;
    v_identique BOOLEAN;
    v_nb_actuel INTEGER;
    v_total_actuel BIGINT;
    v_l RECORD;
    v_type TEXT;
    v_montant INTEGER;
    v_mois DATE;
    v_article UUID;
    v_art public.articles_inscription%ROWTYPE;
    v_du BIGINT;
    v_deja BIGINT;
    v_numero TEXT;
    v_encaisse BIGINT;
    v_ids UUID[];
    v_noms TEXT[];
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_inscription_id IS NULL OR p_lot_id IS NULL OR p_nb_paiements IS NULL OR p_total_actif IS NULL
       OR p_nb_paiements < 0 OR p_total_actif < 0 THEN
        RAISE EXCEPTION 'Encaissement incomplet, réessayez.' USING ERRCODE = 'FJ422';
    END IF;

    -- Mode et référence (obligatoire pour le mobile money)
    IF p_mode IS NULL OR p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
        RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
        RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
    END IF;
    IF length(v_reference) > 60 THEN
        RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
    END IF;

    -- Forme des lignes, vérifiée champ par champ avant tout cast
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                     OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                     OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                     OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                     OR coalesce(jsonb_typeof(c.e -> 'article_id'), 'null') NOT IN ('string', 'null')
                     OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                     OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                     OR coalesce(c.e ->> 'article_id', '00000000-0000-0000-0000-000000000000')
                        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR length(coalesce(c.e ->> 'libelle', '')) > 120
                     OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_id' IS NOT NULL))
                     OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_id' IS NOT NULL))
                     -- Paiement libre (sans article) : un libellé de 1 à 80 caractères, pas de mois
                     OR (c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL
                         AND (c.e ->> 'mois' IS NOT NULL
                              OR length(btrim(coalesce(c.e ->> 'libelle', ''))) NOT BETWEEN 1 AND 80)))
       OR (SELECT count(*) FROM jsonb_array_elements(v_lignes))
          <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_id', ''))
                                    || '|' || CASE WHEN c.e ->> 'article_id' IS NULL AND c.e ->> 'type' = 'autre' THEN btrim(c.e ->> 'libelle') ELSE '' END)
              FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    SELECT count(*), sum((c.e ->> 'montant')::int) INTO v_nb_demande, v_total_demande FROM jsonb_array_elements(v_lignes) AS c(e);

    -- Verrou de l'inscription : les encaissements simultanés d'un même élève passent l'un après l'autre
    SELECT * INTO v_ins FROM public.inscriptions WHERE id = p_inscription_id AND ecole_id = v_ecole FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Inscription introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_ins.annee_scolaire !~ '^[0-9]{4}-[0-9]{4}$' THEN
        RAISE EXCEPTION 'Année scolaire invalide pour cette inscription.' USING ERRCODE = 'FJ422';
    END IF;
    -- Un même lot_id demandé pour deux élèves à la fois ne doit pas échapper au contrôle du trigger numeroter_recu
    PERFORM pg_advisory_xact_lock(hashtextextended('lot:' || v_ecole::text || ':' || p_lot_id::text, 0));
    SELECT mois_debut, nb_mensualites INTO v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_mois_debut IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;

    -- 1. Rejeu : la clé a déjà servi
    SELECT count(*), coalesce(sum(montant), 0), count(DISTINCT inscription_id), min(inscription_id::text)::uuid,
           min(numero_recu), array_agg(id ORDER BY created_at, id), bool_or(annule)
      INTO v_nb_lot, v_total_lot, v_ins_lot, v_ins_lot_id, v_numero, v_ids, v_lot_annule
    FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id;
    IF v_nb_lot > 0 THEN
        IF v_lot_annule THEN
            RAISE EXCEPTION 'Ce reçu a été annulé : recommencez un nouvel encaissement.' USING ERRCODE = 'FJ412';
        END IF;
        -- Même élève et exactement les mêmes lignes (comparaison de multiensembles dans les deux sens)
        v_identique := v_ins_lot = 1 AND v_ins_lot_id = p_inscription_id AND v_total_lot = v_total_demande AND v_nb_lot = v_nb_demande
            AND NOT EXISTS (
                (SELECT type, mois, article_id, montant::bigint,
                        CASE WHEN type = 'autre' AND article_id IS NULL THEN nullif(btrim(coalesce(libelle, '')), '') END
                 FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id
                 EXCEPT ALL
                 SELECT c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'article_id')::uuid, (c.e ->> 'montant')::bigint,
                        CASE WHEN c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL THEN nullif(btrim(coalesce(c.e ->> 'libelle', '')), '') END
                 FROM jsonb_array_elements(v_lignes) AS c(e))
                UNION ALL
                (SELECT c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'article_id')::uuid, (c.e ->> 'montant')::bigint,
                        CASE WHEN c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL THEN nullif(btrim(coalesce(c.e ->> 'libelle', '')), '') END
                 FROM jsonb_array_elements(v_lignes) AS c(e)
                 EXCEPT ALL
                 SELECT type, mois, article_id, montant::bigint,
                        CASE WHEN type = 'autre' AND article_id IS NULL THEN nullif(btrim(coalesce(libelle, '')), '') END
                 FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id)
            );
        IF v_identique THEN
            RETURN jsonb_build_object('numero_recu', v_numero, 'montant_encaisse', v_total_lot, 'ids', to_jsonb(v_ids), 'rejoue', true);
        END IF;
        RAISE EXCEPTION 'Cette clé d''encaissement a déjà servi pour un autre encaissement : rechargez la page et recommencez.'
            USING ERRCODE = 'FJ412';
    END IF;

    -- 2. Empreinte : rien n'a bougé pour cet élève depuis la lecture du serveur
    SELECT count(*), coalesce(sum(montant) FILTER (WHERE NOT annule), 0) INTO v_nb_actuel, v_total_actuel
    FROM public.paiements WHERE inscription_id = p_inscription_id AND ecole_id = v_ecole;
    IF v_nb_actuel <> p_nb_paiements OR v_total_actuel <> p_total_actif THEN
        RAISE EXCEPTION 'Un autre encaissement ou une annulation vient d''être enregistré pour cet élève : vérifiez la fiche et recommencez.'
            USING ERRCODE = 'FJ412';
    END IF;

    -- 3. Plafonds, d'après les tarifs figés de l'inscription
    SELECT array_agg((make_date(substr(v_ins.annee_scolaire, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date ORDER BY i)
      INTO v_mois_liste FROM generate_series(0, v_nb_mois - 1) AS g(i);
    v_dernier := v_mois_liste[array_length(v_mois_liste, 1)];

    FOR v_l IN SELECT c.e AS e FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n) ORDER BY c.n LOOP
        v_type := v_l.e ->> 'type';
        v_montant := (v_l.e ->> 'montant')::int;
        v_mois := (v_l.e ->> 'mois')::date;
        v_article := (v_l.e ->> 'article_id')::uuid;

        IF v_type = 'inscription' THEN
            v_du := v_ins.frais_inscription;
            SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
            WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND type = 'inscription';

        ELSIF v_type = 'mensualite' THEN
            IF NOT (v_mois = ANY (v_mois_liste)) THEN
                RAISE EXCEPTION 'Mois invalide pour cette année scolaire.' USING ERRCODE = 'FJ422';
            END IF;
            -- Dû du mois : tarif du dernier mois pour le dernier, mensualité sinon, moins la réduction
            v_du := greatest(0, (CASE WHEN v_mois = v_dernier THEN coalesce(v_ins.mensualite_dernier_mois, v_ins.mensualite)
                                      ELSE v_ins.mensualite END) - v_ins.reduction_mensuelle);
            SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
            WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND type = 'mensualite' AND mois = v_mois;

        ELSIF v_article IS NOT NULL THEN
            SELECT * INTO v_art FROM public.articles_inscription
            WHERE id = v_article AND inscription_id = v_ins.id AND ecole_id = v_ecole;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Article introuvable pour cet élève.' USING ERRCODE = 'FJ404';
            END IF;
            IF v_art.nature = 'unique' THEN
                IF v_mois IS NOT NULL THEN
                    RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
                END IF;
                v_du := v_art.prix_unitaire::bigint * v_art.quantite;
                SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
                WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND article_id = v_art.id;
            ELSE
                -- Service mensuel : un mois de l'année, prix_unitaire par mois
                IF v_mois IS NULL OR NOT (v_mois = ANY (v_mois_liste)) THEN
                    RAISE EXCEPTION 'Mois invalide pour cette année scolaire.' USING ERRCODE = 'FJ422';
                END IF;
                -- Période du service : hors de [mois_debut, mois_fin] -> refus (NULL = bord de l'année scolaire)
                IF v_mois < coalesce(v_art.mois_debut, v_mois_liste[1])
                   OR v_mois > coalesce(v_art.mois_fin, v_dernier) THEN
                    v_noms := ARRAY['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                                    'septembre', 'octobre', 'novembre', 'décembre'];
                    RAISE EXCEPTION '% : % % est hors de la période du service (% % à % %).',
                        v_art.libelle,
                        v_noms[extract(month FROM v_mois)::int], extract(year FROM v_mois)::int,
                        v_noms[extract(month FROM coalesce(v_art.mois_debut, v_mois_liste[1]))::int],
                        extract(year FROM coalesce(v_art.mois_debut, v_mois_liste[1]))::int,
                        v_noms[extract(month FROM coalesce(v_art.mois_fin, v_dernier))::int],
                        extract(year FROM coalesce(v_art.mois_fin, v_dernier))::int
                        USING ERRCODE = 'FJ412';
                END IF;
                v_du := v_art.prix_unitaire;
                SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
                WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND article_id = v_art.id AND mois = v_mois;
            END IF;

        ELSE
            -- Paiement libre hors catalogue : réservé à un élève encore inscrit, sans plafond de cumul
            IF v_ins.statut <> 'active' THEN
                RAISE EXCEPTION 'Élève parti : seul le solde dû peut être encaissé.' USING ERRCODE = 'FJ412';
            END IF;
            v_du := 99999999;
            v_deja := 0;
        END IF;

        IF v_deja + v_montant > v_du THEN
            RAISE EXCEPTION 'Le montant dépasse ce qui reste dû pour cet élément : vérifiez la fiche et recommencez.' USING ERRCODE = 'FJ412';
        END IF;
    END LOOP;

    -- 4. Un seul INSERT : les lignes partagent p_lot_id, donc le même numéro de reçu (trigger numeroter_recu).
    -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
    WITH inseres AS (
        INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id)
        SELECT v_ecole, v_ins.id, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
               p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), p_lot_id, (c.e ->> 'article_id')::uuid
        FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
        ORDER BY c.n
        RETURNING id, numero_recu, montant
    )
    SELECT min(numero_recu), sum(montant), array_agg(id) INTO v_numero, v_encaisse, v_ids FROM inseres;

    RETURN jsonb_build_object('numero_recu', v_numero, 'montant_encaisse', v_encaisse, 'ids', to_jsonb(v_ids), 'rejoue', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encaisser_paiement(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, BIGINT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encaisser_paiement(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, BIGINT)
    TO authenticated;

-- ==============================================================================
-- v1.17 : matricule de l'ancien système (reprise de l'existant, tranche 5).
-- eleves.matricule_ancien : le numéro que l'école donnait à l'élève avant FayJàng, lecture seule dans l'app.
-- Le matricule FayJàng (colonne matricule) reste attribué par la base. CHECK NOT VALID (1 à 40 caractères une fois
-- rogné) ; unicité par école, sans tenir compte de la casse ni des espaces de bord, seulement pour les valeurs renseignées.
-- ==============================================================================
ALTER TABLE public.eleves ADD COLUMN IF NOT EXISTS matricule_ancien TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eleves_matricule_ancien_check') THEN
        ALTER TABLE public.eleves ADD CONSTRAINT eleves_matricule_ancien_check
            CHECK (matricule_ancien IS NULL OR char_length(btrim(matricule_ancien)) BETWEEN 1 AND 40) NOT VALID;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_eleves_matricule_ancien
    ON public.eleves (ecole_id, lower(btrim(matricule_ancien))) WHERE matricule_ancien IS NOT NULL;

-- ==============================================================================
-- v1.18 : import des élèves d'une école existante par lots (fonction importer_reprise, tranche 5).
-- Un appel = 1 à 25 élèves, une seule transaction : une erreur annule tout le lot (message « Ligne N : … »).
-- Par élève : parent (même téléphone = même parent), élève (matricule FayJàng calculé comme inscrire_eleve, même
-- verrou), inscription aux tarifs de la classe (jamais ceux du client), articles et services avec leur période
-- (mois_debut / mois_fin écrits à l'INSERT ; un service arrêté puis repris = une ligne par période), puis UN reçu
-- « Reprise de l'existant » (un seul INSERT, un lot_id par élève, numéro attribué par numeroter_recu).
-- Les paiements désignent un article par sa position (article_index, à partir de 0) dans le tableau « articles » du même
-- élève : la correspondance position -> id se fait ici, jamais par l'ordre d'un INSERT groupé.
-- La base ne recalcule pas le dû fin (arrondi des tranches) mais plafonne : inscription <= frais ; mensualité <= tarif
-- du mois (dernier mois, réduction) ; frais unique <= prix x quantité ; service <= prix et mois dans la période de SA
-- ligne ; somme par élément <= dû.
-- Doublon (matricule ancien déjà pris, ou même téléphone + prénom + nom déjà inscrit cette année) : statut 'ignore',
-- rien n'est écrit. Le rejeu d'un fichier ne crée donc rien.
-- Mode : espèces, virement ou chèque seulement. Le mobile money exige la référence de la transaction (règle I5) et un
-- versement repris est un cumul sans référence.
-- Retour : [{ligne, statut 'cree'|'ignore', eleve_id, numero_recu, montant}].
-- SECURITY INVOKER : la RLS École s'applique, ecole_id vient du JWT. Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.importer_reprise(
    p_eleves JSONB,
    p_mode TEXT DEFAULT 'especes'
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_today DATE := (now() AT TIME ZONE 'Africa/Dakar')::date;
    v_annee TEXT;
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_mois_liste DATE[];
    v_dernier DATE;
    v_rec RECORD;
    v_e JSONB;
    v_pre TEXT;
    v_classe public.classes%ROWTYPE;
    v_cat public.articles_classe%ROWTYPE;
    v_art public.articles_inscription%ROWTYPE;
    v_a RECORD;
    v_p RECORD;
    v_ligne INTEGER;
    v_prenom TEXT;
    v_nom TEXT;
    v_parent_nom TEXT;
    v_tel TEXT;
    v_matr_ancien TEXT;
    v_naissance DATE;
    v_depart DATE;
    v_debut DATE;
    v_fin DATE;
    v_statut TEXT;
    v_reduction INTEGER;
    v_quantite INTEGER;
    v_parent UUID;
    v_eleve UUID;
    v_inscription UUID;
    v_prefixe TEXT;
    v_num BIGINT;
    v_matricule TEXT;
    v_ids UUID[];
    v_id UUID;
    v_nb_art INTEGER;
    v_du BIGINT;
    v_lot UUID;
    v_numero TEXT;
    v_montant BIGINT;
    v_res JSONB := '[]'::jsonb;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_mode IS NULL OR p_mode NOT IN ('especes', 'virement', 'cheque') THEN
        RAISE EXCEPTION 'Mode de paiement non accepté pour une reprise : choisissez espèces, virement ou chèque.'
            USING ERRCODE = 'FJ422';
    END IF;

    -- ----- Forme du lot, vérifiée champ par champ avant tout cast -----
    IF jsonb_typeof(p_eleves) IS DISTINCT FROM 'array' OR jsonb_array_length(p_eleves) NOT BETWEEN 1 AND 25 THEN
        RAISE EXCEPTION 'Lot d''import invalide : de 1 à 25 élèves.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_eleves) AS t(e)
               WHERE jsonb_typeof(t.e) IS DISTINCT FROM 'object'
                  OR coalesce(t.e ->> 'ligne', '') !~ '^[0-9]{1,6}$'
                  OR jsonb_typeof(t.e -> 'ligne') IS DISTINCT FROM 'number'
                  OR jsonb_typeof(t.e -> 'articles') IS DISTINCT FROM 'array'
                  OR jsonb_typeof(t.e -> 'paiements') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Lot d''import invalide.' USING ERRCODE = 'FJ422';
    END IF;

    FOR v_rec IN SELECT t.e AS e FROM jsonb_array_elements(p_eleves) AS t(e) LOOP
        v_e := v_rec.e;
        v_pre := 'Ligne ' || (v_e ->> 'ligne') || ' : ';
        IF jsonb_array_length(v_e -> 'articles') > 50 OR jsonb_array_length(v_e -> 'paiements') > 80 THEN
            RAISE EXCEPTION '%trop d''articles ou de paiements.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'prenom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'prenom')) NOT BETWEEN 1 AND 60
           OR jsonb_typeof(v_e -> 'nom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'nom')) NOT BETWEEN 1 AND 60 THEN
            RAISE EXCEPTION '%prénom et nom de l''élève obligatoires (60 caractères au plus).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'parent_nom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'parent_nom')) NOT BETWEEN 1 AND 80
           OR jsonb_typeof(v_e -> 'telephone') IS DISTINCT FROM 'string' OR (v_e ->> 'telephone') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION '%nom et téléphone du parent obligatoires (ex : +221771234567).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'sexe'), 'null') NOT IN ('string', 'null') OR coalesce(v_e ->> 'sexe', 'M') NOT IN ('M', 'F') THEN
            RAISE EXCEPTION '%sexe invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'date_naissance'), 'null') NOT IN ('string', 'null')
           OR coalesce(v_e ->> 'date_naissance', '2000-01-01') !~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
            RAISE EXCEPTION '%date de naissance invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'matricule_ancien'), 'null') NOT IN ('string', 'null')
           OR length(btrim(coalesce(v_e ->> 'matricule_ancien', 'x'))) NOT BETWEEN 1 AND 40 THEN
            RAISE EXCEPTION '%matricule de l''ancien système invalide (1 à 40 caractères).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'classe_id') IS DISTINCT FROM 'string'
           OR (v_e ->> 'classe_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION '%classe invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'reduction') IS DISTINCT FROM 'number' OR coalesce(v_e ->> 'reduction', '') !~ '^[0-9]{1,8}$' THEN
            RAISE EXCEPTION '%réduction mensuelle invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'statut') IS DISTINCT FROM 'string' OR (v_e ->> 'statut') NOT IN ('active', 'abandon', 'transfert')
           OR coalesce(jsonb_typeof(v_e -> 'date_depart'), 'null') NOT IN ('string', 'null')
           OR coalesce(v_e ->> 'date_depart', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
           OR ((v_e ->> 'statut') = 'active' AND (v_e ->> 'date_depart') IS NOT NULL)
           OR ((v_e ->> 'statut') <> 'active' AND (v_e ->> 'date_depart') IS NULL) THEN
            RAISE EXCEPTION '%statut ou date de départ invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'articles') AS c(a)
                   WHERE jsonb_typeof(c.a) IS DISTINCT FROM 'object'
                      OR jsonb_typeof(c.a -> 'article_classe_id') IS DISTINCT FROM 'string'
                      OR coalesce(c.a ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      OR jsonb_typeof(c.a -> 'quantite') IS DISTINCT FROM 'number'
                      OR coalesce(c.a ->> 'quantite', '') !~ '^[0-9]{1,2}$'
                      OR coalesce(jsonb_typeof(c.a -> 'mois_debut'), 'null') NOT IN ('string', 'null')
                      OR coalesce(jsonb_typeof(c.a -> 'mois_fin'), 'null') NOT IN ('string', 'null')
                      OR coalesce(c.a ->> 'mois_debut', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                      OR coalesce(c.a ->> 'mois_fin', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$') THEN
            RAISE EXCEPTION '%articles invalides.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                   WHERE jsonb_typeof(c.p) IS DISTINCT FROM 'object'
                      OR coalesce(c.p ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                      OR jsonb_typeof(c.p -> 'montant') IS DISTINCT FROM 'number'
                      OR coalesce(c.p ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                      OR coalesce(jsonb_typeof(c.p -> 'mois'), 'null') NOT IN ('string', 'null')
                      OR coalesce(c.p ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                      OR coalesce(jsonb_typeof(c.p -> 'article_index'), 'null') NOT IN ('number', 'null')
                      OR coalesce(c.p ->> 'article_index', '0') !~ '^[0-9]{1,2}$'
                      OR coalesce(jsonb_typeof(c.p -> 'libelle'), 'null') NOT IN ('string', 'null')
                      OR length(coalesce(c.p ->> 'libelle', '')) > 120
                      OR (c.p ->> 'type' = 'inscription' AND (c.p ->> 'mois' IS NOT NULL OR c.p ->> 'article_index' IS NOT NULL))
                      OR (c.p ->> 'type' = 'mensualite' AND (c.p ->> 'mois' IS NULL OR c.p ->> 'article_index' IS NOT NULL))
                      OR (c.p ->> 'type' = 'autre' AND c.p ->> 'article_index' IS NULL)) THEN
            RAISE EXCEPTION '%paiements invalides.', v_pre USING ERRCODE = 'FJ422';
        END IF;
    END LOOP;

    -- ----- École et calendrier -----
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_annee !~ '^[0-9]{4}-[0-9]{4}$' THEN
        RAISE EXCEPTION 'Année scolaire invalide : réglez d''abord vos Paramètres.' USING ERRCODE = 'FJ422';
    END IF;
    SELECT array_agg((make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date ORDER BY i)
      INTO v_mois_liste FROM generate_series(0, v_nb_mois - 1) AS g(i);
    v_dernier := v_mois_liste[array_length(v_mois_liste, 1)];
    v_prefixe := substr(v_annee, 3, 2);

    -- Deux imports simultanés de la même école passent l'un après l'autre
    PERFORM pg_advisory_xact_lock(hashtextextended('reprise:' || v_ecole::text, 0));

    FOR v_rec IN SELECT t.e AS e FROM jsonb_array_elements(p_eleves) WITH ORDINALITY AS t(e, n) ORDER BY t.n LOOP
        v_e := v_rec.e;
        v_ligne := (v_e ->> 'ligne')::int;
        v_pre := 'Ligne ' || v_ligne || ' : ';
        v_prenom := btrim(v_e ->> 'prenom');
        v_nom := btrim(v_e ->> 'nom');
        v_parent_nom := btrim(v_e ->> 'parent_nom');
        v_tel := v_e ->> 'telephone';
        v_matr_ancien := nullif(btrim(coalesce(v_e ->> 'matricule_ancien', '')), '');
        v_statut := v_e ->> 'statut';
        v_reduction := (v_e ->> 'reduction')::int;
        v_nb_art := jsonb_array_length(v_e -> 'articles');

        -- Doublons : rien n'est écrit, l'élève est compté « ignoré » (le rejeu d'un fichier ne crée rien)
        IF (v_matr_ancien IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.eleves WHERE ecole_id = v_ecole AND lower(btrim(matricule_ancien)) = lower(v_matr_ancien)))
           OR EXISTS (
                SELECT 1 FROM public.parents p
                JOIN public.eleves el ON el.parent_id = p.id AND el.ecole_id = v_ecole
                JOIN public.inscriptions i ON i.eleve_id = el.id AND i.ecole_id = v_ecole AND i.annee_scolaire = v_annee
                WHERE p.ecole_id = v_ecole AND p.telephone = v_tel
                  AND lower(btrim(el.prenom)) = lower(v_prenom) AND lower(btrim(el.nom)) = lower(v_nom)) THEN
            v_res := v_res || jsonb_build_object('ligne', v_ligne, 'statut', 'ignore', 'eleve_id', NULL, 'numero_recu', NULL, 'montant', 0);
            CONTINUE;
        END IF;

        -- Classe : active, de l'année en cours ; verrou partagé (comme inscrire_eleve)
        SELECT * INTO v_classe FROM public.classes
        WHERE id = (v_e ->> 'classe_id')::uuid AND ecole_id = v_ecole AND is_active FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION '%classe introuvable : créez-la d''abord.', v_pre USING ERRCODE = 'FJ404';
        END IF;
        IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
            RAISE EXCEPTION '%la classe appartient à l''année %.', v_pre, v_classe.annee_scolaire USING ERRCODE = 'FJ412';
        END IF;
        IF v_reduction > v_classe.mensualite THEN
            RAISE EXCEPTION '%la réduction dépasse la mensualité.', v_pre USING ERRCODE = 'FJ422';
        END IF;

        -- Dates (formes déjà vérifiées ; un jour impossible comme le 31/02 est refusé ici)
        BEGIN
            v_naissance := (v_e ->> 'date_naissance')::date;
            v_depart := (v_e ->> 'date_depart')::date;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION '%date de naissance ou de départ invalide.', v_pre USING ERRCODE = 'FJ422';
        END;
        IF v_naissance IS NOT NULL AND v_naissance > v_today THEN
            RAISE EXCEPTION '%date de naissance dans le futur.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF v_depart IS NOT NULL AND (v_depart > v_today OR v_depart < v_mois_liste[1]
                                     OR v_depart >= (v_dernier + interval '1 month')::date) THEN
            RAISE EXCEPTION '%date de départ hors de l''année scolaire (ni dans le futur).', v_pre USING ERRCODE = 'FJ422';
        END IF;

        -- Parent : le même téléphone désigne le même parent (son nom ne change pas). DO NOTHING plutôt que
        -- DO UPDATE : la ligne d'un parent existant n'est pas verrouillée, donc pas d'interblocage avec
        -- inscrire_eleve (parent puis verrou matricule) pendant que l'import garde le verrou matricule.
        INSERT INTO public.parents (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, v_tel)
        ON CONFLICT (ecole_id, telephone) DO NOTHING
        RETURNING id INTO v_parent;
        IF v_parent IS NULL THEN
            SELECT id INTO v_parent FROM public.parents WHERE ecole_id = v_ecole AND telephone = v_tel;
            IF v_parent IS NULL THEN
                RAISE EXCEPTION '%parent introuvable, réessayez.', v_pre USING ERRCODE = 'FJ404';
            END IF;
        END IF;

        -- Matricule FayJàng : même calcul et même verrou que inscrire_eleve (à factoriser, voir BACKLOG)
        PERFORM pg_advisory_xact_lock(hashtextextended('matricule:' || v_ecole::text || ':' || v_prefixe, 0));
        SELECT coalesce(max(substr(matricule, 3)::bigint), 0) + 1 INTO v_num
        FROM public.eleves
        WHERE ecole_id = v_ecole AND matricule ~ ('^' || v_prefixe || '[0-9]{1,12}$');
        v_matricule := v_prefixe || lpad(v_num::text, greatest(4, length(v_num::text)), '0');

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance, matricule_ancien)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, v_e ->> 'sexe', v_naissance, v_matr_ancien)
        RETURNING id INTO v_eleve;

        -- Inscription : tarifs figés depuis la classe, jamais depuis le client
        INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                         mensualite_dernier_mois, reduction_mensuelle, statut, date_depart)
        VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
                v_classe.mensualite_dernier_mois, v_reduction, v_statut, v_depart)
        RETURNING id INTO v_inscription;

        -- Articles : une ligne par élément du tableau (un service repris a une ligne par période). v_ids[n] est
        -- l'identifiant de l'élément n (à partir de 1) : les paiements s'y rattachent par article_index + 1.
        v_ids := ARRAY[]::uuid[];
        FOR v_a IN SELECT c.a AS a FROM jsonb_array_elements(v_e -> 'articles') WITH ORDINALITY AS c(a, n) ORDER BY c.n LOOP
            SELECT * INTO v_cat FROM public.articles_classe
            WHERE id = (v_a.a ->> 'article_classe_id')::uuid AND classe_id = v_classe.id AND ecole_id = v_ecole;
            IF NOT FOUND THEN
                RAISE EXCEPTION '%article absent du catalogue de la classe.', v_pre USING ERRCODE = 'FJ404';
            END IF;
            v_quantite := (v_a.a ->> 'quantite')::int;
            v_debut := (v_a.a ->> 'mois_debut')::date;
            v_fin := (v_a.a ->> 'mois_fin')::date;
            IF v_cat.nature = 'unique' THEN
                IF v_quantite < 1 OR v_debut IS NOT NULL OR v_fin IS NOT NULL THEN
                    RAISE EXCEPTION '%« % » : quantité de 1 à 99, sans période.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
                END IF;
            ELSE
                IF v_quantite <> 1 OR v_debut IS NULL OR NOT (v_debut = ANY (v_mois_liste))
                   OR (v_fin IS NOT NULL AND (NOT (v_fin = ANY (v_mois_liste)) OR v_fin < v_debut)) THEN
                    RAISE EXCEPTION '%« % » : période du service invalide.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
                END IF;
            END IF;
            -- Un frais unique une seule fois ; les périodes d'un même service ne se chevauchent pas
            IF EXISTS (SELECT 1 FROM public.articles_inscription ai
                       WHERE ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole AND ai.article_classe_id = v_cat.id
                         AND (v_cat.nature = 'unique'
                              OR (coalesce(ai.mois_fin, DATE '9999-12-01') >= v_debut
                                  AND coalesce(v_fin, DATE '9999-12-01') >= ai.mois_debut))) THEN
                RAISE EXCEPTION '%« % » est cité deux fois ou ses périodes se chevauchent.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
            END IF;
            INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                                     prix_unitaire, quantite, obligatoire, mois_debut, mois_fin)
            VALUES (v_ecole, v_inscription, v_cat.id, v_cat.libelle, v_cat.nature, v_cat.prix_unitaire, v_quantite,
                    v_cat.obligatoire, v_debut, v_fin)
            RETURNING id INTO v_id;
            v_ids := v_ids || v_id;
        END LOOP;

        -- Paiements : plafonds par élément (type, mois, article), d'après les tarifs figés ci-dessus
        IF jsonb_array_length(v_e -> 'paiements') > 0 THEN
            IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                       WHERE c.p ->> 'article_index' IS NOT NULL AND (c.p ->> 'article_index')::int >= v_nb_art) THEN
                RAISE EXCEPTION '%un paiement désigne un article qui n''existe pas.', v_pre USING ERRCODE = 'FJ422';
            END IF;
            FOR v_p IN
                SELECT c.p ->> 'type' AS type, (c.p ->> 'mois')::date AS mois, (c.p ->> 'article_index')::int AS idx,
                       sum((c.p ->> 'montant')::bigint) AS total
                FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                GROUP BY 1, 2, 3
            LOOP
                IF v_p.type = 'inscription' THEN
                    v_du := v_classe.frais_inscription;
                ELSIF v_p.type = 'mensualite' THEN
                    IF NOT (v_p.mois = ANY (v_mois_liste)) THEN
                        RAISE EXCEPTION '%mois de mensualité hors de l''année scolaire.', v_pre USING ERRCODE = 'FJ422';
                    END IF;
                    v_du := greatest(0, (CASE WHEN v_p.mois = v_dernier THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                                              ELSE v_classe.mensualite END) - v_reduction);
                ELSE
                    SELECT * INTO v_art FROM public.articles_inscription WHERE id = v_ids[v_p.idx + 1];
                    IF v_art.nature = 'unique' THEN
                        IF v_p.mois IS NOT NULL THEN
                            RAISE EXCEPTION '%« % » est un frais unique : pas de mois.', v_pre, v_art.libelle USING ERRCODE = 'FJ422';
                        END IF;
                        v_du := v_art.prix_unitaire::bigint * v_art.quantite;
                    ELSE
                        IF v_p.mois IS NULL OR NOT (v_p.mois = ANY (v_mois_liste)) THEN
                            RAISE EXCEPTION '%« % » : mois hors de l''année scolaire.', v_pre, v_art.libelle USING ERRCODE = 'FJ422';
                        END IF;
                        IF v_p.mois < coalesce(v_art.mois_debut, v_mois_liste[1]) OR v_p.mois > coalesce(v_art.mois_fin, v_dernier) THEN
                            RAISE EXCEPTION '%« % » : un paiement tombe hors de la période du service.', v_pre, v_art.libelle USING ERRCODE = 'FJ412';
                        END IF;
                        v_du := v_art.prix_unitaire;
                    END IF;
                END IF;
                IF v_p.total > v_du THEN
                    RAISE EXCEPTION '%le montant versé dépasse ce qui est dû (% FCFA).', v_pre, v_du USING ERRCODE = 'FJ412';
                END IF;
            END LOOP;

            -- Un seul INSERT par élève : le lot_id commun donne un seul numéro de reçu (trigger numeroter_recu).
            -- paye_le reste au DEFAULT (date du jour à Dakar).
            v_lot := gen_random_uuid();
            WITH inseres AS (
                INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle,
                                              lot_id, article_id, encaisse_par)
                SELECT v_ecole, v_inscription, c.p ->> 'type', (c.p ->> 'mois')::date, (c.p ->> 'montant')::int,
                       p_mode, NULL, nullif(btrim(coalesce(c.p ->> 'libelle', '')), ''), v_lot,
                       CASE WHEN c.p ->> 'article_index' IS NULL THEN NULL ELSE v_ids[(c.p ->> 'article_index')::int + 1] END,
                       'Reprise de l''existant'
                FROM jsonb_array_elements(v_e -> 'paiements') WITH ORDINALITY AS c(p, n)
                ORDER BY c.n
                RETURNING numero_recu, montant
            )
            SELECT min(numero_recu), sum(montant) INTO v_numero, v_montant FROM inseres;
        ELSE
            v_numero := NULL;
            v_montant := 0;
        END IF;

        v_res := v_res || jsonb_build_object('ligne', v_ligne, 'statut', 'cree', 'eleve_id', v_eleve,
                                             'numero_recu', v_numero, 'montant', v_montant);
    END LOOP;

    RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.importer_reprise(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importer_reprise(JSONB, TEXT) TO authenticated;

-- ==============================================================================
-- v1.19 : durcissements de l'inscription et de l'import, matricule factorisé, paiement protégé de la suppression.
-- 1. prochain_matricule(annee) : le calcul du matricule FayJàng (2 chiffres de l'année + plus grand numéro + 1, au
--    moins 4 chiffres) et son verrou « matricule: » n'existent plus qu'à un endroit. SECURITY INVOKER, école du JWT.
-- 2. inscrire_eleve (remplace v1.10, même signature, aucune surcharge) : recopie à l'identique, sauf
--    - le verrou « matricule: » est pris AVANT l'écriture du parent, dans le même ordre que importer_reprise (H5) ;
--    - un parent connu n'est plus réécrit : ON CONFLICT DO NOTHING puis SELECT ;
--    - « Classe introuvable ou désactivée. » au lieu de « Choisissez une classe. » ;
--    - un message FJ422 par cause à l'encaissement (nombre de lignes, forme, libellé, doublon, mois hors année,
--      article non encaissable, montant au-delà du dû) ; les contrôles eux-mêmes ne changent pas ;
--    - le lot du reçu prend le même verrou « lot: » que encaisser_paiement (M4) ;
--    - CASE au lieu d'un OR devant jsonb_array_length.
-- 3. importer_reprise (remplace v1.18, même signature) : recopie à l'identique, sauf prochain_matricule appelé avant
--    le parent, le CASE devant jsonb_array_length, et le refus d'un élève à qui il manque un article obligatoire
--    de sa classe. TAILLE_LOT reste à 25 : le verrou de compteurs_recus est gardé pendant tout le lot.
-- 4. trg_interdire_suppression_paiement : un paiement ne se supprime pas, même depuis l'éditeur SQL (rôle postgres,
--    hors RLS) ni par la cascade d'une école supprimée. Pour nettoyer des données de test, dans la même transaction :
--        BEGIN; SET LOCAL fayjang.allow_paiement_delete = 'on'; DELETE ... ; COMMIT;
-- Bloc final : garder en dernier.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prochain_matricule(p_annee TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_prefixe TEXT;
    v_num BIGINT;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    v_prefixe := substr(p_annee, 3, 2);
    -- Le verrou sérialise les créations d'élèves de l'école jusqu'à la fin de la transaction
    PERFORM pg_advisory_xact_lock(hashtextextended('matricule:' || v_ecole::text || ':' || v_prefixe, 0));
    SELECT coalesce(max(substr(matricule, 3)::bigint), 0) + 1 INTO v_num
    FROM public.eleves
    WHERE ecole_id = v_ecole AND matricule ~ ('^' || v_prefixe || '[0-9]{1,12}$');
    RETURN v_prefixe || lpad(v_num::text, greatest(4, length(v_num::text)), '0');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prochain_matricule(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prochain_matricule(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.inscrire_eleve(
    p_classe_id UUID,
    p_eleve_id UUID DEFAULT NULL,
    p_prenom TEXT DEFAULT NULL,
    p_nom TEXT DEFAULT NULL,
    p_sexe TEXT DEFAULT NULL,
    p_date_naissance DATE DEFAULT NULL,
    p_parent_nom TEXT DEFAULT NULL,
    p_parent_telephone TEXT DEFAULT NULL,
    p_reduction INTEGER DEFAULT 0,
    p_articles JSONB DEFAULT '[]'::jsonb,
    p_mois_debut_services DATE DEFAULT NULL,
    p_mode TEXT DEFAULT NULL,
    p_reference TEXT DEFAULT NULL,
    p_lignes_paiement JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_annee TEXT;
    v_classe public.classes%ROWTYPE;
    v_choix JSONB := coalesce(p_articles, '[]'::jsonb);
    v_lignes JSONB := coalesce(p_lignes_paiement, '[]'::jsonb);
    v_prenom TEXT := btrim(coalesce(p_prenom, ''));
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_parent_nom TEXT := btrim(coalesce(p_parent_nom, ''));
    v_manquant TEXT;
    v_eleve UUID;
    v_parent UUID;
    v_parent_cree BOOLEAN := false;
    v_matricule TEXT;
    v_inscription UUID;
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_lot UUID;
    v_numero_recu TEXT;
    v_montant_encaisse BIGINT := 0;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    -- Encaissement demandé : mode valide, référence (obligatoire pour le mobile money), lignes bien formées.
    -- Aucun cast avant que la forme de chaque champ soit vérifiée.
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Lignes de paiement mal formées, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IS NULL THEN
        IF v_reference IS NOT NULL OR jsonb_array_length(v_lignes) > 0 THEN
            RAISE EXCEPTION 'Mode de paiement manquant.' USING ERRCODE = 'FJ422';
        END IF;
    ELSE
        IF p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
            RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
        END IF;
        IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
            RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_reference) > 60 THEN
            RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
        END IF;
        -- v1.19 : un message par cause (nombre de lignes, forme, libellé, doublon)
        IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50 THEN
            RAISE EXCEPTION 'Un encaissement compte de 1 à 50 lignes.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                      WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                         OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                         OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                         OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                         OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'article_classe_id'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                         OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                         OR coalesce(c.e ->> 'article_classe_id', '00000000-0000-0000-0000-000000000000')
                            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         -- Cohérence du type : inscription sans mois ni article, mensualité avec mois, article avec type « autre »
                         OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'autre' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NULL))) THEN
            RAISE EXCEPTION 'Lignes de paiement mal formées, réessayez.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e) WHERE length(coalesce(c.e ->> 'libelle', '')) > 120) THEN
            RAISE EXCEPTION 'Libellé de paiement trop long (120 caractères au plus).' USING ERRCODE = 'FJ422';
        END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(v_lignes))
           <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_classe_id', '')))
               FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
            RAISE EXCEPTION 'Une même ligne de paiement est citée deux fois.' USING ERRCODE = 'FJ422';
        END IF;
    END IF;

    -- Année scolaire de l'école et classe choisie (active, de la même année)
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    -- Verrou partagé de la classe (v1.10) : un enregistrement du catalogue (enregistrer_classe, FOR NO KEY UPDATE)
    -- passe avant ou après cette inscription, jamais pendant. Deux inscriptions dans la même classe ne se bloquent pas.
    SELECT * INTO v_classe FROM public.classes WHERE id = p_classe_id AND ecole_id = v_ecole AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Classe introuvable ou désactivée.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
        RAISE EXCEPTION 'Cette classe appartient à l''année %.', v_classe.annee_scolaire USING ERRCODE = 'FJ412';
    END IF;
    IF p_reduction IS NULL OR p_reduction < 0 THEN
        RAISE EXCEPTION 'Réduction invalide.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_reduction > v_classe.mensualite THEN
        RAISE EXCEPTION 'La réduction dépasse la mensualité.' USING ERRCODE = 'FJ422';
    END IF;

    -- Articles retenus : [{article_classe_id, quantite}], chacun du catalogue de cette classe, une seule fois
    -- v1.19 : CASE, l'ordre d'évaluation d'un OR n'est pas garanti (jsonb_array_length échoue hors tableau)
    IF (CASE WHEN jsonb_typeof(v_choix) IS DISTINCT FROM 'array' THEN true ELSE jsonb_array_length(v_choix) > 50 END) THEN
        RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR coalesce(c.e ->> 'quantite', '') !~ '^[0-9]{1,2}$')
       OR (SELECT count(*) FROM jsonb_array_elements(v_choix))
          <> (SELECT count(DISTINCT lower(e ->> 'article_classe_id')) FROM jsonb_array_elements(v_choix) AS c(e)) THEN
        RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
               WHERE NOT EXISTS (SELECT 1 FROM public.articles_classe a
                                 WHERE a.id = (c.e ->> 'article_classe_id')::uuid
                                   AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole)) THEN
        RAISE EXCEPTION 'Article introuvable pour cette classe.' USING ERRCODE = 'FJ404';
    END IF;
    -- Un article obligatoire (service mensuel, ou frais unique avec une quantité par défaut) doit être retenu
    SELECT a.libelle INTO v_manquant
    FROM public.articles_classe a
    WHERE a.classe_id = v_classe.id AND a.ecole_id = v_ecole AND a.obligatoire
      AND (a.nature = 'mensuel' OR a.quantite_defaut > 0)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                      WHERE (c.e ->> 'article_classe_id')::uuid = a.id
                        AND (a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0))
    ORDER BY a.ordre
    LIMIT 1;
    IF v_manquant IS NOT NULL THEN
        RAISE EXCEPTION '« % » est obligatoire pour cette classe.', v_manquant USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                   JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                   WHERE a.nature = 'mensuel') THEN
        RAISE EXCEPTION 'Mois de début des services manquant.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NOT NULL AND extract(day FROM p_mois_debut_services) <> 1 THEN
        RAISE EXCEPTION 'Mois de début des services invalide.' USING ERRCODE = 'FJ422';
    END IF;

    IF p_eleve_id IS NOT NULL THEN
        -- Réinscription : l'élève existe dans l'école, son parent ne change pas
        SELECT id, parent_id INTO v_eleve, v_parent FROM public.eleves WHERE id = p_eleve_id AND ecole_id = v_ecole;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Élève introuvable.' USING ERRCODE = 'FJ404';
        END IF;
    ELSE
        IF v_prenom = '' OR v_nom = '' THEN
            RAISE EXCEPTION 'Prénom et nom de l''élève obligatoires.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_prenom) > 60 OR length(v_nom) > 60 THEN
            RAISE EXCEPTION 'Prénom ou nom de l''élève trop long.' USING ERRCODE = 'FJ422';
        END IF;
        IF v_parent_nom = '' OR length(v_parent_nom) > 80 OR coalesce(p_parent_telephone, '') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION 'Nom et téléphone du parent obligatoires (ex : 77 123 45 67).' USING ERRCODE = 'FJ422';
        END IF;
        IF p_sexe IS NOT NULL AND p_sexe NOT IN ('M', 'F') THEN
            RAISE EXCEPTION 'Sexe invalide.' USING ERRCODE = 'FJ422';
        END IF;

        -- Matricule (v1.19) : calculé par prochain_matricule, qui prend le verrou « matricule: » AVANT toute écriture
        -- du parent, dans le même ordre que importer_reprise (plus d'interblocage entre inscription et import).
        v_matricule := public.prochain_matricule(v_annee);

        -- Parent : le même téléphone dans l'école désigne le même parent (son nom et son lien ne changent pas).
        -- DO NOTHING (v1.19) : la ligne d'un parent connu n'est ni réécrite ni verrouillée.
        INSERT INTO public.parents (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, p_parent_telephone)
        ON CONFLICT (ecole_id, telephone) DO NOTHING
        RETURNING id INTO v_parent;
        v_parent_cree := v_parent IS NOT NULL;
        IF v_parent IS NULL THEN
            SELECT id INTO v_parent FROM public.parents WHERE ecole_id = v_ecole AND telephone = p_parent_telephone;
            IF v_parent IS NULL THEN
                RAISE EXCEPTION 'Parent introuvable, réessayez.' USING ERRCODE = 'FJ404';
            END IF;
        END IF;

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, p_sexe, p_date_naissance)
        RETURNING id INTO v_eleve;
    END IF;

    -- Inscription : tarifs figés depuis la classe (un élève déjà inscrit cette année lève 23505)
    INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                     mensualite_dernier_mois, reduction_mensuelle)
    VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
            v_classe.mensualite_dernier_mois, p_reduction)
    RETURNING id INTO v_inscription;

    -- Articles : libellé, nature, prix et obligation recopiés du catalogue ; un service mensuel compte pour 1
    INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                             prix_unitaire, quantite, obligatoire, mois_debut)
    SELECT v_ecole, v_inscription, a.id, a.libelle, a.nature, a.prix_unitaire,
           CASE WHEN a.nature = 'mensuel' THEN 1 ELSE (c.e ->> 'quantite')::int END,
           a.obligatoire,
           CASE WHEN a.nature = 'mensuel' THEN p_mois_debut_services END
    FROM jsonb_array_elements(v_choix) AS c(e)
    JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                                  AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole
    WHERE a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0
    ORDER BY a.ordre;

    -- Encaissement : chaque ligne doit correspondre à un élément réellement dû d'une inscription neuve
    -- (aucun paiement antérieur), avec 0 < montant <= reste dû. Le montant exact est calculé par le serveur.
    IF p_mode IS NOT NULL THEN
        -- v1.19 : un message par cause, avant le contrôle des plafonds (inchangé)
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                   WHERE CASE WHEN c.e ->> 'type' = 'mensualite' THEN
                       (c.e ->> 'mois')::date NOT IN (
                           SELECT (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date
                           FROM generate_series(0, v_nb_mois - 1) AS g(i))
                   ELSE false END) THEN
            RAISE EXCEPTION 'Un mois à encaisser est hors de l''année scolaire.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                   LEFT JOIN public.articles_inscription ai
                          ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                         AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
                   WHERE c.e ->> 'type' = 'autre' AND (ai.id IS NULL OR ai.nature <> 'unique')) THEN
            RAISE EXCEPTION 'Seul un frais unique retenu pour l''élève s''encaisse à l''inscription.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_lignes) AS c(e)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            WHERE CASE c.e ->> 'type'
                WHEN 'inscription' THEN (c.e ->> 'montant')::int > v_classe.frais_inscription
                WHEN 'mensualite' THEN
                    (c.e ->> 'mois')::date NOT IN (
                        SELECT (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date
                        FROM generate_series(0, v_nb_mois - 1) AS g(i))
                    -- Dû exact du mois (comme situationInscription) : tarif du dernier mois pour le dernier, mensualité sinon
                    OR (c.e ->> 'montant')::int >
                       CASE WHEN (c.e ->> 'mois')::date =
                                 (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + v_nb_mois - 1) * interval '1 month'))::date
                            THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                            ELSE v_classe.mensualite END - p_reduction
                ELSE ai.id IS NULL OR ai.nature <> 'unique' OR (c.e ->> 'montant')::int > ai.prix_unitaire::bigint * ai.quantite
            END
        ) THEN
            RAISE EXCEPTION 'Un montant à encaisser dépasse ce qui est dû, réessayez.' USING ERRCODE = 'FJ422';
        END IF;

        -- Un seul INSERT : les lignes partagent le lot_id, donc le même numéro de reçu (trigger numeroter_recu).
        -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
        v_lot := gen_random_uuid();
        -- Même verrou de lot que encaisser_paiement (v1.19, finding M4)
        PERFORM pg_advisory_xact_lock(hashtextextended('lot:' || v_ecole::text || ':' || v_lot::text, 0));
        WITH inseres AS (
            INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id)
            SELECT v_ecole, v_inscription, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
                   p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), v_lot, ai.id
            FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            ORDER BY c.n
            RETURNING numero_recu, montant
        )
        SELECT min(numero_recu), sum(montant) INTO v_numero_recu, v_montant_encaisse FROM inseres;
    END IF;

    RETURN jsonb_build_object(
        'eleve_id', v_eleve,
        'inscription_id', v_inscription,
        'parent_id', v_parent,
        'parent_cree', v_parent_cree,
        'matricule', v_matricule,
        'numero_recu', v_numero_recu,
        'montant_encaisse', v_montant_encaisse
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.importer_reprise(
    p_eleves JSONB,
    p_mode TEXT DEFAULT 'especes'
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_today DATE := (now() AT TIME ZONE 'Africa/Dakar')::date;
    v_annee TEXT;
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_mois_liste DATE[];
    v_dernier DATE;
    v_rec RECORD;
    v_e JSONB;
    v_pre TEXT;
    v_classe public.classes%ROWTYPE;
    v_cat public.articles_classe%ROWTYPE;
    v_art public.articles_inscription%ROWTYPE;
    v_a RECORD;
    v_p RECORD;
    v_ligne INTEGER;
    v_prenom TEXT;
    v_nom TEXT;
    v_parent_nom TEXT;
    v_tel TEXT;
    v_matr_ancien TEXT;
    v_naissance DATE;
    v_depart DATE;
    v_debut DATE;
    v_fin DATE;
    v_statut TEXT;
    v_reduction INTEGER;
    v_quantite INTEGER;
    v_parent UUID;
    v_eleve UUID;
    v_inscription UUID;
    v_matricule TEXT;
    v_manquant TEXT;
    v_ids UUID[];
    v_id UUID;
    v_nb_art INTEGER;
    v_du BIGINT;
    v_lot UUID;
    v_numero TEXT;
    v_montant BIGINT;
    v_res JSONB := '[]'::jsonb;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_mode IS NULL OR p_mode NOT IN ('especes', 'virement', 'cheque') THEN
        RAISE EXCEPTION 'Mode de paiement non accepté pour une reprise : choisissez espèces, virement ou chèque.'
            USING ERRCODE = 'FJ422';
    END IF;

    -- ----- Forme du lot, vérifiée champ par champ avant tout cast -----
    -- v1.19 : CASE, l'ordre d'évaluation d'un OR n'est pas garanti (jsonb_array_length échoue hors tableau)
    IF (CASE WHEN jsonb_typeof(p_eleves) IS DISTINCT FROM 'array' THEN true
             ELSE jsonb_array_length(p_eleves) NOT BETWEEN 1 AND 25 END) THEN
        RAISE EXCEPTION 'Lot d''import invalide : de 1 à 25 élèves.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_eleves) AS t(e)
               WHERE jsonb_typeof(t.e) IS DISTINCT FROM 'object'
                  OR coalesce(t.e ->> 'ligne', '') !~ '^[0-9]{1,6}$'
                  OR jsonb_typeof(t.e -> 'ligne') IS DISTINCT FROM 'number'
                  OR jsonb_typeof(t.e -> 'articles') IS DISTINCT FROM 'array'
                  OR jsonb_typeof(t.e -> 'paiements') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Lot d''import invalide.' USING ERRCODE = 'FJ422';
    END IF;

    FOR v_rec IN SELECT t.e AS e FROM jsonb_array_elements(p_eleves) AS t(e) LOOP
        v_e := v_rec.e;
        v_pre := 'Ligne ' || (v_e ->> 'ligne') || ' : ';
        IF jsonb_array_length(v_e -> 'articles') > 50 OR jsonb_array_length(v_e -> 'paiements') > 80 THEN
            RAISE EXCEPTION '%trop d''articles ou de paiements.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'prenom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'prenom')) NOT BETWEEN 1 AND 60
           OR jsonb_typeof(v_e -> 'nom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'nom')) NOT BETWEEN 1 AND 60 THEN
            RAISE EXCEPTION '%prénom et nom de l''élève obligatoires (60 caractères au plus).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'parent_nom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'parent_nom')) NOT BETWEEN 1 AND 80
           OR jsonb_typeof(v_e -> 'telephone') IS DISTINCT FROM 'string' OR (v_e ->> 'telephone') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION '%nom et téléphone du parent obligatoires (ex : +221771234567).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'sexe'), 'null') NOT IN ('string', 'null') OR coalesce(v_e ->> 'sexe', 'M') NOT IN ('M', 'F') THEN
            RAISE EXCEPTION '%sexe invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'date_naissance'), 'null') NOT IN ('string', 'null')
           OR coalesce(v_e ->> 'date_naissance', '2000-01-01') !~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
            RAISE EXCEPTION '%date de naissance invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'matricule_ancien'), 'null') NOT IN ('string', 'null')
           OR length(btrim(coalesce(v_e ->> 'matricule_ancien', 'x'))) NOT BETWEEN 1 AND 40 THEN
            RAISE EXCEPTION '%matricule de l''ancien système invalide (1 à 40 caractères).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'classe_id') IS DISTINCT FROM 'string'
           OR (v_e ->> 'classe_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION '%classe invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'reduction') IS DISTINCT FROM 'number' OR coalesce(v_e ->> 'reduction', '') !~ '^[0-9]{1,8}$' THEN
            RAISE EXCEPTION '%réduction mensuelle invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'statut') IS DISTINCT FROM 'string' OR (v_e ->> 'statut') NOT IN ('active', 'abandon', 'transfert')
           OR coalesce(jsonb_typeof(v_e -> 'date_depart'), 'null') NOT IN ('string', 'null')
           OR coalesce(v_e ->> 'date_depart', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
           OR ((v_e ->> 'statut') = 'active' AND (v_e ->> 'date_depart') IS NOT NULL)
           OR ((v_e ->> 'statut') <> 'active' AND (v_e ->> 'date_depart') IS NULL) THEN
            RAISE EXCEPTION '%statut ou date de départ invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'articles') AS c(a)
                   WHERE jsonb_typeof(c.a) IS DISTINCT FROM 'object'
                      OR jsonb_typeof(c.a -> 'article_classe_id') IS DISTINCT FROM 'string'
                      OR coalesce(c.a ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      OR jsonb_typeof(c.a -> 'quantite') IS DISTINCT FROM 'number'
                      OR coalesce(c.a ->> 'quantite', '') !~ '^[0-9]{1,2}$'
                      OR coalesce(jsonb_typeof(c.a -> 'mois_debut'), 'null') NOT IN ('string', 'null')
                      OR coalesce(jsonb_typeof(c.a -> 'mois_fin'), 'null') NOT IN ('string', 'null')
                      OR coalesce(c.a ->> 'mois_debut', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                      OR coalesce(c.a ->> 'mois_fin', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$') THEN
            RAISE EXCEPTION '%articles invalides.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                   WHERE jsonb_typeof(c.p) IS DISTINCT FROM 'object'
                      OR coalesce(c.p ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                      OR jsonb_typeof(c.p -> 'montant') IS DISTINCT FROM 'number'
                      OR coalesce(c.p ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                      OR coalesce(jsonb_typeof(c.p -> 'mois'), 'null') NOT IN ('string', 'null')
                      OR coalesce(c.p ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                      OR coalesce(jsonb_typeof(c.p -> 'article_index'), 'null') NOT IN ('number', 'null')
                      OR coalesce(c.p ->> 'article_index', '0') !~ '^[0-9]{1,2}$'
                      OR coalesce(jsonb_typeof(c.p -> 'libelle'), 'null') NOT IN ('string', 'null')
                      OR length(coalesce(c.p ->> 'libelle', '')) > 120
                      OR (c.p ->> 'type' = 'inscription' AND (c.p ->> 'mois' IS NOT NULL OR c.p ->> 'article_index' IS NOT NULL))
                      OR (c.p ->> 'type' = 'mensualite' AND (c.p ->> 'mois' IS NULL OR c.p ->> 'article_index' IS NOT NULL))
                      OR (c.p ->> 'type' = 'autre' AND c.p ->> 'article_index' IS NULL)) THEN
            RAISE EXCEPTION '%paiements invalides.', v_pre USING ERRCODE = 'FJ422';
        END IF;
    END LOOP;

    -- ----- École et calendrier -----
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_annee !~ '^[0-9]{4}-[0-9]{4}$' THEN
        RAISE EXCEPTION 'Année scolaire invalide : réglez d''abord vos Paramètres.' USING ERRCODE = 'FJ422';
    END IF;
    SELECT array_agg((make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date ORDER BY i)
      INTO v_mois_liste FROM generate_series(0, v_nb_mois - 1) AS g(i);
    v_dernier := v_mois_liste[array_length(v_mois_liste, 1)];

    -- Deux imports simultanés de la même école passent l'un après l'autre
    PERFORM pg_advisory_xact_lock(hashtextextended('reprise:' || v_ecole::text, 0));

    FOR v_rec IN SELECT t.e AS e FROM jsonb_array_elements(p_eleves) WITH ORDINALITY AS t(e, n) ORDER BY t.n LOOP
        v_e := v_rec.e;
        v_ligne := (v_e ->> 'ligne')::int;
        v_pre := 'Ligne ' || v_ligne || ' : ';
        v_prenom := btrim(v_e ->> 'prenom');
        v_nom := btrim(v_e ->> 'nom');
        v_parent_nom := btrim(v_e ->> 'parent_nom');
        v_tel := v_e ->> 'telephone';
        v_matr_ancien := nullif(btrim(coalesce(v_e ->> 'matricule_ancien', '')), '');
        v_statut := v_e ->> 'statut';
        v_reduction := (v_e ->> 'reduction')::int;
        v_nb_art := jsonb_array_length(v_e -> 'articles');

        -- Doublons : rien n'est écrit, l'élève est compté « ignoré » (le rejeu d'un fichier ne crée rien)
        IF (v_matr_ancien IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.eleves WHERE ecole_id = v_ecole AND lower(btrim(matricule_ancien)) = lower(v_matr_ancien)))
           OR EXISTS (
                SELECT 1 FROM public.parents p
                JOIN public.eleves el ON el.parent_id = p.id AND el.ecole_id = v_ecole
                JOIN public.inscriptions i ON i.eleve_id = el.id AND i.ecole_id = v_ecole AND i.annee_scolaire = v_annee
                WHERE p.ecole_id = v_ecole AND p.telephone = v_tel
                  AND lower(btrim(el.prenom)) = lower(v_prenom) AND lower(btrim(el.nom)) = lower(v_nom)) THEN
            v_res := v_res || jsonb_build_object('ligne', v_ligne, 'statut', 'ignore', 'eleve_id', NULL, 'numero_recu', NULL, 'montant', 0);
            CONTINUE;
        END IF;

        -- Classe : active, de l'année en cours ; verrou partagé (comme inscrire_eleve)
        SELECT * INTO v_classe FROM public.classes
        WHERE id = (v_e ->> 'classe_id')::uuid AND ecole_id = v_ecole AND is_active FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION '%classe introuvable : créez-la d''abord.', v_pre USING ERRCODE = 'FJ404';
        END IF;
        IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
            RAISE EXCEPTION '%la classe appartient à l''année %.', v_pre, v_classe.annee_scolaire USING ERRCODE = 'FJ412';
        END IF;
        IF v_reduction > v_classe.mensualite THEN
            RAISE EXCEPTION '%la réduction dépasse la mensualité.', v_pre USING ERRCODE = 'FJ422';
        END IF;

        -- Dates (formes déjà vérifiées ; un jour impossible comme le 31/02 est refusé ici)
        BEGIN
            v_naissance := (v_e ->> 'date_naissance')::date;
            v_depart := (v_e ->> 'date_depart')::date;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION '%date de naissance ou de départ invalide.', v_pre USING ERRCODE = 'FJ422';
        END;
        IF v_naissance IS NOT NULL AND v_naissance > v_today THEN
            RAISE EXCEPTION '%date de naissance dans le futur.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF v_depart IS NOT NULL AND (v_depart > v_today OR v_depart < v_mois_liste[1]
                                     OR v_depart >= (v_dernier + interval '1 month')::date) THEN
            RAISE EXCEPTION '%date de départ hors de l''année scolaire (ni dans le futur).', v_pre USING ERRCODE = 'FJ422';
        END IF;

        -- Matricule FayJàng (v1.19) : prochain_matricule, comme inscrire_eleve ; le verrou « matricule: » est pris
        -- AVANT l'écriture du parent, dans le même ordre que inscrire_eleve.
        v_matricule := public.prochain_matricule(v_annee);

        -- Parent : le même téléphone désigne le même parent (son nom ne change pas). DO NOTHING : la ligne d'un
        -- parent existant n'est ni réécrite ni verrouillée.
        INSERT INTO public.parents (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, v_tel)
        ON CONFLICT (ecole_id, telephone) DO NOTHING
        RETURNING id INTO v_parent;
        IF v_parent IS NULL THEN
            SELECT id INTO v_parent FROM public.parents WHERE ecole_id = v_ecole AND telephone = v_tel;
            IF v_parent IS NULL THEN
                RAISE EXCEPTION '%parent introuvable, réessayez.', v_pre USING ERRCODE = 'FJ404';
            END IF;
        END IF;

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance, matricule_ancien)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, v_e ->> 'sexe', v_naissance, v_matr_ancien)
        RETURNING id INTO v_eleve;

        -- Inscription : tarifs figés depuis la classe, jamais depuis le client
        INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                         mensualite_dernier_mois, reduction_mensuelle, statut, date_depart)
        VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
                v_classe.mensualite_dernier_mois, v_reduction, v_statut, v_depart)
        RETURNING id INTO v_inscription;

        -- Articles : une ligne par élément du tableau (un service repris a une ligne par période). v_ids[n] est
        -- l'identifiant de l'élément n (à partir de 1) : les paiements s'y rattachent par article_index + 1.
        v_ids := ARRAY[]::uuid[];
        FOR v_a IN SELECT c.a AS a FROM jsonb_array_elements(v_e -> 'articles') WITH ORDINALITY AS c(a, n) ORDER BY c.n LOOP
            SELECT * INTO v_cat FROM public.articles_classe
            WHERE id = (v_a.a ->> 'article_classe_id')::uuid AND classe_id = v_classe.id AND ecole_id = v_ecole;
            IF NOT FOUND THEN
                RAISE EXCEPTION '%article absent du catalogue de la classe.', v_pre USING ERRCODE = 'FJ404';
            END IF;
            v_quantite := (v_a.a ->> 'quantite')::int;
            v_debut := (v_a.a ->> 'mois_debut')::date;
            v_fin := (v_a.a ->> 'mois_fin')::date;
            IF v_cat.nature = 'unique' THEN
                IF v_quantite < 1 OR v_debut IS NOT NULL OR v_fin IS NOT NULL THEN
                    RAISE EXCEPTION '%« % » : quantité de 1 à 99, sans période.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
                END IF;
            ELSE
                IF v_quantite <> 1 OR v_debut IS NULL OR NOT (v_debut = ANY (v_mois_liste))
                   OR (v_fin IS NOT NULL AND (NOT (v_fin = ANY (v_mois_liste)) OR v_fin < v_debut)) THEN
                    RAISE EXCEPTION '%« % » : période du service invalide.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
                END IF;
            END IF;
            -- Un frais unique une seule fois ; les périodes d'un même service ne se chevauchent pas
            IF EXISTS (SELECT 1 FROM public.articles_inscription ai
                       WHERE ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole AND ai.article_classe_id = v_cat.id
                         AND (v_cat.nature = 'unique'
                              OR (coalesce(ai.mois_fin, DATE '9999-12-01') >= v_debut
                                  AND coalesce(v_fin, DATE '9999-12-01') >= ai.mois_debut))) THEN
                RAISE EXCEPTION '%« % » est cité deux fois ou ses périodes se chevauchent.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
            END IF;
            INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                                     prix_unitaire, quantite, obligatoire, mois_debut, mois_fin)
            VALUES (v_ecole, v_inscription, v_cat.id, v_cat.libelle, v_cat.nature, v_cat.prix_unitaire, v_quantite,
                    v_cat.obligatoire, v_debut, v_fin)
            RETURNING id INTO v_id;
            v_ids := v_ids || v_id;
        END LOOP;

        -- Articles obligatoires de la classe (v1.19, même règle que inscrire_eleve) : un frais unique avec une
        -- quantité par défaut, ou un service mensuel. Seule exception, comme repartirReprise : après le dernier mois
        -- de l'année, un service sans versement n'est pas rattaché.
        SELECT a.libelle INTO v_manquant
        FROM public.articles_classe a
        WHERE a.classe_id = v_classe.id AND a.ecole_id = v_ecole AND a.obligatoire
          AND ((a.nature = 'unique' AND a.quantite_defaut > 0)
               OR (a.nature = 'mensuel' AND date_trunc('month', v_today)::date <= v_dernier))
          AND NOT EXISTS (SELECT 1 FROM public.articles_inscription ai
                          WHERE ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole AND ai.article_classe_id = a.id)
        ORDER BY a.ordre
        LIMIT 1;
        IF v_manquant IS NOT NULL THEN
            RAISE EXCEPTION '%« % » est obligatoire pour cette classe.', v_pre, v_manquant USING ERRCODE = 'FJ422';
        END IF;

        -- Paiements : plafonds par élément (type, mois, article), d'après les tarifs figés ci-dessus
        IF jsonb_array_length(v_e -> 'paiements') > 0 THEN
            IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                       WHERE c.p ->> 'article_index' IS NOT NULL AND (c.p ->> 'article_index')::int >= v_nb_art) THEN
                RAISE EXCEPTION '%un paiement désigne un article qui n''existe pas.', v_pre USING ERRCODE = 'FJ422';
            END IF;
            FOR v_p IN
                SELECT c.p ->> 'type' AS type, (c.p ->> 'mois')::date AS mois, (c.p ->> 'article_index')::int AS idx,
                       sum((c.p ->> 'montant')::bigint) AS total
                FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                GROUP BY 1, 2, 3
            LOOP
                IF v_p.type = 'inscription' THEN
                    v_du := v_classe.frais_inscription;
                ELSIF v_p.type = 'mensualite' THEN
                    IF NOT (v_p.mois = ANY (v_mois_liste)) THEN
                        RAISE EXCEPTION '%mois de mensualité hors de l''année scolaire.', v_pre USING ERRCODE = 'FJ422';
                    END IF;
                    v_du := greatest(0, (CASE WHEN v_p.mois = v_dernier THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                                              ELSE v_classe.mensualite END) - v_reduction);
                ELSE
                    SELECT * INTO v_art FROM public.articles_inscription WHERE id = v_ids[v_p.idx + 1];
                    IF v_art.nature = 'unique' THEN
                        IF v_p.mois IS NOT NULL THEN
                            RAISE EXCEPTION '%« % » est un frais unique : pas de mois.', v_pre, v_art.libelle USING ERRCODE = 'FJ422';
                        END IF;
                        v_du := v_art.prix_unitaire::bigint * v_art.quantite;
                    ELSE
                        IF v_p.mois IS NULL OR NOT (v_p.mois = ANY (v_mois_liste)) THEN
                            RAISE EXCEPTION '%« % » : mois hors de l''année scolaire.', v_pre, v_art.libelle USING ERRCODE = 'FJ422';
                        END IF;
                        IF v_p.mois < coalesce(v_art.mois_debut, v_mois_liste[1]) OR v_p.mois > coalesce(v_art.mois_fin, v_dernier) THEN
                            RAISE EXCEPTION '%« % » : un paiement tombe hors de la période du service.', v_pre, v_art.libelle USING ERRCODE = 'FJ412';
                        END IF;
                        v_du := v_art.prix_unitaire;
                    END IF;
                END IF;
                IF v_p.total > v_du THEN
                    RAISE EXCEPTION '%le montant versé dépasse ce qui est dû (% FCFA).', v_pre, v_du USING ERRCODE = 'FJ412';
                END IF;
            END LOOP;

            -- Un seul INSERT par élève : le lot_id commun donne un seul numéro de reçu (trigger numeroter_recu).
            -- paye_le reste au DEFAULT (date du jour à Dakar).
            v_lot := gen_random_uuid();
            WITH inseres AS (
                INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle,
                                              lot_id, article_id, encaisse_par)
                SELECT v_ecole, v_inscription, c.p ->> 'type', (c.p ->> 'mois')::date, (c.p ->> 'montant')::int,
                       p_mode, NULL, nullif(btrim(coalesce(c.p ->> 'libelle', '')), ''), v_lot,
                       CASE WHEN c.p ->> 'article_index' IS NULL THEN NULL ELSE v_ids[(c.p ->> 'article_index')::int + 1] END,
                       'Reprise de l''existant'
                FROM jsonb_array_elements(v_e -> 'paiements') WITH ORDINALITY AS c(p, n)
                ORDER BY c.n
                RETURNING numero_recu, montant
            )
            SELECT min(numero_recu), sum(montant) INTO v_numero, v_montant FROM inseres;
        ELSE
            v_numero := NULL;
            v_montant := 0;
        END IF;

        v_res := v_res || jsonb_build_object('ligne', v_ligne, 'statut', 'cree', 'eleve_id', v_eleve,
                                             'numero_recu', v_numero, 'montant', v_montant);
    END LOOP;

    RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.importer_reprise(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importer_reprise(JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.interdire_suppression_paiement()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF coalesce(current_setting('fayjang.allow_paiement_delete', true), '') = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Un paiement ne se supprime pas : annulez-le avec un motif.' USING ERRCODE = 'FJ412';
END;
$$;
DROP TRIGGER IF EXISTS trg_interdire_suppression_paiement ON public.paiements;
CREATE TRIGGER trg_interdire_suppression_paiement BEFORE DELETE ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.interdire_suppression_paiement();

-- ==============================================================================
-- v1.20 : abonnement appliqué automatiquement (feature D02, tranche 1).
-- Une école dont l'essai ou l'abonnement est fini depuis plus de 7 jours, ou que le SuperAdmin a passée en
-- « Suspendu » ou « Expiré », est en lecture seule : la base refuse ses écritures (FJ403), même si une Server
-- Action oubliait de le contrôler. Rien n'est écrit pour cela : l'état est calculé depuis statut_abonnement,
-- trial_ends_at et abonnement_fin. Aucune colonne, aucune table, aucun bloc existant modifié.
--
-- LA RÈGLE N'EXISTE QU'ICI. L'application ne la recalcule pas : elle lit abonnement_ecole() pour afficher le
-- bandeau, et les triggers lisent la même fonction pour refuser. Changer un délai se fait dans
-- situation_abonnement, nulle part ailleurs.
--
-- 1. situation_abonnement(statut, fin d'essai, fin d'abonnement, jour) : JSON
--    { etat, fin, fin_grace, jours_restants }. Pure (jour passé en paramètre), donc testable sans table.
--      - 'suspendu' ou 'expire' : etat 'lecture_seule' immédiat, sans délai de grâce, pas de date ;
--      - fin = jour de Dakar de trial_ends_at (essai) ou abonnement_fin (actif) ; sans date : 'normal' ;
--      - de fin - 7 à fin : 'alerte' ; de fin + 1 à fin + 7 : 'grace' ; ensuite : 'lecture_seule'.
-- 2. abonnement_ecole() : la situation de l'école du JWT, au jour de Dakar. SECURITY INVOKER : l'école lit sa
--    propre ligne de ecoles par sa policy. NULL si l'école est introuvable.
-- 3. verifier_ecriture_ecole() : lève FJ403 si le rôle est « ecole » et que son état est 'lecture_seule' (ou
--    que l'école est introuvable). Le SuperAdmin et l'inscription d'une école (client admin, rôle NULL) et le
--    parent ne sont pas concernés.
-- 4. Triggers :
--      - trg_abonnement_ecriture (BEFORE, FOR EACH STATEMENT : passe avant tout trigger de ligne, donc avant
--        numeroter_recu, aucun numéro de reçu n'est consommé par un refus) sur paiements, inscriptions, eleves,
--        classes, articles_classe, articles_inscription (toute écriture), ecoles (UPDATE : paramètres),
--        parents (INSERT, DELETE) ;
--      - trg_abonnement_modification (BEFORE UPDATE, FOR EACH ROW) sur parents : toute modification est
--        refusée SAUF celle du seul token (régénérer le lien d'un parent reste permis). La comparaison porte
--        sur la ligne entière : une colonne ajoutée plus tard à parents est gardée d'office.
--    Non gardées : acces_ecole (le code d'accès se change en lecture seule), compteurs_recus,
--    tentatives_connexion.
-- Retour arrière : DROP TRIGGER trg_abonnement_ecriture sur ces 8 tables et trg_abonnement_modification sur
-- parents.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.situation_abonnement(
    p_statut TEXT, p_trial_ends_at TIMESTAMPTZ, p_abonnement_fin DATE, p_jour DATE
) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT jsonb_build_object(
        'etat', CASE
            WHEN p_statut IN ('suspendu', 'expire') THEN 'lecture_seule'
            WHEN f.fin IS NULL THEN 'normal'
            WHEN p_jour > f.fin + 7 THEN 'lecture_seule'
            WHEN p_jour > f.fin THEN 'grace'
            WHEN p_jour >= f.fin - 7 THEN 'alerte'
            ELSE 'normal'
        END,
        'fin', f.fin,
        'fin_grace', f.fin + 7,
        'jours_restants', f.fin - p_jour
    )
    FROM (SELECT CASE p_statut
                     WHEN 'essai' THEN (p_trial_ends_at AT TIME ZONE 'Africa/Dakar')::date
                     WHEN 'actif' THEN p_abonnement_fin
                 END AS fin) f
$$;
REVOKE EXECUTE ON FUNCTION public.situation_abonnement(TEXT, TIMESTAMPTZ, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.situation_abonnement(TEXT, TIMESTAMPTZ, DATE, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.abonnement_ecole()
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT public.situation_abonnement(e.statut_abonnement, e.trial_ends_at, e.abonnement_fin,
                                       (now() AT TIME ZONE 'Africa/Dakar')::date)
    FROM public.ecoles e
    WHERE e.id = public.jwt_ecole_id()
$$;
REVOKE EXECUTE ON FUNCTION public.abonnement_ecole() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abonnement_ecole() TO authenticated;

-- FJ403 : école en lecture seule (abonnement expiré ou suspendu)
CREATE OR REPLACE FUNCTION public.verifier_ecriture_ecole()
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
    -- École introuvable (situation NULL) : on refuse aussi
    IF public.jwt_role_app() = 'ecole'
       AND coalesce(public.abonnement_ecole() ->> 'etat', 'lecture_seule') = 'lecture_seule' THEN
        RAISE EXCEPTION 'Abonnement expiré ou suspendu : l''Espace École est en lecture seule. Contactez FayJàng.'
            USING ERRCODE = 'FJ403';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verifier_ecriture_ecole() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verifier_ecriture_ecole() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exiger_ecriture_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    PERFORM public.verifier_ecriture_ecole();
    RETURN NULL;
END;
$$;

-- Parent : seule la régénération du lien (token) reste permise en lecture seule
CREATE OR REPLACE FUNCTION public.exiger_ecriture_parent()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF (to_jsonb(NEW) - 'token' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'token' - 'updated_at') THEN
        PERFORM public.verifier_ecriture_ecole();
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['paiements', 'inscriptions', 'eleves', 'classes', 'articles_classe', 'articles_inscription'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_abonnement_ecriture ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_abonnement_ecriture BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                       'FOR EACH STATEMENT EXECUTE FUNCTION public.exiger_ecriture_ecole()', t);
    END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_abonnement_ecriture ON public.ecoles;
CREATE TRIGGER trg_abonnement_ecriture BEFORE UPDATE ON public.ecoles
    FOR EACH STATEMENT EXECUTE FUNCTION public.exiger_ecriture_ecole();

DROP TRIGGER IF EXISTS trg_abonnement_ecriture ON public.parents;
CREATE TRIGGER trg_abonnement_ecriture BEFORE INSERT OR DELETE ON public.parents
    FOR EACH STATEMENT EXECUTE FUNCTION public.exiger_ecriture_ecole();

DROP TRIGGER IF EXISTS trg_abonnement_modification ON public.parents;
CREATE TRIGGER trg_abonnement_modification BEFORE UPDATE ON public.parents
    FOR EACH ROW EXECUTE FUNCTION public.exiger_ecriture_parent();

-- ==============================================================================
-- v1.21 : plusieurs utilisateurs par école, tranche 1 (feature D09) : connexion par e-mail + mot de passe.
-- Bloc final : garder en dernier.
--
-- 1. Table utilisateurs_ecole : un compte par membre de l'administration (directeur ou caissier).
--      - un seul directeur par école (index unique partiel) ; un e-mail = un seul compte dans tout FayJàng ;
--      - code_hash : le serveur envoie le sha256 du mot de passe, le trigger le stocke en bcrypt et date le
--        changement (mdp_modifie_at), qui coupe les sessions émises plus de 30 secondes avant (tolérance
--        d'horloge entre Next.js et Postgres, reprise de session_ecole_valide) ;
--      - aucun droit pour anon / authenticated (comme acces_ecole) : seules les fonctions SECURITY DEFINER
--        ci-dessous la lisent et l'écrivent. Pas de branche dans verifier_meme_ecole : la table ne référence
--        que ecoles ;
--      - garde d'abonnement sur INSERT seulement : changer son mot de passe reste permis en lecture seule
--        (décision « Lecture seule (F21) »).
-- 2. Contrôle bloquant (décision du 2026-11-12) : une école sans compte directeur qui n'a pas de code d'accès,
--    d'e-mail valide ou de nom de responsable, ou dont l'e-mail est déjà pris (par un compte ou par une autre
--    école, à la casse et aux espaces près), arrête le script, avec la liste des écoles à compléter.
-- 3. Reprise des écoles existantes : un directeur par école, e-mail = ecoles.email_contact, nom =
--    ecoles.responsable_nom, mot de passe = hash bcrypt de acces_ecole recopié tel quel (le code habituel
--    reste valable). Rejouable : une école qui a déjà son directeur est sautée. Après la création, l'e-mail de
--    connexion du directeur ne suit plus ecoles.email_contact.
-- 4. Fonctions :
--      - jwt_utilisateur_id(), jwt_role_utilisateur() : claims portés par le JWT de l'école ;
--      - echanger_utilisateur_ecole(e-mail, sha256, ip) : connexion, mêmes compteurs que echanger_acces_ecole
--        (5 échecs par IP et e-mail, 30 par e-mail, 50 par IP) ;
--      - session_utilisateur_valide(id, émis le) : utilisateur et école actifs, mot de passe inchangé depuis
--        l'émission du cookie ; appelée par le serveur avec le JWT « connexion » ;
--      - changer_mon_mot_de_passe(ancien, nouveau) : sur l'utilisateur du JWT ; pour le directeur, le nouveau
--        hash est aussi recopié dans acces_ecole (retour arrière vers l'ancien code sans perte).
-- echanger_acces_ecole, session_ecole_valide, changer_code_ecole et acces_ecole restent en place, inchangés.
-- Retour arrière : redéployer l'ancien code (acces_ecole est à jour) ; la table peut rester.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.utilisateurs_ecole (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE,
    nom TEXT NOT NULL CHECK (length(trim(nom)) BETWEEN 1 AND 100),
    email TEXT NOT NULL CHECK (
        email = lower(trim(email)) AND length(email) <= 120
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    ),
    code_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('directeur', 'caissier')),
    actif BOOLEAN NOT NULL DEFAULT true,
    mdp_modifie_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_utilisateurs_ecole_email ON public.utilisateurs_ecole (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_utilisateurs_ecole_directeur ON public.utilisateurs_ecole (ecole_id)
    WHERE role = 'directeur';
CREATE INDEX IF NOT EXISTS idx_utilisateurs_ecole_ecole ON public.utilisateurs_ecole (ecole_id);
ALTER TABLE public.utilisateurs_ecole ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.utilisateurs_ecole FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hacher_mot_de_passe_utilisateur()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = extensions, public AS $$
BEGIN
    IF NEW.code_hash ~ '^[0-9a-fA-F]{64}$' THEN
        NEW.code_hash := crypt(lower(NEW.code_hash), gen_salt('bf', 10));
        NEW.mdp_modifie_at := now();
    ELSIF TG_OP = 'UPDATE' AND NEW.code_hash IS DISTINCT FROM OLD.code_hash THEN
        NEW.mdp_modifie_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hacher_mot_de_passe ON public.utilisateurs_ecole;
CREATE TRIGGER trg_hacher_mot_de_passe
    BEFORE INSERT OR UPDATE OF code_hash ON public.utilisateurs_ecole
    FOR EACH ROW EXECUTE FUNCTION public.hacher_mot_de_passe_utilisateur();

DROP TRIGGER IF EXISTS trg_abonnement_ecriture ON public.utilisateurs_ecole;
CREATE TRIGGER trg_abonnement_ecriture BEFORE INSERT ON public.utilisateurs_ecole
    FOR EACH STATEMENT EXECUTE FUNCTION public.exiger_ecriture_ecole();

-- Contrôle bloquant avant la reprise
DO $$
DECLARE
    v_liste TEXT;
BEGIN
    SELECT string_agg(format('%s (%s)', e.nom, e.id), ', ' ORDER BY e.nom) INTO v_liste
    FROM public.ecoles e
    LEFT JOIN public.acces_ecole a ON a.ecole_id = e.id
    WHERE NOT EXISTS (SELECT 1 FROM public.utilisateurs_ecole u WHERE u.ecole_id = e.id AND u.role = 'directeur')
      AND (a.ecole_id IS NULL
           OR e.email_contact IS NULL
           OR length(lower(trim(e.email_contact))) > 120
           OR lower(trim(e.email_contact)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
           OR coalesce(trim(e.responsable_nom), '') = ''
           OR EXISTS (SELECT 1 FROM public.utilisateurs_ecole u2 WHERE u2.email = lower(trim(e.email_contact)))
           OR EXISTS (SELECT 1 FROM public.ecoles e2
                      WHERE e2.id <> e.id AND lower(trim(e2.email_contact)) = lower(trim(e.email_contact))));
    IF v_liste IS NOT NULL THEN
        RAISE EXCEPTION 'v1.21 : écoles sans compte directeur possible (e-mail invalide ou déjà pris, responsable ou code d''accès manquant) : %. Complétez ecoles.email_contact et ecoles.responsable_nom, puis relancez le script.', v_liste;
    END IF;
END $$;

-- Reprise : un directeur par école existante
INSERT INTO public.utilisateurs_ecole (ecole_id, nom, email, code_hash, role)
SELECT e.id, left(trim(e.responsable_nom), 100), lower(trim(e.email_contact)), a.code_hash, 'directeur'
FROM public.ecoles e
JOIN public.acces_ecole a ON a.ecole_id = e.id
WHERE NOT EXISTS (SELECT 1 FROM public.utilisateurs_ecole u WHERE u.ecole_id = e.id AND u.role = 'directeur')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.jwt_utilisateur_id() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt() ->> 'utilisateur_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION public.jwt_role_utilisateur() RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role_utilisateur' $$;

-- Connexion à l'Espace École (e-mail + mot de passe). L'IP n'est crue que si l'appel vient du serveur
-- Next.js (JWT « connexion »). Aucune ligne renvoyée si l'e-mail ou le mot de passe est incorrect.
CREATE OR REPLACE FUNCTION public.echanger_utilisateur_ecole(p_email TEXT, p_code_hash TEXT, p_ip TEXT DEFAULT NULL)
RETURNS TABLE (utilisateur_id UUID, ecole_id UUID, role TEXT, nom TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
    v_email TEXT := lower(trim(coalesce(p_email, '')));
    v_email_cle TEXT := md5(left(v_email, 120));
    v_cle TEXT := 'utilisateur:' || v_email_cle;
    v_ip TEXT := public.ip_pour_cle(CASE WHEN public.jwt_role_app() = 'connexion' THEN p_ip END);
    v_cle_ip TEXT := 'utilisateurip:' || v_ip || '|' || v_email_cle;
    v_cle_glob TEXT := CASE WHEN v_ip <> 'inconnue' THEN 'ecoleipglob:' || v_ip END;
    v_id UUID;
    v_ecole UUID;
    v_role TEXT;
    v_nom TEXT;
    v_stocke TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cle, 0));
    PERFORM public.controler_tentatives(v_cle);
    PERFORM public.controler_tentatives(v_cle_ip);
    IF v_cle_glob IS NOT NULL THEN
        PERFORM public.controler_tentatives(v_cle_glob);
    END IF;

    SELECT u.id, u.ecole_id, u.role, u.nom, u.code_hash INTO v_id, v_ecole, v_role, v_nom, v_stocke
    FROM public.utilisateurs_ecole u
    JOIN public.ecoles e ON e.id = u.ecole_id
    WHERE u.email = v_email AND u.actif AND e.is_active
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
        RETURN;
    END IF;

    PERFORM public.effacer_tentatives(v_cle_ip);
    RETURN QUERY SELECT v_id, v_ecole, v_role, v_nom;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.echanger_utilisateur_ecole(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.echanger_utilisateur_ecole(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Session École : utilisateur et école actifs, mot de passe inchangé depuis l'émission du cookie (à 30 secondes
-- près : un cookie émis moins de 30 s avant un changement de mot de passe reste valide).
-- Réservée au serveur (JWT « connexion ») : elle renvoie le nom et l'e-mail de l'utilisateur.
CREATE OR REPLACE FUNCTION public.session_utilisateur_valide(p_utilisateur_id UUID, p_emis_at TIMESTAMPTZ)
RETURNS TABLE (ecole_id UUID, role TEXT, nom TEXT, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.ecole_id, u.role, u.nom, u.email
    FROM public.utilisateurs_ecole u
    JOIN public.ecoles e ON e.id = u.ecole_id
    WHERE public.jwt_role_app() = 'connexion'
      AND u.id = p_utilisateur_id AND u.actif AND e.is_active
      AND u.mdp_modifie_at <= p_emis_at + interval '30 seconds'
$$;
REVOKE EXECUTE ON FUNCTION public.session_utilisateur_valide(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_utilisateur_valide(UUID, TIMESTAMPTZ) TO authenticated, service_role;

-- Changement de son propre mot de passe : vérifie l'ancien sans que l'école lise jamais le hash
CREATE OR REPLACE FUNCTION public.changer_mon_mot_de_passe(p_ancien_hash TEXT, p_nouveau_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_utilisateur UUID := public.jwt_utilisateur_id();
    v_ecole UUID := public.jwt_ecole_id();
    v_cle TEXT;
    v_stocke TEXT;
    v_role TEXT;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_utilisateur IS NULL OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé';
    END IF;
    IF p_nouveau_hash IS NULL OR p_nouveau_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Nouveau mot de passe invalide';
    END IF;

    v_cle := 'changemdp:' || v_utilisateur::text;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cle, 0));
    PERFORM public.controler_tentatives(v_cle);

    SELECT code_hash, role INTO v_stocke, v_role
    FROM public.utilisateurs_ecole
    WHERE id = v_utilisateur AND ecole_id = v_ecole AND actif;
    IF NOT public.code_correspond(v_stocke, p_ancien_hash) THEN
        PERFORM public.noter_echec_plafonne(v_cle, 5);
        RETURN false;
    END IF;
    PERFORM public.effacer_tentatives(v_cle);

    UPDATE public.utilisateurs_ecole SET code_hash = p_nouveau_hash WHERE id = v_utilisateur;
    IF v_role = 'directeur' THEN
        UPDATE public.acces_ecole a SET code_hash = u.code_hash, updated_at = now()
        FROM public.utilisateurs_ecole u
        WHERE u.id = v_utilisateur AND a.ecole_id = v_ecole;
    END IF;
    RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.changer_mon_mot_de_passe(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.changer_mon_mot_de_passe(TEXT, TEXT) TO authenticated;

-- ==============================================================================
-- v1.22 : chaque reçu dit qui l'a encaissé (D09, tranche 2).
-- Bloc final : garder en dernier.
--   - nom_utilisateur_courant() : nom de l'utilisateur du JWT (SECURITY DEFINER : la table utilisateurs_ecole n'est
--     lisible par personne côté École). NULL si le JWT n'a pas d'utilisateur ou si l'utilisateur est d'une autre école.
--   - encaisser_paiement : même signature, renseigne paiements.encaisse_par avec ce nom (jamais un paramètre).
--     Le reste de la fonction est celui de la version active (v1.19), sans changement.
--   - inscrire_eleve : même signature, même changement pour l'encaissement fait à l'inscription (décision de
--     l'humain du 2026-11-12) ; le reste de la fonction est celui de la version active (v1.19).
--   - proteger_paiement : encaisse_par devient immuable (il ne l'était pas). importer_reprise ne fait que des INSERT.
--   - CHECK sur utilisateurs_ecole.nom : le nom « Reprise de l'existant » (marqueur de importer_reprise, casse et
--     apostrophe typographique et espaces multiples ou insécables ignorés) est interdit, pour qu'un utilisateur ne se fasse pas passer pour une reprise. Contrôle
--     préalable bloquant : les noms existants (directeurs repris de ecoles.responsable_nom) sont vérifiés.
--   - Les paiements antérieurs gardent encaisse_par NULL. Aucun effet sur les soldes.
-- ==============================================================================
DO $$
DECLARE v_liste TEXT;
BEGIN
    SELECT string_agg(id::text, ', ') INTO v_liste FROM public.utilisateurs_ecole
    -- Même normalisation que la contrainte : casse, apostrophes typographiques, espaces multiples ou insécables
    WHERE btrim(regexp_replace(translate(lower(nom), '’‘ʼ`´' || chr(160), repeat(chr(39), 5) || ' '), '\s+', ' ', 'g')) = 'reprise de l''existant';
    IF v_liste IS NOT NULL THEN
        RAISE EXCEPTION 'v1.22 : utilisateurs dont le nom est réservé (« Reprise de l''existant ») : %. Renommez-les puis relancez le script.', v_liste;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utilisateurs_ecole_nom_reserve_check') THEN
        ALTER TABLE public.utilisateurs_ecole ADD CONSTRAINT utilisateurs_ecole_nom_reserve_check
            CHECK (btrim(regexp_replace(translate(lower(nom), '’‘ʼ`´' || chr(160), repeat(chr(39), 5) || ' '), '\s+', ' ', 'g'))
                   <> 'reprise de l''existant');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.nom_utilisateur_courant() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.nom FROM public.utilisateurs_ecole u
    WHERE public.jwt_role_app() = 'ecole'
      AND u.id = public.jwt_utilisateur_id()
      AND u.ecole_id = public.jwt_ecole_id()
$$;
REVOKE EXECUTE ON FUNCTION public.nom_utilisateur_courant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nom_utilisateur_courant() TO authenticated;

CREATE OR REPLACE FUNCTION public.encaisser_paiement(
    p_inscription_id UUID,
    p_lot_id UUID,
    p_mode TEXT,
    p_reference TEXT,
    p_lignes JSONB,
    p_nb_paiements INTEGER,
    p_total_actif BIGINT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_lignes JSONB := coalesce(p_lignes, '[]'::jsonb);
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_ins public.inscriptions%ROWTYPE;
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_mois_liste DATE[];
    v_dernier DATE;
    v_nb_demande INTEGER;
    v_total_demande BIGINT;
    v_nb_lot INTEGER;
    v_total_lot BIGINT;
    v_ins_lot INTEGER;
    v_ins_lot_id UUID;
    v_lot_annule BOOLEAN;
    v_identique BOOLEAN;
    v_nb_actuel INTEGER;
    v_total_actuel BIGINT;
    v_l RECORD;
    v_type TEXT;
    v_montant INTEGER;
    v_mois DATE;
    v_article UUID;
    v_art public.articles_inscription%ROWTYPE;
    v_du BIGINT;
    v_deja BIGINT;
    v_numero TEXT;
    v_encaisse BIGINT;
    v_ids UUID[];
    v_noms TEXT[];
    v_nom_encaisseur TEXT;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_inscription_id IS NULL OR p_lot_id IS NULL OR p_nb_paiements IS NULL OR p_total_actif IS NULL
       OR p_nb_paiements < 0 OR p_total_actif < 0 THEN
        RAISE EXCEPTION 'Encaissement incomplet, réessayez.' USING ERRCODE = 'FJ422';
    END IF;

    -- Mode et référence (obligatoire pour le mobile money)
    IF p_mode IS NULL OR p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
        RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
        RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
    END IF;
    IF length(v_reference) > 60 THEN
        RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
    END IF;

    -- Forme des lignes, vérifiée champ par champ avant tout cast
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                     OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                     OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                     OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                     OR coalesce(jsonb_typeof(c.e -> 'article_id'), 'null') NOT IN ('string', 'null')
                     OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                     OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                     OR coalesce(c.e ->> 'article_id', '00000000-0000-0000-0000-000000000000')
                        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR length(coalesce(c.e ->> 'libelle', '')) > 120
                     OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_id' IS NOT NULL))
                     OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_id' IS NOT NULL))
                     -- Paiement libre (sans article) : un libellé de 1 à 80 caractères, pas de mois
                     OR (c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL
                         AND (c.e ->> 'mois' IS NOT NULL
                              OR length(btrim(coalesce(c.e ->> 'libelle', ''))) NOT BETWEEN 1 AND 80)))
       OR (SELECT count(*) FROM jsonb_array_elements(v_lignes))
          <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_id', ''))
                                    || '|' || CASE WHEN c.e ->> 'article_id' IS NULL AND c.e ->> 'type' = 'autre' THEN btrim(c.e ->> 'libelle') ELSE '' END)
              FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
        RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    SELECT count(*), sum((c.e ->> 'montant')::int) INTO v_nb_demande, v_total_demande FROM jsonb_array_elements(v_lignes) AS c(e);

    -- Verrou de l'inscription : les encaissements simultanés d'un même élève passent l'un après l'autre
    SELECT * INTO v_ins FROM public.inscriptions WHERE id = p_inscription_id AND ecole_id = v_ecole FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Inscription introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_ins.annee_scolaire !~ '^[0-9]{4}-[0-9]{4}$' THEN
        RAISE EXCEPTION 'Année scolaire invalide pour cette inscription.' USING ERRCODE = 'FJ422';
    END IF;
    -- Un même lot_id demandé pour deux élèves à la fois ne doit pas échapper au contrôle du trigger numeroter_recu
    PERFORM pg_advisory_xact_lock(hashtextextended('lot:' || v_ecole::text || ':' || p_lot_id::text, 0));
    SELECT mois_debut, nb_mensualites INTO v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_mois_debut IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;

    -- 1. Rejeu : la clé a déjà servi
    SELECT count(*), coalesce(sum(montant), 0), count(DISTINCT inscription_id), min(inscription_id::text)::uuid,
           min(numero_recu), array_agg(id ORDER BY created_at, id), bool_or(annule)
      INTO v_nb_lot, v_total_lot, v_ins_lot, v_ins_lot_id, v_numero, v_ids, v_lot_annule
    FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id;
    IF v_nb_lot > 0 THEN
        IF v_lot_annule THEN
            RAISE EXCEPTION 'Ce reçu a été annulé : recommencez un nouvel encaissement.' USING ERRCODE = 'FJ412';
        END IF;
        -- Même élève et exactement les mêmes lignes (comparaison de multiensembles dans les deux sens)
        v_identique := v_ins_lot = 1 AND v_ins_lot_id = p_inscription_id AND v_total_lot = v_total_demande AND v_nb_lot = v_nb_demande
            AND NOT EXISTS (
                (SELECT type, mois, article_id, montant::bigint,
                        CASE WHEN type = 'autre' AND article_id IS NULL THEN nullif(btrim(coalesce(libelle, '')), '') END
                 FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id
                 EXCEPT ALL
                 SELECT c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'article_id')::uuid, (c.e ->> 'montant')::bigint,
                        CASE WHEN c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL THEN nullif(btrim(coalesce(c.e ->> 'libelle', '')), '') END
                 FROM jsonb_array_elements(v_lignes) AS c(e))
                UNION ALL
                (SELECT c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'article_id')::uuid, (c.e ->> 'montant')::bigint,
                        CASE WHEN c.e ->> 'type' = 'autre' AND c.e ->> 'article_id' IS NULL THEN nullif(btrim(coalesce(c.e ->> 'libelle', '')), '') END
                 FROM jsonb_array_elements(v_lignes) AS c(e)
                 EXCEPT ALL
                 SELECT type, mois, article_id, montant::bigint,
                        CASE WHEN type = 'autre' AND article_id IS NULL THEN nullif(btrim(coalesce(libelle, '')), '') END
                 FROM public.paiements WHERE ecole_id = v_ecole AND lot_id = p_lot_id)
            );
        IF v_identique THEN
            RETURN jsonb_build_object('numero_recu', v_numero, 'montant_encaisse', v_total_lot, 'ids', to_jsonb(v_ids), 'rejoue', true);
        END IF;
        RAISE EXCEPTION 'Cette clé d''encaissement a déjà servi pour un autre encaissement : rechargez la page et recommencez.'
            USING ERRCODE = 'FJ412';
    END IF;

    -- 2. Empreinte : rien n'a bougé pour cet élève depuis la lecture du serveur
    SELECT count(*), coalesce(sum(montant) FILTER (WHERE NOT annule), 0) INTO v_nb_actuel, v_total_actuel
    FROM public.paiements WHERE inscription_id = p_inscription_id AND ecole_id = v_ecole;
    IF v_nb_actuel <> p_nb_paiements OR v_total_actuel <> p_total_actif THEN
        RAISE EXCEPTION 'Un autre encaissement ou une annulation vient d''être enregistré pour cet élève : vérifiez la fiche et recommencez.'
            USING ERRCODE = 'FJ412';
    END IF;

    -- 3. Plafonds, d'après les tarifs figés de l'inscription
    SELECT array_agg((make_date(substr(v_ins.annee_scolaire, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date ORDER BY i)
      INTO v_mois_liste FROM generate_series(0, v_nb_mois - 1) AS g(i);
    v_dernier := v_mois_liste[array_length(v_mois_liste, 1)];

    FOR v_l IN SELECT c.e AS e FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n) ORDER BY c.n LOOP
        v_type := v_l.e ->> 'type';
        v_montant := (v_l.e ->> 'montant')::int;
        v_mois := (v_l.e ->> 'mois')::date;
        v_article := (v_l.e ->> 'article_id')::uuid;

        IF v_type = 'inscription' THEN
            v_du := v_ins.frais_inscription;
            SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
            WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND type = 'inscription';

        ELSIF v_type = 'mensualite' THEN
            IF NOT (v_mois = ANY (v_mois_liste)) THEN
                RAISE EXCEPTION 'Mois invalide pour cette année scolaire.' USING ERRCODE = 'FJ422';
            END IF;
            -- Dû du mois : tarif du dernier mois pour le dernier, mensualité sinon, moins la réduction
            v_du := greatest(0, (CASE WHEN v_mois = v_dernier THEN coalesce(v_ins.mensualite_dernier_mois, v_ins.mensualite)
                                      ELSE v_ins.mensualite END) - v_ins.reduction_mensuelle);
            SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
            WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND type = 'mensualite' AND mois = v_mois;

        ELSIF v_article IS NOT NULL THEN
            SELECT * INTO v_art FROM public.articles_inscription
            WHERE id = v_article AND inscription_id = v_ins.id AND ecole_id = v_ecole;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Article introuvable pour cet élève.' USING ERRCODE = 'FJ404';
            END IF;
            IF v_art.nature = 'unique' THEN
                IF v_mois IS NOT NULL THEN
                    RAISE EXCEPTION 'Montant à encaisser incohérent avec le tarif, réessayez.' USING ERRCODE = 'FJ422';
                END IF;
                v_du := v_art.prix_unitaire::bigint * v_art.quantite;
                SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
                WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND article_id = v_art.id;
            ELSE
                -- Service mensuel : un mois de l'année, prix_unitaire par mois
                IF v_mois IS NULL OR NOT (v_mois = ANY (v_mois_liste)) THEN
                    RAISE EXCEPTION 'Mois invalide pour cette année scolaire.' USING ERRCODE = 'FJ422';
                END IF;
                -- Période du service : hors de [mois_debut, mois_fin] -> refus (NULL = bord de l'année scolaire)
                IF v_mois < coalesce(v_art.mois_debut, v_mois_liste[1])
                   OR v_mois > coalesce(v_art.mois_fin, v_dernier) THEN
                    v_noms := ARRAY['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                                    'septembre', 'octobre', 'novembre', 'décembre'];
                    RAISE EXCEPTION '% : % % est hors de la période du service (% % à % %).',
                        v_art.libelle,
                        v_noms[extract(month FROM v_mois)::int], extract(year FROM v_mois)::int,
                        v_noms[extract(month FROM coalesce(v_art.mois_debut, v_mois_liste[1]))::int],
                        extract(year FROM coalesce(v_art.mois_debut, v_mois_liste[1]))::int,
                        v_noms[extract(month FROM coalesce(v_art.mois_fin, v_dernier))::int],
                        extract(year FROM coalesce(v_art.mois_fin, v_dernier))::int
                        USING ERRCODE = 'FJ412';
                END IF;
                v_du := v_art.prix_unitaire;
                SELECT coalesce(sum(montant), 0) INTO v_deja FROM public.paiements
                WHERE inscription_id = v_ins.id AND ecole_id = v_ecole AND NOT annule AND article_id = v_art.id AND mois = v_mois;
            END IF;

        ELSE
            -- Paiement libre hors catalogue : réservé à un élève encore inscrit, sans plafond de cumul
            IF v_ins.statut <> 'active' THEN
                RAISE EXCEPTION 'Élève parti : seul le solde dû peut être encaissé.' USING ERRCODE = 'FJ412';
            END IF;
            v_du := 99999999;
            v_deja := 0;
        END IF;

        IF v_deja + v_montant > v_du THEN
            RAISE EXCEPTION 'Le montant dépasse ce qui reste dû pour cet élément : vérifiez la fiche et recommencez.' USING ERRCODE = 'FJ412';
        END IF;
    END LOOP;

    -- Nom de celui qui encaisse, lu en base d'après le JWT (jamais un paramètre) ; NULL si le JWT n'a pas d'utilisateur
    v_nom_encaisseur := public.nom_utilisateur_courant();

    -- 4. Un seul INSERT : les lignes partagent p_lot_id, donc le même numéro de reçu (trigger numeroter_recu).
    -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
    WITH inseres AS (
        INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id, encaisse_par)
        SELECT v_ecole, v_ins.id, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
               p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), p_lot_id, (c.e ->> 'article_id')::uuid,
               v_nom_encaisseur
        FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
        ORDER BY c.n
        RETURNING id, numero_recu, montant
    )
    SELECT min(numero_recu), sum(montant), array_agg(id) INTO v_numero, v_encaisse, v_ids FROM inseres;

    RETURN jsonb_build_object('numero_recu', v_numero, 'montant_encaisse', v_encaisse, 'ids', to_jsonb(v_ids), 'rejoue', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.encaisser_paiement(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, BIGINT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encaisser_paiement(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, BIGINT)
    TO authenticated;

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
       OR NEW.libelle IS DISTINCT FROM OLD.libelle
       OR NEW.numero_recu IS DISTINCT FROM OLD.numero_recu
       OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
       OR NEW.article_id IS DISTINCT FROM OLD.article_id
       OR NEW.paye_le IS DISTINCT FROM OLD.paye_le
       OR NEW.encaisse_par IS DISTINCT FROM OLD.encaisse_par
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

CREATE OR REPLACE FUNCTION public.inscrire_eleve(
    p_classe_id UUID,
    p_eleve_id UUID DEFAULT NULL,
    p_prenom TEXT DEFAULT NULL,
    p_nom TEXT DEFAULT NULL,
    p_sexe TEXT DEFAULT NULL,
    p_date_naissance DATE DEFAULT NULL,
    p_parent_nom TEXT DEFAULT NULL,
    p_parent_telephone TEXT DEFAULT NULL,
    p_reduction INTEGER DEFAULT 0,
    p_articles JSONB DEFAULT '[]'::jsonb,
    p_mois_debut_services DATE DEFAULT NULL,
    p_mode TEXT DEFAULT NULL,
    p_reference TEXT DEFAULT NULL,
    p_lignes_paiement JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_annee TEXT;
    v_classe public.classes%ROWTYPE;
    v_choix JSONB := coalesce(p_articles, '[]'::jsonb);
    v_lignes JSONB := coalesce(p_lignes_paiement, '[]'::jsonb);
    v_prenom TEXT := btrim(coalesce(p_prenom, ''));
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_parent_nom TEXT := btrim(coalesce(p_parent_nom, ''));
    v_manquant TEXT;
    v_eleve UUID;
    v_parent UUID;
    v_parent_cree BOOLEAN := false;
    v_matricule TEXT;
    v_inscription UUID;
    v_reference TEXT := nullif(btrim(coalesce(p_reference, '')), '');
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_lot UUID;
    v_numero_recu TEXT;
    v_montant_encaisse BIGINT := 0;
    v_nom_encaisseur TEXT := public.nom_utilisateur_courant(); -- D09 : lu d'après le JWT, jamais un paramètre
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    -- Encaissement demandé : mode valide, référence (obligatoire pour le mobile money), lignes bien formées.
    -- Aucun cast avant que la forme de chaque champ soit vérifiée.
    IF jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Lignes de paiement mal formées, réessayez.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mode IS NULL THEN
        IF v_reference IS NOT NULL OR jsonb_array_length(v_lignes) > 0 THEN
            RAISE EXCEPTION 'Mode de paiement manquant.' USING ERRCODE = 'FJ422';
        END IF;
    ELSE
        IF p_mode NOT IN ('especes', 'wave', 'orange_money', 'free_money', 'virement', 'cheque') THEN
            RAISE EXCEPTION 'Mode de paiement inconnu.' USING ERRCODE = 'FJ422';
        END IF;
        IF p_mode IN ('wave', 'orange_money', 'free_money') AND v_reference IS NULL THEN
            RAISE EXCEPTION 'Indiquez la référence de la transaction mobile money.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_reference) > 60 THEN
            RAISE EXCEPTION 'Référence trop longue.' USING ERRCODE = 'FJ422';
        END IF;
        -- v1.19 : un message par cause (nombre de lignes, forme, libellé, doublon)
        IF jsonb_array_length(v_lignes) NOT BETWEEN 1 AND 50 THEN
            RAISE EXCEPTION 'Un encaissement compte de 1 à 50 lignes.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                      WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                         OR coalesce(c.e ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                         OR jsonb_typeof(c.e -> 'montant') IS DISTINCT FROM 'number'
                         OR coalesce(c.e ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                         OR coalesce(jsonb_typeof(c.e -> 'mois'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'article_classe_id'), 'null') NOT IN ('string', 'null')
                         OR coalesce(jsonb_typeof(c.e -> 'libelle'), 'null') NOT IN ('string', 'null')
                         OR coalesce(c.e ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                         OR coalesce(c.e ->> 'article_classe_id', '00000000-0000-0000-0000-000000000000')
                            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         -- Cohérence du type : inscription sans mois ni article, mensualité avec mois, article avec type « autre »
                         OR (c.e ->> 'type' = 'inscription' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'mensualite' AND (c.e ->> 'mois' IS NULL OR c.e ->> 'article_classe_id' IS NOT NULL))
                         OR (c.e ->> 'type' = 'autre' AND (c.e ->> 'mois' IS NOT NULL OR c.e ->> 'article_classe_id' IS NULL))) THEN
            RAISE EXCEPTION 'Lignes de paiement mal formées, réessayez.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e) WHERE length(coalesce(c.e ->> 'libelle', '')) > 120) THEN
            RAISE EXCEPTION 'Libellé de paiement trop long (120 caractères au plus).' USING ERRCODE = 'FJ422';
        END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(v_lignes))
           <> (SELECT count(DISTINCT (c.e ->> 'type') || '|' || coalesce(c.e ->> 'mois', '') || '|' || lower(coalesce(c.e ->> 'article_classe_id', '')))
               FROM jsonb_array_elements(v_lignes) AS c(e)) THEN
            RAISE EXCEPTION 'Une même ligne de paiement est citée deux fois.' USING ERRCODE = 'FJ422';
        END IF;
    END IF;

    -- Année scolaire de l'école et classe choisie (active, de la même année)
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    -- Verrou partagé de la classe (v1.10) : un enregistrement du catalogue (enregistrer_classe, FOR NO KEY UPDATE)
    -- passe avant ou après cette inscription, jamais pendant. Deux inscriptions dans la même classe ne se bloquent pas.
    SELECT * INTO v_classe FROM public.classes WHERE id = p_classe_id AND ecole_id = v_ecole AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Classe introuvable ou désactivée.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
        RAISE EXCEPTION 'Cette classe appartient à l''année %.', v_classe.annee_scolaire USING ERRCODE = 'FJ412';
    END IF;
    IF p_reduction IS NULL OR p_reduction < 0 THEN
        RAISE EXCEPTION 'Réduction invalide.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_reduction > v_classe.mensualite THEN
        RAISE EXCEPTION 'La réduction dépasse la mensualité.' USING ERRCODE = 'FJ422';
    END IF;

    -- Articles retenus : [{article_classe_id, quantite}], chacun du catalogue de cette classe, une seule fois
    -- v1.19 : CASE, l'ordre d'évaluation d'un OR n'est pas garanti (jsonb_array_length échoue hors tableau)
    IF (CASE WHEN jsonb_typeof(v_choix) IS DISTINCT FROM 'array' THEN true ELSE jsonb_array_length(v_choix) > 50 END) THEN
        RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                  WHERE jsonb_typeof(c.e) IS DISTINCT FROM 'object'
                     OR coalesce(c.e ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     OR coalesce(c.e ->> 'quantite', '') !~ '^[0-9]{1,2}$')
       OR (SELECT count(*) FROM jsonb_array_elements(v_choix))
          <> (SELECT count(DISTINCT lower(e ->> 'article_classe_id')) FROM jsonb_array_elements(v_choix) AS c(e)) THEN
        RAISE EXCEPTION 'Articles invalides.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
               WHERE NOT EXISTS (SELECT 1 FROM public.articles_classe a
                                 WHERE a.id = (c.e ->> 'article_classe_id')::uuid
                                   AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole)) THEN
        RAISE EXCEPTION 'Article introuvable pour cette classe.' USING ERRCODE = 'FJ404';
    END IF;
    -- Un article obligatoire (service mensuel, ou frais unique avec une quantité par défaut) doit être retenu
    SELECT a.libelle INTO v_manquant
    FROM public.articles_classe a
    WHERE a.classe_id = v_classe.id AND a.ecole_id = v_ecole AND a.obligatoire
      AND (a.nature = 'mensuel' OR a.quantite_defaut > 0)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                      WHERE (c.e ->> 'article_classe_id')::uuid = a.id
                        AND (a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0))
    ORDER BY a.ordre
    LIMIT 1;
    IF v_manquant IS NOT NULL THEN
        RAISE EXCEPTION '« % » est obligatoire pour cette classe.', v_manquant USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_choix) AS c(e)
                   JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                   WHERE a.nature = 'mensuel') THEN
        RAISE EXCEPTION 'Mois de début des services manquant.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_mois_debut_services IS NOT NULL AND extract(day FROM p_mois_debut_services) <> 1 THEN
        RAISE EXCEPTION 'Mois de début des services invalide.' USING ERRCODE = 'FJ422';
    END IF;

    IF p_eleve_id IS NOT NULL THEN
        -- Réinscription : l'élève existe dans l'école, son parent ne change pas
        SELECT id, parent_id INTO v_eleve, v_parent FROM public.eleves WHERE id = p_eleve_id AND ecole_id = v_ecole;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Élève introuvable.' USING ERRCODE = 'FJ404';
        END IF;
    ELSE
        IF v_prenom = '' OR v_nom = '' THEN
            RAISE EXCEPTION 'Prénom et nom de l''élève obligatoires.' USING ERRCODE = 'FJ422';
        END IF;
        IF length(v_prenom) > 60 OR length(v_nom) > 60 THEN
            RAISE EXCEPTION 'Prénom ou nom de l''élève trop long.' USING ERRCODE = 'FJ422';
        END IF;
        IF v_parent_nom = '' OR length(v_parent_nom) > 80 OR coalesce(p_parent_telephone, '') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION 'Nom et téléphone du parent obligatoires (ex : 77 123 45 67).' USING ERRCODE = 'FJ422';
        END IF;
        IF p_sexe IS NOT NULL AND p_sexe NOT IN ('M', 'F') THEN
            RAISE EXCEPTION 'Sexe invalide.' USING ERRCODE = 'FJ422';
        END IF;

        -- Matricule (v1.19) : calculé par prochain_matricule, qui prend le verrou « matricule: » AVANT toute écriture
        -- du parent, dans le même ordre que importer_reprise (plus d'interblocage entre inscription et import).
        v_matricule := public.prochain_matricule(v_annee);

        -- Parent : le même téléphone dans l'école désigne le même parent (son nom et son lien ne changent pas).
        -- DO NOTHING (v1.19) : la ligne d'un parent connu n'est ni réécrite ni verrouillée.
        INSERT INTO public.parents (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, p_parent_telephone)
        ON CONFLICT (ecole_id, telephone) DO NOTHING
        RETURNING id INTO v_parent;
        v_parent_cree := v_parent IS NOT NULL;
        IF v_parent IS NULL THEN
            SELECT id INTO v_parent FROM public.parents WHERE ecole_id = v_ecole AND telephone = p_parent_telephone;
            IF v_parent IS NULL THEN
                RAISE EXCEPTION 'Parent introuvable, réessayez.' USING ERRCODE = 'FJ404';
            END IF;
        END IF;

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, p_sexe, p_date_naissance)
        RETURNING id INTO v_eleve;
    END IF;

    -- Inscription : tarifs figés depuis la classe (un élève déjà inscrit cette année lève 23505)
    INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                     mensualite_dernier_mois, reduction_mensuelle)
    VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
            v_classe.mensualite_dernier_mois, p_reduction)
    RETURNING id INTO v_inscription;

    -- Articles : libellé, nature, prix et obligation recopiés du catalogue ; un service mensuel compte pour 1
    INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                             prix_unitaire, quantite, obligatoire, mois_debut)
    SELECT v_ecole, v_inscription, a.id, a.libelle, a.nature, a.prix_unitaire,
           CASE WHEN a.nature = 'mensuel' THEN 1 ELSE (c.e ->> 'quantite')::int END,
           a.obligatoire,
           CASE WHEN a.nature = 'mensuel' THEN p_mois_debut_services END
    FROM jsonb_array_elements(v_choix) AS c(e)
    JOIN public.articles_classe a ON a.id = (c.e ->> 'article_classe_id')::uuid
                                  AND a.classe_id = v_classe.id AND a.ecole_id = v_ecole
    WHERE a.nature = 'mensuel' OR (c.e ->> 'quantite')::int > 0
    ORDER BY a.ordre;

    -- Encaissement : chaque ligne doit correspondre à un élément réellement dû d'une inscription neuve
    -- (aucun paiement antérieur), avec 0 < montant <= reste dû. Le montant exact est calculé par le serveur.
    IF p_mode IS NOT NULL THEN
        -- v1.19 : un message par cause, avant le contrôle des plafonds (inchangé)
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                   WHERE CASE WHEN c.e ->> 'type' = 'mensualite' THEN
                       (c.e ->> 'mois')::date NOT IN (
                           SELECT (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date
                           FROM generate_series(0, v_nb_mois - 1) AS g(i))
                   ELSE false END) THEN
            RAISE EXCEPTION 'Un mois à encaisser est hors de l''année scolaire.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lignes) AS c(e)
                   LEFT JOIN public.articles_inscription ai
                          ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                         AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
                   WHERE c.e ->> 'type' = 'autre' AND (ai.id IS NULL OR ai.nature <> 'unique')) THEN
            RAISE EXCEPTION 'Seul un frais unique retenu pour l''élève s''encaisse à l''inscription.' USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_lignes) AS c(e)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            WHERE CASE c.e ->> 'type'
                WHEN 'inscription' THEN (c.e ->> 'montant')::int > v_classe.frais_inscription
                WHEN 'mensualite' THEN
                    (c.e ->> 'mois')::date NOT IN (
                        SELECT (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date
                        FROM generate_series(0, v_nb_mois - 1) AS g(i))
                    -- Dû exact du mois (comme situationInscription) : tarif du dernier mois pour le dernier, mensualité sinon
                    OR (c.e ->> 'montant')::int >
                       CASE WHEN (c.e ->> 'mois')::date =
                                 (make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + v_nb_mois - 1) * interval '1 month'))::date
                            THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                            ELSE v_classe.mensualite END - p_reduction
                ELSE ai.id IS NULL OR ai.nature <> 'unique' OR (c.e ->> 'montant')::int > ai.prix_unitaire::bigint * ai.quantite
            END
        ) THEN
            RAISE EXCEPTION 'Un montant à encaisser dépasse ce qui est dû, réessayez.' USING ERRCODE = 'FJ422';
        END IF;

        -- Un seul INSERT : les lignes partagent le lot_id, donc le même numéro de reçu (trigger numeroter_recu).
        -- paye_le reste au DEFAULT de la colonne (date du jour à Dakar).
        v_lot := gen_random_uuid();
        -- Même verrou de lot que encaisser_paiement (v1.19, finding M4)
        PERFORM pg_advisory_xact_lock(hashtextextended('lot:' || v_ecole::text || ':' || v_lot::text, 0));
        WITH inseres AS (
            INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle, lot_id, article_id, encaisse_par)
            SELECT v_ecole, v_inscription, c.e ->> 'type', (c.e ->> 'mois')::date, (c.e ->> 'montant')::int,
                   p_mode, v_reference, nullif(btrim(coalesce(c.e ->> 'libelle', '')), ''), v_lot, ai.id, v_nom_encaisseur
            FROM jsonb_array_elements(v_lignes) WITH ORDINALITY AS c(e, n)
            LEFT JOIN public.articles_inscription ai
                   ON ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole
                  AND ai.article_classe_id = (c.e ->> 'article_classe_id')::uuid
            ORDER BY c.n
            RETURNING numero_recu, montant
        )
        SELECT min(numero_recu), sum(montant) INTO v_numero_recu, v_montant_encaisse FROM inseres;
    END IF;

    RETURN jsonb_build_object(
        'eleve_id', v_eleve,
        'inscription_id', v_inscription,
        'parent_id', v_parent,
        'parent_cree', v_parent_cree,
        'matricule', v_matricule,
        'numero_recu', v_numero_recu,
        'montant_encaisse', v_montant_encaisse
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    TO authenticated;

-- ==============================================================================
-- v1.23 : plusieurs utilisateurs par école, tranche 3 (feature D09) : le directeur gère ses caissiers.
-- Bloc final : garder en dernier.
--
-- Toutes les fonctions sont réservées au directeur, vérifié deux fois : rôle du JWT (jwt_role_utilisateur) ET
-- compte actif de rôle « directeur » dans utilisateurs_ecole pour l'utilisateur et l'école du JWT. Refus : FJ403.
-- Elles ne touchent qu'un caissier de l'école du JWT (FJ404 sinon) : un directeur n'est jamais créé, désactivé
-- ni réinitialisé par l'école (décision du 2026-11-12 : un seul directeur, réinitialisé par /admin en T6).
--   - lister_utilisateurs_ecole() : id, nom, e-mail, rôle, actif, créé le. Jamais code_hash (la table reste sans
--     aucun droit direct : une policy SELECT exposerait le hash, la RLS ne filtre pas les colonnes).
--   - creer_utilisateur_ecole(nom, e-mail, sha256) : crée un caissier actif. E-mail déjà pris (toutes écoles) :
--     FJ422 sans dire où. 20 comptes au plus par école, directeur et désactivés compris (décision du
--     2026-11-12) : FJ422 au-delà ; verrou par école pour que deux créations simultanées ne dépassent pas. Nom réservé : refusé par la contrainte du bloc v1.22. Lecture seule (F21) : refusé
--     par trg_abonnement_ecriture (FJ403).
--   - changer_statut_utilisateur(id, actif) : désactive ou réactive un caissier (décision du 2026-11-12 :
--     réactivation permise). Chaque changement date mdp_modifie_at : les sessions émises avant sont coupées,
--     et un cookie d'avant la désactivation ne revit pas à la réactivation.
--   - reinitialiser_mot_de_passe_utilisateur(id, sha256) : nouveau mot de passe provisoire pour un caissier ;
--     le trigger le hache en bcrypt et date mdp_modifie_at (session coupée). Les compteurs d'échecs de
--     connexion de son e-mail sont effacés : un caissier bloqué (FJ429) se reconnecte aussitôt (décision du
--     2026-11-12).
-- Désactiver et réinitialiser restent permis en lecture seule (UPDATE non gardé, comme changer son mot de passe).
-- ==============================================================================

-- Directeur actif de l'école du JWT, sinon FJ403 ; renvoie l'école
CREATE OR REPLACE FUNCTION public.exiger_directeur()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole'
       OR public.jwt_role_utilisateur() IS DISTINCT FROM 'directeur'
       OR v_ecole IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM public.utilisateurs_ecole
           WHERE id = public.jwt_utilisateur_id() AND ecole_id = v_ecole AND role = 'directeur' AND actif
       ) THEN
        RAISE EXCEPTION 'Réservé au directeur de l''école.' USING ERRCODE = 'FJ403';
    END IF;
    RETURN v_ecole;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.exiger_directeur() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lister_utilisateurs_ecole()
RETURNS TABLE (id UUID, nom TEXT, email TEXT, role TEXT, actif BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
    v_ecole UUID := public.exiger_directeur();
BEGIN
    RETURN QUERY
    SELECT u.id, u.nom, u.email, u.role, u.actif, u.created_at
    FROM public.utilisateurs_ecole u
    WHERE u.ecole_id = v_ecole
    ORDER BY (u.role = 'directeur') DESC, u.actif DESC, u.nom, u.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.lister_utilisateurs_ecole() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lister_utilisateurs_ecole() TO authenticated;

CREATE OR REPLACE FUNCTION public.creer_utilisateur_ecole(p_nom TEXT, p_email TEXT, p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.exiger_directeur();
    v_nom TEXT := btrim(coalesce(p_nom, ''));
    v_email TEXT := lower(btrim(coalesce(p_email, '')));
    v_id UUID;
BEGIN
    IF length(v_nom) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Indiquez le nom du caissier (100 caractères au plus).' USING ERRCODE = 'FJ422';
    END IF;
    IF length(v_email) > 120 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
        RAISE EXCEPTION 'Adresse e-mail invalide.' USING ERRCODE = 'FJ422';
    END IF;
    IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Mot de passe invalide.' USING ERRCODE = 'FJ422';
    END IF;

    -- Verrous : par école (plafond de comptes) puis par e-mail (deux créations du même e-mail ne se croisent pas)
    PERFORM pg_advisory_xact_lock(hashtextextended('utilisateurs-ecole:' || v_ecole::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('utilisateur-email:' || v_email, 0));
    IF (SELECT count(*) FROM public.utilisateurs_ecole WHERE ecole_id = v_ecole) >= 20 THEN
        RAISE EXCEPTION 'Limite de 20 comptes par école atteinte (comptes désactivés compris) : contactez FayJàng.'
            USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM public.utilisateurs_ecole WHERE email = v_email) THEN
        RAISE EXCEPTION 'Cet e-mail est déjà utilisé par un compte FayJàng : choisissez une autre adresse.'
            USING ERRCODE = 'FJ422';
    END IF;

    INSERT INTO public.utilisateurs_ecole (ecole_id, nom, email, code_hash, role)
    VALUES (v_ecole, v_nom, v_email, p_code_hash, 'caissier')
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.creer_utilisateur_ecole(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creer_utilisateur_ecole(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.changer_statut_utilisateur(p_id UUID, p_actif BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.exiger_directeur();
BEGIN
    IF p_actif IS NULL THEN
        RAISE EXCEPTION 'Statut invalide.' USING ERRCODE = 'FJ422';
    END IF;
    UPDATE public.utilisateurs_ecole
    SET actif = p_actif, mdp_modifie_at = now()
    WHERE id = p_id AND ecole_id = v_ecole AND role = 'caissier';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Caissier introuvable dans cette école.' USING ERRCODE = 'FJ404';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.changer_statut_utilisateur(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.changer_statut_utilisateur(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.reinitialiser_mot_de_passe_utilisateur(p_id UUID, p_nouveau_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.exiger_directeur();
    v_email_cle TEXT;
BEGIN
    IF p_nouveau_hash IS NULL OR p_nouveau_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Mot de passe invalide.' USING ERRCODE = 'FJ422';
    END IF;
    UPDATE public.utilisateurs_ecole
    SET code_hash = p_nouveau_hash
    WHERE id = p_id AND ecole_id = v_ecole AND role = 'caissier'
    RETURNING md5(left(email, 120)) INTO v_email_cle;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Caissier introuvable dans cette école.' USING ERRCODE = 'FJ404';
    END IF;
    -- Mêmes clés que echanger_utilisateur_ecole (bloc v1.21) : par e-mail, et par IP + e-mail
    DELETE FROM public.tentatives_connexion
    WHERE cle = 'utilisateur:' || v_email_cle
       OR cle LIKE 'utilisateurip:%|' || v_email_cle;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reinitialiser_mot_de_passe_utilisateur(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reinitialiser_mot_de_passe_utilisateur(UUID, TEXT) TO authenticated;

-- ==============================================================================
-- v1.24 : seul le directeur annule un reçu, et on sait qui (D09, tranche 4).
-- Bloc final : garder en dernier.
--   - paiements.annule_par : nom de la personne qui a annulé (copie de nom_utilisateur_courant() au moment de
--     l'annulation, jamais fourni par le client). Visible dans l'Espace École seulement (la page parent et le reçu
--     parent ne le sélectionnent pas ; les anciennes annulations ont NULL).
--   - proteger_paiement : même version que le bloc v1.22 ; en plus, annule_par est immuable hors annulation (il
--     rejoint la liste IS DISTINCT FROM : un client ne peut pas le fournir) et il est renseigné à la transition
--     annule faux -> vrai.
--   - numeroter_recu : même version que le bloc v1.4 ; en plus, annule_par est remis à NULL à l'insertion, comme
--     motif_annulation et annule_at.
--   - policy ecole_annule : USING et WITH CHECK exigent en plus jwt_role_utilisateur() = 'directeur' (le refus du
--     caissier est appliqué par la base, pas seulement par l'action et les boutons).
--   La lecture (ecole_lit_ses_paiements) et l'insertion (ecole_encaisse) ne changent pas : le caissier encaisse.
-- ==============================================================================
ALTER TABLE public.paiements ADD COLUMN IF NOT EXISTS annule_par TEXT;

CREATE OR REPLACE FUNCTION public.numeroter_recu()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_annee INTEGER := extract(year FROM NEW.paye_le)::int;
    v_num INTEGER;
    v_numero TEXT;
    v_inscription UUID;
    v_created TIMESTAMPTZ;
BEGIN
    NEW.annule := false;
    NEW.motif_annulation := NULL;
    NEW.annule_at := NULL;
    NEW.annule_par := NULL;

    IF NEW.lot_id IS NOT NULL THEN
        SELECT numero_recu, inscription_id, created_at INTO v_numero, v_inscription, v_created
        FROM public.paiements
        WHERE ecole_id = NEW.ecole_id AND lot_id = NEW.lot_id
        LIMIT 1;
        IF FOUND THEN
            IF v_created IS DISTINCT FROM now() THEN
                RAISE EXCEPTION 'Ce reçu est déjà émis : impossible d''y ajouter une ligne.' USING ERRCODE = 'FJ412';
            END IF;
            IF v_inscription IS DISTINCT FROM NEW.inscription_id THEN
                RAISE EXCEPTION 'Un reçu ne concerne qu''un seul élève.' USING ERRCODE = 'FJ422';
            END IF;
            NEW.numero_recu := v_numero;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.compteurs_recus AS c (ecole_id, annee, dernier)
    VALUES (NEW.ecole_id, v_annee, 1)
    ON CONFLICT (ecole_id, annee) DO UPDATE SET dernier = c.dernier + 1
    RETURNING dernier INTO v_num;
    NEW.numero_recu := 'FJ-' || v_annee || '-' || lpad(v_num::text, 5, '0');
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.numeroter_recu() FROM PUBLIC, anon, authenticated;

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
       OR NEW.libelle IS DISTINCT FROM OLD.libelle
       OR NEW.numero_recu IS DISTINCT FROM OLD.numero_recu
       OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
       OR NEW.article_id IS DISTINCT FROM OLD.article_id
       OR NEW.paye_le IS DISTINCT FROM OLD.paye_le
       OR NEW.encaisse_par IS DISTINCT FROM OLD.encaisse_par
       OR NEW.annule_par IS DISTINCT FROM OLD.annule_par
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Un paiement encaissé ne se modifie pas : annulez-le puis saisissez le bon.' USING ERRCODE = 'FJ412';
    END IF;
    IF NEW.annule AND length(trim(coalesce(NEW.motif_annulation, ''))) < 3 THEN
        RAISE EXCEPTION 'Indiquez le motif de l''annulation.' USING ERRCODE = 'FJ422';
    END IF;
    IF NEW.annule THEN
        NEW.annule_at := now();
        NEW.annule_par := public.nom_utilisateur_courant(); -- D09 : lu d'après le JWT, jamais fourni par le client
    END IF;
    RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS ecole_annule ON public.paiements;
CREATE POLICY ecole_annule ON public.paiements FOR UPDATE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());

-- ==============================================================================
-- v1.25 : plusieurs utilisateurs par école, tranche 5 (feature D09) : le caissier ne touche ni aux paramètres de
-- l'école, ni aux classes et tarifs, ni à l'import.
-- Bloc final : garder en dernier.
--
-- 1. Écritures réservées au directeur sur ecoles, classes et articles_classe. Le refus est porté par WITH CHECK
--    (UPDATE) et par les policies INSERT / DELETE, PAS par le USING de l'UPDATE : un SELECT … FOR SHARE / FOR NO KEY
--    UPDATE applique aussi le USING des policies UPDATE, et le caissier doit garder ses verrous de lecture
--    (inscrire_eleve verrouille la classe en FOR SHARE, l'ajout d'un article à un élève verrouille la ligne du
--    catalogue). Un UPDATE du caissier trouve donc la ligne puis échoue au WITH CHECK (42501).
--    enregistrer_classe et enregistrer_parametres (SECURITY INVOKER) héritent de ce refus sans être modifiées.
--    Lecture inchangée pour le caissier : il lit sa fiche d'école, ses classes et le catalogue pour encaisser.
-- 2. importer_reprise : même fonction que la version active (v1.19), plus un refus FJ403 si le rôle n'est pas
--    directeur (elle écrit élèves, parents, inscriptions et paiements, que le caissier peut écrire par ailleurs).
-- Un JWT sans role_utilisateur est refusé partout (échec fermé) : depuis la tranche 1, le serveur le signe toujours.
-- Retour arrière : rejouer les policies d'origine (sections 9 et v1.5) et la version v1.19 de importer_reprise.
-- ==============================================================================

-- ecoles : modification des paramètres (enregistrer_parametres)
DROP POLICY IF EXISTS ecole_modifie_sa_fiche ON public.ecoles;
CREATE POLICY ecole_modifie_sa_fiche ON public.ecoles FOR UPDATE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND id = public.jwt_ecole_id());

-- classes : lecture par toute l'école, écriture par le directeur
DROP POLICY IF EXISTS ecole_gere_ses_classes ON public.classes;
DROP POLICY IF EXISTS ecole_lit_ses_classes ON public.classes;
CREATE POLICY ecole_lit_ses_classes ON public.classes FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_cree_ses_classes ON public.classes;
CREATE POLICY ecole_cree_ses_classes ON public.classes FOR INSERT TO authenticated
    WITH CHECK (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_modifie_ses_classes ON public.classes;
CREATE POLICY ecole_modifie_ses_classes ON public.classes FOR UPDATE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_supprime_ses_classes ON public.classes;
CREATE POLICY ecole_supprime_ses_classes ON public.classes FOR DELETE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());

-- articles_classe (catalogue) : lecture par toute l'école, écriture par le directeur
DROP POLICY IF EXISTS ecole_gere_ses_articles_classe ON public.articles_classe;
DROP POLICY IF EXISTS ecole_lit_ses_articles_classe ON public.articles_classe;
CREATE POLICY ecole_lit_ses_articles_classe ON public.articles_classe FOR SELECT TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_cree_ses_articles_classe ON public.articles_classe;
CREATE POLICY ecole_cree_ses_articles_classe ON public.articles_classe FOR INSERT TO authenticated
    WITH CHECK (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_modifie_ses_articles_classe ON public.articles_classe;
CREATE POLICY ecole_modifie_ses_articles_classe ON public.articles_classe FOR UPDATE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());
DROP POLICY IF EXISTS ecole_supprime_ses_articles_classe ON public.articles_classe;
CREATE POLICY ecole_supprime_ses_articles_classe ON public.articles_classe FOR DELETE TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND public.jwt_role_utilisateur() = 'directeur' AND ecole_id = public.jwt_ecole_id());

CREATE OR REPLACE FUNCTION public.importer_reprise(
    p_eleves JSONB,
    p_mode TEXT DEFAULT 'especes'
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
    v_today DATE := (now() AT TIME ZONE 'Africa/Dakar')::date;
    v_annee TEXT;
    v_mois_debut INTEGER;
    v_nb_mois INTEGER;
    v_mois_liste DATE[];
    v_dernier DATE;
    v_rec RECORD;
    v_e JSONB;
    v_pre TEXT;
    v_classe public.classes%ROWTYPE;
    v_cat public.articles_classe%ROWTYPE;
    v_art public.articles_inscription%ROWTYPE;
    v_a RECORD;
    v_p RECORD;
    v_ligne INTEGER;
    v_prenom TEXT;
    v_nom TEXT;
    v_parent_nom TEXT;
    v_tel TEXT;
    v_matr_ancien TEXT;
    v_naissance DATE;
    v_depart DATE;
    v_debut DATE;
    v_fin DATE;
    v_statut TEXT;
    v_reduction INTEGER;
    v_quantite INTEGER;
    v_parent UUID;
    v_eleve UUID;
    v_inscription UUID;
    v_matricule TEXT;
    v_manquant TEXT;
    v_ids UUID[];
    v_id UUID;
    v_nb_art INTEGER;
    v_du BIGINT;
    v_lot UUID;
    v_numero TEXT;
    v_montant BIGINT;
    v_res JSONB := '[]'::jsonb;
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    -- D09 : la reprise de l'existant est réservée au directeur (le claim est signé par le serveur d'après la base)
    IF public.jwt_role_utilisateur() IS DISTINCT FROM 'directeur' THEN
        RAISE EXCEPTION 'Réservé au directeur de l''école.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_mode IS NULL OR p_mode NOT IN ('especes', 'virement', 'cheque') THEN
        RAISE EXCEPTION 'Mode de paiement non accepté pour une reprise : choisissez espèces, virement ou chèque.'
            USING ERRCODE = 'FJ422';
    END IF;

    -- ----- Forme du lot, vérifiée champ par champ avant tout cast -----
    -- v1.19 : CASE, l'ordre d'évaluation d'un OR n'est pas garanti (jsonb_array_length échoue hors tableau)
    IF (CASE WHEN jsonb_typeof(p_eleves) IS DISTINCT FROM 'array' THEN true
             ELSE jsonb_array_length(p_eleves) NOT BETWEEN 1 AND 25 END) THEN
        RAISE EXCEPTION 'Lot d''import invalide : de 1 à 25 élèves.' USING ERRCODE = 'FJ422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_eleves) AS t(e)
               WHERE jsonb_typeof(t.e) IS DISTINCT FROM 'object'
                  OR coalesce(t.e ->> 'ligne', '') !~ '^[0-9]{1,6}$'
                  OR jsonb_typeof(t.e -> 'ligne') IS DISTINCT FROM 'number'
                  OR jsonb_typeof(t.e -> 'articles') IS DISTINCT FROM 'array'
                  OR jsonb_typeof(t.e -> 'paiements') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Lot d''import invalide.' USING ERRCODE = 'FJ422';
    END IF;

    FOR v_rec IN SELECT t.e AS e FROM jsonb_array_elements(p_eleves) AS t(e) LOOP
        v_e := v_rec.e;
        v_pre := 'Ligne ' || (v_e ->> 'ligne') || ' : ';
        IF jsonb_array_length(v_e -> 'articles') > 50 OR jsonb_array_length(v_e -> 'paiements') > 80 THEN
            RAISE EXCEPTION '%trop d''articles ou de paiements.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'prenom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'prenom')) NOT BETWEEN 1 AND 60
           OR jsonb_typeof(v_e -> 'nom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'nom')) NOT BETWEEN 1 AND 60 THEN
            RAISE EXCEPTION '%prénom et nom de l''élève obligatoires (60 caractères au plus).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'parent_nom') IS DISTINCT FROM 'string' OR length(btrim(v_e ->> 'parent_nom')) NOT BETWEEN 1 AND 80
           OR jsonb_typeof(v_e -> 'telephone') IS DISTINCT FROM 'string' OR (v_e ->> 'telephone') !~ '^\+[0-9]{9,15}$' THEN
            RAISE EXCEPTION '%nom et téléphone du parent obligatoires (ex : +221771234567).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'sexe'), 'null') NOT IN ('string', 'null') OR coalesce(v_e ->> 'sexe', 'M') NOT IN ('M', 'F') THEN
            RAISE EXCEPTION '%sexe invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'date_naissance'), 'null') NOT IN ('string', 'null')
           OR coalesce(v_e ->> 'date_naissance', '2000-01-01') !~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
            RAISE EXCEPTION '%date de naissance invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF coalesce(jsonb_typeof(v_e -> 'matricule_ancien'), 'null') NOT IN ('string', 'null')
           OR length(btrim(coalesce(v_e ->> 'matricule_ancien', 'x'))) NOT BETWEEN 1 AND 40 THEN
            RAISE EXCEPTION '%matricule de l''ancien système invalide (1 à 40 caractères).', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'classe_id') IS DISTINCT FROM 'string'
           OR (v_e ->> 'classe_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION '%classe invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'reduction') IS DISTINCT FROM 'number' OR coalesce(v_e ->> 'reduction', '') !~ '^[0-9]{1,8}$' THEN
            RAISE EXCEPTION '%réduction mensuelle invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF jsonb_typeof(v_e -> 'statut') IS DISTINCT FROM 'string' OR (v_e ->> 'statut') NOT IN ('active', 'abandon', 'transfert')
           OR coalesce(jsonb_typeof(v_e -> 'date_depart'), 'null') NOT IN ('string', 'null')
           OR coalesce(v_e ->> 'date_depart', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
           OR ((v_e ->> 'statut') = 'active' AND (v_e ->> 'date_depart') IS NOT NULL)
           OR ((v_e ->> 'statut') <> 'active' AND (v_e ->> 'date_depart') IS NULL) THEN
            RAISE EXCEPTION '%statut ou date de départ invalide.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'articles') AS c(a)
                   WHERE jsonb_typeof(c.a) IS DISTINCT FROM 'object'
                      OR jsonb_typeof(c.a -> 'article_classe_id') IS DISTINCT FROM 'string'
                      OR coalesce(c.a ->> 'article_classe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      OR jsonb_typeof(c.a -> 'quantite') IS DISTINCT FROM 'number'
                      OR coalesce(c.a ->> 'quantite', '') !~ '^[0-9]{1,2}$'
                      OR coalesce(jsonb_typeof(c.a -> 'mois_debut'), 'null') NOT IN ('string', 'null')
                      OR coalesce(jsonb_typeof(c.a -> 'mois_fin'), 'null') NOT IN ('string', 'null')
                      OR coalesce(c.a ->> 'mois_debut', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                      OR coalesce(c.a ->> 'mois_fin', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$') THEN
            RAISE EXCEPTION '%articles invalides.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                   WHERE jsonb_typeof(c.p) IS DISTINCT FROM 'object'
                      OR coalesce(c.p ->> 'type', '') NOT IN ('inscription', 'mensualite', 'autre')
                      OR jsonb_typeof(c.p -> 'montant') IS DISTINCT FROM 'number'
                      OR coalesce(c.p ->> 'montant', '') !~ '^[1-9][0-9]{0,7}$'
                      OR coalesce(jsonb_typeof(c.p -> 'mois'), 'null') NOT IN ('string', 'null')
                      OR coalesce(c.p ->> 'mois', '2000-01-01') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
                      OR coalesce(jsonb_typeof(c.p -> 'article_index'), 'null') NOT IN ('number', 'null')
                      OR coalesce(c.p ->> 'article_index', '0') !~ '^[0-9]{1,2}$'
                      OR coalesce(jsonb_typeof(c.p -> 'libelle'), 'null') NOT IN ('string', 'null')
                      OR length(coalesce(c.p ->> 'libelle', '')) > 120
                      OR (c.p ->> 'type' = 'inscription' AND (c.p ->> 'mois' IS NOT NULL OR c.p ->> 'article_index' IS NOT NULL))
                      OR (c.p ->> 'type' = 'mensualite' AND (c.p ->> 'mois' IS NULL OR c.p ->> 'article_index' IS NOT NULL))
                      OR (c.p ->> 'type' = 'autre' AND c.p ->> 'article_index' IS NULL)) THEN
            RAISE EXCEPTION '%paiements invalides.', v_pre USING ERRCODE = 'FJ422';
        END IF;
    END LOOP;

    -- ----- École et calendrier -----
    SELECT annee_scolaire, mois_debut, nb_mensualites INTO v_annee, v_mois_debut, v_nb_mois FROM public.ecoles WHERE id = v_ecole;
    IF v_annee IS NULL THEN
        RAISE EXCEPTION 'École introuvable.' USING ERRCODE = 'FJ404';
    END IF;
    IF v_annee !~ '^[0-9]{4}-[0-9]{4}$' THEN
        RAISE EXCEPTION 'Année scolaire invalide : réglez d''abord vos Paramètres.' USING ERRCODE = 'FJ422';
    END IF;
    SELECT array_agg((make_date(substr(v_annee, 1, 4)::int, 1, 1) + ((v_mois_debut - 1 + i) * interval '1 month'))::date ORDER BY i)
      INTO v_mois_liste FROM generate_series(0, v_nb_mois - 1) AS g(i);
    v_dernier := v_mois_liste[array_length(v_mois_liste, 1)];

    -- Deux imports simultanés de la même école passent l'un après l'autre
    PERFORM pg_advisory_xact_lock(hashtextextended('reprise:' || v_ecole::text, 0));

    FOR v_rec IN SELECT t.e AS e FROM jsonb_array_elements(p_eleves) WITH ORDINALITY AS t(e, n) ORDER BY t.n LOOP
        v_e := v_rec.e;
        v_ligne := (v_e ->> 'ligne')::int;
        v_pre := 'Ligne ' || v_ligne || ' : ';
        v_prenom := btrim(v_e ->> 'prenom');
        v_nom := btrim(v_e ->> 'nom');
        v_parent_nom := btrim(v_e ->> 'parent_nom');
        v_tel := v_e ->> 'telephone';
        v_matr_ancien := nullif(btrim(coalesce(v_e ->> 'matricule_ancien', '')), '');
        v_statut := v_e ->> 'statut';
        v_reduction := (v_e ->> 'reduction')::int;
        v_nb_art := jsonb_array_length(v_e -> 'articles');

        -- Doublons : rien n'est écrit, l'élève est compté « ignoré » (le rejeu d'un fichier ne crée rien)
        IF (v_matr_ancien IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.eleves WHERE ecole_id = v_ecole AND lower(btrim(matricule_ancien)) = lower(v_matr_ancien)))
           OR EXISTS (
                SELECT 1 FROM public.parents p
                JOIN public.eleves el ON el.parent_id = p.id AND el.ecole_id = v_ecole
                JOIN public.inscriptions i ON i.eleve_id = el.id AND i.ecole_id = v_ecole AND i.annee_scolaire = v_annee
                WHERE p.ecole_id = v_ecole AND p.telephone = v_tel
                  AND lower(btrim(el.prenom)) = lower(v_prenom) AND lower(btrim(el.nom)) = lower(v_nom)) THEN
            v_res := v_res || jsonb_build_object('ligne', v_ligne, 'statut', 'ignore', 'eleve_id', NULL, 'numero_recu', NULL, 'montant', 0);
            CONTINUE;
        END IF;

        -- Classe : active, de l'année en cours ; verrou partagé (comme inscrire_eleve)
        SELECT * INTO v_classe FROM public.classes
        WHERE id = (v_e ->> 'classe_id')::uuid AND ecole_id = v_ecole AND is_active FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION '%classe introuvable : créez-la d''abord.', v_pre USING ERRCODE = 'FJ404';
        END IF;
        IF v_classe.annee_scolaire IS DISTINCT FROM v_annee THEN
            RAISE EXCEPTION '%la classe appartient à l''année %.', v_pre, v_classe.annee_scolaire USING ERRCODE = 'FJ412';
        END IF;
        IF v_reduction > v_classe.mensualite THEN
            RAISE EXCEPTION '%la réduction dépasse la mensualité.', v_pre USING ERRCODE = 'FJ422';
        END IF;

        -- Dates (formes déjà vérifiées ; un jour impossible comme le 31/02 est refusé ici)
        BEGIN
            v_naissance := (v_e ->> 'date_naissance')::date;
            v_depart := (v_e ->> 'date_depart')::date;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION '%date de naissance ou de départ invalide.', v_pre USING ERRCODE = 'FJ422';
        END;
        IF v_naissance IS NOT NULL AND v_naissance > v_today THEN
            RAISE EXCEPTION '%date de naissance dans le futur.', v_pre USING ERRCODE = 'FJ422';
        END IF;
        IF v_depart IS NOT NULL AND (v_depart > v_today OR v_depart < v_mois_liste[1]
                                     OR v_depart >= (v_dernier + interval '1 month')::date) THEN
            RAISE EXCEPTION '%date de départ hors de l''année scolaire (ni dans le futur).', v_pre USING ERRCODE = 'FJ422';
        END IF;

        -- Matricule FayJàng (v1.19) : prochain_matricule, comme inscrire_eleve ; le verrou « matricule: » est pris
        -- AVANT l'écriture du parent, dans le même ordre que inscrire_eleve.
        v_matricule := public.prochain_matricule(v_annee);

        -- Parent : le même téléphone désigne le même parent (son nom ne change pas). DO NOTHING : la ligne d'un
        -- parent existant n'est ni réécrite ni verrouillée.
        INSERT INTO public.parents (ecole_id, nom, telephone)
        VALUES (v_ecole, v_parent_nom, v_tel)
        ON CONFLICT (ecole_id, telephone) DO NOTHING
        RETURNING id INTO v_parent;
        IF v_parent IS NULL THEN
            SELECT id INTO v_parent FROM public.parents WHERE ecole_id = v_ecole AND telephone = v_tel;
            IF v_parent IS NULL THEN
                RAISE EXCEPTION '%parent introuvable, réessayez.', v_pre USING ERRCODE = 'FJ404';
            END IF;
        END IF;

        INSERT INTO public.eleves (ecole_id, parent_id, matricule, prenom, nom, sexe, date_naissance, matricule_ancien)
        VALUES (v_ecole, v_parent, v_matricule, v_prenom, v_nom, v_e ->> 'sexe', v_naissance, v_matr_ancien)
        RETURNING id INTO v_eleve;

        -- Inscription : tarifs figés depuis la classe, jamais depuis le client
        INSERT INTO public.inscriptions (ecole_id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite,
                                         mensualite_dernier_mois, reduction_mensuelle, statut, date_depart)
        VALUES (v_ecole, v_eleve, v_classe.id, v_annee, v_classe.frais_inscription, v_classe.mensualite,
                v_classe.mensualite_dernier_mois, v_reduction, v_statut, v_depart)
        RETURNING id INTO v_inscription;

        -- Articles : une ligne par élément du tableau (un service repris a une ligne par période). v_ids[n] est
        -- l'identifiant de l'élément n (à partir de 1) : les paiements s'y rattachent par article_index + 1.
        v_ids := ARRAY[]::uuid[];
        FOR v_a IN SELECT c.a AS a FROM jsonb_array_elements(v_e -> 'articles') WITH ORDINALITY AS c(a, n) ORDER BY c.n LOOP
            SELECT * INTO v_cat FROM public.articles_classe
            WHERE id = (v_a.a ->> 'article_classe_id')::uuid AND classe_id = v_classe.id AND ecole_id = v_ecole;
            IF NOT FOUND THEN
                RAISE EXCEPTION '%article absent du catalogue de la classe.', v_pre USING ERRCODE = 'FJ404';
            END IF;
            v_quantite := (v_a.a ->> 'quantite')::int;
            v_debut := (v_a.a ->> 'mois_debut')::date;
            v_fin := (v_a.a ->> 'mois_fin')::date;
            IF v_cat.nature = 'unique' THEN
                IF v_quantite < 1 OR v_debut IS NOT NULL OR v_fin IS NOT NULL THEN
                    RAISE EXCEPTION '%« % » : quantité de 1 à 99, sans période.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
                END IF;
            ELSE
                IF v_quantite <> 1 OR v_debut IS NULL OR NOT (v_debut = ANY (v_mois_liste))
                   OR (v_fin IS NOT NULL AND (NOT (v_fin = ANY (v_mois_liste)) OR v_fin < v_debut)) THEN
                    RAISE EXCEPTION '%« % » : période du service invalide.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
                END IF;
            END IF;
            -- Un frais unique une seule fois ; les périodes d'un même service ne se chevauchent pas
            IF EXISTS (SELECT 1 FROM public.articles_inscription ai
                       WHERE ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole AND ai.article_classe_id = v_cat.id
                         AND (v_cat.nature = 'unique'
                              OR (coalesce(ai.mois_fin, DATE '9999-12-01') >= v_debut
                                  AND coalesce(v_fin, DATE '9999-12-01') >= ai.mois_debut))) THEN
                RAISE EXCEPTION '%« % » est cité deux fois ou ses périodes se chevauchent.', v_pre, v_cat.libelle USING ERRCODE = 'FJ422';
            END IF;
            INSERT INTO public.articles_inscription (ecole_id, inscription_id, article_classe_id, libelle, nature,
                                                     prix_unitaire, quantite, obligatoire, mois_debut, mois_fin)
            VALUES (v_ecole, v_inscription, v_cat.id, v_cat.libelle, v_cat.nature, v_cat.prix_unitaire, v_quantite,
                    v_cat.obligatoire, v_debut, v_fin)
            RETURNING id INTO v_id;
            v_ids := v_ids || v_id;
        END LOOP;

        -- Articles obligatoires de la classe (v1.19, même règle que inscrire_eleve) : un frais unique avec une
        -- quantité par défaut, ou un service mensuel. Seule exception, comme repartirReprise : après le dernier mois
        -- de l'année, un service sans versement n'est pas rattaché.
        SELECT a.libelle INTO v_manquant
        FROM public.articles_classe a
        WHERE a.classe_id = v_classe.id AND a.ecole_id = v_ecole AND a.obligatoire
          AND ((a.nature = 'unique' AND a.quantite_defaut > 0)
               OR (a.nature = 'mensuel' AND date_trunc('month', v_today)::date <= v_dernier))
          AND NOT EXISTS (SELECT 1 FROM public.articles_inscription ai
                          WHERE ai.inscription_id = v_inscription AND ai.ecole_id = v_ecole AND ai.article_classe_id = a.id)
        ORDER BY a.ordre
        LIMIT 1;
        IF v_manquant IS NOT NULL THEN
            RAISE EXCEPTION '%« % » est obligatoire pour cette classe.', v_pre, v_manquant USING ERRCODE = 'FJ422';
        END IF;

        -- Paiements : plafonds par élément (type, mois, article), d'après les tarifs figés ci-dessus
        IF jsonb_array_length(v_e -> 'paiements') > 0 THEN
            IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                       WHERE c.p ->> 'article_index' IS NOT NULL AND (c.p ->> 'article_index')::int >= v_nb_art) THEN
                RAISE EXCEPTION '%un paiement désigne un article qui n''existe pas.', v_pre USING ERRCODE = 'FJ422';
            END IF;
            FOR v_p IN
                SELECT c.p ->> 'type' AS type, (c.p ->> 'mois')::date AS mois, (c.p ->> 'article_index')::int AS idx,
                       sum((c.p ->> 'montant')::bigint) AS total
                FROM jsonb_array_elements(v_e -> 'paiements') AS c(p)
                GROUP BY 1, 2, 3
            LOOP
                IF v_p.type = 'inscription' THEN
                    v_du := v_classe.frais_inscription;
                ELSIF v_p.type = 'mensualite' THEN
                    IF NOT (v_p.mois = ANY (v_mois_liste)) THEN
                        RAISE EXCEPTION '%mois de mensualité hors de l''année scolaire.', v_pre USING ERRCODE = 'FJ422';
                    END IF;
                    v_du := greatest(0, (CASE WHEN v_p.mois = v_dernier THEN coalesce(v_classe.mensualite_dernier_mois, v_classe.mensualite)
                                              ELSE v_classe.mensualite END) - v_reduction);
                ELSE
                    SELECT * INTO v_art FROM public.articles_inscription WHERE id = v_ids[v_p.idx + 1];
                    IF v_art.nature = 'unique' THEN
                        IF v_p.mois IS NOT NULL THEN
                            RAISE EXCEPTION '%« % » est un frais unique : pas de mois.', v_pre, v_art.libelle USING ERRCODE = 'FJ422';
                        END IF;
                        v_du := v_art.prix_unitaire::bigint * v_art.quantite;
                    ELSE
                        IF v_p.mois IS NULL OR NOT (v_p.mois = ANY (v_mois_liste)) THEN
                            RAISE EXCEPTION '%« % » : mois hors de l''année scolaire.', v_pre, v_art.libelle USING ERRCODE = 'FJ422';
                        END IF;
                        IF v_p.mois < coalesce(v_art.mois_debut, v_mois_liste[1]) OR v_p.mois > coalesce(v_art.mois_fin, v_dernier) THEN
                            RAISE EXCEPTION '%« % » : un paiement tombe hors de la période du service.', v_pre, v_art.libelle USING ERRCODE = 'FJ412';
                        END IF;
                        v_du := v_art.prix_unitaire;
                    END IF;
                END IF;
                IF v_p.total > v_du THEN
                    RAISE EXCEPTION '%le montant versé dépasse ce qui est dû (% FCFA).', v_pre, v_du USING ERRCODE = 'FJ412';
                END IF;
            END LOOP;

            -- Un seul INSERT par élève : le lot_id commun donne un seul numéro de reçu (trigger numeroter_recu).
            -- paye_le reste au DEFAULT (date du jour à Dakar).
            v_lot := gen_random_uuid();
            WITH inseres AS (
                INSERT INTO public.paiements (ecole_id, inscription_id, type, mois, montant, mode, reference, libelle,
                                              lot_id, article_id, encaisse_par)
                SELECT v_ecole, v_inscription, c.p ->> 'type', (c.p ->> 'mois')::date, (c.p ->> 'montant')::int,
                       p_mode, NULL, nullif(btrim(coalesce(c.p ->> 'libelle', '')), ''), v_lot,
                       CASE WHEN c.p ->> 'article_index' IS NULL THEN NULL ELSE v_ids[(c.p ->> 'article_index')::int + 1] END,
                       'Reprise de l''existant'
                FROM jsonb_array_elements(v_e -> 'paiements') WITH ORDINALITY AS c(p, n)
                ORDER BY c.n
                RETURNING numero_recu, montant
            )
            SELECT min(numero_recu), sum(montant) INTO v_numero, v_montant FROM inseres;
        ELSE
            v_numero := NULL;
            v_montant := 0;
        END IF;

        v_res := v_res || jsonb_build_object('ligne', v_ligne, 'statut', 'cree', 'eleve_id', v_eleve,
                                             'numero_recu', v_numero, 'montant', v_montant);
    END LOOP;

    RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.importer_reprise(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importer_reprise(JSONB, TEXT) TO authenticated;


