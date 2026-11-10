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
-- p_mode, p_reference, p_lignes_paiement : réservés à l'encaissement à l'inscription (tranche 2), refusés
-- tant qu'ils ne sont pas pris en charge. Nouvelle fonction, aucun bloc existant modifié.
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
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'FJ403';
    END IF;
    IF p_mode IS NOT NULL OR p_reference IS NOT NULL
       OR jsonb_typeof(v_lignes) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lignes) > 0 THEN
        RAISE EXCEPTION 'Encaissement à l''inscription pas encore pris en charge : encaissez depuis la fiche.' USING ERRCODE = 'FJ422';
    END IF;

    -- Année scolaire de l'école et classe choisie (active, de la même année)
    SELECT annee_scolaire INTO v_annee FROM public.ecoles WHERE id = v_ecole;
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

    RETURN jsonb_build_object(
        'eleve_id', v_eleve,
        'inscription_id', v_inscription,
        'parent_id', v_parent,
        'parent_cree', v_parent_cree,
        'matricule', v_matricule,
        'numero_recu', NULL,
        'montant_encaisse', 0
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inscrire_eleve(UUID, UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, JSONB, DATE, TEXT, TEXT, JSONB)
    TO authenticated;
