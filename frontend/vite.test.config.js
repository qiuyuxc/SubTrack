import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

/**
 * The tests import the real Worker (`worker/src/**`), which reaches the Workers
 * runtime through `cloudflare:sockets`. The tests always inject their own socket
 * connector, so the specifier only has to survive bundling — resolving it would
 * fail outside workerd.
 */
const external = [/^node:/, 'jsdom', 'cloudflare:sockets'];

/**
 * Test builds. `--mode render` produces an SSR bundle (used to render every
 * view in Node); `--mode client` produces a browser bundle mounted in jsdom.
 * Vue stays external in the SSR pass and is inlined in the client pass so the
 * DOM shim is installed before runtime-dom is evaluated.
 */
export default defineConfig(({ mode }) => {
  if (mode === 'client') {
    return {
      plugins: [vue()],
      resolve: { alias },
      build: {
        ssr: false,
        outDir: '.client-out',
        emptyOutDir: true,
        minify: false,
        target: 'esnext',
        // jsdom never fires <link rel="stylesheet"> load events, so Vite's
        // dynamic-import preload helper would stall lazy routes forever.
        // One CSS file for the whole bundle keeps those deps empty.
        cssCodeSplit: false,
        rollupOptions: {
          // The bundle runs in Node with a DOM shim, so builtins stay external.
          external,
          input: { client: fileURLToPath(new URL('./test/client.mjs', import.meta.url)) },
          output: { entryFileNames: '[name].js', format: 'es' },
        },
      },
    };
  }

  return {
    plugins: [vue()],
    resolve: { alias },
    build: {
      ssr: true,
      outDir: '.ssr-out',
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        external,
        input: { render: fileURLToPath(new URL('./test/render.mjs', import.meta.url)) },
        output: { entryFileNames: '[name].js' },
      },
    },
  };
});
