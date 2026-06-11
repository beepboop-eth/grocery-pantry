# Grocery Pantry

Scan groceries with your iPhone → inventory in Supabase → ask Claude for recipes
and grocery lists.

## How it works

```
iPhone camera (PWA in Safari, added to home screen, hosted on GitHub Pages)
  └─ barcode-detector ponyfill (zxing-wasm) decodes EAN/UPC continuously
  └─ Open Food Facts API resolves barcode → product name/brand/category
  └─ row written to Supabase Postgres (pantry_items) via REST

Claude Code / claude.ai sit on the database as the AI layer.
```

Note: the PWA can't be served from Supabase itself — `*.supabase.co` refuses to
render HTML to browsers on the free tier (anti-phishing measure; custom domains
are a paid add-on). Hence GitHub Pages, with the Supabase key injected from a
repo secret at deploy time so it never lands in git.

## One-time setup

1. Create a free Supabase project; put `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   (publishable key) and `SUPABASE_DB_PASSWORD` in `.env` (see `.env.example`).
2. `npx supabase login && npx supabase link --project-ref <ref>`
3. `npx supabase db push` — creates the `pantry_items` table.
4. Create a public GitHub repo, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` as
   Actions secrets, enable Pages with source "GitHub Actions", push `main`.
5. On your iPhone, open the Pages URL in Safari → Share → **Add to Home Screen**.

## Daily use

First launch asks for the pantry passphrase (checked server-side by RLS,
remembered per device). Then: tap the Pantry icon → Start scanning → point at
barcodes. Re-scanning the same
product bumps quantity. `+ no barcode` for produce. Pantry tab to see stock and
tick off items you've used up.

## AI layer

- **Claude Code:** open a session in this directory and ask ("what can I cook?").
  `CLAUDE.md` teaches it the schema and API.
- **Phone:** connect the official Supabase MCP server to claude.ai as a connector.
- **Digest:** schedule a recurring Claude routine that queries the DB and sends
  recipe ideas / a restock list.
