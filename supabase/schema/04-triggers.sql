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





