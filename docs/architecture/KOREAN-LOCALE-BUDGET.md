# Korean locale bundle budget

2026-10-30. The user explicitly requested separate English and Korean experiences while retaining a lightweight app.

The previous 616,000-byte aggregate JS gzip limit covered three locales and an incompletely localized Studio. The first four-locale build measured 692,964 bytes; the final copy pass measured 694,726 bytes across all routes, exceeding the previous 616,000-byte budget by 78,726 bytes (12.78%). Total static output is 9,408,099 bytes, below the unchanged 10 MB limit.

Inspection: no app dependency or lockfile changed. Existing named imports still limit the next-intl compatibility layer to AppShell, Projects and Common rather than duplicating flat dictionaries. Paraglide generates tree-shakeable message modules; shared-vendor splitting and SEED CSS layer ordering remain intact. The optional Higgsfield module is bundled separately for Node and contributes no browser SDK/model payload. Most added messages in Japanese/Chinese fall back to the same English text pending independent translation.

Decision: allocate 700,000 bytes to aggregate scripts for four locales, leaving about 5.3 KB of headroom. This is an explicit localization scope increase, not a performance improvement or an initial-page transfer measurement. Keep the 10 MB static cap, structural baseline and optional-runtime boundaries unchanged. Further features must fit or reduce this budget; do not use this decision as an automatic allowance for later growth. Locale-per-response splitting remains a separate optimization requiring SSR/hydration and navigation testing.
