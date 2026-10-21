# Community catalog boundary

`core/community/` owns bounded discovery metadata, authoring contracts, review diffs and local snapshots. Browser components import only the pure contract. HTTP/MCP/CLI call the same service; they do not duplicate persistence or installation. Catalogs compose existing libraries by passing an entry URL and raw-file hash to their fetch operation.

The snapshot lives in its own SQLite table. Save compares the incoming reviewed digest (canonical normalized catalog plus source) and the previous saved digest under a write transaction. An identical replay is a no-op. Removal compares the saved digest and changes no installed library. Network reads happen before transactions and never mutate saved metadata. Failures preserve the prior snapshot; concurrent clients must review again.

The contract accepts only static public HTTPS metadata/file URLs. The bounded downloader remains responsible for DNS/socket pinning and redirects. A shared streaming hash helper checks raw artifact bytes before JSON parsing or publishing a downloaded tar path; existing library inspection and retained-content installation follow. This hash is distinct from a library's canonical reviewed-content digest. It detects drift, not trusted authorship.

Catalog descriptions cannot create executable capabilities, approve jobs or install dependencies. UI navigation only prefills an explicit library review action; catalog listing performs no network or module execution. Metadata size/count limits and paginated cards bound the feature without another service or runtime dependency. Signed/authenticated catalogs, automatic discovery/polling, and executable-extension lifecycle need separate designs.
