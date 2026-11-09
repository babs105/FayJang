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
