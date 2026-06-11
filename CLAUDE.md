# Grocery Pantry

A barcode-scanning pantry tracker. The phone-facing scanner is a PWA hosted on
GitHub Pages; inventory lives in Supabase Postgres. Claude Code sessions act as
the AI layer on top (recipes, grocery lists, etc.).

## Acting as the pantry agent

Credentials are in `.env` (SUPABASE_URL, SUPABASE_ANON_KEY, PANTRY_KEY). Every
request needs the `x-pantry-key` header — RLS rejects reads and writes without
it. Query the inventory over the REST API:

```bash
source .env
# everything currently in the pantry
curl -s "$SUPABASE_URL/rest/v1/pantry_items?consumed_at=is.null&select=name,brand,category,quantity,unit,added_at&order=added_at.desc" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "x-pantry-key: $PANTRY_KEY"
```

Conventions:
- `consumed_at IS NULL` = item is in stock. To mark something used up, PATCH `consumed_at` to now.
- `raw` holds the full Open Food Facts payload (nutrition, ingredients, categories) — use it for dietary questions.
- Items with `name IS NULL` are unresolved barcodes; offer to identify them.
- Writes (insert/update) via the same REST API are fine — the anon key plus the `x-pantry-key` header has full access to `pantry_items`.
- The passphrase lives in `private.config` (DB) and `.env` (local); it is never committed. To rotate it: `npx supabase db query --linked "update private.config set value = '<new>' where key = 'pantry_key'"`, update `.env`, re-enter on devices.

Typical asks: "what can I cook tonight" (recipes from in-stock items, flag the 1-2
missing ingredients), "make a grocery list" (staples that are low/absent based on
history of consumed items), "what's about to be useless" (perishables by added_at age).

## Architecture

- `web/` — vanilla JS PWA (no build step, deps from esm.sh): continuous camera
  scanning via the barcode-detector ponyfill (zxing-wasm), Open Food Facts lookup,
  direct Supabase writes. Manual-add path for produce without barcodes.
  `web/config.js` and `web/icon.png` are generated at deploy time (see the
  GitHub Actions workflow); the Supabase key lives in repo Actions secrets,
  never in git.
- `supabase/migrations/` — schema. Single `pantry_items` table, RLS open to anon
  (single-user, low-stakes data).
- Serving the PWA from Supabase itself does NOT work: `*.supabase.co` rewrites
  HTML to text/plain + sandbox CSP for browser navigations on the free tier.

## Workflows

- Deploy app changes: push to `main` (`npm run deploy`); GitHub Actions publishes
  `web/` to Pages.
- Schema changes: new file in `supabase/migrations/`, then `npx supabase db push`.
