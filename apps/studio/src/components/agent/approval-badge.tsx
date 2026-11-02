import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';
import { useApprovalBadge } from './use-agent';

/** Shows how many agent generations wait for a person; hidden when none do. */
export function ApprovalBadge() {
  const count = useApprovalBadge().data?.pending ?? 0;
  if (!count) return null;
  return <Link href="/agent" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--vh-graph)]/30 bg-[var(--vh-graph-soft)] px-2.5 text-xs font-semibold text-[var(--vh-graph-strong)]">
    <span className="size-2 rounded-full bg-[var(--vh-graph)]" aria-hidden="true" />{m['ui.agent.badge']({ count })}
  </Link>;
}
