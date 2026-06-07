# SOP Writer

SOP Writer is a local-first React PWA for creating General Leonard Wood Community Hospital
Regulations and Pamphlets in DHA publication format. Content is structured as a typed `SopSpec`;
the browser-side generator owns the Word formatting and downloads a `.docx` locally.

## Privacy

- No accounts, database, telemetry, or document backend.
- Draft JSON autosave uses this browser's `localStorage`.
- The only runtime network call is the optional Ask Dr. Holtkamp or AI Convert request to the
  existing Cloudflare Worker at `https://bandaid6.mholtkamp.workers.dev`.

## Current Scope

- Author mode for new GLWCH Regulations and Pamphlets.
- AI-powered Convert mode for pasted legacy MEDDAC text, `.docx` uploads, `.txt` uploads, and PDF
  text extraction, with a rough local converter fallback when Gemini is unavailable.
- Deterministic `GLWACH` to `GLWCH` and hospital-name normalization.
- Human-review warnings for `shall` and move-impacted room/location/workflow language.
- Readiness panel based on the provided policy checklist and routing email.
- `.docx` generation with DHA section order, enclosures, references, glossary, and signature block.

## Development

```bash
npm install
npm test
npm run build
npm run dev
```

The Vite production base is `/SOPWriter/` for GitHub project Pages.

## Publication Identity

The app produces local GLWCH publications that adopt the DHA publication format. It does not issue
DHA enterprise guidance, use the DHA PSB numbering scheme, or sign as Director, DHA. Publication
numbers remain editable local GLWCH `Reg`/`Pam` identifiers such as `40-43` or `[NUMBER]` until assigned.
