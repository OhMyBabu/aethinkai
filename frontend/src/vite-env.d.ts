/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_BASE_URL?: string;
  readonly VITE_GATEWAY_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
