# Küchenrunde

**Rezepte · Wochenplan · Einkaufsliste**

Küchenrunde ist eine kostenlose Rezept- und Familien-Einkaufslisten-WebApp.
Standardmäßig läuft sie vollständig lokal: Rezepte, Wochenplan, Einkaufslisten
und Einstellungen bleiben im Browser (IndexedDB). Ein expliziter Cloud-Modus
mit Supabase befindet sich in Vorbereitung. Es gibt kein Tracking.

## Aktueller Entwicklungsstand

Küchenrunde ist standardmäßig weiterhin eine **lokale WebApp**. Der Cloud-Modus
wird ausschließlich über `VITE_DATA_MODE=cloud` aktiviert; allein vorhandene
Supabase-Variablen schalten die App nicht um.

Im Cloud-Modus stehen **Anmeldung, Session-Verwaltung, die gemeinsame
Rezeptbibliothek inklusive Bildern, die gemeinsame Wochenplanung und die
gemeinsame Einkaufsliste** zur Verfügung: Rezepte lassen sich anlegen, öffnen,
bearbeiten und löschen, Bilder hinzufügen, anzeigen, ersetzen und entfernen. Der
Wochenplan wird weiterhin ausschließlich manuell befüllt; es gibt keine
automatische Planung. Einkäufe bleiben einzelne, revisionsgesicherte Ereignisse
und erscheinen über Supabase Realtime auch in anderen Sitzungen. Die Bilddateien
liegen im privaten Supabase-Storage-Bucket `recipe-images`; angezeigt werden
sie über kurzlebige Signed URLs. Der Kochmodus ist noch **nicht** angebunden;
lokale Dexie-Daten werden dort nicht als Cloud-Bestand angezeigt.

Details zur Cloud-Grundlage stehen in [`supabase/README.md`](supabase/README.md).

## Funktionen

- Rezeptbibliothek mit Mela-Import
- Import von Rezepten aus Webseiten (JSON-LD)
- Wochenplanung und Kochmodus mit Timern
- Einkaufslisten mit mehreren Listen, Zuteilungen und Einkäufen
- Backup und Wiederherstellung als ZIP
- Offline-Nutzung als PWA

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

**Quellcode:** Die öffentliche Repository-URL wird vor der Veröffentlichung
festgelegt und hier sowie in der App unter „Über Küchenrunde“ eingetragen.
Bis dahin ist der zur ausgelieferten Version gehörende Quellcode auf Anfrage
beim Betreiber erhältlich.

Kostenlos bedeutet nicht „nichtkommerziell“: Die GPLv3 erlaubt auch
kommerzielle Nutzung und Weitergabe durch Dritte. Eine NC-Beschränkung wäre
mit der Lizenz unvereinbar.

## Daten und Backup

Alles bleibt lokal im Browser. Die folgenden internen Kennungen bleiben bei
einer Umbenennung absichtlich stabil, damit bestehende Daten erhalten bleiben:

- IndexedDB-Datenbank: `opencook-web`
- Backup-Format: `opencook-web-backup`
- Koch-Timer in localStorage: `opencook.cookTimers.v1`
- PWA-Start-URL und Scope: `/`

Ein ZIP-Backup enthält Rezepte, Bilder, Wochenpläne, Kochvorgänge,
Einkaufslisten und Einstellungen. Koch-Timer liegen nur im localStorage und
sind nicht im Backup enthalten.

## Entwicklung

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

Für den Produktionsbuild werden die Lizenztexte aus `public/legal/` mit
ausgeliefert. Nach Änderungen an `LICENSE` oder `NOTICE` müssen die Kopien in
`public/legal/` synchron gehalten werden.

## Dritte

- **Open Food Facts** – Zutaten-Taxonomien. Die OFF-Nutzungsbedingungen nennen
  für die Datenbank ODbL 1.0 und für Einzelinhalte DbCL 1.0; der Servercode
  steht unter AGPL-3.0. Die konkrete Lizenzzuordnung der Taxonomiedateien ist
  noch offen und vor einer öffentlichen Veröffentlichung zu klären. Siehe
  [NOTICE](NOTICE) und `docs/ingredient-catalog.md`.
- **einkaufslisten-card** – Kategorienliste, MIT, Copyright (c) 2026
  misterm2310.
- **Laufzeitbibliotheken** – React, React DOM, scheduler, Dexie,
  dexie-react-hooks, DOMPurify, fflate, marked und workbox-window. Die
  vollständigen Texte stehen in `public/legal/THIRD-PARTY-LICENSES.txt`.

## Keine Gewährleistung

Küchenrunde wird ohne jede Gewährleistung bereitgestellt, soweit dies die
Lizenz zulässt. Einzelheiten regelt die GPL-3.0-or-later; siehe
[LICENSE](LICENSE).
