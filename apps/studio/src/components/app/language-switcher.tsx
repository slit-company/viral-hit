import { Action } from '@/components/base/action';
import { Check, ChevronDown, Globe2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  localeNames,
  normalizeLocale,
  supportedLocales,
} from '@/config/locale';
import { m } from '@/paraglide/messages.js';
import { getLocale, setLocale } from '@/paraglide/runtime.js';

type LanguageSwitcherProps = {
  variant?: 'marketing' | 'workspace';
};

export function LanguageSwitcher({
  variant = 'marketing',
}: LanguageSwitcherProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const locale = normalizeLocale(getLocale());
  const switchLanguageLabel = m['product.shell.switchLanguage'](
    {},
    { locale }
  );

  useEffect(() => {
    if (!open) return;

    function closeMenu(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function switchLanguage(nextLocale: (typeof supportedLocales)[number]) {
    setOpen(false);
    if (nextLocale !== locale) setLocale(nextLocale);
  }

  const workspace = variant === 'workspace';

  return (
    <div ref={menuRef} className="relative">
      <Action
        type="button"
        aria-label={switchLanguageLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        title={switchLanguageLabel}
        onClick={() => setOpen((value) => !value)}
        className={
          workspace
            ? 'inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] px-2.5 text-xs font-medium text-[var(--vh-text-2)] transition hover:border-[var(--vh-border)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vh-graph)]/70'
            : 'inline-flex h-8 items-center gap-1 rounded-full px-2 text-[13px] font-medium text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
        }
      >
        <Globe2 className="size-3.5" aria-hidden="true" />
        {locale.toUpperCase()}
        <ChevronDown
          aria-hidden="true"
          className={`size-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </Action>

      {open ? (
        <div
          role="menu"
          aria-label={switchLanguageLabel}
          className="absolute right-0 top-full z-50 mt-2 min-w-[140px] overflow-hidden rounded-[12px] border border-[var(--vh-border)] bg-[var(--vh-surface)] p-1 shadow-none"
        >
          {supportedLocales.map((option) => (
            <Action
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === locale}
              onClick={() => switchLanguage(option)}
              className={`flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[13px] transition hover:bg-[var(--vh-control)] ${
                option === locale
                  ? 'text-[var(--vh-text-1)]'
                  : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]'
              }`}
            >
              {localeNames[option]}
              {option === locale ? (
                <Check
                  className="size-3.5 text-[var(--vh-accent)]"
                  aria-hidden="true"
                />
              ) : null}
            </Action>
          ))}
        </div>
      ) : null}
    </div>
  );
}
