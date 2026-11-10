# Mela-Import und Backup im Cloud-Modus

Stand: implementiert und getestet, **nicht veröffentlicht**. Cloudflare Pages
ist noch nicht eingerichtet.

## Mela-Import

Die vorhandene Mela-Importseite wird unverändert weiterverwendet. Im
Cloud-Modus werden nur drei Persistenzfunktionen ausgetauscht:

- Dublettenprüfung über die `recipes`-Collection des geladenen Cloud-Snapshots,
- Speichern über den vorhandenen `CloudRecipeImageService` (privater Bucket
  `recipe-images`, atomare Rezept-/Bild-Metadaten),
- kein lokales „Testdaten löschen“; die Schaltfläche wird im Cloud-Modus
  ausgeblendet.

Der Mela-Parser und die reine Abbildung `ParsedMelaRecipe → Recipe` bleiben
gemeinsam. Bilder mit einem im Cloud-Bucket nicht erlaubten Format (z. B. HEIC)
oder über 10 MB werden mit einer sichtbaren Warnung übersprungen; das Rezept
selbst wird gespeichert. Schlägt ein Bild-Upload fehl, wird kein unvollständiges
Rezept angelegt.

## ZIP-Backup

Export und Restore verwenden dasselbe versionierte ZIP-Format wie der lokale
Modus (`opencook-web-backup`, aktuell v13). Der Cloud-Export liest den geladenen
Cloud-Snapshot und lädt die Bildbytes aus dem privaten Supabase-Storage. Die
ZIP-Datei wird als normale Datei auf das Gerät heruntergeladen.

Enthalten sind:

- Rezepte inklusive Originaldaten und Import-Metadaten,
- Bilder aus `recipe-images`,
- Wochenplanung (`mealPlans`, `mealDays`, `cookSessions`, `dayNotes`,
  `freeDishes`),
- Einkaufslisten, manuelle Artikel, Käufe, Regeln, Mengenkorrekturen und
  Zuordnungen,
- gemeinsame Einstellungen.

Kochfortschritt und Timer bleiben gerätelokal und sind nicht Teil des Backups.

Schlägt ein Bild-Download oder das Erstellen des ZIP fehl, wird keine
unvollständige Datei als erfolgreiches Backup ausgegeben.

## Cloud-Restore

- Die vorhandene Backup-Prüfung (`inspectBackup`) wird mit
  `compareLocal: false` verwendet; sie liest keine lokale Dexie-Datenbank.
- Vor der Wiederherstellung wird geprüft, ob der Cloud-Bestand leer ist. Bei
  vorhandenen Daten wird die Wiederherstellung mit einer verständlichen Meldung
  verweigert. Es gibt kein automatisches Zurücksetzen und kein Überschreiben.
- Rezept-, Bild-, Planungs-, Einkaufs- und Einstellungs-IDs bleiben erhalten;
  Verknüpfungen zwischen Rezepten, Kochvorgängen, Essensterminen und
  Einkaufslisten werden vor dem Schreiben validiert.
- Alle Metadaten werden in **einem** atomaren `apply_ops`-Aufruf geschrieben.
  Bilder werden vorher hochgeladen. Bei einem Fehler werden nur die in diesem
  Versuch hochgeladenen Dateien entfernt.
- Vor einem erneuten Versuch werden die Zielpfade der Bilder geleert. Dadurch
  sind Reste eines abgebrochenen Uploads unschädlich. Ist der Metadaten-Commit
  unklar, werden hochgeladene Dateien vorsichtshalber nicht gelöscht; die
  Oberfläche verlangt dann eine Prüfung/Neuladen.
- Es gibt keinen Merge- oder Mehrfachdatenbank-Assistenten.

## Grenzen

- Keine Bestandsmigration lokaler Daten in die Cloud.
- Kein Cloud-Reset und kein „Alle Daten löschen“ im Cloud-Modus.
- Cloud-Restore nur in einen leeren Cloud-Bestand.
- Keine Hintergrundjobs oder automatische Bereinigung.
- Kein Deployment und keine Cloudflare-Pages-Veröffentlichung.

## Manuelle Browserprüfung

1. Im Cloud-Modus `#/import` öffnen, eine `.melarecipe`- und eine
   `.melarecipes`-Datei importieren; Vorschau, Dubletten und Ergebnis prüfen.
2. Import mit Bild: Bild in der Cloud-Bibliothek und im Rezepteditor prüfen.
3. `#/backup` öffnen, Backup herunterladen und die ZIP außerhalb der App öffnen.
4. Cloud-Bestand leeren (nur in einer Testumgebung) und das Backup über
   `#/backup` wiederherstellen; Rezepte, Bilder, Planung und Einkauf prüfen.
5. Bei nicht leerem Cloud-Bestand erneut wiederherstellen: Die App muss die
   Wiederherstellung verweigern und die vorhandenen Daten unverändert lassen.
6. Lokalen Modus prüfen: Mela-Import, Backup, Merge/Replace und Testdaten-Reset
   müssen unverändert funktionieren.
