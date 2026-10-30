import { Action } from '@/components/base/action';
import { ArrowUp, AudioLines, Film, ImageIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { normalizeLocale } from '@/config/locale';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import { ProductShell } from './product-shell';
import { HomeTools } from './home-tools';
import { HomeTemplates } from './home-templates';

function getCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    eyebrow: m['product.home.eyebrow']({}, { locale: messageLocale }),
    titleLine1: m['product.home.titleLine1']({}, { locale: messageLocale }),
    titleLine2: m['product.home.titleLine2']({}, { locale: messageLocale }),
    prompt: m['product.home.prompt']({}, { locale: messageLocale }),
    projects: m['product.home.viewProjects']({}, { locale: messageLocale }),
    create: m['product.shell.create']({}, { locale: messageLocale }),
    mediaImage: m['product.home.mediaImage']({}, { locale: messageLocale }),
    mediaVideo: m['product.home.mediaVideo']({}, { locale: messageLocale }),
    mediaAudio: m['product.home.mediaAudio']({}, { locale: messageLocale }),
  };
}

type HomeCopy = ReturnType<typeof getCopy>;

type Media = 'image' | 'video' | 'audio';

function PromptComposer({ copy }: { copy: HomeCopy }) {
  const [prompt, setPrompt] = useState('');
  const choices: Array<[Media, string, ReactNode]> = [
    ['image', copy.mediaImage, <ImageIcon key="image" className="size-3.5" />],
    ['video', copy.mediaVideo, <Film key="video" className="size-3.5" />],
    ['audio', copy.mediaAudio, <AudioLines key="audio" className="size-3.5" />],
  ];

  return (
    <form
      action={localizeHref("/studio")}
      method="get"
      className="mx-auto mt-10 flex min-h-[168px] w-full max-w-[760px] flex-col rounded-[var(--vh-radius)] border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 text-left shadow-[0_12px_40px_rgba(22,22,22,0.06)] sm:p-5"
    >
      <textarea
        name="prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={copy.prompt}
        aria-label={copy.prompt}
        className="min-h-16 w-full resize-none border-0 bg-transparent px-1 text-[15px] leading-6 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-3)] sm:text-base"
      />
      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
        {/* Native radios submit with the form even before the page hydrates. */}
        <div role="radiogroup" aria-label={copy.create} className="flex items-center gap-1 rounded-full border border-[var(--vh-border)] bg-[var(--vh-control)] p-1">
          {choices.map(([value, label, icon]) => (
            <label key={value} className="relative cursor-pointer">
              <input type="radio" name="target" value={value} defaultChecked={value === 'image'} className="peer sr-only" />
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[var(--vh-text-2)] transition hover:text-[var(--vh-text-1)] peer-checked:bg-[var(--vh-surface)] peer-checked:font-semibold peer-checked:text-[var(--vh-text-1)] peer-checked:shadow-[0_1px_2px_rgba(22,22,22,0.08)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-ink)]">
                {icon}
                {label}
              </span>
            </label>
          ))}
        </div>
        <Action
          type="submit"
          className="inline-flex h-11 min-w-[132px] items-center justify-center gap-2 rounded-[14px] bg-[var(--color-brand-lime)] px-6 text-[14px] font-semibold text-[var(--color-ink)] shadow-none transition hover:brightness-95"
        >
          {copy.create}
          <ArrowUp className="size-4" />
        </Action>
      </div>
    </form>
  );
}

export function ProductHome({ locale }: { locale: string }) {
  const copy = getCopy(locale);
  const titleLines = [copy.titleLine1, copy.titleLine2];

  return (
    <ProductShell active="home" locale={locale}>
      <main className="mx-auto w-full max-w-[1280px] px-5 sm:px-6">
        <section className="vh-product-hero pb-14 pt-[64px] text-center sm:pt-[84px] lg:pb-[72px]">
          <p className="vh-product-display inline-flex items-center gap-2.5 text-[10px] font-semibold tracking-[0.18em] text-[var(--vh-accent)] sm:text-[11px]">
            <span className="size-1.5 rounded-full bg-[var(--vh-accent)]" />
            {copy.eyebrow}
          </p>
          <h1 className="vh-product-display vh-product-hero-title mx-auto mt-6 w-full max-w-[720px] text-[clamp(2.25rem,6.6vw,4.75rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--vh-text-1)]">
            {titleLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>
          <PromptComposer copy={copy} />
        </section>

        <HomeTools locale={locale} projectsLabel={copy.projects} />
        <HomeTemplates locale={locale} />
      </main>
    </ProductShell>
  );
}
