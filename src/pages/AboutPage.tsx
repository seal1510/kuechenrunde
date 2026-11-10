/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Licence, provenance and project information. The legal texts linked here
 * are copied into public/legal/ so they are part of the production build.
 */

export function AboutPage() {
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
          Küchenrunde ist eine kostenlose, lokal laufende Rezept- und Familien-Einkaufslisten-WebApp.
          Rezepte, Wochenplan, Einkaufslisten und Einstellungen bleiben im Browser gespeichert.
          Es gibt keine Konten, keine Cloud und kein Tracking.
        </p>
        <p className="muted">
          Der aktuelle Stand ist eine lokale App. Eine gemeinsame Familien-Cloud mit
          Synchronisierung ist geplant, aber noch nicht implementiert.
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
        <p>
          Ein öffentliches Quellcode-Repository ist noch nicht festgelegt. Vor einer
          öffentlichen Veröffentlichung wird hier die URL des Repositorys mit dem exakten
          Versions-Tag oder Commit ergänzt.
        </p>
        <p className="muted small">
          Bis dahin gilt: Der zur ausgelieferten Version gehörende Quellcode ist auf Anfrage
          beim Betreiber erhältlich. Kontaktangabe und Quellcode-URL sind vor dem öffentlichen
          Release zu ergänzen.
        </p>
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
          öffentlichen Veröffentlichung zu klären.
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
