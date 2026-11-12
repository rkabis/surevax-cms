#!/usr/bin/env python3
"""Generate the SureVax CMS go-live requirements questionnaire PDF.

Cross-department question set gathered for go-live: clinical (head nurse /
attending physician), business development, operations, compliance, and IT.
Run:  python3 scripts/gen-golive-questionnaire.py
Output: docs/go-live-requirements-questionnaire.pdf

Style rule: NO em dashes or en dashes anywhere in the content. Plain hyphens,
colons, and the word "to" for ranges. Peso amounts are written "PHP" (the
built-in PDF fonts do not carry the peso glyph).
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
    KeepTogether,
)

TEAL = colors.HexColor("#0d6e64")
TEAL_DARK = colors.HexColor("#0b504a")
INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#5b6b73")
LINE = colors.HexColor("#c8d2d4")

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "DocTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=20, textColor=TEAL_DARK, spaceAfter=4, leading=24,
)
subtitle_style = ParagraphStyle(
    "DocSubtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10.5, textColor=MUTED, spaceAfter=10, leading=15,
)
intro_style = ParagraphStyle(
    "Intro", parent=styles["Normal"], fontName="Helvetica",
    fontSize=9.5, textColor=INK, spaceAfter=6, leading=14,
)
section_style = ParagraphStyle(
    "SectionHead", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=12.5, textColor=colors.white, leading=16,
)
section_sub_style = ParagraphStyle(
    "SectionSub", parent=styles["Normal"], fontName="Helvetica-Oblique",
    fontSize=8.5, textColor=colors.whitesmoke, leading=11,
)
q_style = ParagraphStyle(
    "Question", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10, textColor=INK, leading=13.5, spaceBefore=2,
    alignment=TA_LEFT,
)
note_style = ParagraphStyle(
    "Note", parent=styles["Normal"], fontName="Helvetica-Oblique",
    fontSize=8.5, textColor=MUTED, leading=11.5, leftIndent=14, spaceBefore=1,
)
meta_label = ParagraphStyle(
    "MetaLabel", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=9, textColor=INK, leading=13,
)


def section_header(title, subtitle):
    inner = [[Paragraph(title, section_style)]]
    if subtitle:
        inner.append([Paragraph(subtitle, section_sub_style)])
    t = Table(inner, colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def question_block(num, text, notes=None, answer_lines=2):
    flow = [Paragraph(f"<b>{num}.</b>&nbsp;&nbsp;{text}", q_style)]
    if notes:
        for n in notes:
            flow.append(Paragraph(n, note_style))
    flow.append(Spacer(1, 5))
    for _ in range(answer_lines):
        flow.append(HRFlowable(width="100%", thickness=0.5, color=LINE,
                               spaceBefore=7, spaceAfter=0))
    flow.append(Spacer(1, 9))
    return KeepTogether(flow)


# ---- Content -------------------------------------------------------------

SECTIONS = [
    (
        "Section A. Clinical (Head Nurse / Attending Physician)",
        "Confirms the vaccine catalog, dose schedules, and clinical workflow the system enforces.",
        [
            ("Vaccine and service catalog: please review the full list of services the system "
             "offers and confirm each one is offered by the clinic, with the correct name and "
             "default dose. Flag any that should be removed or renamed.", None),
            ("Pneumococcal vaccines (PCV13 and PPSV23): does the clinic offer these? If yes, "
             "what is the booster interval for high-risk patients (the system currently assumes "
             "a Day 365 offset)?", None),
            ("Hepatitis B, TDAP, Varicella, and Shingles schedules: do the follow-up dose "
             "day-offsets in the system match the clinic standard operating procedure? Please "
             "confirm against the SOP document or provide the correct intervals.", None),
            ("Bot1 regimen: it currently has 3 empty placeholder steps carried over from the old "
             "system. Should these be removed, or do they correspond to real doses? If real, "
             "please specify each step and its day offset.", None),
            ("Rabies PEP and PrEP dose schedules: please confirm the regimens the clinic uses "
             "(for example Updated Thai Red Cross intramuscular, intradermal, and the days each "
             "dose falls on).", None),
            ("Rabies historical dose migration: for patients moved over from the old system, the "
             "A2 regimen sometimes shifts from a 4-dose to a 5-dose schedule. What is the rule "
             "for deciding which schedule a past patient was on?",
             ["This and the items below resolve about 2,824 dose records flagged for manual review."]),
            ("Rabies migration open questions Q4, Q5, Q8, and Q11 (from the dose reconstruction "
             "notes): a clinician needs to give the deciding rule for each. Can the head nurse or "
             "a physician sit for a short review to clear these?", None),
            ("WHO exposure categories I, II, and III: please confirm how each category should be "
             "handled at intake (observation only, vaccine, vaccine plus rabies immune globulin).", None),
            ("Weight-based dose calculation: the system computes dose volume by patient weight for "
             "ERIG, HRIG, HTIG, and ATS. Please confirm the formula and units the clinic uses for "
             "each.", None),
            ("Consent: what consent must be on file before a dose is given? Please provide the "
             "current consent form wording and whether it is per visit or per episode.", None),
            ("Critical laboratory results: when a lab result is flagged critical, who must be "
             "notified, and what is the required action and timeframe?", None),
            ("Adverse events (AEFI): who reports an adverse event, who reviews it, and is there a "
             "14-day follow-up step the system should track?", None),
            ("Roles and responsibilities: who is allowed to administer a dose, who documents it, "
             "and who can override a payment gate? Today one shared clinic account does all roles. "
             "Is that correct, or do you want separate logins per role?", None),
        ],
    ),
    (
        "Section B. Business Development / Commercial",
        "Confirms pricing, payers, receipts, and the commercial setup needed to transact.",
        [
            ("Go-live clinic and target date: which single clinic goes live first, and what is "
             "the target switch-on date? Everything else is scheduled backward from this.", None),
            ("Receipts: the system prints an acknowledgement receipt, not a BIR Official Receipt. "
             "Official Receipts are issued manually on customer request. Please confirm this is "
             "the intended setup for go-live.",
             ["The system is built to switch a branch to printing full BIR Official Receipts later "
              "with no code change, once the registration values below are supplied."]),
            ("BIR registration values, per branch: for each branch, please provide the TIN, the "
             "registered business name, the permit number (PTU or ATP), the Official Receipt "
             "series range, the VAT status, and any accreditation number.", None),
            ("Does any branch already operate a BIR-accredited computerized receipt system today, "
             "or do all branches issue manual Official Receipts from a booklet?", None),
            ("Service price list: what is the current source of truth for prices, and who approves "
             "price changes? Please provide the latest price list.", None),
            ("Partner and corporate payers (for example Hati Health, Forticare, MedAsia, "
             "Philbritish): please confirm each partner, their negotiated rates, and provide the "
             "contracts.", None),
            ("HMO arrangements: which HMOs are accepted, and how is billing and reconciliation "
             "handled for them?", None),
            ("Senior Citizen and PWD discounts: please confirm the 20 percent statutory discount "
             "policy and how the VAT-exempt base should be computed on the receipt.", None),
            ("Per-physician revenue attribution: do you need revenue and consultation counts "
             "broken down per attending physician? If yes, list the physicians.", None),
            ("Phase 2 intentions: is there a plan to run more than one clinic on the system, and "
             "to bill other clinics to use it? This affects how branches and tenants are set up "
             "now.", None),
        ],
    ),
    (
        "Section C. Operations",
        "Confirms the data cutover, branch setup, daily workflow, and inventory handling.",
        [
            ("AppSheet cutover approach: do you want a big-bang switch (everything imported, old "
             "system off the next day) or a parallel run (both systems for a week or two while "
             "history is imported and checked)?", None),
            ("Data migration scope: besides rabies dose history, which records must be imported "
             "(patients, past transactions, inventory, non-rabies vaccine history)? What is the "
             "cutoff date for historical data?", None),
            ("Branch list: please provide, for every branch, the short code, full name, complete "
             "address, contact number, email, and timezone. These print on the receipt and vary "
             "per branch.", None),
            ("Operating hours and day model: the system treats a clinic day as one shared session "
             "across all staff, reconciled once per day. Please confirm this matches how the "
             "clinic runs.", None),
            ("Cash drawer and end of day: describe the current end-of-day process. Who counts the "
             "drawer, who signs off on a variance, and what report is produced?", None),
            ("Inventory: please provide the list of products and suppliers, and confirm that "
             "stock should always be dispensed earliest-expiry-first.", None),
            ("Inventory transfers: do branches move stock between each other? If yes, who approves "
             "a transfer and who confirms receipt?", None),
            ("Product recalls: when a product lot is recalled, the system can list every patient "
             "who received a dose from that lot. Who should be notified, and through what channel?", None),
            ("Printer hardware: what receipt printer model will each branch use, and how does it "
             "connect (USB, Bluetooth, or network)?", None),
            ("Appointments: does the clinic book appointments, or is it walk-in only? If "
             "appointments are used, describe the booking process.", None),
        ],
    ),
    (
        "Section D. Compliance and Data Privacy",
        "Confirms Data Privacy Act and BIR record-keeping obligations.",
        [
            ("Data Protection Officer: who is the designated DPO accountable for patient data "
             "under the Data Privacy Act?", None),
            ("Retention periods: how long must clinical records be kept, and how long must "
             "financial records be kept? BIR generally requires 10 years for financial records.", None),
            ("Right to erasure: when a patient asks to have their data deleted, what is the "
             "approval process, and who must sign off before any deletion happens?", None),
            ("Consent storage: where are signed consent forms kept today, and should scanned "
             "copies be attached to the patient record in the system?", None),
            ("Breach response: is there a written procedure for a suspected data breach, including "
             "who is notified and within what timeframe?", None),
            ("Access review: how often should an administrator review who has access to patient "
             "records and cross-branch access grants?", None),
        ],
    ),
    (
        "Section E. IT and Administration (Accounts and Access)",
        "Confirms the external accounts, domains, and user list needed to switch on.",
        [
            ("Domain names: what web address should staff use for the app, and for the backend "
             "(for example app.surevax and api.surevax)? Who has access to manage the DNS records?", None),
            ("System email: what email address should the system send notifications from?", None),
            ("Patient SMS: do you want the system to send patients SMS reminders? If yes, which "
             "SMS provider, and is there an account?", None),
            ("Online payments: do you want to accept GCash, Maya, or card payments online through "
             "the system? If yes, which gateway and is there an account?", None),
            ("Error alerting: an account is needed so staff-facing errors are reported instead of "
             "failing silently. Who owns this account?", None),
            ("Backups and spend limit: who is responsible for confirming daily database backups "
             "and for setting a monthly hosting spend limit?", None),
            ("User accounts: please provide the full list of staff who need a login, with their "
             "name, role, and email address.", None),
            ("Address autocomplete: do you want address autocomplete on the patient form? This "
             "needs a Google Places account key, and is optional.", None),
        ],
    ),
]


def build():
    out_path = "docs/go-live-requirements-questionnaire.pdf"
    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=16 * mm,
        title="SureVax CMS Go-Live Requirements Questionnaire",
        author="SureVax CMS",
    )

    story = []
    story.append(Paragraph("SureVax CMS Go-Live Requirements Questionnaire", title_style))
    story.append(Paragraph(
        "Decisions and values needed before the system goes live with real patient data.",
        subtitle_style,
    ))
    story.append(Paragraph(
        "Please complete the section that applies to your department. Answer on the lines "
        "provided, or attach a separate document or file where that is easier (for example a "
        "price list or a BIR certificate). Where a question is not applicable, write N/A. "
        "Return the completed form to the project owner.",
        intro_style,
    ))
    story.append(Spacer(1, 6))

    meta = Table(
        [
            [Paragraph("Department / Section:", meta_label),
             HRFlowable(width="100%", thickness=0.6, color=LINE),
             Paragraph("Date:", meta_label),
             HRFlowable(width="100%", thickness=0.6, color=LINE)],
            [Paragraph("Completed by:", meta_label),
             HRFlowable(width="100%", thickness=0.6, color=LINE),
             Paragraph("Role:", meta_label),
             HRFlowable(width="100%", thickness=0.6, color=LINE)],
        ],
        colWidths=[33 * mm, 52 * mm, 18 * mm, 67 * mm],
    )
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (1, 0), (1, -1), 4),
        ("LEFTPADDING", (3, 0), (3, -1), 4),
    ]))
    story.append(meta)
    story.append(Spacer(1, 12))

    for sec_title, sec_sub, questions in SECTIONS:
        story.append(section_header(sec_title, sec_sub))
        story.append(Spacer(1, 8))
        for i, item in enumerate(questions, start=1):
            text, notes = item
            story.append(question_block(i, text, notes))
        story.append(Spacer(1, 6))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 10 * mm,
                          "SureVax CMS Go-Live Requirements Questionnaire")
        canvas.drawRightString(190 * mm, 10 * mm, f"Page {doc_.page}")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(20 * mm, 12 * mm, 190 * mm, 12 * mm)
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    build()
