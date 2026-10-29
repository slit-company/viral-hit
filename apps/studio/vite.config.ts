import { readFileSync } from 'node:fs';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, defaultClientConditions, defaultServerConditions } from 'vite';
import { seedDesignPlugin } from '@seed-design/vite-plugin';

import { paraglideCompilerOptions } from './src/config/paraglide';
import { shouldNormalizeProjectAssetMediaRequest } from './src/lib/project-asset-media-request';

const cssLayerOrder = readFileSync(new URL('./src/styles/globals.css', import.meta.url), 'utf8').split('\n')[0];

export default defineConfig({
  // Keep the creation/editor client within its existing budget without adding runtime dependencies.
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'shared-vendor', test: /node_modules/, minShareCount: 2 }] } } } },
  server: {
    host: '127.0.0.1',
    port: 3020,
  },
  resolve: {
    tsconfigPaths: true,
    conditions: ['seed-layered', ...defaultClientConditions],
  },
  ssr: { resolve: { conditions: ['seed-layered', ...defaultServerConditions] }, noExternal: [/^@seed-design\//] },
  plugins: [
    {
      name: 'viral-hit-seed-layer-order',
      enforce: 'pre',
      // Split vendor CSS can load before globals; establish the same cascade before hashing either file.
      transform(source, id) {
        if (id.includes('@seed-design') && id.endsWith('.layered.css')) return `${cssLayerOrder}\n${source}`;
      },
    },
    seedDesignPlugin({ colorMode: 'light-only' }),
    {
      name: 'viral-hit-project-asset-media-routes',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const destination = request.headers['sec-fetch-dest'];
          if (
            shouldNormalizeProjectAssetMediaRequest({
              method: request.method,
              url: request.url,
              destination:
                typeof destination === 'string' ? destination : undefined,
            })
          ) {
            delete request.headers['sec-fetch-dest'];
          }
          next();
        });
      },
    },
    // MDX must run before the react plugin so JSX in compiled MDX gets transformed.
    { enforce: 'pre', ...mdx({ providerImportSource: '@mdx-js/react' }) },
    tailwindcss(),
    paraglideVitePlugin(paraglideCompilerOptions),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    nitro(),
  ],
});
