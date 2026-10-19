import { registerHooks } from 'node:module';
// Node's component/SSR tests cannot parse CSS. Browser tests load the real styles.
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return nextLoad(url, context);
}});
