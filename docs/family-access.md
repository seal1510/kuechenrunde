# Familienzugang

Küchenrunde nutzt ausschließlich Supabase Auth und die bestehende Tabelle
`public.household_members`. Es gibt keine zweite Anmeldung, keine
Cloudflare-Zugangskontrolle und keine eigene Einladungs- oder Token-Architektur.

## Ablauf für ein neues Familienmitglied

1. Der Betreiber nennt Name und E-Mail-Adresse des Mitglieds.
2. Einmalig in der Supabase CLI angemeldet sein:

   ```bash
   pnpm supabase login
   ```

3. Einladung auslösen:

   ```bash
   pnpm invite-member "Name des Mitglieds" mitglied@example.org --yes
   ```

   Das Skript nutzt die offizielle Supabase-Funktion
   `POST /auth/v1/invite` und trägt das neue Konto anschließend ausdrücklich in
   `public.household_members` ein. Es verschickt keine eigene E-Mail und
   speichert keinen privilegierten Admin-Key.

4. Das Mitglied öffnet den Einladungslink aus der Supabase-E-Mail, legt auf der
   Küchenrunde-Seite sein eigenes Passwort fest und meldet sich an.
5. Danach sieht es dieselbe Rezeptbibliothek, denselben Wochenplan und dieselben
   Einkaufslisten. Die Sitzung bleibt wie bisher erhalten.

Ein trockener Probelauf ohne E-Mail und ohne Datenbankänderung:

```bash
pnpm invite-member "Name des Mitglieds" mitglied@example.org --dry-run
```

## Sicherheit und Grenzen

- Neue Konten werden nicht automatisch Haushaltsmitglieder. Die Freigabe
  erfolgt ausschließlich durch den ausdrücklichen `invite-member`-Aufruf des
  Betreibers.
- Die vorhandenen RLS-Regeln bleiben maßgeblich. Nichtmitglieder erhalten
  weder Rezepte noch Bilder, Wochenplan oder Einkäufe; die App zeigt ihnen
  eine verständliche Meldung.
- Der privilegierte Supabase-Admin-Key (Secret-Key) wird nur zur Laufzeit des
  Betreiber-Skripts über die Supabase Management API geladen. Er wird weder
  ausgegeben noch gespeichert und gelangt nicht in den Browser-Build.
- Öffentliche Registrierung bleibt deaktiviert. Es werden nur eingeladene
  Konten angelegt.
- Ein abgelaufener Einladungslink führt zu einer verständlichen Meldung mit der
  Bitte um eine neue Einladung.

## Supabase-Konfiguration

- Site URL: `https://kuechenrunde.pages.dev`
- Erlaubte Redirect-URLs: `https://kuechenrunde.pages.dev`,
  `https://kuechenrunde.pages.dev/**` sowie die lokalen Entwicklungs-URLs
  `http://localhost:3000/**` und `http://127.0.0.1:3000/**`.
- Der Einladungslink wird auf die Produktions-URL zurückgeleitet; die App
  übernimmt die Auth-Parameter im Hash und zeigt die Passwort-Einrichtung.
- Der Einladungsversand nutzt den in Supabase konfigurierten E-Mail-Versand.
  Es ist kein eigener SMTP- oder Token-Dienst erforderlich.
