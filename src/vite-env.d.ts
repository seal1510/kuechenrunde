/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Öffentliche Supabase-Projekt-URL, z. B. https://abcdefgh.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Öffentlicher Publishable-/Anon-Key. Niemals service_role. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Optionaler Pfad des URL-Import-Endpunkts. */
  readonly VITE_RECIPE_FETCH_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
