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
    numero_recu TEXT, -- attribué par trigger : JP-2026-00001
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
-- (Nouveaux blocs de migration : les ajouter ici, avant la section 8.)
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

-- 9. POLITIQUES RLS : PATTERN HYBRIDE « TOKEN -> JWT COURT »
-- 1) Le serveur échange l'identifiant reçu (code École, token parent) via une fonction SECURITY DEFINER.
-- 2) Il signe un JWT ES256 de 5 minutes : role = authenticated, role_app (ecole | parent | connexion),
--    ecole_id, et parent_id pour un parent.
-- 3) Les politiques ci-dessous filtrent chaque table sur ces claims.
-- La console SuperAdmin, l'inscription d'une école et le diagnostic gardent la clé service_role.

CREATE OR REPLACE FUNCTION public.jwt_role_app() RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role_app' $$;

CREATE OR REPLACE FUNCTION public.jwt_ecole_id() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt() ->> 'ecole_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION public.jwt_parent_id() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt() ->> 'parent_id', '')::uuid $$;

-- Tentatives : 5 échecs (ou le seuil donné) en 15 minutes bloquent la clé 15 minutes (erreur JP429)
CREATE OR REPLACE FUNCTION public.controler_tentatives(p_cle TEXT)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.tentatives_connexion WHERE cle = p_cle AND bloque_jusqu_a > now()) THEN
        RAISE EXCEPTION 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' USING ERRCODE = 'JP429';
    END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.effacer_tentatives(p_cle TEXT)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM public.tentatives_connexion WHERE cle = p_cle
$$;

REVOKE EXECUTE ON FUNCTION public.controler_tentatives(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.noter_echec_plafonne(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.effacer_tentatives(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.controler_tentatives(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.noter_echec_plafonne(TEXT, INTEGER) TO service_role;
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
DROP TRIGGER IF EXISTS trg_hacher_code_bcrypt ON public.acces_ecole;
CREATE TRIGGER trg_hacher_code_bcrypt
    BEFORE INSERT OR UPDATE OF code_hash ON public.acces_ecole
    FOR EACH ROW EXECUTE FUNCTION public.hacher_code_bcrypt();

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

-- 10. TRIGGERS D'INTÉGRITÉ
-- Abonnement, activation et slug réservés au SuperAdmin (service_role, sans role_app)
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
        RAISE EXCEPTION 'Ces informations ne peuvent être modifiées que par FayJàng.' USING ERRCODE = 'JP403';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_proteger_colonnes_ecole ON public.ecoles;
CREATE TRIGGER trg_proteger_colonnes_ecole BEFORE UPDATE ON public.ecoles
    FOR EACH ROW EXECUTE FUNCTION public.proteger_colonnes_ecole();

-- Cohérence multi-écoles : une ligne ne peut pas pointer vers la donnée d'une autre école
CREATE OR REPLACE FUNCTION public.verifier_meme_ecole()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'eleves' AND NEW.parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.parents WHERE id = NEW.parent_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Parent introuvable dans cette école.' USING ERRCODE = 'JP404';
        END IF;
    ELSIF TG_TABLE_NAME = 'inscriptions' THEN
        IF NOT EXISTS (SELECT 1 FROM public.eleves WHERE id = NEW.eleve_id AND ecole_id = NEW.ecole_id)
           OR NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Élève ou classe introuvable dans cette école.' USING ERRCODE = 'JP404';
        END IF;
    ELSIF TG_TABLE_NAME = 'paiements' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inscriptions WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Inscription introuvable dans cette école.' USING ERRCODE = 'JP404';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
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

-- Numéro de reçu attribué par la base (JP-2026-00001), jamais par le client
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
    NEW.numero_recu := 'JP-' || v_annee || '-' || lpad(v_num::text, 5, '0');
    NEW.annule := false;
    NEW.motif_annulation := NULL;
    NEW.annule_at := NULL;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_numeroter_recu ON public.paiements;
CREATE TRIGGER trg_numeroter_recu BEFORE INSERT ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.numeroter_recu();
REVOKE EXECUTE ON FUNCTION public.numeroter_recu() FROM PUBLIC, anon, authenticated;

-- Un paiement encaissé ne change plus : seule l'annulation (définitive, motivée) est permise
CREATE OR REPLACE FUNCTION public.proteger_paiement()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.annule THEN
        RAISE EXCEPTION 'Ce paiement est déjà annulé.' USING ERRCODE = 'JP412';
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
        RAISE EXCEPTION 'Un paiement encaissé ne se modifie pas : annulez-le puis saisissez le bon.' USING ERRCODE = 'JP412';
    END IF;
    IF NEW.annule AND length(trim(coalesce(NEW.motif_annulation, ''))) < 3 THEN
        RAISE EXCEPTION 'Indiquez le motif de l''annulation.' USING ERRCODE = 'JP422';
    END IF;
    IF NEW.annule THEN
        NEW.annule_at := now();
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_proteger_paiement ON public.paiements;
CREATE TRIGGER trg_proteger_paiement BEFORE UPDATE ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.proteger_paiement();

-- Une inscription qui a des paiements ne se supprime pas (on passe son statut à « abandon »)
CREATE OR REPLACE FUNCTION public.proteger_inscription()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.paiements WHERE inscription_id = OLD.id) THEN
        RAISE EXCEPTION 'Cette inscription a des paiements : passez-la en abandon au lieu de la supprimer.' USING ERRCODE = 'JP412';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.eleve_id IS DISTINCT FROM OLD.eleve_id OR NEW.annee_scolaire IS DISTINCT FROM OLD.annee_scolaire) THEN
        RAISE EXCEPTION 'Élève et année d''une inscription payée ne changent pas.' USING ERRCODE = 'JP412';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_proteger_inscription ON public.inscriptions;
CREATE TRIGGER trg_proteger_inscription BEFORE DELETE ON public.inscriptions
    FOR EACH ROW EXECUTE FUNCTION public.proteger_inscription();
DROP TRIGGER IF EXISTS trg_proteger_inscription_maj ON public.inscriptions;
CREATE TRIGGER trg_proteger_inscription_maj BEFORE UPDATE OF eleve_id, annee_scolaire ON public.inscriptions
    FOR EACH ROW EXECUTE FUNCTION public.proteger_inscription();

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
            RAISE EXCEPTION 'Parent introuvable dans cette école.' USING ERRCODE = 'JP404';
        END IF;
    ELSIF TG_TABLE_NAME = 'inscriptions' THEN
        IF NOT EXISTS (SELECT 1 FROM public.eleves WHERE id = NEW.eleve_id AND ecole_id = NEW.ecole_id)
           OR NOT EXISTS (SELECT 1 FROM public.classes WHERE id = NEW.classe_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Élève ou classe introuvable dans cette école.' USING ERRCODE = 'JP404';
        END IF;
    ELSIF TG_TABLE_NAME = 'paiements' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inscriptions WHERE id = NEW.inscription_id AND ecole_id = NEW.ecole_id) THEN
            RAISE EXCEPTION 'Inscription introuvable dans cette école.' USING ERRCODE = 'JP404';
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
                RAISE EXCEPTION 'Ce reçu est déjà émis : impossible d''y ajouter une ligne.' USING ERRCODE = 'JP412';
            END IF;
            IF v_inscription IS DISTINCT FROM NEW.inscription_id THEN
                RAISE EXCEPTION 'Un reçu ne concerne qu''un seul élève.' USING ERRCODE = 'JP422';
            END IF;
            NEW.numero_recu := v_numero;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.compteurs_recus AS c (ecole_id, annee, dernier)
    VALUES (NEW.ecole_id, v_annee, 1)
    ON CONFLICT (ecole_id, annee) DO UPDATE SET dernier = c.dernier + 1
    RETURNING dernier INTO v_num;
    NEW.numero_recu := 'JP-' || v_annee || '-' || lpad(v_num::text, 5, '0');
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.numeroter_recu() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proteger_paiement()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.annule THEN
        RAISE EXCEPTION 'Ce paiement est déjà annulé.' USING ERRCODE = 'JP412';
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
        RAISE EXCEPTION 'Un paiement encaissé ne se modifie pas : annulez-le puis saisissez le bon.' USING ERRCODE = 'JP412';
    END IF;
    IF NEW.annule AND length(trim(coalesce(NEW.motif_annulation, ''))) < 3 THEN
        RAISE EXCEPTION 'Indiquez le motif de l''annulation.' USING ERRCODE = 'JP422';
    END IF;
    IF NEW.annule THEN
        NEW.annule_at := now();
    END IF;
    RETURN NEW;
END;
$$;
