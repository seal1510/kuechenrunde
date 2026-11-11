# Cloudflare Pages – Deployment und Betrieb

Stand: **veröffentlicht** (Produktion auf `main`).

- Produktions-URL: <https://kuechenrunde.pages.dev>
- Eigene Domain: <https://kuechenrunde.com>
- Cloudflare-Pages-Projekt: `kuechenrunde`
- Produktionsbranch: `main`
- Build: `pnpm build` → `dist`
- Node.js: `>= 22` (`package.json`, `.nvmrc`)

Ein Push auf `main` löst über die bestehende Git-Integration einen neuen
Produktions-Deploy aus. `wrangler.toml` ist dabei die maßgebliche
Pages-Konfiguration (Source of Truth); deshalb stehen Bindings und
Kompatibilitätsoptionen im Repository und nicht nur im Dashboard.

## Pages Functions

| Route | Datei | Zweck |
| --- | --- | --- |
| `POST /api/recipe-fetch` | `functions/api/recipe-fetch.ts` | URL-Rezeptimport (JSON-LD) |
| `POST /api/recipe-ocr` | `functions/api/recipe-ocr.ts` | Foto-/Scan-Erkennung über Workers AI |

Beide Routen sind ausschließlich in `public/_routes.json` eingetragen; statische
Assets lösen keine Function aus. Beide Endpunkte verlangen ein gültiges
Supabase-Access-Token **und** die Mitgliedschaft im Familienhaushalt
(`public.is_household_member()`), sind same-origin-only und liefern keine
CORS-Header.

## Workers-AI-Binding

`wrangler.toml` bindet Workers AI:

```toml
[ai]
binding = "AI"
```

Die Foto-Erkennung ruft damit serverseitig
`@cf/google/gemma-4-26b-a4b-it` auf (`env.AI.run(...)`). Der Denkmodus des
Reasoning-Modells wird dabei über `chat_template_kwargs` abgeschaltet, damit
direkt das JSON-Rezept zurückkommt. Der Browser
spricht **nie** direkt mit Cloudflare Workers AI und enthält keine
Cloudflare-Zugangsdaten.

Voraussetzungen im Cloudflare-Konto:

1. Workers AI ist für das Konto verfügbar (Free-Tier genügt).
2. Die Modellbedingungen von Google Gemma 4 wurden im Dashboard einmalig
   akzeptiert. Fehlt die Zustimmung, antwortet `/api/recipe-ocr` mit
   `503 not-configured` und einem verständlichen Hinweis; es wird **kein
   Tarifwechsel** ausgelöst.
3. Das Free-Tier umfasst **10.000 Neuronen pro Tag** (Reset 00:00 UTC). Ist das
   Kontingent erschöpft, liefert die Function `429 quota-exhausted` mit einer
   verständlichen Meldung; es entstehen keine Kosten und es gibt keinen
   automatischen Upgrade.

Falls ein Deployment das AI-Binding nicht übernimmt, kann es im Dashboard unter
**Workers & Pages → kuechenrunde → Settings → Bindings** als
„Workers AI“-Binding mit dem Variablennamen `AI` ergänzt werden; danach ist ein
neuer Deploy nötig. `wrangler` wird für den regulären Deploy nicht benötigt.

## Build-Umgebungsvariablen (öffentlich)

Diese Werte landen im Browser-Bundle und sind keine Secrets:

- `VITE_DATA_MODE=cloud`
- `VITE_SUPABASE_URL=https://<projekt-ref>.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` (oder klassischer Anon-Key)
- `VITE_SOURCE_CODE_URL=https://github.com/<GITHUB-OWNER>/kuechenrunde`
- `NODE_VERSION=22`

## Runtime-Umgebungsvariablen der Pages Functions

Nur serverseitig, nicht `VITE_*`, nicht im Browser-Bundle:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (alternativ `SUPABASE_ANON_KEY`)

**Niemals** setzen: `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_…` oder andere
service-role-equivalente Schlüssel. `functions/lib/supabase-auth.ts` lehnt
solche Keys aktiv ab.

## Sicherheits-Header

`public/_headers` enthält CSP, HSTS, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` und
`Cross-Origin-Opener-Policy`. Die CSP erlaubt Supabase über
`https://*.supabase.co` und `wss://*.supabase.co`; bei einer eigenen
Supabase-Domain müssen `img-src`/`connect-src` ergänzt werden.
`script-src` bleibt auf `'self'` beschränkt (kein `unsafe-eval`); die optionale
PDF-Bibliothek wird als eigener same-origin Chunk geladen.

> Hinweis: `Permissions-Policy: camera=()` betrifft nur die eingebettete Seite.
> Für „Foto aufnehmen“ nutzt Küchenrunde das native
> `<input type="file" capture="environment">`; dafür ist keine
> Kamera-Berechtigung per `getUserMedia` nötig.

## Deployment prüfen

Nach einem Push auf `main`:

```bash
# Build-Status im Dashboard bzw. über die Deployments-Liste prüfen
# https://dash.cloudflare.com → Workers & Pages → kuechenrunde

curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  https://kuechenrunde.pages.dev/api/recipe-ocr
# erwartet: 401 (Route vorhanden, Anmeldung fehlt) – nicht 404/405
```

Weitere Smoke-Tests:

1. Ohne Anmeldung `POST /api/recipe-ocr` → 401; mit gültigem Token, aber ohne
   Haushaltsmitgliedschaft → 403.
2. Im Cloud-Modus unter **Import → Foto / Scan** ein gedrucktes und ein
   handschriftliches Rezept erkennen; Vorschau im Editor prüfen.
3. Unleserliche Stelle → erscheint als Hinweis; gespeichert wird erst nach
   Bestätigung.
4. Drei bis vier Seiten in einer Erkennung testen; bei Fehler `timeout`/`busy`
   mit weniger Seiten wiederholen.
5. Kontingent-Test ist nur kontrolliert sinnvoll (verbraucht das Tagesbudget);
   die Fehlerabbildung ist durch Tests abgedeckt.
6. Statische Assets in den Logs prüfen: keine Function-Aufrufe; keine Tokens,
   Fotos oder Rezeptinhalte in Logs.

## Quellen und Grenzen

- Pages-Functions-Routing und Bindings:
  <https://developers.cloudflare.com/pages/functions/bindings/>
- Workers AI Preise/Free-Tier:
  <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Workers AI Fehlercodes:
  <https://developers.cloudflare.com/workers-ai/platform/errors/>
- Fotoimport-Architektur, Kosten und iPhone-Anleitung:
  [`docs/photo-import.md`](photo-import.md)
- Live-Erkennungstestergebnisse:
  [`docs/photo-ocr-test-results.md`](photo-ocr-test-results.md)

Die Rate-Limits der Functions (pro IP und pro Mitglied) leben isolate-lokal und
sind eine Missbrauchsbremse, keine globale Garantie. Workers AI hat zusätzlich
eigene Kontingente und Rate-Limits.
