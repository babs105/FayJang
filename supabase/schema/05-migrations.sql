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
