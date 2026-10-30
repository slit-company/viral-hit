import { m as uiMessages } from '@/paraglide/messages.js';
import { WorkspaceApiConfigDialog } from '@/components/app/workspace-api-config-dialog';
import { PlugZap, ArrowUpRight } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { NativeSelect } from '@/components/ui/native-select';
import { toolCopy, toolGroups, groupForTool } from './tool-catalog';
import type { StudioToolId } from '@/core/studio/tools';
import type { StudioToolsController } from './use-studio-tools';

export function StudioToolNavigation({
  tools,
  disabled,
}: {
  tools: StudioToolsController;
  disabled: boolean;
}) {
  const group = groupForTool(tools.tool);
  return (
    <nav
      aria-label={uiMessages["studio.tools.creation_tools"]()}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--vh-border)] bg-[var(--vh-surface)] px-3 py-2 sm:px-5"
    >
      {toolGroups.map((item) => (
        <Action
          key={item.id}
          disabled={disabled}
          aria-pressed={group.id === item.id}
          onClick={() => tools.selectGroup(item.tools)}
          className={
            'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ' +
            (group.id === item.id
              ? 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]'
              : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)]')
          }
        >
          <item.icon size={16} />
          {item.label}
        </Action>
      ))}
    </nav>
  );
}
export function StudioToolSelection({
  tools,
  disabled,
}: {
  tools: StudioToolsController;
  disabled: boolean;
}) {
  const group = groupForTool(tools.tool);
  const providers = [
    ...new Map(
      tools.candidates.map((model) => [
        model.providerId ?? 'unknown',
        model.providerLabel ?? model.providerId ?? 'Provider',
      ]),
    ).entries(),
  ];
  const filtered = tools.candidates.filter(
    (model) => model.providerId === tools.model?.providerId,
  );
  return (
    <div className="space-y-5">
      <div
        role="group"
        aria-label={uiMessages["studio.tools.task"]()}
        className="flex flex-wrap gap-1 border-b border-[var(--vh-border)] pb-3"
      >
        {group.tools.map((task) => (
          <Action
            key={task}
            disabled={disabled}
            aria-pressed={tools.tool === task}
            onClick={() => tools.selectTool(task as StudioToolId)}
            className={
              'rounded-lg px-2.5 py-2 text-xs font-medium ' +
              (tools.tool === task
                ? 'bg-[var(--vh-text-1)] text-[var(--vh-bg)]'
                : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)]')
            }
          >
            {toolCopy[task].title}
          </Action>
        ))}
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold tracking-[.18em] text-[var(--vh-text-3)]">
          {uiMessages["studio.media.create_e8a5"]()}{group.label.toUpperCase()}
        </p>
        <h1 className="text-[24px] font-semibold tracking-[-.04em]">
          {toolCopy[tools.tool].title}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-[var(--vh-text-2)]">
          {toolCopy[tools.tool].description}
        </p>
      </div>
      <div className="space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">{uiMessages["studio.tools.selected_model"]()}</span>
          {tools.model?.providerId === 'cloud-api' ? (
            <span className="flex items-center gap-1 text-xs text-[var(--vh-text-2)]">
              {uiMessages["studio.tools.connect_api"]()}<WorkspaceApiConfigDialog providerId="cloud-api" />
            </span>
          ) : (
            <Link
              href="/extensions"
              className="flex items-center gap-1 text-xs text-[var(--vh-text-2)] underline-offset-4 hover:underline"
            >
              <PlugZap size={12} />
              {uiMessages["studio.tools.connect_api"]()}<ArrowUpRight size={12} />
            </Link>
          )}
        </div>
        {tools.loading ? (
          <p role="status" className="text-sm">
            {uiMessages["studio.tools.loading_models"]()}</p>
        ) : tools.error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>{uiMessages["studio.tools.could_not_load_the_model_list"]()}</p>
            <Action
              className="vh-secondary"
              onClick={() => void tools.refresh()}
            >
              {uiMessages["studio.tools.try_again"]()}</Action>
          </div>
        ) : tools.candidates.length ? (
          <>
            <label className="block space-y-1.5 text-[11px] text-[var(--vh-text-2)]">
              <span>{uiMessages["studio.tools.api_provider"]()}</span>
              <NativeSelect
                aria-label={uiMessages["studio.tools.api_provider"]()}
                disabled={disabled}
                value={tools.model?.providerId ?? ''}
                onChange={(event) => tools.selectProvider(event.target.value)}
              >
                {!tools.model && (
                  <option value="">{uiMessages["studio.tools.choose_a_provider"]()}</option>
                )}
                {providers.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block space-y-1.5 text-[11px] text-[var(--vh-text-2)]">
              <span>{uiMessages["studio.tools.model"]()}</span>
              <NativeSelect
                aria-label={uiMessages["studio.tools.task_model"]()}
                disabled={disabled}
                value={tools.model?.id ?? tools.missingModelId ?? ''}
                onChange={(event) => tools.selectModel(event.target.value)}
              >
                {tools.missingModelId && (
                  <option value={tools.missingModelId}>
                    {tools.missingModelId} {uiMessages["studio.tools.unavailable"]()}</option>
                )}
                {filtered.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                    {model.available === false ? uiMessages["studio.tools.needs_connection"]() : ''}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {tools.missingModelId && (
              <p role="status" className="text-xs leading-5 text-amber-800">
                {uiMessages["studio.tools.your_previous_model_is_unavailable_choose_another_provider_and_model_your_inputs_are_preserved"]()}</p>
            )}
            {tools.model?.available === false && (
              <p role="status" className="text-xs leading-5 text-amber-800">
                {uiMessages["studio.tools.connect_this_model_s_api_key_or_choose_another_provider"]()}</p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p
              role="status"
              className="text-sm leading-6 text-[var(--vh-text-2)]"
            >
              {uiMessages["studio.tools.no_installed_model_supports_this_task_yet_connect_an_api_or_local_model_to_see_it_here"]()}</p>
            <Link
              href="/runtime-packages"
              className="inline-flex text-sm font-medium underline underline-offset-4"
            >
              {uiMessages["studio.tools.add_a_provider_link"]()}</Link>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--vh-border)] pt-3 text-[11px] text-[var(--vh-text-2)]">
          <Link
            href="/runtime-packages"
            className="underline underline-offset-4"
          >
            {uiMessages["studio.tools.add_another_provider"]()}</Link>
          <Action
            disabled={disabled}
            onClick={() => void tools.refresh()}
            className="underline underline-offset-4"
          >
            {uiMessages["studio.tools.refresh_connections"]()}</Action>
        </div>
      </div>
    </div>
  );
}
