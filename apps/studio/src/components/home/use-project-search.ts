import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWorkspaceProjects, type WorkspaceProjectCardItem } from '@/core/workspace-lib/app/workspace-client-api';

const PAGE = 24;

/** Server-side name search, sort and paging; the default view keeps the live recent list. */
export function useProjectSearch(recent: WorkspaceProjectCardItem[]) {
  const [input, setInput] = useState(''), [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { const timer = setTimeout(() => { setQuery(input.trim()); setLimit(PAGE); }, 250); return () => clearTimeout(timer); }, [input]);
  const custom = Boolean(query) || sort !== 'recent' || limit > PAGE;
  const result = useQuery({
    queryKey: ['workspace-project-search', query, sort, limit],
    queryFn: () => fetchWorkspaceProjects({ query, sort, limit }),
    enabled: custom,
    placeholderData: previous => previous,
  });
  const projects = custom ? result.data?.projects ?? [] : recent;
  return {
    input, setInput, sort, setSort: (next: 'recent' | 'name') => { setSort(next); setLimit(PAGE); },
    projects, searching: Boolean(query), loading: custom && result.isPending,
    canShowMore: projects.length >= limit && limit < 200, showMore: () => setLimit(value => Math.min(200, value + PAGE)),
    refresh: () => result.refetch(),
  };
}

