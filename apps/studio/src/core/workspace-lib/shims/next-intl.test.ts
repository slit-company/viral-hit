import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLocale, overwriteGetLocale } from '@/paraglide/runtime.js';
import { useTranslations, getTranslations } from './next-intl';

test('legacy translations preserve every nested key in all locales after dropping duplicate flat product messages', async () => {
  const previous = getLocale;
  try {
    for (const locale of ['en', 'zh', 'ja'] as const) {
      overwriteGetLocale(() => locale);
      const messages = JSON.parse(readFileSync('messages/' + locale + '.json', 'utf8')) as Record<string, unknown>;
      async function check(value: unknown, path: string[]) {
        if (typeof value === 'string') {
          const namespace = path.slice(0, -1).join('.'), key = path.at(-1)!;
          assert.equal(useTranslations(namespace)(key), value, locale + ':' + path.join('.'));
          assert.equal(await getTranslations(namespace)(key), value);
        } else if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) await check(child, [...path, key]);
        }
      }
      for (const [key, value] of Object.entries(messages)) if (value && typeof value === 'object') await check(value, [key]);
      assert.equal(useTranslations('Unknown')('missing'), 'missing');
    }
  } finally { overwriteGetLocale(previous); }
});
