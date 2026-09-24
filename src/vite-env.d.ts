/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "parody" (default, public) or "real" (npm run build:private only). REQ-BRD-02. */
  readonly VITE_BRAND_MODE?: 'parody' | 'real';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
