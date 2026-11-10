/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Expliziter Datenmodus: "local" (Standard) oder "cloud". */
  readonly VITE_DATA_MODE?: string
  /** Öffentliche Supabase-Projekt-URL, z. B. https://abcdefgh.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Öffentlicher Publishable-/Anon-Key. Niemals service_role. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Optionaler Pfad des URL-Import-Endpunkts. */
  readonly VITE_RECIPE_FETCH_ENDPOINT?: string
  /** Öffentliche Quellcode-URL für „Über Küchenrunde“. */
  readonly VITE_SOURCE_CODE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
