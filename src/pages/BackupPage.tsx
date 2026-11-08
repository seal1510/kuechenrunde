import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  exportBackup,
  inspectBackup,
  restoreBackup,
  type BackupInspection,
  type RestoreResult,
} from '../backup/backup'
import { deleteAllData } from '../import/importer'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE')
  } catch {
    return iso
  }
}

export function BackupPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)

  async function handleExport() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { bytes, manifest } = await exportBackup()
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const blob = new Blob([copy.buffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `opencook-backup-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
      setMessage(
        `Backup mit ${manifest.counts.recipes} Rezepten, ${manifest.counts.images} Bildern, ` +
          `${manifest.counts.mealPlans} Essensterminen, Einkaufsdaten und Einstellungen heruntergeladen.`,
      )
    } catch (cause) {
      setError((cause as Error).message || 'Das Backup konnte nicht erstellt werden.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setMessage('')
    setResult(null)
    setConfirmReplace(false)
    setFileName(file.name)
    try {
      const inspectionData = await inspectBackup(await file.arrayBuffer())
      setInspection(inspectionData)
    } catch (cause) {
      setInspection(null)
      setError((cause as Error).message || 'Das Backup konnte nicht gelesen werden.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleDeleteAll() {
    setDeletingAll(true)
    setError('')
    setMessage('')
    try {
      await deleteAllData()
      setInspection(null)
      setResult(null)
      setConfirmDeleteAll(false)
      setMessage('Alle lokalen Rezepte, Bilder und Wochenpläne wurden gelöscht. Einstellungen bleiben erhalten.')
    } catch (cause) {
      setError((cause as Error).message || 'Die Daten konnten nicht gelöscht werden.')
    } finally {
      setDeletingAll(false)
    }
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!inspection) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const restored = await restoreBackup(inspection, mode)
      setResult(restored)
      setConfirmReplace(false)
      setInspection(null)
    } catch (cause) {
      setError((cause as Error).message || 'Die Wiederherstellung ist fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const conflicts = inspection
    ? inspection.conflicts.recipes +
      inspection.conflicts.mealPlans +
      inspection.conflicts.mealDays +
      inspection.conflicts.settings +
      inspection.conflicts.cookSessions +
      inspection.conflicts.dayNotes +
      inspection.conflicts.freeDishes
    : 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Backup & Wiederherstellung</h1>
          <p className="muted">
            Vollständiges ZIP mit Rezepten, Bildern, Tags, Essensplan, Kochvorgängen,
            Tagesnotizen und Einstellungen.
          </p>
        </div>
        <a className="button" href="#/">
          Zur Bibliothek
        </a>
      </header>

      <section className="panel">
        <h2>Backup erstellen</h2>
        <p className="muted">
          Enthält alle Rezepte inklusive Originalangaben, Bilder, Kategorien, Tags, Essensplan,
          Kochvorgänge, Tagesflags, Tagesnotizen und die Haushaltsgröße. Die Datei bleibt
          ausschließlich lokal.
        </p>
        <button type="button" className="button primary" onClick={handleExport} disabled={busy}>
          {busy ? 'Erstelle …' : 'Backup herunterladen'}
        </button>
      </section>

      <section className="panel">
        <h2>Backup wiederherstellen</h2>
        <p className="muted">
          Die Datei wird zuerst geprüft und als Vorschau angezeigt. Beim Zusammenführen bleiben
          lokale Rezepte und Pläne bei Konflikten unverändert; beim Ersetzen wird der lokale Bestand
          erst nach ausdrücklicher Bestätigung gelöscht.
        </p>
        <label className="file-picker">
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleFile}
            disabled={busy}
          />
          Backup-Datei auswählen
        </label>
        {fileName ? <p className="muted small">Ausgewählt: {fileName}</p> : null}
      </section>

      {message ? <div className="notice">{message}</div> : null}

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      {inspection ? (
        <section className="panel">
          <h2>Vorschau</h2>
          <p className="muted">
            Erstellt am {formatDate(inspection.manifest.createdAt)} · Formatversion{' '}
            {inspection.manifest.version}
          </p>
          <ul className="backup-counts">
            <li><strong>{inspection.recipes.length}</strong> Rezepte</li>
            <li><strong>{inspection.freeDishes.length}</strong> Freie Gerichte</li>
            <li><strong>{inspection.images.length}</strong> Bilder</li>
            <li><strong>{inspection.mealPlans.length}</strong> Essenstermine</li>
            <li><strong>{inspection.cookSessions.length}</strong> Kochvorgänge</li>
            <li><strong>{inspection.mealDays.length}</strong> Tagesflags</li>
            <li><strong>{inspection.dayNotes.length}</strong> Tagesnotizen</li>
            <li><strong>{inspection.settings.length}</strong> Einstellungen</li>
          </ul>

          {inspection.warnings.length > 0 ? (
            <div className="notice">
              <p>
                <strong>Hinweise zur Datenprüfung:</strong>
              </p>
              <ul>
                {inspection.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {conflicts > 0 ? (
            <div className="notice">
              <p>
                <strong>{conflicts} Konflikt(e):</strong> {inspection.conflicts.recipes} Rezepte,{' '}
                {inspection.conflicts.mealPlans} Essenstermine, {inspection.conflicts.cookSessions}{' '}
                Kochvorgänge, {inspection.conflicts.mealDays} Tagesflags,{' '}
                {inspection.conflicts.dayNotes} Tagesnotizen,{' '}
                {inspection.conflicts.freeDishes} freie Gerichte,{' '}
                {inspection.conflicts.settings} Einstellungen existieren bereits.
              </p>
              <p className="muted small">
                „Zusammenführen“ lässt lokale Einträge gewinnen und ergänzt nur fehlende.
                „Lokal ersetzen“ übernimmt das Backup vollständig.
              </p>
            </div>
          ) : (
            <p className="muted">Keine Konflikte mit dem lokalen Bestand.</p>
          )}

          <div className="notice-actions">
            <button type="button" className="button primary" onClick={() => void restore('merge')} disabled={busy}>
              Zusammenführen (lokal gewinnt)
            </button>
            {!confirmReplace ? (
              <button type="button" className="button danger" onClick={() => setConfirmReplace(true)} disabled={busy}>
                Lokal ersetzen …
              </button>
            ) : (
              <>
                <button type="button" className="button danger" onClick={() => void restore('replace')} disabled={busy}>
                  Wirklich alles ersetzen
                </button>
                <button type="button" className="button" onClick={() => setConfirmReplace(false)} disabled={busy}>
                  Abbrechen
                </button>
              </>
            )}
          </div>
          {confirmReplace ? (
            <div className="notice danger">
              <p>
                Beim Ersetzen werden alle lokalen Rezepte, Bilder, Essenstermine, Kochvorgänge,
                Wochenpläne, Tagesnotizen, Einkaufslisten und Einstellungen gelöscht und durch das
                Backup ersetzt. Diese Aktion ist nicht umkehrbar.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section className="panel">
          <h2>Ergebnis</h2>
          <p>
            {result.mode === 'replace' ? 'Lokal ersetzt.' : 'Zusammengeführt.'} {result.addedRecipes}{' '}
            Rezepte, {result.addedFreeDishes} freie Gerichte, {result.addedImages} Bilder,{' '}
            {result.addedMealPlans} Essenstermine, {result.addedCookSessions} Kochvorgänge,{' '}
            {result.addedDayNotes} Tagesnotizen, {result.addedShoppingManualItems} manuelle
            Einkaufsartikel, {result.addedShoppingPurchases} Einkäufe und{' '}
            {result.addedShoppingQuantityCorrections} Mengenkorrekturen übernommen.
          </p>
          {result.detachedMealLinks > 0 ? (
            <p className="muted">
              {result.detachedMealLinks} Essenstermin(e) behielten ihre Portionen, aber die
              Verknüpfung zu einem fehlenden Kochvorgang wurde gelöst.
            </p>
          ) : null}
          {result.skippedRecipes > 0 ? (
            <p className="muted">
              {result.skippedRecipes} Rezept(e) blieben wegen lokaler Konflikte unverändert.
            </p>
          ) : null}
          {result.skippedFreeDishes > 0 ? (
            <p className="muted">
              {result.skippedFreeDishes} freie(s) Gericht(e) blieben lokal unverändert.
            </p>
          ) : null}
          {result.skippedDayNotes > 0 ? (
            <p className="muted">
              {result.skippedDayNotes} Tagesnotiz(en) blieben lokal unverändert.
            </p>
          ) : null}
          <a className="button primary" href="#/">
            Zur Bibliothek
          </a>
        </section>
      ) : null}

      <section className="panel danger-zone">
        <h2>Datenverwaltung</h2>
        <p className="muted small">
          Alle lokalen Rezepte, Bilder, Essenstermine, Kochvorgänge, freien Gerichte, Tagesflags
          und Tagesnotizen löschen. Die Haushaltsgröße bleibt erhalten. Ein Backup vorher wird
          ausdrücklich empfohlen.
        </p>
        {confirmDeleteAll ? (
          <div className="notice danger">
            <p>
              Wirklich <strong>alle</strong> Rezeptdaten und Wochenpläne löschen? Das kann nicht
              rückgängig gemacht werden.
            </p>
            <div className="notice-actions">
              <button type="button" className="button danger" onClick={handleDeleteAll} disabled={deletingAll}>
                {deletingAll ? 'Lösche …' : 'Endgültig löschen'}
              </button>
              <button type="button" className="button" onClick={() => setConfirmDeleteAll(false)}>
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="button danger-quiet" onClick={() => setConfirmDeleteAll(true)}>
            Alle Rezeptdaten löschen
          </button>
        )}
      </section>
    </div>
  )
}
