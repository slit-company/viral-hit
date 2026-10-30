import { m as uiMessages } from '@/paraglide/messages.js';
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
          {uiMessages["studio.media.your_next_creation_a309"]()}</p>
        <h2 className="mt-4 text-[clamp(24px,2.6vw,38px)] font-semibold tracking-[-.045em]">
          {uiMessages["studio.tools.from_idea_to_finished_work_in_one_place"]()}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--vh-text-2)]">
          {copy.description} {uiMessages["studio.tools.keep_working_in_the_same_project_whichever_model_you_choose"]()}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-3">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--vh-control)]">
            <img
              src="/app/create-thumb-portrait.webp"
              alt={uiMessages["studio.tools.example_portrait"]()}
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium text-black">
              {uiMessages["studio.tools.start_with_your_media"]()}</span>
          </div>
          <h3 className="text-sm font-semibold">{uiMessages["studio.tools.01_idea_and_source"]()}</h3>
          <p className="text-xs leading-6 text-[var(--vh-text-2)]">
            {uiMessages["studio.tools.describe_your_idea_or_add_images_video_or_audio_you_can_also_reuse_a_previous_result"]()}</p>
        </div>
        <div className="space-y-3">
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-5">
            <div className="grid size-12 place-items-center rounded-2xl bg-[var(--color-brand-lime-soft)]">
              <Sparkles size={24} />
            </div>
            <span className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] px-5 py-2 text-xs font-medium">
              {uiMessages["studio.tools.your_api_model"]()}</span>
            <span className="text-[10px] text-[var(--vh-text-3)]">
              {uiMessages["studio.tools.connect_your_preferred_provider"]()}</span>
          </div>
          <h3 className="text-sm font-semibold">{uiMessages["studio.tools.02_model_and_settings"]()}</h3>
          <p className="text-xs leading-6 text-[var(--vh-text-2)]">
            {uiMessages["studio.tools.choose_a_model_for_the_task_then_set_its_supported_length_aspect_ratio_and_quality"]()}</p>
        </div>
        <div className="space-y-3">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--vh-control)]">
            <img
              src="/app/create-thumb-road.webp"
              alt={uiMessages["studio.tools.example_video_scene"]()}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-x-3 bottom-3 flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-5 flex-1 rounded bg-white/80" />
              ))}
            </div>
          </div>
          <h3 className="text-sm font-semibold">{uiMessages["studio.tools.03_edit_your_results"]()}</h3>
          <p className="text-xs leading-6 text-[var(--vh-text-2)]">
            {uiMessages["studio.tools.reuse_a_result_or_add_it_to_the_editor_finish_with_cuts_captions_and_music"]()}</p>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--vh-border)] p-4">
        <span className="text-xs leading-5 text-[var(--vh-text-2)]">
          {uiMessages["studio.tools.example_images_illustrate_the_workflow"]()}</span>
        <div className="flex gap-4">
          <Link
            href={'/assets/' + projectId}
            className="inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <Layers size={14} />
            {uiMessages["studio.tools.project_media"]()}</Link>
          <Link
            href={'/editor/' + projectId}
            className="inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <Scissors size={14} />
            {uiMessages["studio.tools.open_editor"]()}</Link>
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
