import { Action } from '@/components/base/action';
import {
  Menu,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/app/language-switcher';
import { normalizeLocale } from '@/config/locale';
import { Link } from '@/core/i18n/navigation';
import { appConfig } from '@/config';
import { m } from '@/paraglide/messages.js';

type ProductSurface = 'home' | 'projects' | 'characters';

function getShellCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    home: m['product.shell.home']({}, { locale: messageLocale }),
    create: m['product.shell.create']({}, { locale: messageLocale }),
    projects: m['product.shell.projects']({}, { locale: messageLocale }),
    characters: m['product.shell.characters']({}, { locale: messageLocale }),
    openNavigation: m['product.shell.openNavigation'](
      {},
      { locale: messageLocale }
    ),
    closeNavigation: m['product.shell.closeNavigation'](
      {},
      { locale: messageLocale }
    ),
    switchLanguage: m['product.shell.switchLanguage'](
      {},
      { locale: messageLocale }
    ),
    terms: m['product.shell.terms']({}, { locale: messageLocale }),
    privacy: m['product.shell.privacy']({}, { locale: messageLocale }),
  };
}

type ShellCopy = ReturnType<typeof getShellCopy>;

function getNavItems(copy: ShellCopy) {
  return [
    { label: copy.home, href: '/' },
    { label: copy.create, href: '/studio' },
    { label: copy.projects, href: '/projects' },
    { label: copy.characters, href: '/characters' },
  ] as const;
}

const activeNavHref: Record<ProductSurface, string> = {
  home: '/',
  projects: '/projects',
  characters: '/characters',
};

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label={`${appConfig.app_name} home`}
      className="vh-product-display inline-flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.02em] text-[var(--vh-text-1)] sm:text-base"
    >
      <img
        src={appConfig.app_wordmark}
        alt={appConfig.app_name}
        className="h-11 w-[148px] shrink-0 object-contain"
      />
    </Link>
  );
}

function CapsuleNav({
  active,
  items,
}: {
  active: ProductSurface;
  items: ReturnType<typeof getNavItems>;
}) {
  const activeHref = activeNavHref[active];
  return (
    <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-5 text-sm font-medium md:flex lg:gap-8">
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              isActive
                ? 'text-[var(--vh-text-1)]'
                : 'text-[var(--vh-text-2)] transition-colors hover:text-[var(--vh-text-1)]'
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ProductShell({
  active,
  locale,
  children,
}: {
  active: ProductSurface;
  locale: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const currentLocale = normalizeLocale(locale);
  const copy = getShellCopy(currentLocale);
  const navItems = getNavItems(copy);

  return (
    <div
      lang={currentLocale}
      className="vh-product-shell min-h-[100dvh] bg-[var(--vh-bg)] pt-4 text-[var(--vh-text-1)] selection:bg-[var(--vh-accent)]/35 sm:pt-5"
    >
      <header className="sticky top-3 z-40 px-4 sm:top-4 sm:px-6">
        <div className="mx-auto flex h-[60px] w-full min-w-0 max-w-[1280px] items-center gap-3 rounded-full border border-[var(--vh-border)] bg-[var(--vh-surface)]/90 px-3.5 shadow-none backdrop-blur-2xl sm:px-5">
          <Brand />

          <CapsuleNav active={active} items={navItems} />

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block">
              <LanguageSwitcher />
            </div>

            <Action
              type="button"
              aria-label={
                menuOpen ? copy.closeNavigation : copy.openNavigation
              }
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-10 place-items-center rounded-full border border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-1)] transition hover:border-[var(--vh-border)] md:hidden"
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </Action>
          </div>
        </div>

        {menuOpen ? (
          <div className="absolute inset-x-4 top-[calc(100%+8px)] rounded-[18px] border border-[var(--vh-border)] bg-[var(--vh-surface)]/95 p-2 shadow-lg backdrop-blur-xl md:hidden">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-[12px] px-4 py-3 text-sm font-medium text-[var(--vh-text-1)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-[var(--vh-border)] px-2 pt-3">
              <span className="text-[11px] font-medium text-[var(--vh-text-2)]">
                {copy.switchLanguage}
              </span>
              <LanguageSwitcher />
            </div>
          </div>
        ) : null}
      </header>

      {children}

      <footer className="px-5 pb-8 pt-16 text-center text-[11px] font-[500] text-[var(--vh-text-2)]">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/terms-of-service" className="transition hover:text-[var(--vh-text-1)]">
            {copy.terms}
          </Link>
          <Link href="/privacy-policy" className="transition hover:text-[var(--vh-text-1)]">
            {copy.privacy}
          </Link>
        </div>
      </footer>
    </div>
  );
}
