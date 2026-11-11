# Foto-/Scan-Import für Papierrezepte

Stand: implementiert und veröffentlicht.

Dieses Dokument beschreibt den Foto-/Scan-Import im Cloud-Modus von
Küchenrunde: Architektur, Erkennungstechnologie, Datenschutz, Kosten, Grenzen
und die Benutzung auf dem iPhone.

## Ziel und Ablauf

Gedruckte und handschriftliche Familienrezepte sollen mit möglichst wenigen
Fotos und Korrekturen in der gemeinsamen Rezeptbibliothek landen – ohne
laufende Fixkosten.

```
Browser (Cloud-Modus, angemeldetes Haushaltsmitglied)
  ├─ Kamera / Fotomediathek / Dateien / PDF
  ├─ Bildaufbereitung im Browser (verkleinern, JPEG, Größenbudget)
  └─ POST /api/recipe-ocr  (same-origin, Bearer-Token, 1–4 Seiten)
       └─ Cloudflare Pages Function
            ├─ Supabase-Token prüfen (Auth) + is_household_member() prüfen
            ├─ IP-/Nutzer-Rate-Limit, Größen-/Format-/Magic-Byte-Prüfung
            ├─ Workers AI: @cf/google/gemma-4-26b-a4b-it (Vision, Denkmodus aus)
            ├─ Modellantwort: JSON extrahieren + strikt validieren
            └─ strukturiertes Rezept + Warnungen/Unklarheiten zurück
  └─ vorhandener Rezepteditor (RecipeForm) mit allen Korrekturmöglichkeiten
       └─ Speichern erst nach ausdrücklicher Bestätigung
            └─ vorhandene Cloud-Bildpipeline (CloudRecipeImageService.saveRecipeImages)
```

Es gibt **keine zweite Rezeptdatenstruktur**: Die validierte KI-Antwort wird
in den bestehenden `RecipeDraft` abgebildet, im vorhandenen `RecipeForm`
bearbeitet und über `buildRecipeFromDraft` + die bestehende Cloud-Persistenz
gespeichert (`importSource: 'photo'`, Rohmetadaten in `raw`).

## Erkennungstechnologie

- Modell: `@cf/google/gemma-4-26b-a4b-it` (Google Gemma 4, Vision,
  26B-Mixture-of-Experts mit 4B aktiven Parametern).
- Denkmodus aus: Gemma 4 ist ein Reasoning-Modell. Mit
  `chat_template_kwargs: { enable_thinking: false, thinking: false }` liefert
  es direkt JSON; ohne diese Option verbraucht der Denktext das Tokenbudget,
  und die eigentliche Antwort kommt abgeschnitten oder gar nicht an.
- Ausgabelimit: `max_completion_tokens: 6144` (Gemma-Doku; `max_tokens` ist
  dort veraltet). Eine abgeschnittene Generierung (`finish_reason: length`)
  wird erkannt und mit einer eigenen Meldung beantwortet, nicht als
  generischer Formatfehler.
- Aufruf: ausschließlich serverseitig über das Workers-AI-Binding
  (`env.AI.run`) der Pages Function; gebunden in `wrangler.toml` (`[ai]`).
- Zwei getrennte Aufgaben, wie im echten Familienrezept-Test begründet:
  1. **Erkennung** (1 Aufruf, mit allen Seitenbildern): Transkription,
     Zutaten, Mengen, Gruppen, vorläufige Schritte.
  2. **Aufbereitung der Zubereitung** (1 text-only Aufruf, nur wenn eine
     Transkription vorliegt): Aus Transkription + validierter Zutatenliste
     werden verständliche, vollständige Schritte gebaut. Die fragmentierten
     Erkennungsschritte gehen dabei bewusst **nicht** ein, weil sie die
     Formulierung im Test verschlechtert haben.
  Die Seiten werden in der vom Nutzer festgelegten Reihenfolge als ein Rezept
  zusammengeführt.
- Kein automatischer Modell-Fallback und keine kostenpflichtige Alternative im
  Code. Schlägt die Erkennung fehl oder ist das Tageskontingent erschöpft,
  erscheint eine verständliche Meldung samt manuellem Fallback.
- Das Modell erhält die Bilder als Base64-Data-URLs zusammen mit einem
  deutschen System-Prompt. Der Prompt verlangt zuerst eine originalgetreue
  zeilenweise Transkription in ein Zwischenfeld (`transcription`, wird vom
  Editor verworfen) und danach die Strukturierung: vollständige Übernahme
  jeder Zutatenzeile, Trennung von Zutaten- und Handlungszeilen (Zeilen mit
  „+“, „→“ oder Imperativ sind Zubereitungsschritte), exakte Wortwiedergabe
  ohne „Verbesserung“ ähnlicher Wörter, vollständige Brüche („1½“ ist
  eins-einhalb) und sichtbare Zutatengruppen.
- Der Aufbereitungs-Prompt arbeitet nur mit der Transkription und der
  Zutatenliste. Er verlangt vollständige Sätze mit Objekt (keine
  „Marinieren.“-Fragmente), verbindet zusammengehörige Kurznotizen, behält
  die Originalreihenfolge (jeder Schritt nennt seine Quellzeilen, der Server
  sortiert danach) und ergänzt einen fehlenden Schritt nur dann aus dem
  Ablauf, wenn eine Zutat vorbereitet und beiseitegestellt wurde (dann
  `uncertain=true`). Erfinden von Mengen, Temperaturen, Garzeiten oder
  Zutaten ist verboten; unleserliche Stellen werden als unsicher markiert.
  Der Aufbereitungsaufruf nutzt zusätzlich `response_format: { type:
  'json_object' }` und ein deterministisches Plausibilitätsgate: Liefert das
  Modell nur einen einzelnen falschen Satz, Duplikate, eine Schleife oder
  deutlich weniger Schritte als die Erkennung, wird die Antwort verworfen.
  Schlägt der zweite Aufruf fehl (Format, Plausibilität, Netzwerk, Kontingent),
  bleibt der Import mit den erkannten Schritten nutzbar und zeigt einen
  deutlichen Warnhinweis.
- Nach Erkennung und Aufbereitung laufen deterministische Zusatzprüfungen auf
  dem Server: doppelte Zutatennamen mit unterschiedlichen Mengen werden als
  unklar markiert (typisch für durchgestrichene Korrekturen),
  zusammengeschriebene bekannte Einheiten („2 EL“) werden wieder in Menge und
  Einheit getrennt, verworfene Zutaten-/Schrittzeilen und leere Listen
  erzeugen sichtbare Warnungen, und offensichtlich vermischte Zeilen (Zutat
  klingt wie Handlung bzw. Schritt wie Zutatenzeile) werden markiert. Alles
  erfindet nichts und löscht nichts automatisch.

### Modellvergleich und Entscheidung

Nachdem die Erkennung an einem **echten handschriftlichen Familienrezept**
inhaltlich scheiterte, wurden auf demselben Originalfoto drei Workers-AI-Modelle
mit identischem Prompt verglichen: Llama 4 Scout (bisher), Gemma 4 (neu im
Einsatz) und Moondream 3.1. Zusätzlich wurde der Prompt gezielt überarbeitet
(Transkription, Vollständigkeit, Schichtgrenze Zutaten/Zubereitung, exakte
Wortwiedergabe, Brüche).

Ergebnis (Details und Messwerte in
[`docs/photo-ocr-test-results.md`](photo-ocr-test-results.md)):

- **Llama 4 Scout** ließ auch mit verbessertem Prompt kurze Zutatenzeilen aus,
  verfremdete Wörter, ordnete keine Gruppen zu und erzeugte Sammel-Schritte;
  der alte Prompt erzeugte zusätzlich riesige Schrittblöcke.
- **Gemma 4** erkannte mit demselben Foto alle Zutatenzeilen, die sichtbaren
  Gruppen und die vollständige Mengenangabe (einschließlich „1½“); Zutaten und
  Zubereitung blieben getrennt, unsichere Stellen wurden markiert. Es ist
  zugleich deutlich günstiger pro Token als Llama 4 Scout.
- **Moondream 3.1** lieferte über die dokumentierte Workers-AI-REST-Schnittstelle
  in diesem Konto nur leere Ergebnisse (`result: {}`) – unabhängig von
  Data-URI, rohem Base64 oder öffentlicher Bild-URL und ohne Fehlermeldung.
  Das Modell ist damit derzeit nicht belastbar einsetzbar.
- **Gemini 3.1 Flash-Lite** wurde **nicht** aktiviert: kostenpflichtiger
  Drittanbieter, eigene Datenverarbeitung, und nach dem Gemma-Ergebnis kein
  belegter Bedarf. Er bleibt der nächste Kandidat, falls sich der Engpass bei
  weiteren echten Handschriften bestätigt.

## Strukturierte Ausgabe und Validierung

Der Server verlangt vom Modell ein JSON-Objekt (Details:
`src/import/photo-ocr.ts`) mit:

- `title`, `description`, `servingsText`, `prepTime`, `cookTime`, `totalTime`,
  `notes`
- `ingredients[]` mit `group`, `quantity`, `unit`, `name`, `purchaseNote`,
  `preparationNote`, `uncertain`, `uncertainty`
- `steps[]` mit `text`, `uncertain`, `uncertainty`
- `uncertainties[]` mit `reference`, `note` (nachvollziehbarer Bezug, z. B.
  „Zutat 3, Menge“, „Schritt 2, Temperatur“)
- `warnings[]`
- `pages[]` mit `index`, `kind`, `note`

Serverseitig passiert Folgendes:

1. Modellantwort robust aus Markdown-Zäunen/Vorwort extrahieren.
2. JSON strikt gegen den Vertrag validieren: Typen, Längen, Array-Obergrenzen,
   Seitenzahl. Unbekannte Felder werden verworfen, fehlende mit leeren Werten
   aufgefüllt.
3. Ungültige Antworten werden als `502 invalid-ai-response` beantwortet;
   Modell-Rohdaten, Fotos und private Rezeptinhalte werden **nicht** an den
   Browser oder in Logs weitergegeben.
4. `recognized: false` (kein Rezept auf den Fotos) ist eine gültige Antwort und
   führt zu einem verständlichen Hinweis statt zu einem erfundenen Rezept.

Fehlende oder unleserliche Angaben bleiben leer und werden markiert. Mengen
und Einheiten werden nie umgerechnet; die bestehende Mengenlogik des Editors
(`parseQuantityInput`, `buildIngredientList`) übernimmt die weitere
Verarbeitung.

## Datenschutz und Sicherheit

- Zugriff nur für angemeldete Haushaltsmitglieder: Supabase-Access-Token +
  `is_household_member()`; fehlender/ungültiger Token → 401, gültiger Token
  ohne Mitgliedschaft → 403.
- Anmeldung wird **vor** dem Lesen des bis zu 12 MiB großen Foto-Bodys geprüft.
- Same-origin-only, keine CORS-Header, `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`.
- Bildformat, Magic Bytes, Einzel-/Gesamtgröße und Seitenzahl werden
  serverseitig geprüft; nicht als JPEG/PNG/WebP deklarierte Daten werden
  abgelehnt.
- KI-Aufrufe ausschließlich serverseitig; der Browser erhält keine
  Cloudflare-Zugangsdaten und spricht nie direkt mit Workers AI.
- Keine Protokollierung von Fotos, Base64-Daten, Rezeptinhalten oder Tokens.
- Fotos bleiben im Arbeitsspeicher des Browser-Imports. Sie werden **nicht
  dauerhaft gespeichert**, außer der Nutzer aktiviert „Seitenfotos als
  Rezeptbilder mitspeichern“. Dann laufen sie über den vorhandenen privaten
  Supabase-Bucket `recipe-images` (bestehende Bildlogik).
- Cloudflare Workers AI ist für dieses Modell als „Zero data retention“
  ausgewiesen; die Fotos werden nur für die Inferenz verarbeitet.
- Rate-Limits: 20 Anfragen/Minute pro IP, 8 Anfragen/Minute pro Mitglied
  (isolate-lokal, Missbrauchsbremse, keine globale Garantie).
- Kein automatischer Tarifwechsel und keine kostenpflichtigen Dienste.

## Kosten und kostenlose Grenzen

- Workers AI im Free-Tier: **10.000 Neuronen pro Tag**, Reset 00:00 UTC.
  Danach schlägt die Erkennung mit `429 quota-exhausted` fehl, ohne Kosten zu
  verursachen.
- Modellpreis laut Cloudflare: **Gemma 4** 9.091 Neuronen pro Mio.
  Input-Tokens und 27.273 pro Mio. Output-Tokens (Llama 4 Scout zum Vergleich:
  24.545 / 77.273).
- Gemessen in den Live-Tests (Erkennung + Aufbereitung): echte Handschriftseite
  **rund 100–115 Neuronen** mit Gemma 4 – davon ca. 65 für die Erkennung und
  30–45 für die Aufbereitung. Zum Vergleich: die reine Erkennung ohne
  Aufbereitung lag bei 52–65 Neuronen, Llama 4 Scout bei 135–169. Das
  entspricht grob **85–100 vollständigen Rezeptimporten pro Tag** im Free-Tier.
  Die genauen Messwerte stehen in
  [`docs/photo-ocr-test-results.md`](photo-ocr-test-results.md).
- Bei erschöpftem Kontingent erscheint eine deutsche Meldung mit dem Hinweis,
  dass keine Kosten entstehen, und ein Link zum manuellen Anlegen. Es gibt
  keine automatische Umstellung auf einen kostenpflichtigen Tarif.
- Zusätzliche Anfragegrenzen (unabhängig vom KI-Kontingent):
  - maximal 4 Seiten pro Rezept/Anfrage
  - maximal 3 MiB pro Bild, 8 MiB gesamt (decodiert), 12 MiB Request-Body
  - Browser-Aufbereitung: lange Kante maximal 2048 px, JPEG-Qualität 0,85
    (mit Qualitäts-Fallback), Rohdateien bis 30 MB
  - Client-Abbruch nach 180 s; PDFs bis 40 MB und maximal 4 übernommene Seiten

## Benutzeroberfläche

### iPhone (Kamera und Fotos)

1. In Küchenrunde im Cloud-Modus anmelden.
2. **Import → Foto / Scan** öffnen (alternativ über das „Mehr“-Menü oder die
   Rezeptbibliothek).
3. **Foto aufnehmen** tippen; die Kamera öffnet sich. Nach dem Auslösen wird
   das Foto als Seite übernommen. Für weitere Seiten erneut **Foto aufnehmen**
   tippen.
4. Alternativ **Aus Fotos auswählen** tippen und mehrere Bilder aus der
   Mediathek wählen.
5. Reihenfolge mit **↑/↓** kontrollieren; **Ersetzen** tauscht eine Seite,
   **Entfernen** löscht sie. „Groß ansehen“ zeigt das Foto zum Prüfen.
6. **Rezept erkennen** tippen. Die Erkennung dauert je nach Seitenzahl und
   Auslastung meist einige Sekunden bis etwa zwei Minuten; **Erkennen
   abbrechen** ist jederzeit möglich.
7. Die Vorschau erscheint im bekannten Rezepteditor. Oben stehen die
   Unklarheiten/Warnungen der KI (z. B. „Zutat 3, Menge“); die Fotos bleiben
   über „Groß ansehen“ vergleichbar.
8. Alle Angaben korrigieren, dann **Rezept speichern**. Optional vorher
   **„Seitenfotos als Rezeptbilder mitspeichern“** aktivieren (Standard: aus).
   **Verwerfen** löscht den Import ohne Rezeptänderung.
9. Nach dem Speichern führt ein Link direkt zum Rezept; **Weiteres Foto
   importieren** startet den nächsten Import.

Tipps: Papier möglichst flach, vollständig im Bild und gleichmäßig beleuchtet
fotografieren. Handschrift braucht Größe und Schärfe; ein Foto pro Seite ist
besser als mehrere Seiten auf einem Bild. Bei mehrseitigen Rezepten die
Lesereihenfolge vor der Erkennung prüfen.

### Desktop

- Buttons **Foto aufnehmen** (Webcam/Dateiauswahl je nach Browser),
  **Aus Fotos auswählen** und **PDF auswählen**.
- Bilder und PDFs können auch per Drag & Drop in den markierten Bereich
  gezogen werden.
- PDFs werden ausschließlich im Browser in Seitenbilder umgewandelt
  (`pdfjs-dist`, nur bei Bedarf nachgeladen). Maximal 4 Seiten; der Rest wird
  mit Hinweis ignoriert. Passwortgeschützte oder beschädigte PDFs erzeugen eine
  verständliche Meldung.

## Verhältnis zu bestehenden Importwegen

- **Mela-Import** und **URL-Import** bleiben unverändert.
- Der Foto-Import nutzt denselben Rezepteditor (`RecipeForm`), dieselbe
  Dubletten-/Speicherlogik und dieselbe private Bildablage wie die übrigen
  Cloud-Importe.
- Der Importbereich bietet im Cloud-Modus die dritte Option **Foto / Scan**;
  im lokalen Modus erscheint bei direktem Aufruf ein Hinweis, dass der Dienst
  nur im Cloud-Modus verfügbar ist.

## Grenzen und bekannte Punkte

- **Handschrift ist naturgemäß schwieriger** als Druck. Sehr kleine, blasse,
  verwackelte oder stark beschriftete Fotos können zu unleserlichen Stellen
  führen; diese werden markiert, nicht erfunden. Im Test mit einer echten
  Handschriftseite blieben einzelne sehr schwer lesbare Wörter unsicher bzw.
  wurden falsch gelesen (z. B. ein Fachwort und eine Zeile ganz unten am
  Blatt); Zutaten, Mengen und Gruppen waren vollständig. Die Modellwahl stützt
  sich auf **eine** echte Handschriftseite; ein zweites echtes Handschriftfoto
  lag nicht vor. Die Vorschau mit Warnungen und Fotoabgleich bleibt deshalb
  Pflicht.
- **Seitenlimit 4**: Rezepte über mehr als vier Seiten müssen auf mehrere
  Importe aufgeteilt oder manuell ergänzt werden.
- **Latenz**: Erkennung 9–35 s pro Seite plus Aufbereitung 3–25 s, in den
  Live-Tests insgesamt rund 20–60 s pro einseitigem Rezept. Die Oberfläche
  zeigt währenddessen einen Ladezustand, erlaubt Abbruch und wartet bis zu
  180 s. Mehrseitige Rezepte können die Obergrenze erreichen; die Aufbereitung
  fällt bei Timeout auf die erkannten Schritte zurück.
- **HEIC**: iPhones liefern Fotos meist als JPEG an das Datei-Eingabefeld bzw.
  Safari kann HEIC dekodieren; falls ein Browser ein Format nicht öffnen kann,
  erscheint ein Hinweis, das Foto als JPEG zu speichern.
- **Rate-Limits** der Function leben pro Workers-Isolate; sie sind eine
  Missbrauchsbremse, keine globale Garantie.
- **PDF-Import** ist für Desktop gedacht; auf dem iPhone ist der Weg über
  Fotos der vorgesehene Weg.
- **Testdaten**: Der Großteil der automatisierten Live-Messung nutzt
  synthetische, gerenderte Testseiten. Zusätzlich wurde ein echtes
  handschriftliches Familienrezept gegen die Referenz geprüft (Ergebnis siehe
  Testdokument). Ein weiteres echtes Handschriftfoto und ein echtes gedrucktes
  Familienrezept stehen als manuelle Abnahme noch aus.

## Testabdeckung und Nachprüfung

Automatisiert geprüft werden u. a.:

- gedruckter Rezepttext, handschriftliche Zutaten/Zubereitung, mehrseitige
  Rezepte, unleserliche Angaben, fehlende/falsche Einheiten
  (Live-Tests mit Workers AI, siehe Ergebnisse)
- strukturierte Ausgabe, JSON-Extraktion und serverseitige Validierung
- KI-Fehler, erschöpftes Kontingent, Dienst nicht konfiguriert
- nicht autorisierte Zugriffe (401/403), Body-/Seiten-/Formatlimits
- Abbrechen ohne Rezeptänderung, Speichern ausschließlich nach Bestätigung
- Speichern über den bestehenden Editor und die bestehende Cloud-Bildpipeline
- PDF-Seitenlimit und Fehlerabbildung (Renderer injiziert)

Befehle:

```bash
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
```

Opt-in-Live-Tests (nur mit ausdrücklicher Freigabe; verbrauchen das
Free-Tier-Kontingent):

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  pnpm vitest run server/photo-ocr-trial.test.ts
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  pnpm vitest run server/photo-ocr-handler-live.test.ts
```

Der erste Lauf misst die Modellqualität an synthetischen Fixtures, der zweite
führt den echten Handler aus `functions/api/recipe-ocr.ts` mit einem
REST-gestützten AI-Binding-Ersatz und gemockter Haushaltsprüfung aus. Der
Handler-Lauf umfasst seit der Schrittaufbereitung zwei Modellaufrufe pro Fall
(Erkennung + text-only Aufbereitung) und prüft damit den vollständigen Pfad.
Für Modellvergleiche auf einem echten Foto dient zusätzlich
`server/photo-ocr-model-compare.test.ts`; Bild und Ground Truth liegen aus
Datenschutzgründen nur lokal unter `fixtures-private/` und werden nie
committet:

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  PHOTO_OCR_COMPARE_IMAGE=fixtures-private/photo-compare/photo.jpg \
  PHOTO_OCR_COMPARE_GT=fixtures-private/photo-compare/ground-truth.json \
  pnpm vitest run server/photo-ocr-model-compare.test.ts
``` Der
veröffentlichte Endpunkt selbst verlangt zusätzlich ein gültiges
Haushalts-Token und wird nach dem Deploy mit einem echten Familienkonto
geprüft.

### Manuelle Abnahme (einmalig, mit echtem Konto)

1. Im Cloud-Modus anmelden, **Import → Foto / Scan** öffnen.
2. Ein gedrucktes und ein handschriftliches Familienrezept fotografieren.
3. Erkennen lassen, Unklarheiten mit den Fotos abgleichen und korrigieren.
4. Speichern; Rezept in der Bibliothek und auf einem zweiten Gerät prüfen.
5. Mit drei bis vier Seiten und einem PDF (Desktop) wiederholen.
6. Abbrechen/Verwerfen testen: kein neues Rezept, keine Fotos gespeichert.
7. Nach mehreren Erkennungen am Tag das Verhalten bei erreichtem
   Tageskontingent beobachten (verständliche Meldung, keine Kosten).

## Beteiligte Dateien

- `src/import/photo-ocr.ts` – gemeinsamer Vertrag: Grenzen, Prompt,
  JSON-Extraktion, Validierung
- `functions/api/recipe-ocr.ts` – Pages Function (Auth, Limits, Binding,
  Fehlerabbildung)
- `functions/lib/photo-ai.ts` – Binding, Base64-/Bildprüfung, Modellaufruf,
  Antwort-/Usage-Extraktion, Fehlerklassifikation
- `functions/lib/photo-request.ts` – Body-Reader mit 12-MiB-Limit
- `src/import/photo-image.ts` – Bildaufbereitung im Browser
- `src/import/photo-pdf.ts` – PDF-Seiten im Browser (pdfjs-dist)
- `src/import/photo-ocr-client.ts` – same-origin Client mit Timeout/Abbruch
- `src/import/photo-draft.ts` – Abbildung in den vorhandenen Rezepteditor
- `src/pages/PhotoImportPage.tsx` – UI
- `src/cloud/CloudPhotoImportPage.tsx` – Cloud-Verdrahtung
- `tests/fixtures/photo-ocr/` – synthetische Testbilder + Ground Truth
- `server/photo-ocr-trial.test.ts`, `server/photo-ocr-handler-live.test.ts` –
  Opt-in-Live-Tests
- `server/photo-ocr-model-compare.test.ts` – opt-in Modellvergleich
  (Llama/Gemma/Moondream) auf einem echten Foto; private Daten bleiben lokal
- `scripts/generate-photo-ocr-fixtures.py` – deterministischer Fixture-Generator
