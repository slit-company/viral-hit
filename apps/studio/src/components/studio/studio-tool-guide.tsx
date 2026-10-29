import { ArrowRight, Scissors, Layers, Sparkles } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { toolCopy } from './tool-catalog';
import type { StudioToolId } from '@/core/studio/tools';
export function StudioToolGuide({
  tool,
  projectId,
  onPrompt,
  disabled,
}: {
  tool: StudioToolId;
  projectId: string;
  onPrompt: (prompt: string) => void;
  disabled: boolean;
}) {
  const copy = toolCopy[tool];
  return (
    <div className="mx-auto w-full max-w-4xl px-1 py-7 sm:px-6 sm:py-14">
      <div className="mb-9 text-center">
        <p className="text-[10px] font-semibold tracking-[.2em] text-[var(--vh-text-3)]">
          YOUR NEXT CREATION
        </p>
        <h2 className="mt-4 text-[clamp(24px,2.6vw,38px)] font-semibold tracking-[-.045em]">
          아이디어에서 완성까지, 한곳에서.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--vh-text-2)]">
          {copy.description} 모델이 달라도 작업은 같은 프로젝트에 이어져요.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-3">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--vh-control)]">
            <img
              src="/app/create-thumb-portrait.webp"
              alt="인물 사진 예시"
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium text-black">
              시작할 자료
            </span>
          </div>
          <h3 className="text-sm font-semibold">01. 아이디어와 원본</h3>
          <p className="text-xs leading-6 text-[var(--vh-text-2)]">
            설명을 적거나 이미지·영상·오디오를 추가하세요. 결과물도 다음 작업의
            원본이 될 수 있어요.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-5">
            <div className="grid size-12 place-items-center rounded-2xl bg-[var(--color-brand-lime-soft)]">
              <Sparkles size={24} />
            </div>
            <span className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] px-5 py-2 text-xs font-medium">
              원하는 API + 모델
            </span>
            <span className="text-[10px] text-[var(--vh-text-3)]">
              연결 방식은 자유롭게
            </span>
          </div>
          <h3 className="text-sm font-semibold">02. 모델과 설정</h3>
          <p className="text-xs leading-6 text-[var(--vh-text-2)]">
            작업에 맞는 모델을 골라주세요. 해당 모델이 지원하는 길이·비율·품질을
            설정할 수 있어요.
          </p>
        </div>
        <div className="space-y-3">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--vh-control)]">
            <img
              src="/app/create-thumb-road.webp"
              alt="영상 장면 예시"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-x-3 bottom-3 flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-5 flex-1 rounded bg-white/80" />
              ))}
            </div>
          </div>
          <h3 className="text-sm font-semibold">03. 결과를 이어서 편집</h3>
          <p className="text-xs leading-6 text-[var(--vh-text-2)]">
            만든 결과를 다시 활용하거나 편집기에 넣어보세요. 컷과 자막, 음악을
            더해 완성할 수 있어요.
          </p>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--vh-border)] p-4">
        <span className="text-xs leading-5 text-[var(--vh-text-2)]">
          예시 이미지는 사용 흐름을 설명하기 위한 자료예요.
        </span>
        <div className="flex gap-4">
          <Link
            href={'/assets/' + projectId}
            className="inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <Layers size={14} />
            프로젝트 자료
          </Link>
          <Link
            href={'/editor/' + projectId}
            className="inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <Scissors size={14} />
            편집기 열기
          </Link>
        </div>
      </div>
      <Action
        disabled={disabled}
        className="mt-6 flex items-center gap-2 text-xs text-[var(--vh-text-2)]"
        onClick={() => onPrompt(copy.hint)}
      >
        {copy.hint}
        <ArrowRight size={14} className="shrink-0" />
      </Action>
    </div>
  );
}
