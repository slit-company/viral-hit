# Creative model APIs

One package, seven providers. Each builds into its own folder under `dist/providers/`, and `pnpm run setup` at the repository root copies them into `./providers`, which Studio, the worker and MCP load by default. Paste keys in **Connections**; models without a key stay listed as "Needs connection".

| Provider | Key in Connections | What you get | Official reference |
| --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | GPT Image 2.5 Sunburst and Flare, text-to-image and edits with up to 16 references | [Image generation](https://developers.openai.com/api/docs/guides/image-generation) |
| Google Gemini | `GEMINI_API_KEY` | Nano Banana 2.1, Pro and 2 Lite; Gemini Omni Flash video with audio | [Images](https://ai.google.dev/gemini-api/docs/image-generation), [Omni](https://ai.google.dev/gemini-api/docs/omni) |
| xAI | `XAI_API_KEY` | Grok Imagine Image 2, Grok Imagine Video 1.5 and Lite with frames or references | [Imagine](https://docs.x.ai/developers/model-capabilities/imagine) |
| ElevenLabs | `ELEVENLABS_API_KEY` | Voice (v4, multilingual), Eleven Music 2.5, sound effects, voice changer | [API reference](https://elevenlabs.io/docs/api-reference) |
| fal | `FAL_KEY` | 47 gallery models: Nano Banana, GPT Image, FLUX 3, Seedream 5, Seedance 2.5, Kling 4, Gemini Omni, Wan 3, Grok, lip sync, upscaling, voice, music | [Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue) |
| Runway | `RUNWAYML_API_SECRET` | 33 models: Gen-4.5, Veo 3.1, Seedance 2.5, Kling 4, Hailuo 3, Wan 3, H3, Aleph video edit, Act-Two, image models, upscaling | [Runway Dev](https://docs.dev.runwayml.com/ai-context.md) |
| Higgsfield | `HIGGSFIELD_API_KEY` (`KEY_ID:KEY_SECRET`) | 42 endpoints: Soul, Cinema Studio 4.0, Ads Studio, Marketing Studio, Seedance 2.5 create/edit/extend, Kling 3 and O3, motion control, Wan 3, H3, LTX 2.5, Genjutsu | [Higgsfield API](https://docs.higgsfield.ai) |

## How it is built

`src/kit/` holds what the providers share: bounded HTTP, result downloads, option validation and polling. OpenAI, Google, xAI and ElevenLabs are short hand-written modules. fal, Runway and Higgsfield publish a JSON schema for every model, so their models come from `schema-profile.mjs`. It turns each official schema into the public model entry (aspect ratios, lengths, references, controls) and a private binding that `catalog-request.mjs` uses to build the exact upstream request. Each of those vendors then supplies only authentication, reference upload, submission and status reading to `catalog-provider.mjs`.

```sh
npm ci
npm run sync    # refresh the fal, Runway and Higgsfield catalogs from their official schemas
npm run build   # bundle dist/providers/<id>
npm test
```

Edit `src/providers/<id>/selection.mjs` to add or remove catalog models (at most 50 per provider), then run `sync` and `build`. A model is kept only when every required upstream field is bound to Studio input.

## Behavior

- Paid submissions are sent once. A network failure after sending reports an unknown outcome and asks you to check the vendor's history; it never resubmits on its own. Higgsfield requests also carry an idempotency key.
- References are read from the project only when a generation is submitted, then delivered the way each vendor documents: fal CDN upload, Runway inline data or ephemeral upload, Higgsfield signed upload, inline data for Google, OpenAI and xAI.
- Results are downloaded into the project as soon as they finish, because vendor links expire.
- Cost is recorded when the vendor reports it (Runway credits, xAI USD); otherwise it stays unknown rather than estimated.

