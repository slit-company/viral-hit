# Local media source audit — 2026-10-19

Requested repositories remain ignored, unmodified reference checkouts. The vid2 GitHub page was inspected through Aside; implementation claims were checked against the pinned sources. Integration uses independently installed npm packages, not runtime imports from research.

| Source | Inspected revision | Useful implementation | Current reuse |
|---|---|---|---|
| [vid2-gen](https://github.com/lidge-ai/vid2-gen/tree/0119a5c12f602fcfaceb48924551871665eba4a5) | `0119a5c12f602fcfaceb48924551871665eba4a5`, 0.6.0 | Integer frame resolution, declarative scenes, stage/kinetic motion, transitions, segment caching, audio mixing/QA | Actual optional CLI execution for self-contained timelines → MP4; file sources, native layer round-trip, capture and provider generation are not bridged |
| [music2-gen](https://github.com/lidge-ai/music2-gen/tree/aba897a63e87398edec59a54ad88c713ff611111) | `aba897a63e87398edec59a54ad88c713ff611111`, 0.4.0 | Song JSON/mini-notation, seeded synths/drums, layers, effects, automation, loop timing, stems/MIDI | Actual optional CLI execution for authored synthesized scores → WAV; stems/MIDI, sampled instruments and plugins are not bridged |
| [ima2-gen](https://github.com/lidge-ai/ima2-gen/tree/bc58b964cc7f40223d7ebda8e9f6446da688973b) | `bc58b964cc7f40223d7ebda8e9f6446da688973b`, 3.26.3 | Explicit provider/model lanes, local result storage, capability discovery, alpha-pixel verification, graph branches/image editing | Inspected only; no ima2 generation adapter or copied UI is enabled |

ima2 includes its own UI/server and native dependencies. Useful next boundaries are explicit capability/provider selection and recoverable generation identity, followed by result verification. Its `lib/imageBackgroundParam.ts`/`lib/alphaDecode.ts` inspect actual alpha pixels: a PNG header alone cannot establish transparency. This audit does not implement that check in Viral Hit. Existing ComfyUI/Router verification remains separate.

These engines are authoring/rendering tools, not evidence of model-generation quality. General and specialized recipes can author different documents within the bridge bounds. Broader media support should extend verified project-asset bindings rather than accept arbitrary host paths.
