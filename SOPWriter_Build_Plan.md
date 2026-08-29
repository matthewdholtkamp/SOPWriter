# BUILD PLAN — "SOP Writer" Web App: Author or Convert → Perfect GLWCH Publication (.docx)

**Audience:** the implementing engineer (Codex / Antigravity). This is a strategy + specification
document, not code.

**Goal:** a GitHub-hosted website where a user either (a) **authors a new** GLWCH Standard Operating
Procedure from labeled blocks, or (b) **pastes/loads a legacy MEDDAC Pam/Reg** and converts it, and then
presses **Generate** to download a Microsoft Word (.docx) publication that complies **exactly** with the
GLWCH (DHA-format) publication template — every time.

**This app is the SOP-domain sibling of the existing `ArmyMemo` app** (`Desktop/Research AI/Army Memo`).
Reuse its architecture, its three-layer split, its generator constants, its profile system, its validation
pattern, and especially its **"Ask Dr. Holtkamp" patch-generator AI assistant**. Where this plan says
"mirror ArmyMemo," read that repo first and copy the pattern rather than inventing a new one.

**Non-goals:** no backend for document logic, no accounts, no database, no AI *free-writing* of the
document body. The AI proposes structured field updates; the deterministic generator owns all formatting.
The app does **not** generate the Policy Review & Submission Checklist or the routing email as files —
those already exist as fillable forms. Their criteria are reused as a pre-submission **readiness panel**.

---

## 0. THE ONE DECISION THAT SHAPES EVERYTHING

Build a **100% client-side static web app**, identical in philosophy to ArmyMemo. All logic and `.docx`
generation run in the browser; the file is assembled in-browser and downloaded locally.

- GitHub Pages serves only static files.
- **Privacy:** policy content (which can reference internal operations) never leaves the user's machine.
- **Portability:** runs on locked-down hospital networks; can run offline from a saved folder (PWA).

The **only** network call at runtime is the optional "Ask Dr. Holtkamp" assistant, which posts to the
existing Cloudflare Worker proxy (§8). Everything else is local.

---

## 1. RECOMMENDED TECH STACK (mirror ArmyMemo; pin versions)

| Concern | Choice | Notes |
|---|---|---|
| .docx generation | **`docx` (docx-js) by Dolan Miu**, browser build, `Packer.toBlob()` | Same lib ArmyMemo uses (it pins `docx@9.7.1`). Full control over numbering, indentation, headers/footers, page numbers, tables, embedded seal. |
| Build tool | **Vite** | Same as ArmyMemo. |
| Language/UI | **TypeScript + React** | Mirror ArmyMemo (`react@19`, `react-dom@19`). The dynamic block tree + dual-mode UI benefit from React. |
| Schema/validation | **`zod`** | Mirror ArmyMemo (`zod@4`). The `SopSpec` and the assistant patch get zod schemas. |
| Legacy ingestion (Phase 2) | **`pdfjs-dist`** for PDF text, **`mammoth`** for .docx text | Client-side only; no upload to any server. Phase 1 uses paste. |
| Styling | Plain CSS (copy ArmyMemo's `styles.css` approach) | Keep bundle small, offline-friendly. |
| Hosting/CI | **GitHub Actions → GitHub Pages** | Copy `.github/workflows/deploy.yml` from ArmyMemo verbatim (Node 24, `npm ci` → `npm test` → `npm run build` → deploy `dist/`). |
| PWA | **`vite-plugin-pwa`** | Mirror ArmyMemo so the tool installs/runs offline. |
| Storage | None server-side. Optional **localStorage** draft autosave, **off by default**. | Same privacy posture as ArmyMemo. |

---

## 2. ARCHITECTURE — THREE CLEAN LAYERS + ASSISTANT + CONVERTER

```
            ┌─────────────────────────────────────────────┐
            │  MODE: "Author"  ──or──  "Convert"           │
            └─────────────────────────────────────────────┘
                              │
[ UI: labeled section blocks + paste/upload + block tree editor ]
                              │  collects content only (never format)
                              ▼
            [ SopSpec — one typed JSON object ]   ← the contract; §5
                  │                         ▲
   pure function  │                         │  proposes a validated PATCH
                  ▼                         │
   [ buildDocx(spec) → Blob ]      [ Ask Dr. Holtkamp SOP Assist ] ──► Cloudflare Worker ──► Gemini
   owns ALL DHA format; §6         author-assist + convert-map; §8
                  │
                  ▼
        [ Download .docx ]  +  [ Structural HTML preview ]  +  [ Compliance + Readiness panel; §10 ]
```

Why this split (same reasoning as ArmyMemo): the **generator is the single source of truth for format**
and is unit-testable in isolation (feed a spec, unzip the output, assert the XML). The **UI never decides
formatting**. The **AI never writes the final document** — it only emits a `SopSpec` patch that is
sanitized, schema-checked, and applied. That is what makes "perfect every time" enforceable.

The **converter** (§7) is a deterministic text→spec mapper used in Convert mode; the AI assistant's
convert-map skill (§8) is the smart fallback/accelerator on top of it. Both produce a `SopSpec` patch.


---

## 3. PUBLICATION IDENTITY (the decision the principal delegated — recommended)

**Recommendation: the app produces *local GLWCH publications* that adopt the DHA publication *format*.**
Concretely:

- **Two document types:** **GLWCH Regulation** (directive/mandatory policy — uses "will/must") and
  **GLWCH Pamphlet** (informational / procedural how-to guidance). A `documentType` field switches header
  wording and a few validation rules. This matches the legacy world (`MEDDAC Reg 40-43`, `MEDDAC Pam 40-7`).
- **Signed locally:** by the **Hospital Commander** (COL) or the **Deputy Commander** (the two approval
  authorities named in the Policy Review checklist) — *not* "Director, DHA."
- **Localized applicability:** GLWCH and its outlying clinics / assigned, attached personnel — *not* the
  DHA Enterprise, MILDEPs, Combatant Commands, or Joint Staff. Those enterprise constructs from the source
  template are **dropped/localized**.
- **Adopt wholesale (do not localize away):** the section order, the paragraph-numbering hierarchy, the
  enclosure/glossary structure, the "must/will/may — never shall" verb discipline, the reference-citation
  style, and the editing-style rules. This is the formatting standard the hospital is moving to.

Why: GLWCH is a single MTF producing local guidance, not the DHA enterprise issuing instructions to the
Services. The uploaded template is the full **DHA enterprise** template; we keep its *form* and localize
its *authority/scope content*. Keep this rationale in the README so future maintainers don't "restore" the
enterprise language.

**Numbering:** default to the **Army functional-area style** the proponents already use
(`GLWCH Reg 40-43`, `GLWCH Pam 40-7`) as an editable free-text field, rendered as `[NUMBER]` until
assigned. Do **not** hardcode the DHA "NUMBER XXXX.XX" PSB scheme — there is no DHA PSB assigning numbers
to a local MTF pamphlet. (If the hospital later mandates the XXXX.XX scheme, it is just a different string
in the same field.)

---

## 4. DHA-FORMAT RULES THE GENERATOR MUST ENFORCE (authoritative summary)

Derived directly from the uploaded template `GLWCH PAM or REG Number Name.docx`. Encode as constants and
logic. **The template's body text is *instructions*, not content** — the generator must reproduce the
*structure and formatting*, and must NEVER emit the instructional prose ("Required section, is always
located above the signature…") into a finished document.

### 4.1 Header block (above signature, page 1)
In order: `Defense Health Agency` (top line) · `General Leonard Wood Community Hospital` · publication
number line (`GLWCH Regulation No. 40-43` / `GLWCH Pamphlet No. 40-7`, or `[NUMBER]`) · date
(`Month DD, YYYY`, or `[DATE]`) · proponent line · `SUBJECT:` (two spaces after colon; title case; no
acronyms; if it wraps, align the second line under the first) · `References:` (always "See Enclosure 1.").

### 4.2 Required body sections, in this exact order (above the signature)
1. **PURPOSE** — required, always above signature. "…establishes the GLWCH procedures to/for…".
2. **APPLICABILITY** — required, second paragraph, in paragraph (prose) form. Localized to GLWCH + clinics.
3. **POLICY IMPLEMENTATION** — required. State the overarching higher policy being implemented; a local
   pub *implements* DoD/DHA/Service policy and *establishes local procedures* — it does not create policy.
4. **CANCELED DOCUMENTS** — optional. **This is the conversion target**: "This GLWCH Regulation cancels
   MEDDAC Reg 40-43, *Fall Prevention Program*, 23 October 2024." Omit if nothing is canceled.
5. **RESPONSIBILITIES** — required. Brief, actionable, assigned to *officials not offices*; if it exceeds
   ~½ page, the detail goes to **Enclosure 2** and only a summary stays above the signature.
6. **PROCEDURES** — required, the central element. A brief description stays above the signature; the
   detailed procedures go to **Enclosure 3** (subdivided into appendices as needed).
7. **INFORMATION COLLECTION** — required *if applicable*; otherwise remove and renumber.
8. **PROPONENT AND WAIVERS** — required, above signature. Localized: proponent = the responsible GLWCH
   department/directorate; waivers route through the hospital chain to the Commander (not Director, DHA).
9. **RELEASABILITY** — required. Select exactly one: "Cleared for public release" **or** "Not cleared for
   public release"; render only the chosen statement.
10. **EFFECTIVE DATE** — required. "Is effective upon signature." + "Will expire N years from the date of
    signature if not reissued or canceled."
11. **FORMS** — required *if forms are cited*.
12. **SUMMARY OF CHANGES** — required *only if a change/reissue publication*; otherwise remove.

### 4.3 Signature block
Begins on the **7th line** below the last section; signature-block tab at **3.25"**. Lines: NAME (caps),
rank+branch (e.g., `COL, MC`), title (e.g., `Commander` / `Deputy Commander for Clinical Services`). Long
titles wrap indented.

### 4.4 Enclosures (after signature), in order of use
`1. References` (always first) · `2. Responsibilities` · `3. Procedures` · `Appendix(ces)` (listed under
the enclosure they support) · `Glossary` (always last).

### 4.5 Enclosure 1 — REFERENCES
Lettered `(a)`, `(b)`, `(c)`… in order of first appearance in the text. Hanging indent / tab at ~0.36".
First references are the establishing/authority documents. Dates as `Month Day, Year`; never break a date
across two lines. "as amended" follows reissued-document dates.

### 4.6 Enclosure 2/3 — RESPONSIBILITIES / PROCEDURES (the deep body)
**Paragraph-numbering hierarchy (DHA — note this DIFFERS from ArmyMemo's memo hierarchy at depths 4–5):**

| Depth | Label | First-line indent |
|---|---|---|
| 0 (section) | `1.` | 0" (left margin) |
| 1 | `a.` | 0.25" |
| 2 | `(1)` | 0.50" |
| 3 | `(a)` | 0.75" |
| 4 | `1.` | 1.00" |
| 5 | `a.` | 1.25" **(deepest — never subordinate below this)** |

Rules: **two spaces after the number/letter label — never a tab.** Runover lines return to the left margin
(block style). A paragraph `a.` requires a `b.`; a `(1)` requires a `(2)` (lone-child is an error). At any
given level, **either all siblings carry a paragraph heading or none do.** A section title with text on the
same line gets a period after the title (`1. SECTION TITLE. Text…`); a title with no following text gets no
period. Tables: title **above** the table (`Table 2. …`). Figures: title **below** the figure
(`Figure 1: …`). When only one table or figure exists, do not number it.

### 4.7 Glossary (always last enclosure)
**Part I — Abbreviations and Acronyms:** required when the publication is over two pages and uses acronyms
other than "DoD," "OSD," or "U.S." that appear **3+ times**. Alphabetical by acronym; blank line between
letter groups; lowercase the meaning when it is a common noun, Title Case when a proper noun.
**Part II — Definitions:** alphabetical, unnumbered, capitalize proper nouns only. Omit a Part if unused
(and then don't label "Part #").

### 4.8 Table of Contents
Only required if the publication exceeds 25 pages (or genuinely adds value). Leader dots to a right tab at
6.5"; uppercase for enclosure/section/appendix titles, title case for paragraph headings.

### 4.9 Army/DHA writing-style rules (enforce where deterministic, warn otherwise)
- **"must"** = mandatory; **"will"** = required future action; **"may"/"can"** = permitted/optional.
  **"shall" is prohibited** — flag every occurrence.
- **Serial (Oxford) comma** required.
- **En dash** "–" for ranges with **no surrounding spaces** (`12–18 months`).
- **Two spaces** after sentence-ending periods/question marks.
- **Dates spelled out:** `Month Day, Year` (e.g., `January 1, 2011`). Amounts of time are numerals.
  "fiscal year" lowercase unless followed by a year.
- **`i.e.,`** and **`e.g.,`** each followed by a comma; `e.g.` = "for example" (no "etc."), `i.e.` = "in
  other words."
- **"health care"** two words as a noun, **"healthcare"** one word as an adjective.
- **"Service member(s)"** — capital S.
- Acronyms: spell out in full on first use with the acronym in parentheses, then use the acronym; list in
  Glossary Part I per §4.7.
- Page: US Letter, 1" margins, ragged right (never justify). Default font matches the template (set the
  font name; rely on the opener's installed font).


---

## 5. THE SopSpec (the UI↔generator↔assistant contract)

Define as a TypeScript type **and** a zod schema (mirror `src/model/memoSpec.ts`). The UI produces it,
`buildDocx(spec)` consumes it, and the assistant emits *partial* patches against it. Keep `specVersion`.

```jsonc
{
  "specVersion": "1.0.0",
  "mode": "author" | "convert",          // provenance only; does not affect output format
  "documentType": "regulation" | "pamphlet",
  "profileId": "glwch",                   // letterhead profile (§9)
  "publicationNumber": "40-43",           // renders "GLWCH Regulation No. 40-43"; empty → "[NUMBER]"
  "date": "January 1, 2026",              // empty → "[DATE]"
  "proponent": "Department of ___ (DCN ___)",
  "subject": "Fall Prevention Program",   // title case, no acronyms

  // Enclosure 1 — rendered (a),(b),(c)... in order of first text appearance
  "references": [
    "DoD Directive 5136.13, \"Defense Health Agency (DHA),\" September 30, 2013, as amended"
  ],

  // ABOVE-SIGNATURE SECTIONS (each a recursive ParagraphNode[]; generator derives numbering from depth)
  "sections": {
    "purpose":               [ { "text": "...", "children": [] } ],   // §1 required
    "applicability":         [ { "text": "...", "children": [] } ],   // §2 required (prose)
    "policyImplementation":  [ { "text": "...", "children": [] } ],   // §3 required
    "canceledDocuments":     null,                                    // §4 optional (conversion target)
    "responsibilitiesBrief": [ { "text": "...", "children": [] } ],   // §5 summary (detail → Encl 2)
    "proceduresBrief":       [ { "text": "...", "children": [] } ],   // §6 summary (detail → Encl 3)
    "informationCollection": null,                                    // §7 if applicable
    "proponentAndWaivers":   [ { "text": "...", "children": [] } ],   // §8 required
    "releasability":         "public" | "notPublic",                  // §9 select-one
    "effectiveDate":         { "effectiveOnSignature": true, "expiresYears": 10 }, // §10
    "forms":                 null,                                    // §11 if forms cited
    "summaryOfChanges":      null                                     // §12 if change pub
  },

  "signature": {
    "name": "Matthew D. Holtkamp",        // generator uppercases
    "rankBranch": "COL, MC",
    "title": ["Deputy Commander for Clinical Services"],
    "approvalAuthority": "commander" | "deputy"
  },

  "enclosures": {
    "responsibilities": [ /* ParagraphNode[] — Enclosure 2 detailed */ ],
    "procedures":       [ /* ParagraphNode[] — Enclosure 3 detailed */ ],
    "appendices": [ { "title": "...", "body": [ /* ParagraphNode[] */ ] } ]
  },

  "glossary": {
    "acronyms":    [ { "term": "MTF", "meaning": "military medical treatment facility" } ],  // Part I
    "definitions": [ { "term": "...", "definition": "..." } ]                                // Part II
  },

  "tables":  [ { "number": 1, "title": "..." } ],   // optional; drives TOC list of tables
  "figures": [ { "number": 1, "title": "..." } ],   // optional

  // Convert-mode provenance only (used to prefill Canceled Documents + the readiness panel)
  "legacy": {
    "sourceDesignation": "MEDDAC Reg 40-43",
    "sourceTitle": "Fall Prevention Program",
    "sourceDate": "23 October 2024",
    "ingestedText": "..."                 // never sent anywhere except the optional assistant call
  }
}
```

```ts
type ParagraphNode = {
  heading?: string;        // optional "Paragraph Heading." rendered before text (all-or-none per level)
  text: string;            // body text WITHOUT any manual "1.", "a.", "(1)" — generator adds the label
  children: ParagraphNode[];
};
```

---

## 6. GENERATOR SPEC — docx-js settings (reuse ArmyMemo constants; extend for SOP structure)

Start from `src/generator/format.ts` in ArmyMemo and keep the proven constants:
`DXA_PER_INCH=1440`, `PAGE_WIDTH=12240`, `PAGE_HEIGHT=15840`, `MARGIN=1440`, `HEADER_FOOTER_MARGIN=720`,
`CONTENT_WIDTH=9360`, `INDENT_STEP=360` (0.25"), `SINGLE_LINE=240`, `PARAGRAPH_AFTER=200`.
Signature block tab/indent = **4680** dxa (3.25").

**Replace the label function** with the DHA hierarchy (§4.6) — this is the key divergence from ArmyMemo:

```ts
export const MAX_SUBLEVEL_DEPTH = 5; // depths 0..5 allowed; reject children at depth 5
export function sopLabel(depth: number, ordinal: number): string {
  const letter = String.fromCharCode(96 + Math.min(ordinal, 26));
  switch (depth) {
    case 0: return `${ordinal}.`;
    case 1: return `${letter}.`;
    case 2: return `(${ordinal})`;
    case 3: return `(${letter})`;
    case 4: return `${ordinal}.`;
    default: return `${letter}.`; // depth 5
  }
}
```

`buildDocx(spec: SopSpec): Promise<Blob>` must be a **single pure function, no DOM access** (so it is
unit-testable headlessly, exactly like ArmyMemo's). Behaviors:

- **Numbering label:** `sopLabel(depth, ordinal)` + **two spaces** + (optional `heading` + ". ") + text.
- **Indentation:** `indent { left: 0, firstLine: depth * INDENT_STEP }` — first line indented, runover to
  the left margin (block style). Section level (depth 0) at the margin.
- **Section assembly (above signature):** emit §1–§12 in the fixed order of §4.2; skip optional/empty
  sections and **renumber** the visible section numbers accordingly (Information Collection, Forms,
  Summary of Changes, Canceled Documents are conditional). Releasability renders only the selected
  statement. Effective Date renders the two standard sentences with `expiresYears`.
- **Header block:** `Defense Health Agency` / `General Leonard Wood Community Hospital` / number line keyed
  to `documentType` (`GLWCH Regulation No. X` vs `GLWCH Pamphlet No. X`) / date / proponent / `SUBJECT:  `
  (two spaces) / `References:  See Enclosure 1.`
- **Title page behavior:** set `titlePage: true` at the section `properties` level (same gotcha noted in
  ArmyMemo — NOT inside `page`). Page 1 letterhead, no page number; continuation pages get a plain header
  (publication short title + subject) and a centered page number. ArmyMemo already solves this exact
  header/footer split — copy it.
- **Enclosures:** start each on a new page; heading `ENCLOSURE N` then the uppercase title; then the
  paragraph tree via the same numbering engine. References render `(a)…(z)` with a 0.36" hanging indent.
- **Glossary:** `GLOSSARY`, `PART I. ABBREVIATIONS AND ACRONYMS` (alphabetized, blank line between letter
  groups), `PART II. DEFINITIONS` (alphabetized, unnumbered). Omit empty parts.
- **TOC:** generate only when the rendered page count would exceed 25 (Phase 2 — use docx-js
  `TableOfContents`/field, or a computed leader-dot table). Phase 1 may omit and warn.
- **Spacing:** `line: 240` single, `after: 200` between paragraphs; ragged right (no justification).
- **Output:** `Packer.toBlob(doc)` → object-URL download; filename from `documentType + number + subject +
  date`, sanitized (e.g., `GLWCH-Reg-40-43_Fall-Prevention-Program.docx`).


---

## 7. CONVERT MODE — legacy MEDDAC Pam/Reg → SopSpec

Convert mode and Author mode are the same editor; Convert simply prefills the `SopSpec` from a legacy
document and applies mandatory transforms, then the user reviews/edits before Generate.

### 7.1 Ingestion
- **Phase 1:** a "Paste legacy text" textarea. The user pastes the body of the old Pam/Reg.
- **Phase 2:** client-side file load — **PDF** via `pdfjs-dist` (extract text), **.docx** via `mammoth`.
  No bytes leave the browser. A "couldn't parse cleanly" path always falls back to paste.

### 7.2 Deterministic section mapping (legacy → new)
Legacy MEDDAC docs follow `1. Purpose / 2. References / 3. Applicability / 4. Responsibilities / …
Procedures`. Map as:

| Legacy heading | New destination |
|---|---|
| Purpose | §1 PURPOSE |
| References | **Enclosure 1 REFERENCES** (relettered `(a)…`) |
| Applicability | §2 APPLICABILITY |
| Responsibilities | §5 summary above signature **+ Enclosure 2** for the detail |
| Procedures / program detail | §6 summary above signature **+ Enclosure 3** for the detail |
| Definitions / acronyms (if present) | **Glossary** Part I / Part II |
| (none in legacy) | Generate stubs for §3 Policy Implementation, §8 Proponent & Waivers, §9
Releasability, §10 Effective Date — flagged as **needs author input** |
| (the legacy doc itself) | §4 CANCELED DOCUMENTS prefilled: "This GLWCH {type} cancels {legacy
designation}, *{title}*, {date}." |

### 7.3 Mandatory verbiage normalization (deterministic pass; applied in place)
Per the principal's scope decision the tool outputs **only the SOP** — there is no separate diff file — so
these run as an in-place normalization with each change surfaced as a **compliance flag** the user can see:

- `General Leonard Wood Army Community Hospital` → `General Leonard Wood Community Hospital`
- `GLWACH` → `GLWCH` (whole-word, case-sensitive variants)
- Letterhead `DEPARTMENT OF THE ARMY` → header block `Defense Health Agency` +
  `General Leonard Wood Community Hospital`
- Legacy designation `MEDDAC Regulation/Reg NN-NN` / `MEDDAC Pam NN-N` → `GLWCH Regulation/Pamphlet NN-NN`
  (and the old designation drops into §4 Canceled Documents)
- `shall` → flag for the author to choose `must`/`will`/`may` (do **not** auto-substitute — meaning
  matters)

### 7.4 Flag-for-human-review (NEVER auto-change — surfaced as warnings/questions)
The facility move changes physical operations. The converter and the assistant must **flag, not rewrite**,
any content that depends on the building: room/suite/floor/wing references, "located in/at," building
names, service locations, signage/wayfinding, phone/pager extensions, and any procedure whose steps assume
the old layout or workflow. Each becomes a "needs move review" item in the readiness panel (§10).

---

## 8. "ASK DR. HOLTKAMP" SOP ASSIST (mirror ArmyMemo's assistant exactly)

This is the SOP-domain version of ArmyMemo's `src/assistant/` (`client.ts`, `schema.ts`, `apply.ts`).
**Reuse the entire pattern**; only the system prompt and the patch schema change.

### 8.1 Transport (copy verbatim)
- POST to the **existing Cloudflare Worker** `https://bandaid6.mholtkamp.workers.dev` — it is a generic
  Gemini proxy that hides the API key and accepts `{ model, fallbackModel, stream, systemInstruction,
  contents, generationConfig }`. **No new worker is needed**; the system prompt lives client-side. Add the
  worker origin to the CSP `connect-src` (§11).
- Primary model `gemini-3.5-flash-lite`, fallback `gemini-3.7-flash` (same as ArmyMemo's `schema.ts`).
- `generationConfig`: `thinkingConfig.thinkingLevel: "low"`, `responseMimeType: "application/json"`, and a
  `responseSchema` describing the patch (Gemini structured output). Reuse ArmyMemo's recursive
  `paragraphResponseSchema(depth)` helper for the `ParagraphNode` tree (cap recursion at depth 5).
- **Robustness (copy ArmyMemo `client.ts`):** `extractJson` (strip ``` fences / find first `{`…`}`),
  `sanitize*` functions, zod `assistantResponseSchema.parse`, and `normalizeAssistantResponse` to recover
  JSON that the model accidentally returns inside the chat string.
- **Privacy:** strip any seal/local profile data before sending (ArmyMemo's `stripSealData` analog). The
  prompt forbids PHI, patient detail, classified content, and names of real patients/staff.

### 8.2 Two skills (one prompt, behavior keyed by `mode` + the user instruction)
1. **Author-assist:** rough notes / bullet points / "write me a responsibilities section for X" → propose a
   `SopSpec` patch (subject, purpose, applicability, responsibilities tree, procedures tree, references,
   glossary acronyms). Asks clarifying questions when a required section can't be responsibly filled.
2. **Convert-map:** given pasted legacy text in `legacy.ingestedText`, return a patch that places the old
   content into the new section/enclosure structure (§7.2), applies the verbiage normalization (§7.3), and
   returns **warnings/questions** for every move-impacted procedure and every missing required section
   (§7.4). It must **not invent** Policy Implementation / Proponent / Releasability content — it returns
   those as `questions`.

### 8.3 Response shape (mirror ArmyMemo's `AssistantResponse`)
```jsonc
{
  "assistantMessage": "Brief explanation for the user.",
  "action": "applyPatch" | "askClarifyingQuestion" | "noChange",
  "specPatch": { /* partial SopSpec: any subset of §5 fields, deep-merged */ },
  "changedFields": [ { "field": "sections.responsibilitiesBrief", "reason": "..." } ],
  "warnings": [ "Procedure 3.b references 'Room 2-C wing' — confirm post-move location." ],
  "questions": [ "Who is the proponent department for this publication?" ]
}
```
Apply path mirrors `src/assistant/apply.ts`: deep-merge the validated patch into the working spec, report
`changedFields`, never apply a patch that fails the zod schema or the §10 structural rules.

### 8.4 System prompt (client-side constant — adapt ArmyMemo's `ARMYMEMO_ASSISTANT_PROMPT`)
> You are **Dr. Holtkamp SOP Assist** inside SOP Writer. You help convert rough notes or legacy MEDDAC
> Pam/Reg text into a GLWCH publication draft. Return **only** strict JSON matching the requested shape —
> no Markdown fences. The browser app validates and formats the document; you only propose field updates.
> Follow the GLWCH (DHA-format) rules: required section order (Purpose, Applicability, Policy
> Implementation, Canceled Documents, Responsibilities, Procedures, Information Collection, Proponent &
> Waivers, Releasability, Effective Date, Forms, Summary of Changes); paragraph numbering is added
> automatically — **never** put manual "1.", "a.", "(1)" in `text`. Use "must"/"will"/"may", **never
> "shall"**; serial commas; two spaces after sentence-ending punctuation; spell dates as Month Day, Year;
> expand acronyms on first use and add them to the glossary. Assign responsibilities to **officials, not
> offices**. When converting: change "General Leonard Wood Army Community Hospital" → "General Leonard Wood
> Community Hospital" and "GLWACH" → "GLWCH"; place the legacy document into Canceled Documents; do **not**
> invent Policy Implementation, Proponent, or Releasability — ask for them. **Flag, never rewrite**, any
> procedure that depends on building/room/location/workflow, because the hospital is moving facilities.
> Never include PHI, patient details, real staff names, or classified content.

---

## 9. PROFILES / CONFIGURATION (mirror ArmyMemo's profile system)

Reuse `src/model/profiles.ts` + `seals.ts`. A profile = `{ id, displayName, headerLines: string[],
sealImage, defaultProponent, signerPresets: [{name, rankBranch, title, approvalAuthority}] }`.

- Ship a built-in **`glwch`** profile: header `Defense Health Agency` / `General Leonard Wood Community
  Hospital` / `Fort Leonard Wood, Missouri`; DoD seal asset (reuse ArmyMemo's); signer presets for
  **Hospital Commander** (COL) and **Deputy Commander**.
- Import/Export profile JSON so an admin builds it once and distributes the file. Nothing person-specific
  is hardcoded — a signer is just a preset.


---

## 10. VALIDATION + READINESS PANEL (mirror ArmyMemo's `validate.ts`; live PASS/WARN/FAIL)

Two groups, exactly like ArmyMemo's compliance panel.

**Blocking errors (disable Generate):**
- Missing subject/title.
- Any **required** section empty: Purpose, Applicability, Policy Implementation, Responsibilities,
  Procedures, Proponent & Waivers, Releasability, Effective Date.
- Enclosure 1 References empty (every publication has at least the establishing references).
- **Lone subparagraph** anywhere (a child with no sibling) — reuse ArmyMemo's walker.
- Nesting beyond depth 5.
- Signature incomplete (name, rank+branch, title, approvalAuthority).

**Warnings (allow, but flag):**
- `shall` used anywhere.
- Acronym not expanded on first use; acronym used 3+ times but missing from Glossary Part I (when doc
  > 2 pages).
- Subject contains an acronym, or exceeds a sensible length.
- Date not in `Month Day, Year` form, or still `[DATE]`.
- Responsibilities/Procedures summary above the signature exceeds ~½ page → move detail to the enclosure.
- `i.e.`/`e.g.` without trailing comma; missing serial comma heuristic; "health care" used as an adjective.
- Sentence spacing not double (offer a one-click fix, like ArmyMemo's `fixSentenceSpacing`).
- **Convert-mode only:** residual `GLWACH` or `Army Community Hospital` strings detected; legacy
  designation still present in body; any **move-impacted** location/room/workflow reference not yet
  acknowledged.

**Pre-submission Readiness panel (mirror the Policy Review & Submission Checklist — NOT a generated file):**
render the checklist's criteria as live items so the proponent can self-verify before routing:
formatting converted to new format ✓ · hospital-name verbiage updated ✓ · `GLWACH→GLWCH` updated ✓ ·
procedures reviewed for the move (manual acknowledgment) · affected-area review (manual) · Deputy-lane
review if Commander signature (manual) · final approval authority selected. Show the correct routing note
based on `approvalAuthority`: **Deputy** → OICs/Civilians-in-charge of affected areas → Executive Officer;
**Commander** → OICs/Civilians-in-charge → the corresponding Deputy's lane → Executive Officer.

---

## 11. PRIVACY, SECURITY, ACCESSIBILITY (requirements, not extras)

- **One runtime network call only:** the optional assistant POST to the Worker. Strict CSP, copied from
  ArmyMemo and adjusted: `connect-src 'self' https://bandaid6.mholtkamp.workers.dev`; `img-src 'self' data:
  blob:`; `script-src 'self'`; `object-src 'none'`; etc. No analytics, no trackers.
- **No server storage.** Optional localStorage draft autosave **off by default** with a "stays on this
  device" notice and a "Clear all" button. Legacy `ingestedText` is held in memory/draft only and sent
  *only* if the user invokes the assistant.
- **Section 508 / WCAG 2.1 AA** (federal requirement): full keyboard nav, labeled controls, visible focus,
  contrast, ARIA on the dynamic block tree and the compliance panel.
- Sanitize the generated filename; escape user text in the HTML preview (XSS).

---

## 12. REPOSITORY STRUCTURE (mirror ArmyMemo)

```
sopwriter/
├─ README.md                 # what it is; the §3 identity rationale; how to add a profile; DHA-format notes
├─ LICENSE  NOTICE.md
├─ package.json              # pinned: docx, react, react-dom, zod, vite, vitest, vite-plugin-pwa, (pdfjs-dist, mammoth in P2)
├─ vite.config.ts            # base: "/SOP/" (or chosen repo path); PWA manifest
├─ index.html                # CSP per §11
├─ .github/workflows/deploy.yml   # copy ArmyMemo's verbatim
├─ public/assets/seals/      # dod_seal.png (reuse), placeholder
├─ src/
│  ├─ main.tsx  App.tsx  styles.css
│  ├─ model/
│  │  ├─ sopSpec.ts          # SopSpec type + zod schema + specVersion (mirror memoSpec.ts)
│  │  ├─ defaultSpec.ts  profiles.ts  seals.ts  drafts.ts
│  ├─ generator/
│  │  ├─ buildDocx.ts        # pure generator (§6)
│  │  └─ format.ts           # constants + sopLabel() (§6)
│  ├─ convert/
│  │  ├─ ingest.ts           # paste (P1) + pdfjs/mammoth (P2)
│  │  ├─ mapLegacy.ts        # §7.2 section mapping
│  │  └─ normalizeVerbiage.ts# §7.3 deterministic swaps + §7.4 flag detector
│  ├─ assistant/
│  │  ├─ client.ts  schema.ts  apply.ts   # mirror ArmyMemo; SOP prompt + patch schema (§8)
│  ├─ validation/
│  │  └─ validate.ts         # §10 rules + readiness panel
│  └─ ui/                    # mode switch, section/block tree editor, paste/upload, preview, panels
└─ tests/
   ├─ generator.test.ts      # unzip .docx, assert XML
   ├─ convert.test.ts  validation.test.ts  assistant.test.ts
   └─ fixtures/              # golden specs + a redacted legacy sample
```

---

## 13. BUILD & DEPLOY (GitHub Pages)

- Personal account hosting, consistent with the principal's other repos
  (`github.com/matthewdholtkamp/...`). Suggested repo name `SOP` (project Pages) → Vite `base: "/SOP/"`
  and `start_url` accordingly. Confirm before first deploy.
- `.github/workflows/deploy.yml` copied from ArmyMemo: on push to `main` → checkout → Node 24 → `npm ci`
  → `npm test` → `npm run build` → upload `dist/` → deploy Pages.
- Result: a single static URL anyone in the hospital can open. PWA allows offline use from a saved copy.

---

## 14. TESTING STRATEGY (inspect real output — mirror ArmyMemo)

Vitest. In `generator.test.ts`, call `buildDocx(spec)`, unzip the Blob (`fflate`/`jszip`), read
`word/document.xml`, and assert:
- Section order matches §4.2; conditional sections omitted **and** renumbered when empty.
- DHA numbering labels per §4.6 (`1.`/`a.`/`(1)`/`(a)`/`1.`/`a.`), two spaces after the label, first-line
  indent = depth·360, runover at left margin.
- Lone-child spec → validator rejects (separate `validation.test.ts`).
- References render `(a)…` with hanging indent; Enclosures start on new pages; Glossary parts alphabetized.
- `titlePage` set at section properties; page 1 unnumbered; continuation header + centered page number.
- Signature run uppercased, indented to 4680, on the 7th line.
- `convert.test.ts`: a redacted legacy sample maps to the right sections; `GLWACH→GLWCH` and the
  hospital-name swap applied; a planted `Room 2-C` string produces a move-review warning, **not** a
  rewrite; the legacy designation lands in Canceled Documents.
- Golden fixtures: one authored Regulation, one converted Pamphlet.
- README manual-QA: open generated `.docx` in Word; verify page 1 letterhead/no number, continuation
  header + number, enclosure breaks, glossary, signature placement, ragged right.

---

## 15. PHASED ROADMAP (with acceptance criteria)

**Phase 0 — Skeleton.** Vite+TS+React app, repo, CI to Pages, CSP. *Done when:* placeholder page is live.

**Phase 1 — MVP (the core promise; both modes).**
- `documentType` Regulation + Pamphlet; full §4.2 section set + Enclosures 1–3 + Glossary; `buildDocx` per
  §6; section/block tree editor with **live DHA numbering**; GLWCH profile + signer presets.
- **Convert mode via paste:** §7.2 mapping + §7.3 deterministic verbiage normalization + §7.4 flags.
- Validation/compliance + readiness panel (§10); structural HTML preview; Save/Load draft JSON.
- **Ask Dr. Holtkamp SOP Assist** (author-assist + convert-map) via the existing Worker (§8).
- *Done when:* a user can (a) author a new Regulation from blocks, or (b) paste a legacy Pam, see it mapped
  with `GLWACH→GLWCH` applied and move-impacted steps flagged, watch the compliance panel go green, and
  download a `.docx` that passes the §4 structure and the generator unit tests.

**Phase 2 — v1 (usable hospital-wide).**
- Client-side **file ingestion** (PDF via `pdfjs-dist`, .docx via `mammoth`).
- **TOC** auto-generation for >25-page pubs; tables/figures lists; appendices under enclosures.
- Profile import/export; Section 508 pass; PWA offline.
- *Done when:* a non-technical proponent loads an old PDF Pam, converts, reviews flags, and produces a
  compliant publication with a working TOC; an admin can distribute the GLWCH profile JSON.

**Phase 3 — v2 (polish / stretch).**
- Side-by-side legacy↔converted diff view; multiple seals/profiles; print-to-PDF; richer style linting
  (passive voice, serial comma, en-dash); optional batch convert.

---

## 16. HANDOFF BRIEF FOR CODEX / ANTIGRAVITY (paste this as the task)

> Build a static, client-side web app (Vite + React + TypeScript) hosted on GitHub Pages that produces
> **GLWCH (DHA-format) publications** — Regulations and Pamphlets — as downloadable `.docx` files using
> `docx` (docx-js) `Packer.toBlob()`. It has two modes: **Author** (fill labeled section blocks) and
> **Convert** (paste a legacy MEDDAC Pam/Reg, auto-map it into the new structure, apply mandatory verbiage
> swaps, and flag move-impacted procedures). Architecture mirrors the sibling repo **ArmyMemo**
> (`Desktop/Research AI/Army Memo`): UI collects content into a typed **SopSpec** (schema §5); a pure
> `buildDocx(spec): Promise<Blob>` generator (constants §6, DHA numbering §4.6) owns all formatting; a
> validation layer (§10) gates Generate. Enforce the DHA-format rules in §4 (section order, paragraph
> hierarchy, must/will/may-never-shall, references/glossary, style). Implement Convert per §7. Implement
> the **"Ask Dr. Holtkamp SOP Assist"** patch-generator per §8 by copying ArmyMemo's `src/assistant/`
> pattern and pointing at the existing Worker `https://bandaid6.mholtkamp.workers.dev` (Gemini structured
> output; system prompt §8.4; the AI proposes a SopSpec patch, never free-writes the document). Privacy/CSP
> §11 (only network call is the assistant). Repo layout §12, CI to Pages §13, Vitest that unzips the
> `.docx` and asserts XML §14. Deliver in the phases of §15; Phase 1 acceptance is the bar for "working."
> **Read ArmyMemo first and reuse its generator constants, profile system, validation pattern, and
> assistant transport/sanitization code.**

---

## 17. DECISIONS MADE FOR THE PRINCIPAL (override if any are wrong)

1. **Publication identity:** local **GLWCH Regulation + Pamphlet** in DHA format, signed by Hospital
   Commander/Deputy, applicability scoped to GLWCH + clinics; enterprise (DHA/MILDEP/COCOM) content
   localized away. *(You delegated this; rationale in §3.)*
2. **Numbering:** Army functional style `GLWCH Reg/Pam NN-NN`, editable free-text, `[NUMBER]` until
   assigned — not the DHA "XXXX.XX" PSB scheme.
3. **AI assistant:** reuse the existing **bandaid6** Cloudflare Worker (generic Gemini proxy); SOP system
   prompt lives client-side. No new worker.
4. **Legacy ingestion:** paste text in Phase 1; client-side PDF/.docx upload in Phase 2.
5. **Companion artifacts:** Policy Review Checklist + routing email are **not** generated files (you have
   fillable versions). Their criteria power the §10 readiness panel instead. *(Your "SOP document only"
   choice.)*
6. **Hosting:** personal GitHub (`matthewdholtkamp`), Pages, suggested base `/SOP/` — confirm repo name.
7. **Stack:** mirror ArmyMemo (docx 9.x, react 19, zod 4, vite, vitest, vite-plugin-pwa).

*Open items worth a 60-second confirm before the build starts: the exact repo name/base path (item 6);
whether Pamphlets need any rule that differs from Regulations beyond the header label and the
mandatory-language strictness; and whether the default font should match the template's font exactly or
standardize on the hospital's chosen typeface.*
