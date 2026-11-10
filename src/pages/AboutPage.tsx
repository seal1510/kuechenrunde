/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Licence, provenance and project information. The legal texts linked here
 * are copied into public/legal/ so they are part of the production build.
 */

function configuredSourceCodeUrl(): string | null {
  const raw = import.meta.env.VITE_SOURCE_CODE_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function AboutPage({
  sourceCodeUrl = configuredSourceCodeUrl(),
}: {
  sourceCodeUrl?: string | null
} = {}) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Über Küchenrunde</h1>
          <p className="muted">Rezepte · Wochenplan · Einkaufsliste</p>
        </div>
        <a className="button" href="#/">
          Zur Bibliothek
        </a>
      </header>

      <section className="panel">
        <h2>Die App</h2>
        <p>
          Küchenrunde ist eine kostenlose Rezept- und Familien-Einkaufslisten-WebApp. Sie läuft
          standardmäßig lokal im Browser; im expliziten Cloud-Modus werden Rezepte, Bilder,
          Wochenplan und Einkaufslisten über eine gemeinsame Familien-Cloud geteilt. Es gibt kein
          Tracking.
        </p>
        <p className="muted">
          Der Cloud-Modus ist optional und wird nur mit <code>VITE_DATA_MODE=cloud</code>{' '}
          aktiviert. Anmeldung und Zugriff erfolgen über den Familienhaushalt. Koch-Timer, Wake Lock
          und der temporäre Kochfortschritt bleiben gerätelokal.
        </p>
      </section>

      <section className="panel">
        <h2>Herkunft</h2>
        <p>
          Küchenrunde ist eine eigenständige Weiterentwicklung auf Basis von{' '}
          <a href="https://github.com/oliexdev/openCook" target="_blank" rel="noreferrer noopener">
            openCook
          </a>{' '}
          von olie.xdev, Copyright (C) 2026 olie.xdev, lizenziert unter GPL-3.0-or-later.
        </p>
        <p>
          Teile des Wochenplaners, des Reconcilers und des Zutatenparsers sind Portierungen aus
          dem Kotlin-Original. Die React-Oberfläche, die Dexie-Datenbank, der Mela-Import, der
          URL-Import und die PWA sind eigenständige Weiterentwicklungen. Die betroffenen Dateien
          und Änderungen sind in der{' '}
          <a href="/legal/NOTICE.txt">NOTICE</a> dokumentiert.
        </p>
        <p className="muted small">
          Küchenrunde ist kein offizielles Projekt von openCook und wird von den openCook-Autoren
          nicht unterstützt.
        </p>
      </section>

      <section className="panel">
        <h2>Lizenz</h2>
        <p>
          Küchenrunde steht unter der GNU General Public License, Version 3 oder später
          (GPL-3.0-or-later). Der vollständige Lizenztext ist im Produktionsbuild unter{' '}
          <a href="/legal/LICENSE.txt">/legal/LICENSE.txt</a> verfügbar.
        </p>
        <ul>
          <li>
            <a href="/legal/LICENSE.txt">GPL-3.0-or-later – vollständiger Lizenztext</a>
          </li>
          <li>
            <a href="/legal/NOTICE.txt">NOTICE – Herkunft, Änderungen und Drittanbieterhinweise</a>
          </li>
          <li>
            <a href="/legal/THIRD-PARTY-LICENSES.txt">
              Drittanbieter-Lizenzen der ausgelieferten Laufzeitbibliotheken
            </a>
          </li>
          <li>
            <a href="/legal/OFF-DATA-NOTICE.txt">Hinweis zu den Open-Food-Facts-Daten</a>
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>Quellcode</h2>
        {sourceCodeUrl ? (
          <>
            <p>
              Der Quellcode dieser Version ist im{' '}
              <a href={sourceCodeUrl} target="_blank" rel="noreferrer noopener">
                öffentlichen Repository
              </a>{' '}
              verfügbar.
            </p>
            <p className="muted small">
              Der Link wird beim Build über <code>VITE_SOURCE_CODE_URL</code> gesetzt. Das
              Repository enthält den Quellcode zum veröffentlichten Stand.
            </p>
          </>
        ) : (
          <p>
            Der zur ausgelieferten Version gehörende Quellcode ist beim Betreiber erhältlich.
            Für eine öffentliche Veröffentlichung wird die Repository-URL beim Build hinterlegt;
            eine unbekannte URL wird bewusst nicht erfunden.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Daten und Dritte</h2>
        <p>
          Die Zutaten-Kategorien und -Synonyme wurden unter Bezug auf die Open-Food-Facts-Taxonomien
          und die Kategorienliste von einkaufslisten-card zusammengestellt. Die
          Open-Food-Facts-Nutzungsbedingungen nennen für die Datenbank ODbL 1.0 und für
          Einzelinhalte DbCL 1.0; der OFF-Servercode steht unter AGPL-3.0. Die konkrete
          Lizenzzuordnung der im Server-Repository liegenden Taxonomiedateien ist noch nicht
          eindeutig geklärt. Dieser offene Punkt ist im{' '}
          <a href="/legal/OFF-DATA-NOTICE.txt">OFF-Hinweis</a> dokumentiert und vor einer
          öffentlichen Veröffentlichung mit Open Food Facts (reuse@openfoodfacts.org) zu klären.
        </p>
        <p>
          Im Cloud-Modus werden die gemeinsamen Rezepte, Bilder, Pläne und Einkaufsdaten bei
          Supabase gespeichert. Die App verwendet dafür ein Supabase-Projekt des Betreibers; die
          Anmeldung erfolgt über Supabase Auth. Die lokalen Daten bleiben davon getrennt.
        </p>
        <p>
          Die Kategorienliste von einkaufslisten-card steht unter der MIT-Lizenz, Copyright (c)
          2026 misterm2310. Die vollständigen Hinweise und Lizenztexte stehen in der{' '}
          <a href="/legal/THIRD-PARTY-LICENSES.txt">Drittanbieter-Lizenzdatei</a>.
        </p>
        <p className="muted small">
          Küchenrunde ist nicht mit Open Food Facts, einkaufslisten-card oder Mela verbunden und
          wird von diesen Projekten nicht unterstützt.
        </p>
      </section>

      <section className="panel">
        <h2>Gewährleistung</h2>
        <p>
          Küchenrunde wird ohne jede Gewährleistung bereitgestellt, soweit dies die Lizenz
          zulässt. Einzelheiten regelt die GPL-3.0-or-later; siehe{' '}
          <a href="/legal/LICENSE.txt">Lizenztext</a>.
        </p>
      </section>
    </div>
  )
}
