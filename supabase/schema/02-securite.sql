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
