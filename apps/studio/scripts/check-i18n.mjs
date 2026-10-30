#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const hanPattern = /\p{Script=Han}/u;
const nonEnglishPattern = /[\p{Script=Han}\p{Script=Hangul}]/u;
const placeholderPattern = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const localeOptionalPlaceholders = new Set(['{plural}']);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function flattenMessages(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (
      child &&
      typeof child === 'object' &&
      !Array.isArray(child)
    ) {
      flattenMessages(child, nextKey, out);
    } else {
      out[nextKey] = child;
    }
  }
  return out;
}

function walkFiles(relativeDir, predicate, out = []) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return out;

  for (const entry of readdirSync(absoluteDir)) {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(root, absolutePath);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walkFiles(relativePath, predicate, out);
    } else if (predicate(relativePath)) {
      out.push(relativePath);
    }
  }
  return out;
}

function assertNoHanInFile(relativePath, failures) {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (hanPattern.test(line)) {
      failures.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    }
  });
}

const localeCodes = readJson('project.inlang/settings.json').locales;
const messages = Object.fromEntries(
  localeCodes.map((locale) => [
    locale,
    flattenMessages(readJson(`messages/${locale}.json`)),
  ])
);
const en = messages.en;
const failures = [];

for (const locale of localeCodes) {
  const localeMessages = messages[locale];
  const missing = Object.keys(en).filter((key) => !(key in localeMessages));
  const extra = Object.keys(localeMessages).filter((key) => !(key in en));
  if (missing.length > 0) {
    failures.push(
      `Missing ${missing.length} key(s) in messages/${locale}.json:\n${missing
        .slice(0, 50)
        .join('\n')}`
    );
  }
  if (extra.length > 0) {
    failures.push(
      `Extra ${extra.length} key(s) in messages/${locale}.json:\n${extra
        .slice(0, 50)
        .join('\n')}`
    );
  }

  for (const [key, englishValue] of Object.entries(en)) {
    const localizedValue = localeMessages[key];
    if (
      typeof englishValue !== 'string' ||
      typeof localizedValue !== 'string'
    ) {
      continue;
    }
    const englishPlaceholders = [...englishValue.matchAll(placeholderPattern)]
      .map(([placeholder]) => placeholder)
      .filter((placeholder) => !localeOptionalPlaceholders.has(placeholder))
      .sort();
    const localizedPlaceholders = [
      ...localizedValue.matchAll(placeholderPattern),
    ]
      .map(([placeholder]) => placeholder)
      .filter((placeholder) => !localeOptionalPlaceholders.has(placeholder))
      .sort();
    if (englishPlaceholders.join('\0') !== localizedPlaceholders.join('\0')) {
      failures.push(
        `Placeholder mismatch in messages/${locale}.json for ${key}: expected ${englishPlaceholders.join(', ') || '(none)'}, received ${localizedPlaceholders.join(', ') || '(none)'}`
      );
    }
  }
}

const emptyEnglishValues = Object.entries(en).filter(
  ([, value]) => typeof value === 'string' && value.trim() === ''
);
if (emptyEnglishValues.length > 0) {
  failures.push(
    `Empty English message value(s):\n${emptyEnglishValues
      .slice(0, 50)
      .map(([key]) => key)
      .join('\n')}`
  );
}

const hanInEnglishMessages = Object.entries(en).filter(
  ([, value]) => typeof value === 'string' && nonEnglishPattern.test(value)
);
if (hanInEnglishMessages.length > 0) {
  failures.push(
    `Chinese or Korean characters in English messages:\n${hanInEnglishMessages
      .slice(0, 50)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')}`
  );
}

const englishContentFiles = [
  ...walkFiles(
    'src/content/pages',
    (relativePath) => relativePath.endsWith('.en.mdx')
  ),
].filter((relativePath, index, files) => files.indexOf(relativePath) === index);

for (const relativePath of englishContentFiles) {
  assertNoHanInFile(relativePath, failures);
  for (const locale of localeCodes.filter((item) => item !== 'en')) {
    const localizedPath = relativePath.replace(/\.en\.mdx$/, `.${locale}.mdx`);
    if (!existsSync(path.join(root, localizedPath))) {
      failures.push(`Missing localized content page: ${localizedPath}`);
    }
  }
}

const uiSourceFiles = [
  ...walkFiles('src/components', (relativePath) => {
    if (!/\.(ts|tsx)$/.test(relativePath)) return false;
    if (/\.test\.(ts|tsx)$/.test(relativePath)) return false;
    if (relativePath.startsWith('src/components/home/generated/')) return false;
    return true;
  }),
  ...walkFiles('src/routes', (relativePath) => {
    if (!/\.(ts|tsx)$/.test(relativePath)) return false;
    if (/\.test\.(ts|tsx)$/.test(relativePath)) return false;
    return true;
  }),
];

for (const relativePath of uiSourceFiles) {
  assertNoHanInFile(relativePath, failures);
  const source = ts.createSourceFile(relativePath, readFileSync(path.join(root, relativePath), 'utf8'), ts.ScriptTarget.Latest, true);
  function checkMessageCall(node) {
    if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)) {
      const accessor = node.expression;
      if (ts.isIdentifier(accessor.expression) && ['m', 'uiMessages'].includes(accessor.expression.text) && ts.isStringLiteral(accessor.argumentExpression)) {
        const key = accessor.argumentExpression.text;
        const value = en[key];
        if (typeof value !== 'string') failures.push(`${relativePath}: unknown message key ${key}`);
        else {
          const required = [...value.matchAll(placeholderPattern)].map(([item]) => item.slice(1, -1)).filter(item => item !== 'plural');
          const input = node.arguments[0];
          if (required.length && (!input || ts.isObjectLiteralExpression(input))) {
            const fields = input?.properties ?? [];
            if (!fields.some(ts.isSpreadAssignment)) {
              const provided = fields.map(field => field.name?.getText(source).replace(/^['"]|['"]$/g, ''));
              const missing = required.filter(name => !provided.includes(name));
              if (missing.length) failures.push(`${relativePath}: ${key} needs ${missing.join(', ')}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, checkMessageCall);
  }
  checkMessageCall(source);
}

if (failures.length > 0) {
  console.error(`i18n check failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}

console.log(
  [
    'i18n check passed',
    ...localeCodes.map(
      (locale) => `- ${locale} keys: ${Object.keys(messages[locale]).length}`
    ),
    `- English content files checked: ${englishContentFiles.length}`,
    `- UI source files checked: ${uiSourceFiles.length}`,
  ].join('\n')
);
