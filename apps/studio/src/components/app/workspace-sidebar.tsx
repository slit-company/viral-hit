import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Blocks, BookOpenText, Clapperboard, Images, LayoutPanelTop, Link2, PanelLeftClose, PanelLeftOpen, Plus, Puzzle, Scissors, Send, Sparkles, UserRound, Users, Workflow } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { apiJsonGet } from '@/lib/api-client';
import { appConfig } from '@/config';
import { buildProjectDetailPath } from '@/core/projects/project-entry';
import { cn } from '@/lib/utils';

type Page = 'studio' | 'canvas' | 'editor' | 'assets' | 'storyboards' | 'publish';
type RecentProject = { id: string; name: string; lastWorkspaceMode?: string | null };
const COLLAPSED_KEY = 'viral-hit:sidebar-collapsed';

function Item({ href, icon, label, accessibleLabel, active, collapsed }: { href: string; icon: ReactNode; label: string; accessibleLabel?: string; active?: boolean; collapsed: boolean }) {
  return (
    <Link href={href} aria-label={accessibleLabel} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined}
      className={cn('flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium transition', collapsed && 'justify-center px-0',
        active ? 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]' : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]')}>
      <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">{icon}</span>
      <span className={cn('truncate', collapsed && 'sr-only')}>{label}</span>
    </Link>
  );
}

function Heading({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  return collapsed ? <div className="mx-3 my-2 border-t border-[var(--vh-border)]" /> : <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--vh-text-3)]">{children}</p>;
}

/** Desktop project navigation in the style of Higgsfield's workspace sidebar. Phones keep the header tabs. */
export function WorkspaceSidebar({ projectId, current }: { projectId: string; current?: Page }) {
  const t = useTranslations('AppShell');
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1'); } catch { /* storage unavailable */ } }, []);
  const toggle = () => setCollapsed(value => { try { localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1'); } catch { /* storage unavailable */ } return !value; });
  const recent = useQuery({ queryKey: ['sidebar-projects'], queryFn: () => apiJsonGet<{ projects: RecentProject[] }>('/api/app/projects'), staleTime: 30_000 });
  // Longer accessible names keep the visible word and match the header icons they replace on desktop.
  const accessible: Partial<Record<string, string>> = { publish: 'Publish project', '/connections': 'Publishing connections' };
  const pages: Array<[Page, string, string, ReactNode]> = [
    ['studio', '/studio/' + projectId, t('header.studio'), <LayoutPanelTop key="s" className="size-4" />],
    ['canvas', '/canvas/' + projectId, t('header.canvas'), <Workflow key="c" className="size-4" />],
    ['editor', '/editor/' + projectId, t('header.editor'), <Scissors key="e" className="size-4" />],
    ['storyboards', '/storyboards/' + projectId, t('sidebar.storyboards'), <Clapperboard key="b" className="size-4" />],
    ['assets', '/assets/' + projectId, t('header.assets'), <Images key="a" className="size-4" />],
    ['publish', '/publish/' + projectId, t('sidebar.publish'), <Send key="p" className="size-4" />],
  ];
  const library: Array<[string, string, ReactNode]> = [
    ['/packs', t('sidebar.packs'), <Blocks key="pk" className="size-4" />],
    ['/skills', t('sidebar.skills'), <Sparkles key="sk" className="size-4" />],
    ['/characters', t('sidebar.characters'), <UserRound key="ch" className="size-4" />],
    ['/community', t('sidebar.community'), <Users key="co" className="size-4" />],
    ['/extensions', t('sidebar.extensions'), <Puzzle key="ex" className="size-4" />],
    ['/connections', t('sidebar.connections'), <Link2 key="cn" className="size-4" />],
  ];
  return (
    <aside aria-label={t('sidebar.navigation')} className={cn('hidden shrink-0 flex-col border-r border-[var(--vh-border)] bg-[var(--vh-surface)] transition-[width] duration-200 lg:flex', collapsed ? 'w-[64px]' : 'w-[232px]')}>
      <div className={cn('flex h-14 items-center gap-2 border-b border-[var(--vh-border)] px-3', collapsed && 'justify-center px-0')}>
        {!collapsed && <Link href="/" className="flex min-w-0 flex-1 items-center gap-2"><img src={appConfig.app_logo} alt="" className="size-7 rounded-lg object-contain" /><span className="truncate text-[14px] font-semibold text-[var(--vh-text-1)]">{appConfig.app_name}</span></Link>}
        <Action aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')} aria-expanded={!collapsed} onClick={toggle} className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--vh-text-2)] hover:bg-[var(--vh-control)]">
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Action>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <Link href="/studio" title={collapsed ? t('sidebar.newProject') : undefined} className={cn('mb-2 flex h-9 items-center gap-2 rounded-xl border border-[var(--vh-border)] px-2.5 text-[13px] font-semibold text-[var(--vh-text-1)] hover:bg-[var(--vh-control)]', collapsed && 'justify-center px-0')}>
          <Plus className="size-4" aria-hidden="true" /><span className={cn(collapsed && 'sr-only')}>{t('sidebar.newProject')}</span>
        </Link>
        <Heading collapsed={collapsed}>{t('sidebar.project')}</Heading>
        {pages.map(([page, href, label, icon]) => <Item key={page} href={href} label={label} accessibleLabel={accessible[page]} icon={icon} active={current === page} collapsed={collapsed} />)}
        <Heading collapsed={collapsed}>{t('sidebar.library')}</Heading>
        {library.map(([href, label, icon]) => <Item key={href} href={href} label={label} accessibleLabel={accessible[href]} icon={icon} collapsed={collapsed} />)}
        {!collapsed && <>
          <Heading collapsed={false}>{t('sidebar.recentProjects')}</Heading>
          {(recent.data?.projects ?? []).slice(0, 6).map(project => (
            <Link key={project.id} href={buildProjectDetailPath(project.id, project.lastWorkspaceMode ?? undefined)} aria-current={project.id === projectId ? 'true' : undefined}
              className={cn('block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition', project.id === projectId ? 'bg-[var(--vh-control)] font-semibold text-[var(--vh-text-1)]' : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]')}>
              {project.name}
            </Link>
          ))}
          <Link href="/projects" className="mt-1 flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]"><BookOpenText className="size-3.5" aria-hidden="true" />{t('sidebar.allProjects')}</Link>
        </>}
      </nav>
    </aside>
  );
}

