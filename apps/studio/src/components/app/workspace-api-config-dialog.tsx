import { Action } from '@/components/base/action';
import { Cloud, Database } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DEFAULT_CLOUD_API_BASE_URL,
  getCreativeCanvasProviderPublicConfig,
} from '@/core/creative-canvas/providers/provider-config';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { apiGet, apiPost } from '@/lib/api-client';
import { maskApiKeyPreview } from '@/lib/mask-api-key';

/** Custom plug glyph — the workspace's "connect your API" mark. */
function PlugGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 2.5v4.5" />
      <path d="M15 2.5v4.5" />
      <path d="M6.5 7h11v3.8a5.5 5.5 0 0 1-11 0V7Z" />
      <path d="M12 16.3v2.2" />
      <path d="M12 18.5c0 1.6 1.4 3 3 3h2.5" />
    </svg>
  );
}

const inputClassName =
  'h-11 w-full rounded-[12px] border border-[var(--vh-border)] bg-[var(--vh-control)] px-3.5 font-mono text-[13px] text-[var(--vh-text-1)] outline-none transition placeholder:text-[var(--vh-text-2)] focus:border-[var(--vh-border-strong)]/55 focus:ring-[3px] focus:ring-[#ff7a33]/15';

const saveButtonClassName =
  'h-11 w-full rounded-[12px] bg-[var(--vh-accent)] text-[14px] font-semibold text-[var(--vh-text-2)] shadow-none transition hover:bg-[var(--vh-accent)] disabled:cursor-not-allowed disabled:opacity-60';

const configuredKeyMask = '••••••••••••••••••••••••';

type CloudApiConfigState = {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
};

type StorageConfigState = {
  mode: 'cloud-api' | 's3';
  managedEligible: boolean;
  custom: {
    region: string;
    endpoint: string;
    bucketName: string;
    publicUrl: string;
    forcePathStyle: boolean;
    accessKeyConfigured: boolean;
    secretKeyConfigured: boolean;
  };
};

function ApiConfigForm({
  providerLabel,
  isDefault,
  state,
  loaded,
  onSaved,
}: {
  providerLabel: string;
  isDefault: boolean;
  state: CloudApiConfigState | null;
  loaded: boolean;
  onSaved: (state: CloudApiConfigState) => void;
}) {
  const t = useTranslations('AppShell.header.apiConfig');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const configured = Boolean(state?.apiKeyConfigured && state.apiKeyPreview);

  async function save() {
    const nextKey = apiKey.trim();
    if (!nextKey) return;
    setSaving(true);
    try {
      const result = await apiPost<{ apiKeyPreview?: string }>(
        '/api/config/cloud-api',
        { apiKey: nextKey }
      );
      toast.success(t('saved'));
      setApiKey('');
      setEditing(false);
      onSaved({
        baseUrl: DEFAULT_CLOUD_API_BASE_URL,
        apiKeyConfigured: true,
        apiKeyPreview: result?.apiKeyPreview || maskApiKeyPreview(nextKey),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium text-[var(--vh-text-1)]">{providerLabel}</p>
        {isDefault ? (
          <span className="rounded-full border border-[var(--vh-border-strong)]/30 bg-[var(--vh-accent)]/10 px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em] text-[#ff9a62]">
            {t('defaultBadge')}
          </span>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="cloud-api-key"
          className="mb-2 block text-[12px] font-medium text-[var(--vh-text-2)]"
        >
          {t('keyLabel')}
        </label>
        {!loaded ? (
          <div
            className="h-11 animate-pulse rounded-[12px] border border-[var(--vh-border)] bg-[var(--vh-control)] motion-reduce:animate-none"
            aria-label={t('loadingConnection')}
          />
        ) : (
          <input
            id="cloud-api-key"
            type={configured && !editing ? 'text' : 'password'}
            value={configured && !editing ? configuredKeyMask : apiKey}
            onFocus={() => {
              if (configured && !editing) {
                setEditing(true);
                setApiKey('');
              }
            }}
            onBlur={() => {
              if (!apiKey.trim()) setEditing(false);
            }}
            onChange={(event) => {
              setEditing(true);
              setApiKey(event.target.value);
            }}
            placeholder={t('keyPlaceholder')}
            autoComplete="off"
            className={inputClassName}
          />
        )}
      </div>

      <Action
        type="button"
        disabled={!loaded || saving || !apiKey.trim()}
        onClick={() => void save()}
        className={saveButtonClassName}
      >
        {saving ? t('saving') : t('save')}
      </Action>

      <a
        href="https://cloud.example/dashboard/apikeys"
        target="_blank"
        rel="noreferrer"
        className="inline-flex text-[12px] font-semibold text-[#ff8b4d] transition hover:text-[#ffa26b]"
      >
        {t('getKey')}
      </a>
    </div>
  );
}

function StorageConfigForm({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations('AppShell.header.apiConfig.storage');
  const [state, setState] = useState<StorageConfigState | null>(null);
  const [mode, setMode] = useState<'cloud-api' | 's3'>('cloud-api');
  const [region, setRegion] = useState('auto');
  const [endpoint, setEndpoint] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet<StorageConfigState>('/api/config/storage')
      .then((config) => {
        if (cancelled || !config) return;
        setState(config);
        setMode(config.mode);
        setRegion(config.custom.region || 'auto');
        setEndpoint(config.custom.endpoint);
        setBucketName(config.custom.bucketName);
        setPublicUrl(config.custom.publicUrl);
        setForcePathStyle(config.custom.forcePathStyle);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await apiPost('/api/config/storage', {
        mode,
        ...(mode === 's3'
          ? {
              region: region.trim() || 'auto',
              endpoint: endpoint.trim(),
              bucketName: bucketName.trim(),
              publicUrl: publicUrl.trim(),
              accessKeyId: accessKeyId.trim(),
              secretAccessKey: secretAccessKey.trim(),
              forcePathStyle,
            }
          : {}),
      });
      toast.success(t('saved'));
      setState((previous) =>
        previous
          ? {
              mode,
              managedEligible: previous.managedEligible,
              custom: {
                ...previous.custom,
                region,
                endpoint,
                bucketName,
                publicUrl,
                forcePathStyle,
                accessKeyConfigured: Boolean(
                  accessKeyId || previous.custom.accessKeyConfigured
                ),
                secretKeyConfigured: Boolean(
                  secretAccessKey || previous.custom.secretKeyConfigured
                ),
              },
            }
          : previous
      );
      setAccessKeyId('');
      setSecretAccessKey('');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-[var(--vh-border)] bg-[var(--vh-control)] p-1">
        <Action
          type="button"
          disabled={!state?.managedEligible}
          onClick={() => {
            if (state?.managedEligible) setMode('cloud-api');
          }}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition ${
            mode === 'cloud-api'
              ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)]'
              : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-2)]'
          } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-[var(--vh-text-2)]`}
        >
          <Cloud
            className={`size-3.5 ${mode === 'cloud-api' ? 'text-[#ff8b4d]' : ''}`}
          />
          {t('managedTitle')}
        </Action>
        <Action
          type="button"
          onClick={() => setMode('s3')}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition ${
            mode === 's3'
              ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)]'
              : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-2)]'
          }`}
        >
          <Database
            className={`size-3.5 ${mode === 's3' ? 'text-[#ff8b4d]' : ''}`}
          />
          {t('customTitle')}
        </Action>
      </div>

      {mode === 'cloud-api' ? (
        <p className="text-[12px] leading-5 text-[var(--vh-text-2)]">{t('managedHint')}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder={t('regionPlaceholder')}
              aria-label={t('regionLabel')}
              className={inputClassName}
            />
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={t('endpointPlaceholder')}
              aria-label={t('endpointLabel')}
              className={inputClassName}
            />
          </div>
          <input
            value={bucketName}
            onChange={(event) => setBucketName(event.target.value)}
            placeholder={t('bucketPlaceholder')}
            aria-label={t('bucketLabel')}
            className={inputClassName}
          />
          <input
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            placeholder={t('publicUrlPlaceholder')}
            aria-label={t('publicUrlLabel')}
            className={inputClassName}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="password"
              value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value)}
              placeholder={
                state?.custom?.accessKeyConfigured
                  ? t('configuredPlaceholder')
                  : t('accessKeyPlaceholder')
              }
              aria-label={t('accessKeyLabel')}
              autoComplete="off"
              className={inputClassName}
            />
            <input
              type="password"
              value={secretAccessKey}
              onChange={(event) => setSecretAccessKey(event.target.value)}
              placeholder={
                state?.custom?.secretKeyConfigured
                  ? t('configuredPlaceholder')
                  : t('secretKeyPlaceholder')
              }
              aria-label={t('secretKeyLabel')}
              autoComplete="off"
              className={inputClassName}
            />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[var(--vh-text-2)]">
            <input
              type="checkbox"
              checked={forcePathStyle}
              onChange={(event) => setForcePathStyle(event.target.checked)}
              className="accent-[#ff7a33]"
            />
            {t('forcePathStyle')}
          </label>
        </div>
      )}

      <Action
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className={saveButtonClassName}
      >
        {saving ? t('saving') : t('save')}
      </Action>
    </div>
  );
}

export function WorkspaceApiConfigDialog({
  providerId,
}: {
  providerId?: string | null;
}) {
  const t = useTranslations('AppShell.header.apiConfig');
  const provider = getCreativeCanvasProviderPublicConfig(providerId);
  const [saveSignal, setSaveSignal] = useState(0);
  const [section, setSection] = useState<'provider' | 'storage'>('provider');
  const [providerState, setProviderState] =
    useState<CloudApiConfigState | null>(null);
  const [providerStateLoaded, setProviderStateLoaded] = useState(false);
  const providerConfigured = Boolean(
    providerState?.apiKeyConfigured && providerState.apiKeyPreview
  );

  useEffect(() => {
    let cancelled = false;
    void apiGet<CloudApiConfigState>('/api/config/cloud-api')
      .then((config) => {
        if (!cancelled) setProviderState(config);
      })
      .catch(() => {
        if (!cancelled) setProviderState(null);
      })
      .finally(() => {
        if (!cancelled) setProviderStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog>
      <DialogTrigger
        aria-label={
          providerConfigured ? t('triggerConfiguredLabel') : t('triggerLabel')
        }
        title={
          providerConfigured ? t('triggerConfiguredLabel') : t('triggerLabel')
        }
        className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-[var(--vh-control)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a33]/45 ${
          providerConfigured
            ? 'border-[var(--vh-border-strong)]/35 text-[#ff8b4d]'
            : 'border-[var(--vh-border)] text-[var(--vh-text-2)] hover:border-[var(--vh-border)]'
        }`}
      >
        <PlugGlyph className="size-[18px]" />
        {providerConfigured ? (
          <span
            className="absolute right-0 top-0 size-2.5 rounded-full border-2 border-[#111214] bg-[var(--vh-accent)]"
            aria-hidden="true"
          />
        ) : null}
      </DialogTrigger>

      <DialogContent className="vh-product-shell max-h-[88vh] overflow-y-auto rounded-[24px] border border-[var(--vh-border)] bg-[var(--vh-surface)] p-0 text-[var(--vh-text-1)] shadow-none ring-0 sm:max-w-[480px] [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:text-[var(--vh-text-2)] [&_[data-slot=dialog-close]]:hover:bg-[var(--vh-control)] [&_[data-slot=dialog-close]]:hover:text-[var(--vh-text-1)]">
        <div className="border-b border-[var(--vh-border)] px-5 pb-4 pt-5">
          <div className="flex items-start gap-3 pr-8">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-[var(--vh-border-strong)]/25 bg-[var(--vh-accent)]/10 text-[#ff8b4d]">
              <PlugGlyph className="size-4" />
            </span>
            <DialogHeader className="gap-1 text-left">
              <DialogTitle className="vh-product-display text-[17px] font-semibold tracking-[-0.02em] text-[var(--vh-text-1)]">
                {t('title')}
              </DialogTitle>
              <DialogDescription className="text-[12px] leading-5 text-[var(--vh-text-2)]">
                {section === 'provider' ? t('description') : t('storage.intro')}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b border-[var(--vh-border)] bg-[var(--vh-control)] p-1">
          {(['provider', 'storage'] as const).map((item) => (
            <Action
              key={item}
              type="button"
              onClick={() => setSection(item)}
              className={`h-9 rounded-[10px] text-[13px] font-semibold transition ${
                section === item
                  ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)]'
                  : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-2)]'
              }`}
            >
              {item === 'provider' ? t('providerTab') : t('storageTab')}
            </Action>
          ))}
        </div>

        {section === 'provider' ? (
          <ApiConfigForm
            key={`provider-${saveSignal}`}
            providerLabel={provider.label}
            isDefault={provider.isDefault}
            state={providerState}
            loaded={providerStateLoaded}
            onSaved={(nextState) => {
              setProviderState(nextState);
              setProviderStateLoaded(true);
              setSaveSignal((n) => n + 1);
            }}
          />
        ) : (
          <StorageConfigForm
            key={`storage-${saveSignal}`}
            onSaved={() => setSaveSignal((n) => n + 1)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
