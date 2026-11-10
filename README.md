# Küchenrunde

**Rezepte · Wochenplan · Einkaufsliste**

Küchenrunde ist eine kostenlose Rezept- und Familien-Einkaufslisten-WebApp.
Sie läuft standardmäßig vollständig lokal im Browser. Optional verbindet der
explizite Cloud-Modus die Familie über Supabase: gemeinsame Rezepte, Bilder,
Wochenplanung, Einkaufslisten und Einstellungen. Es gibt kein Tracking.

## Aktueller Stand

Küchenrunde ist standardmäßig eine **lokale WebApp**. Der Cloud-Modus wird
ausschließlich über `VITE_DATA_MODE=cloud` aktiviert; allein vorhandene
Supabase-Variablen schalten die App nicht um.

Im Cloud-Modus stehen **Anmeldung, Session-Verwaltung, die gemeinsame
Rezeptbibliothek inklusive Bildern, die gemeinsame Wochenplanung, die gemeinsame
Einkaufsliste und der Kochmodus** zur Verfügung. Rezepte lassen sich anlegen,
öffnen, bearbeiten und löschen, Bilder hinzufügen, anzeigen, ersetzen und
entfernen. Der Wochenplan wird weiterhin ausschließlich manuell befüllt; es gibt
keine automatische Planung. Einkäufe bleiben einzelne, revisionsgesicherte
Ereignisse und erscheinen über Supabase Realtime auch in anderen Sitzungen. Die
Bilddateien liegen im privaten Supabase-Storage-Bucket `recipe-images`;
angezeigt werden sie über kurzlebige Signed URLs. Koch-Timer, Wake Lock und der
temporäre Kochfortschritt bleiben bewusst gerätelokal.

Im lokalen Modus bleiben alle Daten in IndexedDB. Es gibt keine automatische
Migration lokaler Bestände in die Cloud und keinen Cloud-Reset.

Details:

- Cloud-Grundlage und RLS: [`supabase/README.md`](supabase/README.md)
- URL-Rezeptimport und Pages Function: [`docs/url-import-cloud.md`](docs/url-import-cloud.md)
- Mela-Import und Cloud-Backup: [`docs/cloud-import-backup.md`](docs/cloud-import-backup.md)
- Cloudflare-Pages-Deployment: [`docs/cloudflare-pages.md`](docs/cloudflare-pages.md)

Cloudflare Pages ist noch nicht eingerichtet; es wurde nichts veröffentlicht.
Der letzte vorbereitete Stand liegt auf `feat/cloud`.

## Funktionen

- Rezeptbibliothek mit Mela-Import und URL-Import (JSON-LD)
- Wochenplanung und Kochmodus mit Timern
- Einkaufslisten mit mehreren Listen, Zuteilungen und Einkäufen
- Backup und Wiederherstellung als ZIP, lokal und im Cloud-Modus
- Offline-Nutzung als PWA im lokalen Modus

## Herkunft und Lizenz

Küchenrunde ist eine eigenständige Weiterentwicklung auf Basis von
[openCook](https://github.com/oliexdev/openCook) von olie.xdev
(Copyright (C) 2026 olie.xdev, GPL-3.0-or-later).

Insbesondere der Wochenplaner, der Reconciler und der Zutatenparser sind
Portierungen aus dem Kotlin-Original. Die React-Oberfläche, die
Dexie-Datenbank, der Mela-Import, der URL-Import und die PWA sind eigenständige
Weiterentwicklungen. Details, betroffene Dateien und Änderungsdatum stehen in
[NOTICE](NOTICE).

Küchenrunde ist **kein offizielles Projekt von openCook** und wird von den
openCook-Autoren nicht unterstützt.

Die App steht unter **GPL-3.0-or-later**. Der vollständige Lizenztext liegt in
[LICENSE](LICENSE). Die im Produktionsbuild ausgelieferten Kopien stehen unter
`public/legal/`.

**Quellcode:** Beim Release wird `VITE_SOURCE_CODE_URL` auf das tatsächliche
öffentliche Repository gesetzt; die App verlinkt es unter „Über Küchenrunde“.
Bis dahin ist der zur ausgelieferten Version gehörende Quellcode auf Anfrage
beim Betreiber erhältlich. Eine noch unbekannte Repository-URL wird nicht
erfunden.

Kostenlos bedeutet nicht „nichtkommerziell“: Die GPLv3 erlaubt auch
kommerzielle Nutzung und Weitergabe durch Dritte. Eine NC-Beschränkung wäre
mit der Lizenz unvereinbar.

## Daten und Backup

Die folgenden internen Kennungen bleiben bei einer Umbenennung absichtlich
stabil, damit bestehende Daten erhalten bleiben:

- IndexedDB-Datenbank: `opencook-web`
- Backup-Format: `opencook-web-backup`
- Koch-Timer in localStorage: `opencook.cookTimers.v1`
- PWA-Start-URL und Scope: `/`

Ein ZIP-Backup enthält Rezepte, Bilder, Wochenpläne, Kochvorgänge,
Einkaufslisten und Einstellungen. Koch-Timer liegen nur im localStorage und
sind nicht im Backup enthalten. Im Cloud-Modus werden Bilder aus dem privaten
Supabase-Storage geladen; eine Wiederherstellung ist nur in einen leeren
Cloud-Bestand möglich und überschreibt keine Familiendaten.

## Entwicklung

```bash
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm typecheck:worker
pnpm build
```

`pnpm typecheck:worker` prüft die Cloudflare-Function isoliert gegen
Web-Standard-Typen (ohne Node-APIs). `pnpm build` führt diesen Check mit aus.
Node.js >= 22 ist erforderlich (`@supabase/supabase-js`).

Für den Produktionsbuild werden die Lizenztexte aus `public/legal/` mit
ausgeliefert. Nach Änderungen an `LICENSE` oder `NOTICE` müssen die Kopien in
`public/legal/` synchron gehalten werden.

## Cloudflare Pages

Die vorbereitete Konfiguration verwendet:

- Build-Befehl `pnpm build`
- Ausgabeverzeichnis `dist`
- Produktionsbranch `feat/cloud` (für den ersten kontrollierten Deploy; danach
  kann auf `main` gewechselt werden)
- Pages Function `functions/api/recipe-fetch.ts`
- `public/_routes.json` für ausschließlich `/api/recipe-fetch`
- `public/_headers` für sichere HTTP-Header
- `wrangler.toml` mit `pages_build_output_dir = "dist"`

Die vollständige Checkliste, Umgebungsvariablen und der kürzeste
Deployment-Weg stehen in [`docs/cloudflare-pages.md`](docs/cloudflare-pages.md).
Die Build-Variablen `VITE_*` sind öffentlich; service_role- und
`sb_secret_`-Schlüssel gehören niemals in den Build oder in den Browser.

## Dritte

- **Open Food Facts** – Zutaten-Taxonomien. Die OFF-Nutzungsbedingungen nennen
  für die Datenbank ODbL 1.0 und für Einzelinhalte DbCL 1.0; der Servercode
  steht unter AGPL-3.0. Die konkrete Lizenzzuordnung der Taxonomiedateien ist
  noch offen und vor einer öffentlichen Veröffentlichung zu klären. Siehe
  [NOTICE](NOTICE) und `docs/ingredient-catalog.md`.
- **einkaufslisten-card** – Kategorienliste, MIT, Copyright (c) 2026
  misterm2310.
- **Supabase** – Auth, PostgreSQL, Realtime und Storage im Cloud-Modus. Das
  JavaScript-SDK und seine Laufzeitabhängigkeiten stehen unter MIT bzw. 0BSD;
  die vollständigen Texte stehen in `public/legal/THIRD-PARTY-LICENSES.txt`.
- **Laufzeitbibliotheken** – React, React DOM, scheduler, Dexie,
  dexie-react-hooks, DOMPurify, fflate, marked und workbox-window. Die
  vollständigen Texte stehen in `public/legal/THIRD-PARTY-LICENSES.txt`.

## Keine Gewährleistung

Küchenrunde wird ohne jede Gewährleistung bereitgestellt, soweit dies die
Lizenz zulässt. Einzelheiten regelt die GPL-3.0-or-later; siehe
[LICENSE](LICENSE).
