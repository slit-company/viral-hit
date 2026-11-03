# Costs

Viral Hit shows what a generation should cost before it runs.

## Estimates before a run

The estimate uses the price each service publishes for the model, the length, resolution and other settings you chose, and the script length for speech. It appears next to **Generate** in Studio, in the Cinema plan, in the Canvas run plan, in the dialogue dialog and on each approval an agent waits for. Agents get the same numbers: approvals list a cost per step, Cinema `preview` and Canvas `plan` return a `cost` total, `viral_hit_dialogue produce` returns one, and `viral_hit_generation_model_get` includes the model's `pricing`.

Estimates are approximate. They leave out reference and input extras (for example a charge per reference image or per second of input video) and taxes, and they never block a run. When a service picks the resolution itself, the estimate uses the model's highest listed rate. A model without a published price shows **Price not listed** instead of a guess, and a per-second tool whose source length is unknown shows its rate per second.

## Where the prices come from

| Service | Models priced | Source |
|---|---|---|
| fal | 47 of 47 | fal's pricing API (`extensions/model-apis/scripts/sync-fal-prices.mjs`), with tiers by resolution from each model page in `pricing-overrides.json`. Prices fal lists only in its own units or tokens use fal's reported average per request. |
| Runway | 33 of 33 | [API pricing](https://docs.dev.runwayml.com/guides/pricing/) at $0.01 per credit, including minimums and the Kling 4.0 discount through November 30, 2026 |
| Comfy | 26 of 28 | [Partner node pricing](https://docs.comfy.org/tutorials/partner-nodes/pricing) at 211 credits per US dollar (every Veo rate there is a multiple of 2.11 credits per $0.01). Seedance rates are Comfy's 16:9, 24 fps examples; GPT Image 2.5 bills tokens and is not listed. |
| xAI | 3 of 3 | [xAI pricing](https://docs.x.ai/developers/pricing) at medium image quality |
| Gemini | 4 of 4 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing); Nano Banana 2 Lite and Gemini Omni Flash list only some sizes |
| ElevenLabs | Speech | One credit per character for Eleven v4 (measured: 33 characters used 33 credits) and Multilingual v2, half for Flash v2.5. Shown as characters, the unit of the ElevenLabs balance. |
| Higgsfield, Sume, OpenAI | — | Not listed yet |

Each price records its source and the date it was checked. To refresh fal, run `FAL_KEY=... node extensions/model-apis/scripts/sync-fal-prices.mjs` and then `pnpm providers`; the call only reads prices.

## For provider authors

Add `pricing` to a model in `provider.json` (bundled providers keep it in `pricing.json` next to the catalog):

```json
{ "currency": "USD", "per": "second", "amount": 0.68, "by": { "option": "resolution", "amounts": { "480p": 0.2, "1080p": 0.68 } }, "minimum": 0.8, "basis": "list", "source": "https://example.com/pricing", "checked": "2026-11-03" }
```

`currency` is `USD` (convert fixed-price credits) or `characters`. `per` is `second` (of output, or of the source for tools billed by input length), `output` (each image or clip), `request`, `megapixel` or `character` (of the script). `by` sets the rate by an option's value; with two or three options, list them in `option` and join their values with `|` in the keys, such as `"720p|true"`. `amount` is the rate when the options have no listed value. `basis` is `average` when the number is the service's average per request rather than a published rate.
