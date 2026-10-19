import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { createRequire } from 'node:module';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/studio/package.json'));
const ts = require('typescript');
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const forbiddenPackages = new Set(['@libsql/client', '@comfyorg/sdk', 'drizzle-orm', 'better-sqlite3']);
const excluded = path => /(?:^|\/)(?:paraglide|node_modules)\//.test(path) || /(?:\.test\.[cm]?[jt]sx?$|routeTree\.gen\.ts$)/.test(path);
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (excluded(path + (entry.isDirectory() ? '/' : ''))) return [];
    return entry.isDirectory() ? walk(path) : /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}
function typeOnly(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    return clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly));
  }
  return ts.isExportDeclaration(node) && (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly)));
}
export function inspectArchitecture(workspace) {
  const src = resolve(workspace, 'src');
  const files = walk(src), map = new Map(), findings = [];
  for (const absolute of files) {
    const path = relative(workspace, absolute).replaceAll('\\', '/'), text = readFileSync(absolute, 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, extname(path).endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = [];
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && !typeOnly(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(ast);
        if (['import', 'require', 'process.getBuiltinModule'].includes(name) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          imports.push(node.arguments[0].text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const local = [], forbidden = [];
    for (const specifier of new Set(imports)) {
      if (/(?:^|\/)(?:research|upstream)(?:\/|$)/.test(specifier)) findings.push(`research-import:${path}:${specifier}`);
      if (specifier.startsWith('node:') || builtins.has(specifier) || [...forbiddenPackages].some(name => specifier === name || specifier.startsWith(name + '/'))) forbidden.push(specifier);
      const candidate = specifier.startsWith('@/') ? resolve(src, specifier.slice(2)) : specifier.startsWith('.') ? resolve(dirname(absolute), specifier) : null;
      if (!candidate) continue;
      const target = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].map(extension => candidate + extension).find(file => files.includes(file));
      if (target) local.push(relative(workspace, target).replaceAll('\\', '/'));
    }
    map.set(path, { local, forbidden, lines: text.split('\n').filter(line => line.trim()).length });
    for (const target of local) {
      if (path.startsWith('src/core/') && /^src\/(components|routes)\//.test(target)) findings.push(`core-direction:${path}->${target}`);
      if (/^src\/components\/(base|ui)\//.test(path) && /^src\/(core|routes)\//.test(target)) findings.push(`shared-ui-direction:${path}->${target}`);
    }
  }
  const cycles = new Set();
  function reachable(from, target, visited = new Set()) {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from); return (map.get(from)?.local ?? []).some(next => reachable(next, target, visited));
  }
  for (const [path, entry] of map) for (const target of entry.local) if (reachable(target, path)) cycles.add(`${path}->${target}`);
  const browserRoots = [...map.keys()].filter(path => path.startsWith('src/components/'));
  const browserSeen = new Set();
  function browserVisit(path, chain) {
    if (browserSeen.has(path)) return;
    browserSeen.add(path); const entry = map.get(path); if (!entry) return;
    if (/\.server\.[cm]?[jt]sx?$/.test(path)) findings.push(`browser-server-module:${[...chain, path].join(' -> ')}`);
    for (const forbidden of entry.forbidden) findings.push(`browser-server:${[...chain, path].join(' -> ')} -> ${forbidden}`);
    for (const target of entry.local) browserVisit(target, [...chain, path]);
  }
  for (const path of browserRoots) browserVisit(path, []);
  return { findings: [...new Set(findings)].sort(), cycles: [...cycles].sort(), oversized: Object.fromEntries([...map].filter(([, entry]) => entry.lines > 400).map(([path, entry]) => [path, entry.lines])), modules: map.size, browserModules: browserSeen.size };
}
export function violations(report, baseline) {
  return [...report.findings, ...report.cycles.filter(edge => !baseline.cycles.includes(edge)).map(edge => `new-cycle:${edge}`), ...Object.entries(report.oversized).filter(([path, lines]) => lines > (baseline.oversized[path] ?? 400)).map(([path, lines]) => `module-size:${path}:${lines}>${baseline.oversized[path] ?? 400}`)];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectArchitecture(resolve(root, 'apps/studio'));
  if (process.argv.includes('--report')) console.log(JSON.stringify(report, null, 2));
  else {
    const baseline = JSON.parse(readFileSync(resolve(root, 'docs/architecture/architecture-baseline.json'), 'utf8'));
    const errors = violations(report, baseline);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log(`Architecture checks passed: ${report.modules} modules, ${report.browserModules} browser-reachable modules, ${Object.keys(report.oversized).length} existing size allowances, ${report.cycles.length} existing cyclic edges.`);
  }
}
