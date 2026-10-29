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
      aria-label="만들기 도구"
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
        aria-label="세부 작업"
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
          CREATE / {group.id.toUpperCase()}
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
          <span className="text-xs font-semibold">사용할 모델</span>
          {tools.model?.providerId === 'cloud-api' ? (
            <span className="flex items-center gap-1 text-xs text-[var(--vh-text-2)]">
              API 연결
              <WorkspaceApiConfigDialog providerId="cloud-api" />
            </span>
          ) : (
            <Link
              href="/extensions"
              className="flex items-center gap-1 text-xs text-[var(--vh-text-2)] underline-offset-4 hover:underline"
            >
              <PlugZap size={12} />
              API 연결
              <ArrowUpRight size={12} />
            </Link>
          )}
        </div>
        {tools.loading ? (
          <p role="status" className="text-sm">
            모델을 불러오는 중…
          </p>
        ) : tools.error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>모델 목록을 불러오지 못했어요.</p>
            <Action
              className="vh-secondary"
              onClick={() => void tools.refresh()}
            >
              다시 확인
            </Action>
          </div>
        ) : tools.candidates.length ? (
          <>
            <label className="block space-y-1.5 text-[11px] text-[var(--vh-text-2)]">
              <span>API 제공업체</span>
              <NativeSelect
                aria-label="API 제공업체"
                disabled={disabled}
                value={tools.model?.providerId ?? ''}
                onChange={(event) => tools.selectProvider(event.target.value)}
              >
                {!tools.model && (
                  <option value="">제공업체를 선택해주세요</option>
                )}
                {providers.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block space-y-1.5 text-[11px] text-[var(--vh-text-2)]">
              <span>모델</span>
              <NativeSelect
                aria-label="작업 모델"
                disabled={disabled}
                value={tools.model?.id ?? tools.missingModelId ?? ''}
                onChange={(event) => tools.selectModel(event.target.value)}
              >
                {tools.missingModelId && (
                  <option value={tools.missingModelId}>
                    {tools.missingModelId} · 사용할 수 없음
                  </option>
                )}
                {filtered.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                    {model.available === false ? ' · 연결 필요' : ''}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {tools.missingModelId && (
              <p role="status" className="text-xs leading-5 text-amber-800">
                선택했던 모델을 찾을 수 없어요. 다른 제공업체와 모델을
                골라주세요. 입력한 내용은 유지돼요.
              </p>
            )}
            {tools.model?.available === false && (
              <p role="status" className="text-xs leading-5 text-amber-800">
                이 모델의 API 연결이 필요해요. 다른 제공업체를 선택하거나 키를
                등록하세요.
              </p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p
              role="status"
              className="text-sm leading-6 text-[var(--vh-text-2)]"
            >
              아직 이 작업을 지원하는 모델이 없어요. 사용할 API나 로컬 모델을
              연결하면 여기에 표시돼요.
            </p>
            <Link
              href="/runtime-packages"
              className="inline-flex text-sm font-medium underline underline-offset-4"
            >
              제공업체 추가하기 →
            </Link>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--vh-border)] pt-3 text-[11px] text-[var(--vh-text-2)]">
          <Link
            href="/runtime-packages"
            className="underline underline-offset-4"
          >
            다른 제공업체 추가
          </Link>
          <Action
            disabled={disabled}
            onClick={() => void tools.refresh()}
            className="underline underline-offset-4"
          >
            연결 상태 새로고침
          </Action>
        </div>
      </div>
    </div>
  );
}
