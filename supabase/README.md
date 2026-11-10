# Supabase-Grundlage (Etappe A1/A1.5)

Diese Migration legt die gemeinsame Cloud-Basis für **einen** Familienhaushalt
an. Sie ist noch **nicht** an die App angeschlossen: `src/db.ts`, alle Services
und alle Seiten arbeiten weiterhin ausschließlich lokal mit Dexie.

## Anwenden

1. Supabase-Projekt anlegen (Region EU empfohlen).
2. Einmalig im lokalen Terminal anmelden und das Projekt verknüpfen
   (interaktive Eingabe, keine Zugangsdaten im Repository):

   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <projekt-ref>
   ```

3. Migration zuerst als Dry-Run prüfen, dann anwenden (CLI v3):

   ```bash
   pnpm supabase db push --dry-run --remote
   pnpm supabase db push --remote
   ```

   Keine manuellen SQL-Skripte parallel im Dashboard einspielen; sonst
   divergiert die Migrationshistorie.

4. Familienmitglied einladen. Im Cloud-Modus gibt es dafür **Familie
   verwalten** (`#/family`): Der Administrator erstellt einen sieben Tage
   gültigen Einladungslink, kopiert ihn oder teilt ihn nativ. Die eingeladene
   Person registriert sich selbst oder meldet sich an; die Einlösung erfolgt
   serverseitig und atomar über `redeem_household_invite()`.

   Details und Sicherheitsmodell: [`docs/family-access.md`](../docs/family-access.md).

5. Administrations-Fallback ohne Oberfläche:

   ```bash
   pnpm invite-member "Name des Mitglieds" mitglied@example.org --yes
   ```

   Das Skript nutzt `POST /auth/v1/invite` und trägt das Konto anschließend in
   `public.household_members` ein. Alternativ kann die Einladung im Dashboard
   unter **Authentication → Users → Invite user** ausgelöst und die
   Mitgliedschaft per SQL eingetragen werden.

   Für die Selbstregistrierung ist `disable_signup = false` gesetzt;
   E-Mail-Bestätigung ist derzeit nicht erforderlich. Ohne gültigen
   Einladungslink entsteht trotzdem kein Haushaltszugriff.

6. `.env.example` nach `.env` kopieren und `VITE_SUPABASE_URL` sowie
   `VITE_SUPABASE_PUBLISHABLE_KEY` eintragen. Nur der öffentliche
   Publishable-Key; **niemals** `service_role`.

## Sicherheitsmodell

- `public.records` enthält alle App-Daten als `(collection, id, rev, data)`.
- RLS lässt ausschließlich authentifizierte Mitglieder aus
  `public.household_members` zu.
- `is_household_member()`, `apply_ops()` und `snapshot()` sind
  `SECURITY INVOKER`; es gibt keinen Definer-Pfad um RLS herum.
- `household_members` hat nur eine SELECT-Policy auf die eigene Zeile.
  `authenticated` besitzt darauf ausschließlich `SELECT`; INSERT/UPDATE/DELETE
  und TRUNCATE sind entzogen.
- `apply_ops()` prüft die Mitgliedschaft zusätzlich explizit und verweigert
  sonst mit `42501`.
- Schreibvorgänge nutzen `expected_rev` (Compare-and-Swap). Ein veralteter
  Stand führt zu `PT409` statt zu stillem Überschreiben.
- Der Bucket `recipe-images` ist privat, auf 10 MB pro Datei und gängige
  Bild-MIME-Typen begrenzt.

## Live-Status (A1.5)

Projekt: `kuechenrunde` (`roalmqptpytcdfrcugyx`, eu-central-1, PostgreSQL 17.11).

Angewendete Migrationen:

- `20261110134755_cloud.sql`
- `20261110150500_harden_grants.sql` – entzieht `authenticated` die von
  Supabase standardmäßig gesetzten Rechte `TRUNCATE`, `REFERENCES` und
  `TRIGGER`; TRUNCATE wird von RLS nicht geprüft.
- `20261110232000_family_invites.sql` – `is_admin`, gehashte Einladungen und
  die serverseitigen Einlöse-RPCs.

**Live geprüft:**

- Tabellen, Spalten, Indizes, Trigger, Realtime-Publication und Storage-Bucket
  existieren.
- RLS ist auf `records` und `household_members` aktiv; die Policies entsprechen
  dem Entwurf.
- `is_household_member()`, `apply_ops()` und `snapshot()` sind
  `SECURITY INVOKER`; `anon` und `PUBLIC` haben keine EXECUTE-Rechte.
- `anon` hat auf beiden Tabellen keinerlei Tabellenrechte; SELECT, INSERT und
  TRUNCATE werden verweigert (stichprobenartig live geprüft), ebenso alle drei
  RPCs (HTTP 401/42501 bzw. `permission denied`).
- `authenticated` **ohne** Mitgliedschaft: `is_household_member() = false`,
  `records` und `household_members` liefern 0 Zeilen, `snapshot()` und
  `apply_ops()` liefern `42501`, INSERT in `household_members` wird verweigert,
  INSERT in `records` scheitert an der RLS-Policy.
- `authenticated` hat nur `SELECT` auf `household_members` und
  `SELECT/INSERT/UPDATE/DELETE` auf `records`; kein TRUNCATE.
- Der `rev`-Trigger erhöht bei einem Update von 1 auf 2 (in einer Transaktion
  mit `ROLLBACK` geprüft).
- Der Bucket `recipe-images` ist privat, auf 10 MB pro Datei begrenzt und
  akzeptiert nur die vorgesehenen Bild-MIME-Typen. Die vier Storage-Policies gelten für
  `authenticated`.
- `disable_signup = false` für die Selbstregistrierung; ohne gültigen Einladungslink entsteht kein Haushaltszugriff. Anonyme Authentifizierung ist deaktiviert.
- `pnpm supabase db advisors --type security` meldet keine Befunde.
- `records` ist leer; `household_members` enthält das freigeschaltete
  Betreiberkonto, `auth.users` genau diesen Benutzer.

**Weiterhin offen:**

- Wochenplan, Einkaufsliste und Kochmodus im Cloud-Modus.

Die RLS-Tests liefen direkt auf der Datenbank über
`pnpm supabase db query --remote --yes -f <datei>` mit
`BEGIN; SET LOCAL ROLE ...; SET LOCAL request.jwt.claim.sub ...; ROLLBACK;`.
Es wurden keine Benutzer und keine dauerhaften Daten angelegt.

## Frontend-Modus (A2/A3.1/A3.2)

- **Standard:** `VITE_DATA_MODE` fehlt oder ist `local` → die bisherige lokale
  Dexie-App läuft unverändert.
- **Cloud:** `VITE_DATA_MODE=cloud` plus `VITE_SUPABASE_URL` und
  `VITE_SUPABASE_PUBLISHABLE_KEY` → Login, Session-Verwaltung und gemeinsame
  Rezeptbibliothek inklusive Bildern.
- Die Supabase-Variablen allein schalten die App **nicht** um.
- Im Cloud-Modus werden keine lokalen Dexie-Rezepte als Cloud-Daten angezeigt.
- Login, Logout, Bootstrap, fehlende Mitgliedschaft und Netzwerkfehler sind
  unit-getestet und mit dem Betreiberkonto live durchgespielt.

## Rezeptbibliothek im Cloud-Modus (A3.1)

- Bibliothek, Detail und Editor verwenden die bestehenden React-Komponenten.
- **Live im Browser bestanden:** Rezept anlegen, bearbeiten und löschen;
  Realtime für INSERT/UPDATE/DELETE zwischen zwei gleichzeitig geöffneten
  Tabs; Konflikt beim gleichzeitigen Bearbeiten (`PT409`, kein Overwrite);
  Testrezept anschließend gelöscht (`records = 0`).
- **Nicht live getestet:** Wochenplan, Einkauf und Kochmodus.

## Rezeptbilder im Cloud-Modus (A3.2)

- Bilddateien liegen ausschließlich im privaten Bucket `recipe-images` unter
  `{recipeId}/{imageId}`. Eine Ersetzung nutzt einen neuen Pfad mit
  Generationssuffix; die alte Datei wird erst nach erfolgreichem
  Metadaten-Schreiben gelöscht.
- Bild-Metadaten (`id`, `recipeId`, `position`, `mimeType`, `size`,
  `storagePath`, `createdAt`, `updatedAt`) liegen in der Cloud-Collection
  `images` in `public.records`. Signed URLs werden nie in der Datenbank
  gespeichert.
- Anzeige ausschließlich über authentifizierte Signed URLs (eine Stunde
  gültig, Erneuerung fünf Minuten vor Ablauf). Der URL-Cache lebt nur im
  Arbeitsspeicher und wird beim Logout verworfen.
- Rezept und Bild-Metadaten werden in einem atomaren `apply_ops`-Aufruf
  gespeichert. Neue Dateien werden vorher hochgeladen und bei einem Fehler
  bestmöglich wieder entfernt. Schlägt das Löschen einer nicht mehr
  referenzierten Datei fehl, zeigt die Oberfläche einen Hinweis.
- **Unit-getestet:** Upload, mehrere Bilder, Reihenfolge, Entfernen, Ersetzen,
  fehlgeschlagene Uploads/Metadaten-Transaktionen/Löschvorgänge, Konflikte,
  Realtime-Metadaten, Signed-URL-Cache und unveränderte lokale Bildverwaltung.
- **Live geprüft:** Bucket ist privat, 10 MiB groß und akzeptiert nur
  JPEG/PNG/WebP/GIF/AVIF; die vier Storage-Policies gelten für
  `authenticated`; ein authentifiziertes Haushaltsmitglied konnte in einer
  Transaktion (`ROLLBACK`) eine Objektzeile einfügen und lesen; ein
  authentifizierter Nicht-Mitglieds-Aufruf sah 0 Objekte. Ein Signed-URL-Aufruf
  ohne Sitzung wurde mit HTTP 400 abgelehnt. **Nicht live geprüft:** der
  vollständige Browser-Upload/-Download mit einem echten Familienkonto.
- Temporäre SQL-Proben wurden zurückgerollt und entfernt; es blieben keine
  Testobjekte oder Testrezepte zurück.

## URL-Rezeptimport (A4-Vorbereitung)

- Die Pages Function `functions/api/recipe-fetch.ts` prüft ein
  Supabase-Access-Token über `/auth/v1/user` und danach die Mitgliedschaft über
  die vorhandene RPC `public.is_household_member()`.
- Es wird nur der öffentliche Publishable-/Anon-Key verwendet; service_role-
  und `sb_secret_`-Schlüssel werden abgelehnt.
- Der Import speichert über den vorhandenen `CloudRecipeImageService` in
  `records` und im privaten Bucket `recipe-images`. Es gibt keinen zweiten
  Rezepteditor und keine neue Zutatenlogik.
- Details: [`docs/url-import-cloud.md`](../docs/url-import-cloud.md).

## Mela-Import und ZIP-Backup (A4.1)

- Der vorhandene Mela-Import nutzt im Cloud-Modus den bestehenden
  `CloudRecipeImageService` und die geladene `recipes`-Collection. Der
  Mela-Parser bleibt unverändert.
- Cloud-Backup und -Restore verwenden dasselbe ZIP-Format wie lokal. Bilder
  werden aus dem privaten Bucket `recipe-images` geladen bzw. dorthin
  zurückgeschrieben.
- Restore ist nur in einen leeren Cloud-Bestand möglich; vorhandene Daten
  werden weder gelöscht noch überschrieben. IDs und Verknüpfungen bleiben
  erhalten.
- Details: [`docs/cloud-import-backup.md`](../docs/cloud-import-backup.md).

## Noch nicht enthalten

- Cloudflare-Pages-Deployment; die Function ist vorbereitet, aber nicht
  veröffentlicht oder live getestet.
- Bestandsmigration lokaler Daten in die Cloud.
- Cloud-Reset oder „Alle Daten löschen“ im Cloud-Modus.

## Hinweis zur Laufzeit

`@supabase/supabase-js` 2.119 verlangt Node.js >= 22. Lokal und im
Cloudflare-Pages-Build muss eine passende Node-Version gesetzt sein.
