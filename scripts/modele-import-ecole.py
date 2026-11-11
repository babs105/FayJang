# Génère le modèle Excel d'import (reprise de l'existant) : python3 scripts/modele-import-ecole.py public/modele-import-ecole.xlsx
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

out = sys.argv[1]
F = "Arial"
VERT = PatternFill("solid", fgColor="059669")
JAUNE = PatternFill("solid", fgColor="FFF9C4")
GRIS = PatternFill("solid", fgColor="F3F4F6")
EX = Font(name=F, color="6B7280", italic=True)
fin = Side(style="thin", color="D1D5DB")
BORD = Border(left=fin, right=fin, top=fin, bottom=fin)
N = 500  # lignes préparées

wb = Workbook()

def entete(ws, cols, oblig):
    for i, (titre, larg, note) in enumerate(cols, 1):
        c = ws.cell(row=1, column=i, value=titre + (" *" if titre in oblig else ""))
        c.font = Font(name=F, bold=True, color="FFFFFF")
        c.fill = VERT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORD
        ws.column_dimensions[get_column_letter(i)].width = larg
        if note:
            # Bulle d'aide affichée quand l'en-tête est sélectionné (les commentaires de cellule
            # écrits par openpyxl ne sont pas lisibles par exceljs, qui lit le fichier à l'import)
            aide = DataValidation(allow_blank=True, showInputMessage=True, promptTitle=titre[:32], prompt=note[:255])
            ws.add_data_validation(aide)
            aide.add(c.coordinate)
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"

def lignes(ws, data, ncols, formats=None):
    formats = formats or {}
    for r, ligne in enumerate(data, 2):
        for c, v in enumerate(ligne, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = EX
    for r in range(2, N + 2):
        for c in range(1, ncols + 1):
            cell = ws.cell(row=r, column=c)
            if cell.font != EX:
                cell.font = Font(name=F)
            cell.border = BORD
            if c in formats:
                cell.number_format = formats[c]

def liste(ws, plage, valeurs=None, formule=None, msg=""):
    dv = DataValidation(type="list", formula1=formule or '"' + ",".join(valeurs) + '"', allow_blank=True,
                        showErrorMessage=True, errorTitle="Valeur refusée", error=msg or "Choisir dans la liste.")
    ws.add_data_validation(dv)
    dv.add(plage)

def entier(ws, plage):
    dv = DataValidation(type="whole", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
                        showErrorMessage=True, errorTitle="Montant refusé",
                        error="Montant entier en FCFA, sans espace ni « F ».")
    ws.add_data_validation(dv)
    dv.add(plage)

MONEY = '#,##0" F";-#,##0" F";"-"'
from datetime import date
from openpyxl.formatting.rule import FormulaRule
from openpyxl.workbook.properties import CalcProperties
ROUGE = PatternFill("solid", fgColor="FECACA")

# ---------- Lisez-moi ----------
ws = wb.active
ws.title = "Lisez-moi"
ws.column_dimensions["A"].width = 115
texte = [
    ("Modèle d'import FayJàng (V1, reprise simple) : une ligne par élève", "titre"),
    ("", None),
    ("En 3 étapes", "h"),
    ("1. « Classes » : une ligne par classe avec ses tarifs. Indiquer le nombre de mensualités de l'école (case jaune).", None),
    ("2. « Articles » (facultatif) : tenues, assurances, transport, cantine… de chaque classe.", None),
    ("3. « Élèves » : une ligne par élève. Seules les 5 premières colonnes sont obligatoires.", None),
    ("", None),
    ("Règles de saisie", "h"),
    ("• Colonnes marquées * obligatoires. Cliquer sur un en-tête pour voir sa consigne.", None),
    ("• Lignes en gris italique = exemples : les effacer avant l'import.", None),
    ("• Montants en nombres entiers FCFA : 15000 (pas « 15 000 F »). Vide = 0.", None),
    ("• Les classes et les articles s'écrivent comme dans leurs feuilles (listes déroulantes).", None),
    ("• Copier-coller depuis votre propre fichier est la méthode la plus rapide (Coller > Valeurs).", None),
    ("• Variante acceptée : une feuille « Élèves » par classe, nommée comme la classe, sans colonne « Classe ».", None),
    ("", None),
    ("Ce qui a déjà été payé : un seul montant par élève", "h"),
    ("• « Total versé (scolarité) » : tout ce que l'élève a payé cette année en inscription et mensualités.", None),
    ("  FayJàng le répartit dans l'ordre où l'école exige l'argent, d'après ses Paramètres. Le reste = paiement partiel :", None),
    ("    1. les frais d'inscription ;", None),
    ("    2. les mensualités payées à l'inscription, si l'école l'a réglé (premier mois et/ou dernier mois) ;", None),
    ("    3. puis, par date d'échéance, les mensualités ordinaires et les tranches du mois payé par tranches", None),
    ("       (dernier, avant-dernier ou antépénultième mois) ; à date égale, la mensualité passe avant la tranche.", None),
    ("  Exemple sans réglage particulier (inscription 25 000, mensualité 15 000) :", None),
    ("    62 000 = inscription + octobre + novembre + 7 000 sur décembre.", None),
    ("  Exemple avec dernier mois (juin) payé à l'inscription :", None),
    ("    62 000 = inscription + juin + octobre + 7 000 sur novembre.", None),
    ("  Ne pas ventiler soi-même : indiquer le total versé, tel qu'il figure dans le cahier.", None),
    ("• « Total versé (articles) » : tout ce qui a été payé en articles et services. Réparti d'abord sur les frais uniques", None),
    ("  (tenue, assurance…), puis sur les services mois par mois (transport d'octobre, cantine d'octobre, transport de novembre…).", None),
    ("• Les colonnes « Total dû » et « Reste » se calculent seules : une case rouge = montant versé trop élevé, à corriger.", None),
    ("• Les remises se déclarent dans « Réduction mensuelle », pas en baissant les montants.", None),
    ("• FayJàng crée un reçu « Reprise de l'existant » par élève, daté du jour de l'import.", None),
    ("", None),
    ("Élèves", "h"),
    ("• Même téléphone de parent = même parent : les frères et sœurs partagent un seul lien de suivi.", None),
    ("• « Articles optionnels » : articles non obligatoires pris par l'élève, séparés par « ; » (ex : Transport ; Cantine).", None),
    ("  Les articles obligatoires sont ajoutés d'office. Quantité différente : « Tenue x3 » (format à confirmer).", None),
    ("• Un service mensuel est dû à partir du mois de l'import, sauf si le montant versé couvre des mois précédents.", None),
    ("• Statut « abandon » ou « transfert » : « Date de départ » obligatoire, pas dans le futur. Vide = élève actif.", None),
    ("• « Matricule ancien » : unique dans l'école ; il évite qu'un élève soit importé deux fois.", None),
    ("• Un élève déjà présent dans FayJàng est ignoré et signalé : rien n'est modifié.", None),
    ("", None),
    ("Ce qu'il ne faut pas fournir", "h"),
    ("• Soldes, arriérés, « reste à payer » : FayJàng les calcule. • Numéros de reçu. • Matricules FayJàng (générés).", None),
    ("", None),
    ("Avant l'import", "h"),
    ("• Régler l'année scolaire, le mois de rentrée, le nombre de mensualités et les tranches dans Paramètres.", None),
    ("• L'aperçu affiche les erreurs ligne par ligne et l'arriéré total de l'école avant toute écriture : le comparer au cahier.", None),
    ("• L'import peut se faire en plusieurs fois (classe par classe) : un élève déjà importé est ignoré.", None),
    ("• La feuille « Cas d'exemple » montre le résultat attendu pour chaque élève d'exemple.", None),
]
for i, (t, s) in enumerate(texte, 1):
    c = ws.cell(row=i, column=1, value=t)
    c.alignment = Alignment(wrap_text=True)
    c.font = (Font(name=F, bold=True, size=14, color="059669") if s == "titre"
              else Font(name=F, bold=True, size=11) if s == "h" else Font(name=F))

# ---------- Listes (masquée) ----------
wl = wb.create_sheet("Listes")
listes = {
    "A": ["Niveau", "prescolaire", "elementaire", "moyen", "secondaire"],
    "B": ["Sexe", "M", "F"],
    "C": ["Statut", "active", "abandon", "transfert"],
    "F": ["Nature", "unique", "mensuel"],
    "G": ["Oui/Non", "oui", "non"],
}
for col, vals in listes.items():
    for i, v in enumerate(vals, 1):
        wl[f"{col}{i}"] = v
wl.sheet_state = "hidden"

# ---------- Classes ----------
wc = wb.create_sheet("Classes")
cols = [
    ("Classe", 16, "Nom unique dans l'école (ex : CM2 A)."),
    ("Niveau", 14, "prescolaire, elementaire, moyen ou secondaire."),
    ("Frais d'inscription", 16, "Entier en FCFA."),
    ("Mensualité", 14, "Entier en FCFA."),
    ("Mensualité dernier mois", 18, "Vide = même montant que les autres mois."),
    ("Total de l'année (calculé)", 18, "Inscription + toutes les mensualités, sans réduction ni articles."),
]
entete(wc, cols, {"Classe", "Niveau", "Frais d'inscription", "Mensualité"})
classes_ex = [
    ["Petite section", "prescolaire", 15000, 10000, None],
    ["CE1", "elementaire", 20000, 12000, 6000],
    ["CM2 A", "elementaire", 25000, 15000, None],
    ["6e A", "moyen", 30000, 20000, None],
    ["Terminale S", "secondaire", 40000, 30000, None],
]
lignes(wc, classes_ex, 6, {3: MONEY, 4: MONEY, 5: MONEY, 6: MONEY})
for r in range(2, N + 2):
    c = wc.cell(row=r, column=6, value=f'=IF(A{r}="","",C{r}+D{r}*($I$2-1)+IF(E{r}="",D{r},E{r}))')
    c.fill = GRIS
    c.font = EX if r <= len(classes_ex) + 1 else Font(name=F)
wc.column_dimensions["H"].width = 26
wc["H1"] = "Réglage de l'école"; wc["H1"].font = Font(name=F, bold=True)
wc["H2"] = "Nombre de mensualités *"; wc["H2"].font = Font(name=F)
wc["I2"] = 9; wc["I2"].font = Font(name=F, bold=True); wc["I2"].fill = JAUNE; wc["I2"].border = BORD
aide = DataValidation(allow_blank=True, showInputMessage=True, promptTitle="Nombre de mensualités", prompt="Comme dans Paramètres (9 par défaut : octobre à juin).")
wc.add_data_validation(aide)
aide.add("I2")
liste(wc, f"B2:B{N+1}", formule="Listes!$A$2:$A$5")
entier(wc, f"C2:E{N+1}")
CLASSES = f"Classes!$A$2:$A${N+1}"

# ---------- Articles ----------
wa = wb.create_sheet("Articles")
cols = [
    ("Classe", 16, "Classe de la feuille « Classes »."),
    ("Libellé", 20, "Nom de l'article (ex : Tenue, Transport)."),
    ("Nature", 12, "unique = payé une fois (tenue) ; mensuel = payé chaque mois (transport)."),
    ("Prix unitaire", 14, "Entier en FCFA (prix par mois pour un service mensuel)."),
    ("Quantité par défaut", 16, "Vide = 1."),
    ("Obligatoire", 12, "oui = ajouté à tous les élèves de la classe ; non = option."),
]
entete(wa, cols, {"Classe", "Libellé", "Nature", "Prix unitaire"})
lignes(wa, [
    ["Petite section", "Goûter", "mensuel", 4000, 1, "non"],
    ["CE1", "Tenue", "unique", 7000, 1, "oui"],
    ["CE1", "Assurance", "unique", 2000, 1, "oui"],
    ["CE1", "Transport", "mensuel", 5000, 1, "non"],
    ["CM2 A", "Tenue", "unique", 8000, 2, "oui"],
    ["CM2 A", "Transport", "mensuel", 5000, 1, "non"],
    ["CM2 A", "Cantine", "mensuel", 10000, 1, "non"],
    ["CM2 A", "Étude du soir", "mensuel", 3000, 1, "non"],
    ["6e A", "Fournitures", "unique", 15000, 1, "oui"],
], 6, {4: MONEY})
liste(wa, f"A2:A{N+1}", formule=CLASSES, msg="Classe inconnue : la créer dans la feuille « Classes ».")
liste(wa, f"C2:C{N+1}", formule="Listes!$F$2:$F$3")
liste(wa, f"F2:F{N+1}", formule="Listes!$G$2:$G$3")
entier(wa, f"D2:E{N+1}")

# ---------- Élèves ----------
we = wb.create_sheet("Élèves")
cols = [
    ("Prénom", 14, None),
    ("Nom", 14, None),
    ("Classe", 14, "Classe de la feuille « Classes »."),
    ("Nom du parent", 18, "Parent ou tuteur."),
    ("Téléphone du parent", 17, "Ex : 77 123 45 67. Même numéro = même parent (frères et sœurs)."),
    ("Total versé (scolarité)", 16, "Tout ce qui a été payé cette année en inscription et mensualités. Vide = rien."),
    ("Articles optionnels", 26, "Options prises par l'élève, séparées par « ; » (ex : Transport ; Cantine)."),
    ("Total versé (articles)", 15, "Tout ce qui a été payé en articles et services. Vide = rien."),
    ("Réduction mensuelle", 13, "Remise en FCFA sur chaque mensualité. Vide = 0."),
    ("Sexe", 7, "M ou F."),
    ("Date de naissance", 13, "Date (JJ/MM/AAAA)."),
    ("Matricule ancien", 13, "Matricule de l'école, unique."),
    ("Statut", 11, "active (vide), abandon ou transfert."),
    ("Date de départ", 13, "Obligatoire si abandon ou transfert."),
    ("Total dû scolarité (calculé)", 17, "Année complète de la classe moins les réductions (sans tenir compte d’un départ ni des articles). Ne pas remplir."),
    ("Reste scolarité (calculé)", 16, "Rouge = total versé supérieur au dû : à corriger. Ne pas remplir."),
]
entete(we, cols, {"Prénom", "Nom", "Classe", "Nom du parent", "Téléphone du parent"})
for i in (15, 16):
    we.cell(row=1, column=i).fill = PatternFill("solid", fgColor="6B7280")
eleves = [
    ["Awa", "Diop", "CM2 A", "Moussa Diop", "77 123 45 67", 62000, "Transport ; Cantine", 42000, None, "F", date(2015, 3, 12), "2024-118", None, None],
    ["Ibrahima", "Diop", "CE1", "Moussa Diop", "+221771234567", 30000, None, 9000, 2000, "M", date(2018, 9, 2), "2025-031", None, None],
    ["Fatou", "Ndiaye", "CE1", "Aminata Sow", "78 765 43 21", 10000, None, None, None, "F", date(2018, 1, 20), "2025-044", "abandon", date(2026, 11, 5)],
    ["Moussa", "Fall", "6e A", "Awa Fall", "76 222 33 44", 50000, None, 15000, None, "M", date(2014, 6, 5), "2023-210", "transfert", date(2026, 10, 31)],
    ["Khady", "Sarr", "Petite section", "Ousmane Sarr", "70 111 22 33", None, "Goûter", None, None, "F", date(2022, 4, 18), None, None, None],
    ["Ndeye", "Gueye", "Terminale S", "Mamadou Gueye", "77 999 88 77", 310000, None, None, None, "F", date(2008, 11, 30), "2019-007", None, None],
    ["Mariama", "Ba", "CM2 A", "Aïssatou Ba", "78 444 55 66", 100000, None, 16000, None, "F", date(2015, 8, 9), "2024-131", None, None],
    ["Cheikh", "Mbaye", "CM2 A", "Fatou Mbaye", "00221 77 555 66 77", 55000, "Transport ; Étude du soir ; Tenue x3", 32000, None, "M", date(2015, 2, 14), None, None, None],
]
lignes(we, eleves, 16, {6: MONEY, 8: MONEY, 9: MONEY, 11: "DD/MM/YYYY", 14: "DD/MM/YYYY", 15: MONEY, 16: MONEY, 5: "@", 12: "@"})
TOT = f"Classes!$F$2:$F${N+1}"
for r in range(2, N + 2):
    o = we.cell(row=r, column=15, value=(
        f'=IF(C{r}="","",IFERROR(INDEX({TOT},MATCH(C{r},{CLASSES},0))'
        f'-IF(I{r}="",0,I{r})*Classes!$I$2,"classe ?"))'))
    p = we.cell(row=r, column=16, value=f'=IF(ISNUMBER(O{r}),O{r}-IF(F{r}="",0,F{r}),"")')
    for c in (o, p):
        c.fill = GRIS
        c.font = EX if r <= len(eleves) + 1 else Font(name=F)
we.conditional_formatting.add(f"P2:P{N+1}", FormulaRule(formula=['AND(ISNUMBER(P2),P2<0)'], fill=ROUGE))
we.conditional_formatting.add(f"O2:O{N+1}", FormulaRule(formula=['O2="classe ?"'], fill=ROUGE))
liste(we, f"C2:C{N+1}", formule=CLASSES, msg="Classe inconnue : la créer dans la feuille « Classes ».")
liste(we, f"J2:J{N+1}", formule="Listes!$B$2:$B$3")
liste(we, f"M2:M{N+1}", formule="Listes!$C$2:$C$4")
entier(we, f"F2:F{N+1}"); entier(we, f"H2:I{N+1}")
dv = DataValidation(type="date", operator="between", formula1="DATE(1990,1,1)", formula2="DATE(2030,12,31)",
                    allow_blank=True, showErrorMessage=True, error="Saisir une date valide.")
we.add_data_validation(dv); dv.add(f"K2:K{N+1}"); dv.add(f"N2:N{N+1}")

# ---------- Cas d'exemple ----------
wx = wb.create_sheet("Cas d'exemple")
entete(wx, [("Élève", 16, None), ("Cas illustré", 55, None),
            ("Répartition faite par FayJàng et résultat (import le 11/11/2026, échéance le 5)", 80, None)], set())
cas = [
    ("Awa Diop", "Élève à jour puis partiel ; deux options ; Tenue obligatoire ×2.",
     "Scolarité 62 000 : inscription 25 000, octobre et novembre 15 000, décembre 7 000 (reste 8 000, pas encore échu). "
     "Articles 42 000 : tenue 16 000, puis transport et cantine d'octobre (15 000), transport de novembre 5 000, cantine de novembre 6 000 sur 10 000. Arriéré : 4 000."),
    ("Ibrahima Diop", "Frère d'Awa (même téléphone écrit +221…) ; réduction de 2 000.",
     "Même parent qu'Awa, un seul lien. Mensualité nette 10 000. Scolarité 30 000 : inscription 20 000 + octobre. Novembre en retard : arriéré 10 000. Articles 9 000 : tenue + assurance."),
    ("Fatou Ndiaye", "Abandon le 05/11/2026 ; inscription à moitié payée ; articles obligatoires impayés.",
     "Inscription : 10 000 versés, 10 000 dus. Octobre et novembre (mois du départ) dus : 24 000. Tenue + assurance dues (9 000). Arriéré : 43 000. Mois après novembre non dus."),
    ("Moussa Fall", "Transfert le 31/10/2026 ; payé jusqu'au départ.",
     "Scolarité 50 000 : inscription 30 000 + octobre 20 000. Fournitures payées. Novembre à juin non dus. Arriéré : 0."),
    ("Khady Sarr", "Aucun versement ; option Goûter.",
     "Arriéré : inscription 15 000 + octobre et novembre 20 000 + goûter de novembre 4 000 (dû à partir du mois de l'import) = 39 000."),
    ("Ndeye Gueye", "Année entière payée d'avance.", "Scolarité 310 000 = 40 000 + 9 × 30 000. Arriéré 0, reste sur l'année 0 (colonne Reste = 0)."),
    ("Mariama Ba", "Paiement d'avance jusqu'à février.",
     "Scolarité 100 000 : inscription 25 000 + octobre à février (5 × 15 000). Arriéré 0 ; prochaine mensualité due : mars."),
    ("Cheikh Mbaye", "Trois options dont une quantité (Tenue x3).",
     "Scolarité 55 000 : inscription + octobre + novembre. Articles 32 000 : tenue ×3 24 000, transport d'octobre 5 000, étude d'octobre 3 000. "
     "Arriéré : transport et étude de novembre = 8 000."),
    ("Réglage : juin à l'inscription + mai par tranches", "Même total que d'autres élèves, mais l'école exige juin à l'inscription et paie mai (avant-dernier mois) en 3 tranches dues le 5 janvier, février et mars. Élève de CM2 A.",
     "62 000 : inscription 25 000, juin 15 000, octobre 15 000, novembre 7 000 → arriéré 8 000 (novembre). "
     "130 000 : inscription, juin, octobre à janvier, tranche 1 de mai 5 000, février, tranche 2 de mai 5 000, mars 5 000 sur 15 000 → mai « Tranches 1 à 2/3 » payé 10 000, mars partiel, arriéré 0."),
    ("(cas refusé)", "Total versé supérieur au total de l'année (ex : 170 000 en CM2 A, total 160 000).",
     "La colonne « Reste » devient rouge (-10 000) et l'import signale l'erreur : rien n'est écrit pour cet élève."),
]
for r, ligne in enumerate(cas, 2):
    for c, v in enumerate(ligne, 1):
        cell = wx.cell(row=r, column=c, value=v)
        cell.font = Font(name=F)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        cell.border = BORD

wb.move_sheet("Listes", offset=10)
wb.calculation = CalcProperties(fullCalcOnLoad=True)
wb.save(out)
print("ok")
