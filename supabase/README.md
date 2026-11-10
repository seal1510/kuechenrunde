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

4. In **Authentication → Users** pro Familienmitglied ein Konto mit
   E-Mail + Initialpasswort anlegen und „Auto Confirm User“ setzen.
   Öffentliche Registrierung bleibt deaktiviert.
5. Mitgliedschaft eintragen (nur über den Betreiber, nie aus der App):

   ```sql
   insert into public.household_members (user_id, display_name)
   select id, 'Name des Mitglieds'
   from auth.users
   where email = 'mitglied@example.org';
   ```

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
- `disable_signup = true`; anonyme Authentifizierung ist deaktiviert.
- `pnpm supabase db advisors --type security` meldet keine Befunde.
- Keine App-Daten vorhanden: `records`, `household_members` und `auth.users`
  enthalten jeweils 0 Zeilen.

**Noch offen – erfordert ein echtes Mitgliedskonto:**

- `apply_ops()`-CAS und Atomizität als Mitglied (erwarteter Konflikt `PT409`).
- Realtime-Zustellung eines INSERT/UPDATE/DELETE an einen echten Client.
- Storage-Upload/Download als Mitglied inklusive signed URL.
- Vollständiger Login über die spätere Auth-Oberfläche.

Die RLS-Tests liefen direkt auf der Datenbank über
`pnpm supabase db query --remote --yes -f <datei>` mit
`BEGIN; SET LOCAL ROLE ...; SET LOCAL request.jwt.claim.sub ...; ROLLBACK;`.
Es wurden keine Benutzer und keine dauerhaften Daten angelegt.

## Frontend-Modus (A2)

- **Standard:** `VITE_DATA_MODE` fehlt oder ist `local` → die bisherige lokale
  Dexie-App läuft unverändert.
- **Cloud:** `VITE_DATA_MODE=cloud` plus `VITE_SUPABASE_URL` und
  `VITE_SUPABASE_PUBLISHABLE_KEY` → Login, Session-Verwaltung und Laden des
  gemeinsamen Snapshots. Danach zeigt die App nur einen Bereitschaftszustand.
- Die Supabase-Variablen allein schalten die App **nicht** um.
- Im Cloud-Modus werden keine lokalen Dexie-Rezepte als Cloud-Daten angezeigt.
- Login, Logout, Bootstrap, fehlende Mitgliedschaft und Netzwerkfehler sind
  durch Unit-Tests abgedeckt. Der echte Login mit einem Familienkonto ist noch
  offen.

## Noch nicht enthalten

- Umschaltung der App auf den Cloud-Adapter (`src/db.ts` bleibt lokal).
- Login-Oberfläche und Auth-Gate.
- Bild-Upload/Download und signed URLs.
- ZIP-Migration der lokalen Daten.
- Cloudflare-Pages-Deployment und URL-Import-Function.

## Hinweis zur Laufzeit

`@supabase/supabase-js` 2.119 verlangt Node.js >= 22. Lokal und im
Cloudflare-Pages-Build muss eine passende Node-Version gesetzt sein.
