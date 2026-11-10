# URL-Rezeptimport auf Cloudflare Pages

Stand: vorbereitet, **nicht veröffentlicht**. Cloudflare Pages ist noch nicht
eingerichtet; es gibt keinen live getesteten produktiven Endpunkt.

## Ablauf

```
Browser (Cloud-Modus)
  └─ POST /api/recipe-fetch  (same-origin, Bearer-Token)
       └─ Cloudflare Pages Function
            ├─ Supabase /auth/v1/user            (Token prüfen)
            ├─ RPC is_household_member()          (Mitgliedschaft prüfen)
            ├─ gemeinsame URL-/SSRF-Regeln
            ├─ fremde Seite holen (manuelle Redirects, Limits)
            ├─ vorhandener JSON-LD-Parser
            └─ strukturierte Kandidaten (kein rohes HTML) zurück
  └─ vorhandene Importvorschau (RecipeForm)
       └─ vorhandener CloudRecipeImageService
            ├─ Bilder in den privaten Bucket recipe-images
            └─ Rezept + Bild-Metadaten atomar über apply_ops()
```

Der lokale Pfad bleibt unverändert: Die Vite-Middleware
`server/recipe-fetch-plugin.ts` ruft weiterhin `server/recipe-fetcher.ts` mit
DNS-Pinning auf. Der Browser spricht in beiden Modi nur mit dem eigenen
Endpunkt.

## Wiederverwendete Komponenten

- `src/import/jsonld.ts` – JSON-LD-/schema.org-Auswertung, Zutaten- und
  Mengenverarbeitung.
- `src/import/ingredients.ts`, `src/import/url.ts` – bestehende Parser- und
  URL-Logik.
- `src/pages/UrlImportPage.tsx` – Vorschau, Bearbeitung, Dublettenhinweis und
  Bestätigung; im Cloud-Modus nur mit Cloud-Fetcher, Cloud-Dublettenprüfung und
  Cloud-Speicherfunktion injiziert.
- `src/import/url-import.ts` – `buildUrlRecipe`, Import-Metadaten und
  Dublettenregeln (jetzt zusätzlich als reine Funktion für einen vorhandenen
  Rezept-Snapshot).
- `src/data/cloudRecipes.ts`, `src/data/cloudImages.ts` – bestehende
  Supabase-Persistenz inklusive Bild-Upload und atomarem `apply_ops`.
- `src/import/remote-url-policy.ts` – gemeinsame URL-, IP-, Content-Type- und
  Grenzregeln für Node und Workers.

## Zugriffsschutz

- Nur `POST`, `Content-Type: application/json`, same-origin; keine CORS-Header.
- Bearer-Token aus `Authorization`; Prüfung über Supabase Auth
  (`GET /auth/v1/user`).
- Mitgliedschaft über die vorhandene SECURITY-INVOKER-Funktion
  `public.is_household_member()` per PostgREST-RPC.
- Fehlender/ungültiger Token → 401; gültiger Token ohne Mitgliedschaft → 403.
- Ausschließlich der öffentliche Publishable-/Anon-Key als `apikey`.
  `sb_secret_…`- und service_role-Schlüssel werden aktiv abgelehnt.
- Der Token wird nie an die Rezeptwebsite weitergegeben, nie geloggt und nie in
  eine Antwort aufgenommen.
- Rate-Limits: 30 Anfragen/Minute pro IP, 60 Anfragen/Minute pro Mitglied.
  Die Zähler leben pro Workers-Isolate (kein KV/Durable Object); sie sind eine
  Missbrauchsbremse, keine globale Garantie.
- Request-Body maximal 16 KiB; HTML maximal 5 MiB; Bilder maximal 8 MiB;
  Timeout 15 s; höchstens 5 Redirects (Bilder: 3).

## URL- und SSRF-Schutz

Gemeinsame Regeln in `src/import/remote-url-policy.ts`:

- nur `http:`/`https:`, keine URL-Zugangsdaten, maximal 2048 Zeichen;
- nur Port 80/443; im Cloud-Pfad zusätzlich nur der zum Schema passende Port;
- keine IP-Literale im Cloud-Pfad (auch keine öffentlichen);
- keine lokalen/internen/reservierten Namen (`localhost`, `.local`, `.internal`,
  `.lan`, `.home.arpa`, `.onion`, `.test`, `.example`, …);
- keine Wildcard-DNS-Dienste, die private IPs aus dem Namen ableiten
  (`nip.io`, `sslip.io`, `xip.io`, `localtest.me`, `lvh.me`, `vcap.me`,
  `traefik.me`, `local.gd`);
- private, reservierte, Link-Local-, Multicast-, Dokumentations- und
  IPv4-gemappte IPv6-Bereiche werden abgelehnt;
- jede Weiterleitung wird relativ aufgelöst und **vollständig neu** geprüft;
- Antworten werden erst nach Status- und Content-Type-Prüfung gelesen; die
  Größenbegrenzung greift zusätzlich beim Streamen (auch gegen
  Dekompressionsbomben).

Der Cloud-Pfad sendet ausschließlich `User-Agent`, `Accept`,
`Accept-Language` und `Cache-Control`. Es werden keine eingehenden Cookies,
Authorization-, Referer- oder Origin-Header übernommen.

Rohes fremdes HTML wird nicht an den Browser zurückgegeben. Die Function liefert
nur die vom vorhandenen Parser erzeugten Rezeptkandidaten (inklusive der
begrenzten JSON-LD-Rohdaten für den bestehenden Import-Metadatenpfad).

### Verbleibende Grenze: kein DNS-Pinning

Der Node-Pfad löst DNS auf, verwirft jede private Antwort und pinnt eine
geprüfte Adresse in den Socket-Lookup. Cloudflare Workers bietet diesen
Mechanismus für `fetch()` nicht. Eine vorgelagerte DNS-over-HTTPS-Prüfung würde
ein DNS-Rebinding zwischen Prüfung und Abruf nicht verhindern; sie wird deshalb
nicht als Sicherheitsgarantie eingesetzt.

Der Cloud-Pfad verlässt sich für die Netzwerkgrenze auf Cloudflares öffentliches
Egress. Private/VPC-Ziele erfordern eine explizite VPC-Bindung, die dieses
Projekt nicht konfiguriert. Zusätzlich ist `global_fetch_strictly_public`
gesetzt. Ein DNS-Rebinding gegen einen zunächst öffentlich aufgelösten Namen ist
aus Anwendungscode nicht vollständig ausschließbar. Diese Grenze ist bewusst
dokumentiert und wird **nicht** als gleichwertig zum Node-DNS-Pinning
behauptet.

## Cloudflare-Konfiguration

- `functions/api/recipe-fetch.ts` – Pages Function (`onRequest`).
- `functions/lib/remote-fetch.ts` – begrenzter Abruf mit manuellen Redirects.
- `functions/lib/supabase-auth.ts` – Token- und Mitgliedschaftsprüfung.
- `functions/lib/http.ts` – JSON-/Body-/Origin-Helfer.
- `public/_routes.json` – nur `/api/recipe-fetch` löst Functions aus.
- `wrangler.toml` – `pages_build_output_dir = "dist"`,
  `compatibility_date`, `global_fetch_strictly_public`.
- `functions/tsconfig.json` – eigener Typecheck mit Web-Standard-Typen
  (`types: []`, kein Node-API); `pnpm typecheck:worker`.

### Umgebungsvariablen

Build-Zeit (öffentlich, landen im Browser-Bundle):

- `VITE_DATA_MODE=cloud`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Runtime der Pages Function (nicht `VITE_*`, nicht im Browser-Bundle):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (alternativ `SUPABASE_ANON_KEY`)

Niemals setzen: `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_…` oder andere
service-role-equivalente Schlüssel. Die Function lehnt sie ab.

### Build

```bash
pnpm install
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
```

Cloudflare Pages: Build-Befehl `pnpm build`, Ausgabeverzeichnis `dist`.
Node.js >= 22 ist wegen `@supabase/supabase-js` erforderlich.

## Noch nicht live getestet

- Kein Cloudflare-Pages-Projekt, keine Veröffentlichung, kein produktiver
  Endpunkt.
- Keine echte Pages-Function-Ausführung mit Cloudflare-Runtime; der Code ist
  statisch für die Web-Standard-Runtime typgeprüft und mit gemockten
  Fetch-/Auth-Aufrufen unit-getestet.
- Keine echte Supabase-Token-/Mitgliedschaftsprüfung aus einer Pages Function.
- Kein echter Abruf über Cloudflares Egress, kein reales DNS-Verhalten, keine
  realen Redirects externer Rezeptseiten.
- Kein echter Bild-Upload aus einem Cloud-Import in den Supabase-Bucket.
- Kein `wrangler pages dev` (bewusst nicht gestartet).

## Manuelle Tests nach dem Deployment

1. Ohne Anmeldung `POST /api/recipe-fetch` → 401, kein externer Abruf.
2. Mit gültigem Token, aber ohne `household_members`-Eintrag → 403.
3. Mit Familienmitglied: bekannte Rezept-URL mit JSON-LD importieren, Vorschau
   prüfen, speichern, Rezept in einem zweiten Browser-Tab sehen.
4. Import mit Bild: Bild erscheint nach dem Speichern über Signed URL.
5. Dieselbe URL und dasselbe JSON-LD-Rezept erneut importieren → exakter
   Dublettenhinweis; erst nach Bestätigung entsteht eine zweite Kopie.
6. URL auf `http://127.0.0.1`, `http://169.254.169.254` oder `*.nip.io` → 400,
   kein externer Abruf.
7. Öffentliche URL, die per Redirect auf ein privates Ziel zeigt → Abbruch.
8. Seite über 5 MiB bzw. Bild über 8 MiB → 413.
9. Viele Anfragen in einer Minute → 429.
10. Seite ohne JSON-LD → 200 mit null Kandidaten und Hinweis; kein geratenes
    Rezept.
11. Lokaler Modus (`pnpm dev`, `VITE_DATA_MODE=local`): URL-Import funktioniert
    unverändert über die Vite-Middleware.
12. In den Cloudflare-Logs prüfen, dass statische Assets keine Function
    auslösen und keine Tokens/URLs in Fehlermeldungen auftauchen.
13. In Supabase prüfen, dass der Import nur `records`-Zeilen und
    `recipe-images`-Objekte des Haushalts erzeugt.

## Verbleibende Voraussetzungen für die Veröffentlichung

- Cloudflare-Pages-Projekt mit dem Repository verbinden.
- Build-Befehl `pnpm build`, Ausgabeverzeichnis `dist`, Node.js >= 22.
- `VITE_DATA_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` als
  Build-Umgebungsvariablen setzen.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` als Runtime-Umgebungsvariablen der
  Pages Function setzen.
- Keine Secrets im Repository oder im Browser-Bundle.
- Nach dem Deployment die oben genannten manuellen Tests durchführen.
