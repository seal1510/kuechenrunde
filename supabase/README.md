# Supabase-Grundlage (Etappe A1)

Diese Migration legt die gemeinsame Cloud-Basis für **einen** Familienhaushalt
an. Sie ist noch **nicht** an die App angeschlossen: `src/db.ts`, alle Services
und alle Seiten arbeiten weiterhin ausschließlich lokal mit Dexie.

## Anwenden

1. Supabase-Projekt anlegen (Region EU empfohlen).
2. `supabase/migrations/0001_cloud.sql` im **SQL-Editor** als `postgres`
   ausführen. Die Datei ist in eine Transaktion eingefasst und kann bei einem
   Fehler vollständig zurückgerollt werden.
3. In **Authentication → Users** pro Familienmitglied ein Konto mit
   E-Mail + Initialpasswort anlegen und „Auto Confirm User“ setzen.
   Öffentliche Registrierung bleibt deaktiviert.
4. Mitgliedschaft eintragen (nur über den Betreiber, nie aus der App):

   ```sql
   insert into public.household_members (user_id, display_name)
   select id, 'Name des Mitglieds'
   from auth.users
   where email = 'mitglied@example.org';
   ```

5. `.env.example` nach `.env` kopieren und `VITE_SUPABASE_URL` sowie
   `VITE_SUPABASE_ANON_KEY` eintragen. Nur der öffentliche
   Publishable-/Anon-Key; **niemals** `service_role`.

## Sicherheitsmodell

- `public.records` enthält alle App-Daten als `(collection, id, rev, data)`.
- RLS lässt ausschließlich authentifizierte Mitglieder aus
  `public.household_members` zu.
- `is_household_member()`, `apply_ops()` und `snapshot()` sind
  `SECURITY INVOKER`; es gibt keinen Definer-Pfad um RLS herum.
- `household_members` hat nur eine SELECT-Policy auf die eigene Zeile.
  INSERT/UPDATE/DELETE sind für `authenticated` entzogen.
- `apply_ops()` prüft die Mitgliedschaft zusätzlich explizit und verweigert
  sonst mit `42501`.
- Schreibvorgänge nutzen `expected_rev` (Compare-and-Swap). Ein veralteter
  Stand führt zu `PT409` statt zu stillem Überschreiben.
- Der Bucket `recipe-images` ist privat, auf 10 MB pro Datei und gängige
  Bild-MIME-Typen begrenzt.

## Was mit echtem Supabase geprüft werden muss

Ohne Projektzugang sind nur statische SQL-Prüfungen und Unit-Tests möglich.
Folgende Punkte sind **Live-Tests** und noch offen:

1. Migration läuft im SQL-Editor fehlerfrei durch (inkl. `storage`-Policies und
   `alter publication`).
2. `anon` erhält auf `records` keine Zeilen und keine Schreibrechte.
3. Ein angemeldeter Nutzer **ohne** `household_members`-Zeile bekommt
   `snapshot() = []`, bei `apply_ops()` den Fehler `42501` und bei Storage
   keinen Zugriff.
4. Ein Mitglied kann lesen/schreiben; der `rev`-Trigger erhöht die Revision bei
   jedem Update.
5. Zwei Clients mit derselben Ausgangsrevision: der zweite Schreibvorgang
   erhält `PT409`; die erste Änderung bleibt erhalten.
6. Realtime liefert INSERT/UPDATE/DELETE inklusive `old.collection`/`old.id`
   (dafür ist `replica identity full` gesetzt).
7. Der Bucket ist nicht öffentlich; signed URLs funktionieren nur mit
   Mitglieds-Session.
8. `household_members`-INSERT als `authenticated` wird verweigert.

## Noch nicht enthalten

- Umschaltung der App auf den Cloud-Adapter (`src/db.ts` bleibt lokal).
- Login-Oberfläche und Auth-Gate.
- Bild-Upload/Download und signed URLs.
- ZIP-Migration der lokalen Daten.
- Cloudflare-Pages-Deployment und URL-Import-Function.

## Hinweis zur Laufzeit

`@supabase/supabase-js` 2.119 verlangt Node.js >= 22. Lokal und im
Cloudflare-Pages-Build muss eine passende Node-Version gesetzt sein.
