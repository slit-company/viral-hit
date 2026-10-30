---
name: video-model-routing
description: Choose among connected video models by declared inputs, length and cost; retry confirmed failures within budget and never resubmit an uncertain paid job.
---

# Choose a video model

Models change every week. Do not rely on a remembered list: read `viral_hit_generation_models` (filter `kind: "video"`) and `viral_hit_generation_model_get` for each candidate. A model's descriptor is the truth about its aspect ratios, lengths, reference counts, options and connection state.

## Select

1. A model or service the user named wins. "Only X" means no silent switch.
2. Match the shot's needs to declared inputs:
   - exact opening and closing composition: image-to-video with first and last frames;
   - several identity or product images: reference-to-video;
   - follow an existing clip's motion or edit it: video edit, motion control or motion transfer;
   - speech in the shot: a model with native audio, or a separate voice plus lip sync.
3. Check the length and aspect ratio are in the descriptor; never ask for a value it does not list.
4. Prefer a connected model over one marked "Needs connection". The same model name on two services is two different routes with different bills; choosing the service is part of choosing the model.
5. Video cost scales with length far more than resolution. Estimate at the real length, multiply for batches, and show the total before submitting.

## Submit

Use `viral_hit_asset_generation` with `action: "prepare"`, show the user the exact model, prompt, references, options and estimate, and submit only with approval. Submission returns a job, not a result: wait for `viral_hit_generation_status` to finish and look at the actual video before describing it.

## Recover

- **Confirmed failure, allowed content:** retry the same request on the same model up to two more times, then move to the next model in the plan that has the same inputs, within the approved budget. Announce the switch and any capability difference.
- **Moderation or invalid input:** fix the request; do not rewrite benign content on the assumption it was prohibited without the actual error.
- **Unknown outcome** (timeout, lost connection, "outcome is unknown"): call `action: "inspect"` with the original intent token and check the service's history. Never prepare a fresh request to "retry" until you know the first one did not run.
- **Out of balance or quota:** stop and report the real error; do not route to another paid service the user did not approve.

