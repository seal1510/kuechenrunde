import { lazy, Suspense } from 'react'
import { dataMode, dataModeConfig } from './data/dataMode'
import { LocalApp } from './LocalApp'

/**
 * Der Cloud-Teil wird nur geladen, wenn VITE_DATA_MODE=cloud gesetzt ist.
 * Im lokalen Modus bleibt das bisherige Bundle und Verhalten unangetastet.
 */
const CloudApp = lazy(() =>
  import('./cloud/CloudApp').then((module) => ({ default: module.CloudApp })),
)

function DataModeProblem({ message }: { message: string }) {
  return (
    <div className="page">
      <section className="panel">
        <h1>Konfiguration ungültig</h1>
        <p>{message}</p>
        <p className="muted">
          Küchenrunde startet nicht stillschweigend im lokalen Modus, wenn der
          Cloud-Modus falsch konfiguriert ist.
        </p>
      </section>
    </div>
  )
}

function CloudFallback() {
  return (
    <div className="page">
      <section className="panel">
        <p className="muted" role="status">
          Cloud-Oberfläche wird geladen …
        </p>
      </section>
    </div>
  )
}

export default function App() {
  if (dataModeConfig.error) {
    return <DataModeProblem message={dataModeConfig.error} />
  }
  if (dataMode === 'local') {
    return <LocalApp />
  }
  return (
    <Suspense fallback={<CloudFallback />}>
      <CloudApp />
    </Suspense>
  )
}
