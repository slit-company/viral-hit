/** Public, browser-safe diagnostic projection. Never includes source code, host paths or configuration values. */
export type ExtensionKind = 'providers' | 'adapters' | 'publishing' | 'skills';
export type ExtensionDiagnostic = {
  id: string; label: string; description?: string; scope?: 'general' | 'specialized'; version?: string;
  source: 'operator' | 'installed' | 'official'; state: 'loaded' | 'needs-setup';
  configuration: { name: string; present: boolean }[]; capabilities: { id: string; label: string }[];
  issues: string[];
};
export type ExtensionGroup = {
  kind: ExtensionKind; items: ExtensionDiagnostic[]; problems: { location: string; message: string }[];
  refresh: 'restart' | 'live'; sourceChanged?: boolean;
};
export type ExtensionDiagnostics = { checkedAt: string; groups: ExtensionGroup[] };
