# Familienzugang

Küchenrunde nutzt ausschließlich Supabase Auth und die bestehende Tabelle
`public.household_members`. Es gibt keine zweite Anmeldung, keine
Cloudflare-Zugangskontrolle und keine eigene Einladungs- oder Token-Architektur.

## Einladung direkt in Küchenrunde

1. Als Haushaltsadministrator anmelden und **Familie verwalten** (`#/family`)
   öffnen.
2. **Einladungslink erstellen** wählen.
3. Den Link kopieren oder über die native Teilen-Funktion (z. B. WhatsApp)
   weitergeben. Derselbe Link ist sieben Tage gültig und kann von mehreren
   Familienmitgliedern genutzt werden.
4. Aktive Links können in derselben Ansicht widerrufen werden. Die Ansicht
   zeigt **Aktiv**, **Abgelaufen** und **Widerrufen**.

## Beitritt für das Familienmitglied

1. Einladungslink öffnen.
2. Eigenes Konto mit E-Mail und Passwort erstellen oder mit einem bestehenden
   Konto anmelden.
3. Falls Supabase eine E-Mail-Bestätigung verlangt: Link in der E-Mail öffnen.
   Danach geht es automatisch auf der Beitrittsseite weiter.
4. Der Haushalt wird serverseitig und atomar zugeordnet. Die Person sieht
   sofort dieselben Rezepte, Pläne und Einkaufslisten.

Die Sitzung bleibt wie bisher erhalten.

## Sicherheit und Grenzen

- Neue Konten werden nicht automatisch Haushaltsmitglieder. Der Zugang entsteht
  erst durch die Einlösung eines gültigen Einladungslinks.
- Ein Link wird serverseitig atomar geprüft. Mehrere Familienmitglieder können
  denselben Link gleichzeitig einlösen; jedes Konto wird genau einmal
  aufgenommen.
- In der Datenbank liegt nur der SHA-256-Hash des Tokens. Der Klartext wird
  ausschließlich einmal beim Erstellen an den Administrator ausgeliefert.
- Erstellen, Auflisten und Widerrufen sind serverseitig auf
  Haushaltsadministratoren beschränkt. `is_admin` ist ein einzelnes Boolean,
  kein Rollensystem.
- Direkter Tabellenzugriff auf `household_invites` ist für `anon` und
  `authenticated` gesperrt; die RPCs sind der einzige Weg.
- Die bestehenden RLS-Regeln für `records`, Bilder, Wochenplan und Einkäufe
  bleiben unverändert. Nichtmitglieder erhalten keinen Zugriff.
- Ein vorhandenes Konto kann denselben Einladungslink erneut öffnen. Es wird
  kein zweiter Haushaltseintrag angelegt; der Link bleibt für andere gültig.
- Die öffentliche Supabase-Registrierung ist aktiviert, damit die
  Selbstregistrierung funktioniert. Ohne gültigen Einladungslink entsteht
  daraus kein Haushaltszugriff.
- Einladungs-URLs werden aus der aktuellen Browser-URL gebaut und funktionieren
  daher mit `kuechenrunde.pages.dev` wie mit einer späteren eigenen Domain.

## Administrations-Fallback

Der bisherige Weg bleibt bestehen:

```bash
pnpm invite-member "Name des Mitglieds" mitglied@example.org --yes
```

Er nutzt die offizielle Supabase-Einladung per E-Mail und trägt das Konto
anschließend in `household_members` ein. Für den normalen Familienbetrieb ist
die Einladung über **Familie verwalten** der vorgesehene Weg.

## Supabase-Konfiguration

- Site URL: `https://kuechenrunde.pages.dev`
- Erlaubte Redirect-URLs: `https://kuechenrunde.pages.dev`,
  `https://kuechenrunde.pages.dev/**` sowie lokale Entwicklungs-URLs.
- Selbstregistrierung: aktiviert (`disable_signup = false`).
- E-Mail-Bestätigung: derzeit nicht erforderlich (`mailer_autoconfirm =
  true`), damit die Registrierung direkt abgeschlossen werden kann. Die
  Beitrittsseite verarbeitet einen Bestätigungslink trotzdem, falls die
  Bestätigung später aktiviert wird.
- Migration: `supabase/migrations/20261110232000_family_invites.sql`.
