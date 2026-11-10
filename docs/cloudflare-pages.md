# GitHub und Cloudflare Pages – Veröffentlichungscheckliste

Stand: vorbereitet, **nicht veröffentlicht**. Es existiert noch kein
GitHub-Remote und Cloudflare Pages ist noch nicht eingerichtet.

## 1. Repository

Aktueller Stand:

- Branch: `feat/cloud`
- Letzter Commit: `e778f9e` (A4.1); für A5 kommt ein weiterer lokaler Commit
  hinzu.
- Kein Git-Remote, kein GitHub-Repository, `gh` ist auf dem Rechner nicht
  installiert.
- `main` enthält noch den Stand vor der Cloud-Integration. Für den ersten
  kontrollierten Deploy ist deshalb `feat/cloud` der Produktionsbranch.

Sobald ein GitHub-Konto und eine Anmeldung verfügbar sind:

```bash
# einmalig, interaktiv
gh auth login

# privates Repository anlegen; <GITHUB-OWNER> durch das eigene Konto/Organisation ersetzen
gh repo create <GITHUB-OWNER>/kuechenrunde --private --source=. --remote=origin

# feat/cloud veröffentlichen (kein öffentlicher Push)
git push -u origin feat/cloud
git push -u origin main
```

Alternativ über die GitHub-Weboberfläche ein **privates** Repository
`kuechenrunde` anlegen und das Remote manuell eintragen:

```bash
git remote add origin git@github.com:<GITHUB-OWNER>/kuechenrunde.git
git push -u origin feat/cloud
git push -u origin main
```

Vor dem ersten Push prüfen:

```bash
git status
git log --oneline -5
git ls-files | grep -E '^(\.env|fixtures-private/|backups/)' || true
```

`fixtures-private/`, `.env`, lokale Backups und `.DS_Store` sind gitignored.
Die Git-Historie wurde auf typische Secret-Muster geprüft; es wurden keine
echten service_role-/Secret-Keys, JWTs, Datenbank-URLs oder privaten
Rezeptdateien gefunden. Der alte Legacy-service_role-Key aus dem lokalen
Tool-Protokoll ist **nicht** im Repository.

## 2. Cloudflare Pages

### Projekt anlegen

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Repository `kuechenrunde` auswählen (privat ist in Ordnung).
3. Produktionsbranch für den ersten Deploy: **`feat/cloud`**.
   Nach der Abnahme kann auf `main` gewechselt werden, sobald `feat/cloud`
   dorthin gemerged wurde.
4. Framework-Preset: **Vite** (oder „None“ mit den Werten unten).
5. Build-Befehl: `pnpm build`
6. Ausgabeverzeichnis: `dist`
7. Root-Verzeichnis: `/`
8. Node.js-Version: **22** (`NODE_VERSION=22` als Build-Umgebungsvariable;
   `package.json` verlangt `>=22`).

### Build-Umgebungsvariablen

Diese Werte sind öffentlich und werden in das Browser-Bundle eingebaut:

- `VITE_DATA_MODE=cloud`
- `VITE_SUPABASE_URL=https://<projekt-ref>.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` oder der klassische
  Anon-Key
- `VITE_SOURCE_CODE_URL=https://github.com/<GITHUB-OWNER>/kuechenrunde`
  (für den Quellcode-Link unter „Über Küchenrunde“; beim Release setzen)
- `NODE_VERSION=22`

### Runtime-Umgebungsvariablen der Pages Function

Diese Werte werden **nicht** in das Browser-Bundle eingebaut und nur von
`functions/api/recipe-fetch.ts` gelesen:

- `SUPABASE_URL=https://<projekt-ref>.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` (alternativ
  `SUPABASE_ANON_KEY`)

Für Production und Preview setzen. **Niemals** setzen:

- `SUPABASE_SERVICE_ROLE_KEY`
- `sb_secret_…`
- andere service-role-equivalente Schlüssel

Die Function lehnt solche Schlüssel aktiv ab.

### Vorhandene Konfiguration

- `wrangler.toml` – `pages_build_output_dir = "dist"`,
  `compatibility_date = "2026-11-01"`,
  `compatibility_flags = ["global_fetch_strictly_public"]`
- `public/_routes.json` – nur `/api/recipe-fetch` löst Pages Functions aus;
  statische Assets bleiben Function-frei.
- `public/_headers` – CSP, HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`.
- `functions/api/recipe-fetch.ts` – Same-Origin-API mit Supabase-Token- und
  Haushaltsprüfung.
- PWA: `vite-plugin-pwa` mit `start_url`/`scope` `/` und
  `navigateFallback: /index.html`; `sw.js` wird nicht lange gecacht.

**Wichtig zur Source of Truth:** Sobald `wrangler.toml` ein
`pages_build_output_dir` enthält, gilt die Datei bei Cloudflare Pages als
Source of Truth; dieselben Felder sind im Dashboard dann nicht mehr editierbar.
Die Runtime-Werte der Function (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`)
müssen deshalb als Pages-Variablen/`[vars]` hinterlegt werden. Beide Werte sind
öffentlich und dürfen im Browser-Bundle stehen; service_role-/Secret-Keys
niemals. `VITE_*` bleiben Build-Umgebungsvariablen. Falls die
Dashboard-Konfiguration bevorzugt wird, `pages_build_output_dir` entfernen und
die Pages-Einstellungen im Dashboard pflegen; dann die Compatibility-Flags dort
setzen.

### CSP und Supabase-Domain

Die CSP in `public/_headers` erlaubt Supabase über
`https://*.supabase.co` und `wss://*.supabase.co`. Bei einer eigenen
Supabase-Domain müssen `img-src` und `connect-src` entsprechend ergänzt
werden. `style-src 'unsafe-inline'` ist für React-Inline-Styles nötig;
`script-src` bleibt auf `'self'` beschränkt.

### Erster kontrollierter Deploy

1. Repository privat anlegen und `feat/cloud` pushen (siehe oben).
2. Pages-Projekt verbinden, Produktionsbranch `feat/cloud`, Build wie oben.
3. Build- und Runtime-Variablen setzen; keine Secrets.
4. Deploy starten und Build-Log prüfen (Typecheck, Worker-Typecheck, Vite).
5. `https://<projekt>.pages.dev` öffnen:
   - Login mit einem Familienkonto
   - Rezeptbibliothek und ein Bild laden
   - URL-Import und Mela-Import testen
   - Backup herunterladen
   - Restore nur in einem leeren Testbestand testen
6. In den Cloudflare-Logs prüfen, dass statische Assets keine Function
   auslösen und `/api/recipe-fetch` nur bei Bedarf aufgerufen wird.
7. Erst nach erfolgreicher Abnahme `feat/cloud` nach `main` mergen und den
   Produktionsbranch in Cloudflare auf `main` umstellen.

### Nach dem Deploy manuell prüfen

- Supabase-Auth: Login/Logout, Session-Refresh, Nicht-Mitglied wird abgewiesen.
- URL-Import: öffentliche Rezeptseite, Redirect, private URL wird abgelehnt.
- Mela-Import: Rezept ohne/mit JPEG/PNG-Bild; HEIC wird bewusst übersprungen.
- Cloud-Backup: ZIP herunterladen, außerhalb der App öffnen.
- Cloud-Restore: nur leerer Bestand; bei vorhandenen Daten verweigert.
- Lokaler Modus (`VITE_DATA_MODE=local`) bleibt separat funktionsfähig.
- PWA: Installation/Offline-Shell im lokalen Modus; Cloud-Daten brauchen Netz.

## 3. GitHub-CLI-Status

`gh` ist auf diesem Rechner nicht installiert. Die Repository-Erstellung und
der Push benötigen daher eine der folgenden Benutzeraktionen:

- GitHub CLI installieren und `gh auth login` ausführen, oder
- ein privates Repository über die GitHub-Weboberfläche anlegen und das Remote
  manuell eintragen.

Ohne diese Anmeldung kann kein GitHub-Remote angelegt oder gepusht werden. Es
wurde kein öffentlicher Push durchgeführt.

## 4. Kurzfassung des kürzesten Wegs

1. Privates GitHub-Repository `kuechenrunde` anlegen und `feat/cloud` pushen.
2. In Cloudflare Pages verbinden, Produktionsbranch `feat/cloud`,
   `pnpm build` → `dist`, Node 22.
3. Öffentliche `VITE_*`-Build-Variablen und die beiden `SUPABASE_*`-Runtime-
   Variablen setzen; keine service_role-/Secret-Keys.
4. Deployen, die Smoke-Tests oben ausführen.
5. Danach `feat/cloud` nach `main` mergen und den Produktionsbranch umstellen.
