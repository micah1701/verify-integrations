import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ mode }) => {
  // loadEnv with empty prefix loads ALL .env vars (not just VITE_*) into the config.
  // process.env alone won't have .env values — Vite only populates import.meta.env for client code.
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [
    svelte({
      // Compile component styles to JS that injects a <style> tag at runtime.
      // Combined with emitCss: false, this keeps the bundle a single .js file.
      emitCss: false,
      compilerOptions: { css: 'injected' },
    }),
  ],
  define: {
    // Baked in at build time via env var; replace with your BC app's client_id.
    // Used only for /customer/current.jwt storefront endpoint.
    __ADHOC_BC_CLIENT_ID__: JSON.stringify(env.ADHOC_BC_CLIENT_ID ?? ''),
  },
  build: {
    lib: {
      entry: 'src/bigcommerce/storefront/entry.ts',
      name: 'AdHocVerify',
      formats: ['iife'],
      fileName: () => 'bigcommerce.js',
    },
    outDir: 'dist/storefront',
    // Inline all assets — result must be a single self-contained .js file
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
  };
});
