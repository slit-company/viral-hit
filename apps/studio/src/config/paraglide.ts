import type { CompilerOptions } from '@inlang/paraglide-js';

export const paraglideCompilerOptions = {
  project: './project.inlang',
  outdir: './src/paraglide',
  outputStructure: 'message-modules',
  cookieName: 'PARAGLIDE_LOCALE',
  // On unprefixed links, honor a saved choice first, then the browser's
  // preferred language. Explicit localized links always win below.
  strategy: ['cookie', 'preferredLanguage', 'url', 'baseLocale'],
  routeStrategies: [
    {
      match: '/ko/:path(.*)?',
      strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
    },
    {
      match: '/zh/:path(.*)?',
      strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
    },
    {
      match: '/ja/:path(.*)?',
      strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
    },
  ],
  urlPatterns: [
    // API endpoints are never locale-prefixed.
    {
      pattern: '/api/:path(.*)?',
      localized: [
        ['zh', '/api/:path(.*)?'],
        ['en', '/api/:path(.*)?'],
        ['ja', '/api/:path(.*)?'],
        ['ko', '/api/:path(.*)?'],
      ],
    },
    // English is the primary locale and stays unprefixed; other languages use their locale prefix.
    {
      pattern: '/',
      localized: [
        ['en', '/'],
        ['zh', '/zh'],
        ['ja', '/ja'],
        ['ko', '/ko'],
      ],
    },
    // "as-needed" prefix: English unprefixed, other languages prefixed.
    {
      pattern: '/:path(.*)?',
      localized: [
        ['zh', '/zh/:path(.*)?'],
        ['ja', '/ja/:path(.*)?'],
        ['ko', '/ko/:path(.*)?'],
        ['en', '/:path(.*)?'],
      ],
    },
  ],
} satisfies CompilerOptions;
