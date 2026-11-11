# Foto-/Scan-Import – Testergebnisse (synthetische Fixtures)

Stand: 2026-11-11 · Status: **Live-Lauf abgeschlossen** mit dem echten
Workers-AI-Modell über die offizielle Wrangler-OAuth-Anmeldung. Es wurden keine
Zugangsdaten im Repository oder in diesem Dokument abgelegt.

Gegenstand: Erkennungsqualität des Workers-AI-Modells
`@cf/meta/llama-4-scout-17b-16e-instruct` für den Foto-/Scan-Import
(`src/import/photo-ocr.ts`). Es werden ausschließlich **frei erfundene,
synthetische Rezepte** getestet. Keine echten Familienrezepte, keine privaten
Daten, keine Zugangsdaten im Repository.

## 1. Testaufbau

1. `scripts/generate-photo-ocr-fixtures.py` erzeugt deterministisch acht
   JPEG-Seiten und die Ground Truth:
   - `tests/fixtures/photo-ocr/*.jpg`
   - `tests/fixtures/photo-ocr/ground-truth.json`
2. `server/photo-ocr-trial.test.ts` baut dieselben `messages` wie der Server
   (Import von `OCR_SYSTEM_PROMPT` und `buildOcrUserPrompt` aus dem gemeinsamen
   Vertrag; Bilder als `type: 'image_url'` mit `data:image/jpeg;base64,…`) und
   ruft die Workers-AI-REST-API auf:
   `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct`
3. Die Antwort wird mit `extractJsonObject`, `validateOcrRecipe` und
   `validateOcrPageReports` aus dem Vertrag geparst und validiert.
4. Pro Fall entstehen Metriken; am Ende schreibt der Lauf den
   maschinenlesbaren Bericht `docs/photo-ocr-trial-results.json` und gibt eine
   Markdown-Tabelle auf stdout aus.

Für den hier dokumentierten Lauf wurden die Modell-Rohantworten mit `curl`
geholt (`PHOTO_OCR_RAW_DIR`) und anschließend vom selben Harness ohne
Netzwerkaufruf ausgewertet. Hintergrund: Die Workers-AI-REST-Aufrufe zeigten
über Node `fetch` sporadische, nicht reproduzierbare Hänger im Test-Worker;
`curl` war stabil. Prompt, Parameter (`temperature: 0.1`,
`max_tokens: 3000`), Modell und Validierung sind in beiden Wegen identisch.

Eigenschaften des Harness:

- **Opt-in:** Ohne `CLOUDFLARE_ACCOUNT_ID` **und** `CLOUDFLARE_API_TOKEN` wird
  die Suite über `describe.skipIf` vollständig übersprungen (aktuell:
  `9 tests | 9 skipped`). Der Befehl endet mit Exit-Code 0.
- **Kostenbremse:** genau 7 Modellaufrufe pro Lauf (`MAX_MODEL_CALLS = 8`),
  120 s Timeout pro Aufruf. Free-Tier-Budget: 10.000 Neuronen/Tag.
- **Fehlertoleranz:** Ein API-, JSON- oder Schemafehler beendet nur den
  betroffenen Fall; der Fehler wird protokolliert und im Bericht festgehalten.
  Der Lauf schlägt nur fehl, wenn **kein** Fall auswertbar war.
- **Keine Secrets:** Account-ID und Token werden nur aus der Umgebung gelesen
  und weder geloggt noch in den Bericht geschrieben. Fehlermeldungen enthalten
  nur HTTP-Status und eine gekürzte Fehlerantwort des Dienstes.

## 2. Fixtures

Alle Bilder: JPEG, Qualität 85, lange Kante 2000–2400 px, < 2,5 MB.
Erzeugung mit festen Seeds; zweimaliges Ausführen erzeugt byte-identische
Dateien (per SHA-256 geprüft). Die erfundenen Rezepte sind deutsch und enthalten
realistische Mengen, Einheiten und Abkürzungen.

| Datei | Maße | Größe | Inhalt / Zweck |
| --- | --- | --- | --- |
| `printed-basic.jpg` | 1654×2339 | 324 KB | Gedruckte Referenzseite: Titel, 4 Portionen, Zeiten, 8 Zutaten (g, ml, TL/EL, Prise, Stk.), 5 Schritte. Helles Papier, gut lesbar. |
| `printed-photo.jpg` | 2100×2400 | 440 KB | Dasselbe Rezept als Handyfoto: ca. 3° Rotation, ungleichmäßiges Licht, Schatten, Rauschen, leichte Unschärfe, grauer Tisch. Ground Truth identisch zu `printed-basic.jpg`. |
| `handwritten-basic.jpg` | 1654×2339 | 461 KB | Handschriftlich wirkende Seite (Bradley Hand) auf liniertem Papier: 8 Zutaten, 5 Schritte, Temperatur 180 °C. Gut lesbar. |
| `handwritten-hard.jpg` | 1654×2339 | 338 KB | Absichtlich schwer: dünnere/kleinere Schrift (Chalkboard SE Light), schwacher Kontrast, leichte Verkippung. „200 g Zucker“ ist durchgestrichen und durch „180 g Zucker“ korrigiert. |
| `multi-page-1.jpg` | 1654×2339 | 218 KB | Rezept über zwei Seiten, Seite 1: Titel, Portionen, Zeiten, Zutaten der Füllung (6). |
| `multi-page-2.jpg` | 1654×2339 | 301 KB | Seite 2: Fortsetzung der Zutaten (Béchamelsauce, Außerdem) und 6 Zubereitungsschritte. Erst beide Seiten zusammen ergeben das vollständige Rezept. |
| `unclear-quantities.jpg` | 1654×2339 | 285 KB | Gemischt gedruckt/handschriftlich mit bewusst unleserlichen Stellen: Tipp-Ex über der Buttermenge, „250 ?“ (Einheit unklar), „250 Zucker“ (Einheit fehlt), „2 EL Salz“ (unplausible Einheit), Backtemperatur „1?? °C“ als Schmutzfleck. |
| `printed-abbreviations.jpg` | 1654×2339 | 373 KB | Viele Abkürzungen (EL, TL, Msp., Prise, Stk., Pck., g, kg, ml, l, Min., Std., °C), Brüche (1/4, 1 1/2) und Zutatengruppen (Teig, Füllung, Streusel): 14 Zutaten. |

Auflösung: Bei A4 entsprechen 2339 px lange Kante ca. 200 dpi. Der Vorgaben-
Korridor „lange Kante 2000–2400 px“ hat hier Vorrang vor „300 dpi“; das ist
auch praxisnah, weil der Browser Fotos ohnehin auf 2048 px lange Kante
verkleinert (`PHOTO_OCR_TARGET_LONG_EDGE`). Die Seiten sind bei dieser
Auflösung gut lesbar.

Bildinhalte stichprobenartig geprüft (Maße, Dateigröße und Sichtprüfung): Die
gedruckten Seiten sind klar lesbar, das Handyfoto ist hell/dunkel ungleichmäßig
ausgeleuchtet und leicht schief, die Handschrift ist kursiv und leicht versetzt,
die schwere Seite ist merklich kontrastärmer, und die unleserlichen Stellen sind
auch bei Sichtprüfung nicht sicher rekonstruierbar.

Ground Truth (Auszug):

```json
{
  "fixtures": {
    "printed-basic.jpg": {
      "title": "Cremige Kürbis-Kokos-Suppe",
      "servingsText": "4 Portionen",
      "prepTime": "15 Min.",
      "cookTime": "25 Min.",
      "totalTime": "40 Min.",
      "ingredients": [
        { "quantity": "800", "unit": "g", "name": "Hokkaido-Kürbis" }
      ],
      "steps": ["…"],
      "expectedUncertainties": [],
      "notes": "Gedruckte, gut lesbare Referenzseite."
    }
  },
  "combined": {
    "multi-page": { "pages": ["multi-page-1.jpg", "multi-page-2.jpg"], "…": "vollständiges Rezept" }
  }
}
```

`expectedUncertainties` benennt unleserliche/mehrdeutige Stellen nachvollziehbar
(`"Zutat 1, Menge"`, `"Schritt 4, Temperatur"`) und hält in `mustNotInvent`
fest, was das Modell auf keinen Fall erfinden darf. Für `unclear-quantities.jpg`
sind fünf Stellen markiert; `expectUncertain: false` bedeutet: Stelle ist lesbar
und soll wörtlich übernommen werden (z. B. „2 EL Salz“ nicht „korrigieren“).

## 3. Metriken

Pro Fall berechnet der Harness:

- **Titel:** exakt (normalisiert, inkl. Umlaut-Faltung) / enthält / verfehlt.
- **Zutaten:** Precision und Recall über normalisierte Namen (leichte
  Plural-/Endungsnormalisierung); separat Trefferquote für **Menge** und
  **Einheit** bei zugeordneten Zutaten.
- **Schritte:** Anzahl Soll/Ist, Differenz und Token-Jaccard über den
  Gesamttext der Schritte.
- **Portionen:** normalisiert korrekt/abweichend.
- **Zeiten:** Vorbereitungs-/Koch-/Gesamtzeit im Vergleich zur Ground Truth.
- **Unklarheiten:** Abdeckung der erwarteten Pflicht-Unklarheiten
  (`expectUncertain: true`), inkl. Liste fehlender Referenzen.
- **Halluzinationen/Erfindungen:** nicht zuordenbare Zutaten und Schritte,
  erfundene Mengen/Einheiten/Temperaturen sowie „korrigierte“ unplausible
  Einheiten.
- **Kosten:** `usage` (Prompt-/Completion-Tokens) und Neuronen-Schätzung
  (24.545 pro Mio. Input-Tokens, 77.273 pro Mio. Output-Tokens) inkl.
  Anteil am Free-Tier-Tagesbudget von 10.000 Neuronen.

Die Schätzung aus der `usage` ist eine Obergrenze der Modellkosten; die
tatsächliche Abrechnung von Workers AI kann davon abweichen. Der gemessene
Lauf mit 7 Aufrufen benötigte nach dieser Formel **1.068,16 Neuronen**
(10,68 % des Free-Tier-Tagesbudgets). Die API meldete in `usage.neurons`
praktisch dieselben Werte.

## 4. Ergebnis des Live-Laufs

**Aufbau:** 7 Modellaufrufe am 2026-11-11 gegen
`@cf/meta/llama-4-scout-17b-16e-instruct`, identischer System-Prompt und
identische Parameter wie die ausgelieferte Pages Function
(`temperature: 0.1`, `max_tokens: 3000`). Die Rohantworten wurden mit `curl`
geholt und vom Harness offline ausgewertet. Gesamtkosten:
**1.068,16 Neuronen** (10,68 % des Free-Tier-Tagesbudgets von 10.000).

| Fall | Status | Titel | Zutaten P / R | Menge / Einheit | Schritte Soll/Ist | Jaccard | Portionen | Zeiten | Unklarheiten | Halluz./Erfind. | Neuronen | ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| printed-basic | ok | exakt | 100 % / 100 % | 100 % / 100 % | 5/5 | 100 % | ok | 3/3 | 0/0 | 0/0 | 138,7 | 32.402 |
| printed-photo | ok | exakt | 100 % / 100 % | 100 % / 100 % | 5/5 | 96 % | ok | 3/3 | 0/0 | 0/0 | 142,3 | 35.102 |
| handwritten-basic | ok | exakt | 100 % / 100 % | 100 % / 100 % | 5/5 | 100 % | ok | 3/3 | 0/0 | 0/0 | 136,4 | 25.621 |
| handwritten-hard | ok | exakt | 88 % / 100 % | 86 % / 100 % | 5/5 | 100 % | ok | 3/3 | 1/1 | 1/0 | 134,9 | 23.294 |
| multi-page-kombiniert | ok | exakt | 100 % / 100 % | 100 % / 100 % | 6/6 | 100 % | ok | 3/3 | 0/0 | 0/0 | 215,2 | 32.744 |
| unclear-quantities | ok | exakt | 86 % / 86 % | 83 % / 83 % | 4/4 | 98 % | ok | 3/3 | 2/4 | 1/1 | 133,4 | 26.116 |
| printed-abbreviations | ok | exakt | 100 % / 100 % | 100 % / 100 % | 5/5 | 100 % | ok | 3/3 | 0/0 | 0/0 | 167,2 | 51.709 |

Beim Fall `unclear-quantities` fehlten laut Harness zwei erwartete
Unklarheiten-Hinweise: „Zutat 1, Menge“ (Butter) und „Zutat 3, Einheit“
(Zucker). Das Modell erfand außerdem eine Buttermenge („3“), obwohl die Stelle
unkenntlich ist. Die KI markierte stattdessen „Zutat 2, Menge“ (Mehl) und die
unleserliche Temperatur in Schritt 4. Beides ist im Rezept entsprechend
sichtbar; die Stellen müssen mit den Fotos abgeglichen werden.

**Zusätzlicher Integrationstest** mit dem **echten Handler** aus
`functions/api/recipe-ocr.ts` (nur Auth gemockt, Modell real über REST):

| Fall | Ergebnis | Zutaten | Schritte | Prompt/Completion | Neuronen |
| --- | --- | --- | --- | --- | --- |
| printed-basic.jpg | 200, `ok:true`, Titel exakt | 8 | 5 | 3.317 / 741 | 138,68 |
| handwritten-basic.jpg | 200, `ok:true`, Titel exakt | 8 | 5 | 3.317 / 712 | 136,44 |

Beide Handler-Läufe zusammen: **275,12 Neuronen**. Damit sind Body-Limit,
Seitenprüfung, Prompt-Aufbau, Modellaufruf, JSON-Extraktion und
Vertragsvalidierung des echten Serverpfads live bestätigt. Das reale
Cloudflare-AI-Binding und die Supabase-Haushaltsprüfung werden erst im
Deployment mit einem Familienkonto durchlaufen (manuelle Abnahme).

## 5. Interpretation

**Gedruckt:** Beide gedruckten Seiten (gerade und als schiefes, ungleichmäßig
beleuchtetes Handyfoto) wurden bei Titel, Zutaten, Mengen, Einheiten,
Portionen, Zeiten und Schritten praktisch fehlerfrei erkannt. Das ist die
Kernzielgruppe und funktioniert ohne Korrektur.

**Handschrift:** Das gut lesbare handschriftliche Rezept war ebenfalls
komplett korrekt – inklusive der leicht flapsigen „750 g Äpfel“, die als 750
erkannt wurde. Die absichtlich schwere Seite (dünne Schrift, schwacher
Kontrast, durchgestrichene Korrektur) wurde inhaltlich vollständig richtig
gelesen (Titel, Zeiten, 5/5 Schritten, Jaccard 100 %). Der einzige Fehler:
Das Modell übernahm **beide** Zuckerzeilen – die durchgestrichene „200 g“ und
die Korrektur „180 g“ – als getrennte Zutaten. Die deterministische
Doppel-Zutaten-Prüfung des Servers markiert beide Zeilen als unsicher
(Unklarheiten-Abdeckung 1/1), sodass der Nutzer sie im Editor sieht und die
ungültige Zeile löschen kann. Ohne diese Prüfung wäre die Stelle unbemerkt
geblieben. **Fazit:** Handschrift ist grundsätzlich geeignet, aber
Durchstreichungen/Korrekturen und Mengen müssen geprüft werden.

**Mengen und Einheiten:** Auf den gedruckten Abkürzungsseiten wurden EL, TL,
Msp., Prise, Stk., Pck., g/kg/ml/l, Min./Std./°C sowie Brüche (1/4, 1 1/2) und
Zutatengruppen (Teig/Füllung/Streusel) zu 100 % korrekt übernommen; nichts
wurde umgerechnet. Bei der unleserlichen Seite schrieb das Modell einige
Mengen zusammen mit der Einheit in ein Feld („2 EL“); der Server trennt
bekannte Einheiten deterministisch wieder ab, ohne unbekannte Endungen zu
raten.

**Unleserliche Stellen:** Das Modell markierte zwei der vier erwarteten
Pflicht-Unklarheiten und erfand an einer Stelle eine Menge. Es hat die
unleserliche Temperatur korrekt als unsicher gekennzeichnet und **nicht** auf
die im Rezept genannten 180 °C geraten. Die Trefferquote zeigt: Die
Unklarheiten-Markierung ist eine Hilfe, aber keine Garantie. Deshalb bleibt die
Vorschau mit Fotos und Warnungen verpflichtend; es wird nie automatisch
gespeichert.

**Mehrseitig:** Beide Seiten in einer Anfrage wurden zu genau einem Rezept
zusammengeführt: 11/11 Zutaten, 6/6 Schritte, korrekte Gruppen (Füllung,
Béchamelsauce, Außerdem), zwei Seitenberichte, keine Duplikate. Das
Mehrseiten-Ziel ist erfüllt.

**Kosten:** 133–215 Neuronen pro Aufruf (mehr Seiten = mehr), im Mittel etwa
150 pro Ein-Seiten-Rezept. Im Free-Tier von 10.000 Neuronen/Tag sind damit
grob **45–70 Ein-Seiten-Erkennungen pro Tag** möglich – für einen Familienhaushalt
deutlich mehr als der übliche Bedarf. Ein mehrseitiges Rezept kostet etwa das
1,5- bis 1,6-Fache einer Seite.

**Gesamturteil:** Die Erkennungsqualität ist für den vorgesehenen Zweck
ausreichend, wenn die Vorschau mit Warnungen und Fotoabgleich bestehen bleibt.
Ein Wechsel auf ein anderes Modell (z. B. Gemini 3.1 Flash-Lite) ist nach
dieser Messung **nicht** begründet. Der Engpass ist weniger das Modell als die
Natur handschriftlicher Korrekturen; echte Familienrezepte sollten trotzdem
gezielt nachgemessen werden.

## 6. Grenzen

- **Synthetische Daten:** Die Bilder sind realistisch, aber keine echten
  Handyfotos. Reale Fotos haben stärkere Perspektive, Spiegelungen, Finger im
  Bild, unterschiedliche Papierfarben und Kamera-Processing. Die gemessene
  Qualität ist deshalb eine **obere Schätzung**, kein Produktionsversprechen.
- **Ein Modell, ein Lauf:** Getestet wird genau ein Modell und (pro Lauf) eine
  Stichprobe pro Fall. Keine Wiederholungsmessung, keine Varianzanalyse.
- **Getestete Schichten:** Der Qualitätslauf ruft die Workers-AI-REST-API mit
  den Fixtures auf. Zusätzlich führt `server/photo-ocr-handler-live.test.ts`
  den **echten Handler** aus `functions/api/recipe-ocr.ts` mit einem
  REST-gestützten AI-Binding-Ersatz und gemockter Haushaltsprüfung aus. Nicht
  live getestet sind damit: das reale Cloudflare-AI-Binding, die
  Supabase-Auth-Kette, Rate-Limits im Deploy und das Browser-Resize/UI auf
  echten Geräten. Diese Punkte sind durch Unit-Tests abgedeckt bzw. stehen als
  manuelle Abnahme aus.
- **Bewertung ist heuristisch:** Namensabgleich, Token-Jaccard, Zeit- und
  Einheitenvergleich sind bewusst einfach und nachvollziehbar. Synonyme
  („Esslöffel“ vs. „EL“ wird über eine kleine Aliasliste abgefangen),
  freiere Umformulierungen und fachlich richtige, aber anders formulierte
  Schritte können zu niedrigeren Werten führen. Die Ground Truth ist knapp
  gehalten; sie ersetzt keine menschliche Bewertung.
- **Kosten:** Free-Tier-Kontingent (10.000 Neuronen/Tag) begrenzt die
  Testhäufigkeit. Der Lauf ist auf 8 Aufrufe und 120 s/Aufruf begrenzt.
- **Nichtsensitive Daten:** Da nur erfundene Rezepte verwendet werden, prüft
  der Test nicht, wie das Modell mit echten (handschriftlichen) Familienrezepten
  umgeht – insbesondere nicht mit schwer lesbaren Unikaten.
- **Durchstreichungen:** Das Modell „sieht“ Durchstreichungen nicht zuverlässig;
  es kann alte und korrigierte Angaben doppelt ausgeben. Die serverseitige
  Doppel-Zutaten-Prüfung markiert das, ersetzt aber keine menschliche
  Entscheidung.
- **Unklarheiten nicht vollständig:** Im Test wurden 2 von 4 erwarteten
  Pflicht-Unklarheiten markiert; eine Menge wurde erfunden. Die Warnliste ist
  eine Hilfe, keine Garantie.
- **Kein echtes Binding im Test:** Der Qualitätslauf nutzt die offizielle
  Workers-AI-REST-API mit demselben Modell/Prompt, der Handler-Lauf ein
  REST-gestütztes Binding. Das reale `env.AI`-Binding, Supabase-Auth und
  Rate-Limits im Deploy werden erst bei der manuellen Abnahme durchlaufen.

## 7. Empfehlung

1. **Foto-Import verwenden**, aber die Vorschau ernst nehmen: Bei Handschrift
   besonders Mengen, Einheiten, Temperaturen und durchgestrichene Korrekturen
   mit den Fotos vergleichen.
2. **Echte Familienrezepte nachmessen**: 10–20 typische Papierrezepte
   (verschiedene Handschriften, Papierfarben, Beleuchtung, Kameras) durch den
   Import schicken und stichprobenartig gegen das Original prüfen. Die
   synthetischen Fixtures sind eine obere Schätzung.
3. **Keine automatische Speicherung** – bleibt so umgesetzt. Die
   Unklarheiten-Liste und die Foto-Großansicht sind der vorgesehene
   Korrekturweg.
4. **Kein Modellwechsel nötig.** Falls echte Scans deutlich schlechter
   abschneiden, ist der günstigste nächste Schritt eine gezielte
   Prompt-/Auflösungs-Nachmessung und erst danach die Prüfung von Gemini 3.1
   Flash-Lite (Free-Tier, Google-API-Key, eigene Datenverarbeitung) – nur mit
   ausdrücklicher Freigabe und ohne automatische Kosten.
5. **Kontingent beobachten:** Bei 10.000 Neuronen/Tag und ~150 Neuronen pro
   Seite sind ~45–70 Ein-Seiten-Erkennungen möglich. Bei `429 quota-exhausted`
   erscheint eine verständliche Meldung; es entstehen keine Kosten.
6. **Manuelle Abnahme** mit einem echten Familienkonto auf iPhone und Desktop
   durchführen (Kamera, Mediathek, mehrseitig, PDF, Abbrechen, Speichern).

## 8. Live-Lauf: exakter Befehl

```bash
# Variante A: Modell direkt aufrufen (verbraucht Kontingent)
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  pnpm vitest run server/photo-ocr-trial.test.ts

# Variante B: bereits mit curl geholte Rohantworten offline auswerten
# (keine Netzwerkaufrufe, kein Kontingent)
PHOTO_OCR_RAW_DIR=/tmp/photo-ocr-raw \
  pnpm vitest run server/photo-ocr-trial.test.ts

# Echten Handler live testen (Auth gemockt, Modell real)
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  pnpm vitest run server/photo-ocr-handler-live.test.ts
```

Ohne Zugangsdaten bzw. `PHOTO_OCR_RAW_DIR` werden die Suiten sauber
übersprungen (Exit-Code 0). Der reine Offline-Auswertungslauf benötigt keine
Cloudflare-Zugangsdaten.

Der Live-Lauf endet mit Exit-Code 0, wenn mindestens ein Fall auswertbar war
(auch wenn die Qualitätswerte schlecht sind). Fehler einzelner Fälle stehen im
Bericht und in der Tabelle. Der Bericht enthält keine Zugangsdaten.

## 9. Reproduktion und Verifikation

```bash
# Fixtures neu erzeugen (deterministisch, gibt Maße/KB/SHA-256 aus)
python3 scripts/generate-photo-ocr-fixtures.py

# Harness ohne Zugangsdaten: sauberer Skip, Exit-Code 0
pnpm vitest run server/photo-ocr-trial.test.ts

# Typecheck der Testdatei (der Repository-weite Typecheck kann durch parallele
# Arbeit an src/import/*.ts rot sein; die Testdatei selbst ist typfehlerfrei)
pnpm exec tsc --noEmit
```

Determinismus: Zwei aufeinanderfolgende Generator-Läufe erzeugen identische
SHA-256-Summen für alle acht JPEGs und für `ground-truth.json`. Die
Ground-Truth-Datei enthält bewusst keinen Zeitstempel.

Geänderte Dateien dieses Arbeitspakets (nur diese):

- `scripts/generate-photo-ocr-fixtures.py`
- `tests/fixtures/photo-ocr/` (8 JPEGs + `ground-truth.json`)
- `server/photo-ocr-trial.test.ts`
- `server/photo-ocr-handler-live.test.ts`
- `docs/photo-ocr-test-results.md`
- `docs/photo-ocr-trial-results.json` (synthetische Messdaten, eingecheckt)
