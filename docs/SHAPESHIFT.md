# Shapeshift

**Shapeshift** rebuilds who or what is in a video while the video's motion, timing, camera and sound stay as shot. It runs on the video models you have connected (fal, Runway, Comfy, Sume, Higgsfield and others), picks the strongest one that has credit, can run several models side by side, and scores every result against the source so the best one is marked. Every result has the source's exact length, framing and sound, so it drops straight into the timeline.

Open it from **Shapeshift** in the project sidebar. Agents use the `viral_hit_shapeshift` MCP tool, and HTTP clients use `/api/app/projects/<id>/shapeshifts`.

## Two modes

| Mode | Keeps from the source | Takes from your pictures |
| --- | --- | --- |
| **Motion transfer** | Body movement, gestures, timing, camera movement and framing | The character's look and the setting. **Style** can redraw the whole video as anime, 3D animation, claymation, comic, watercolor, pixel art, film noir, neon or oil painting |
| **Object swap** | Everything except one subject: motion, expressions, gaze, camera, background and light | The new person, product or outfit |

## A run, step by step

1. **Source video.** Choose any project video from the motion library: your uploads, imported references (YouTube, Instagram and other intake) and earlier results, or upload a new one. Use the whole video or a range of 2 seconds to 2 minutes. Clear, readable movement gives the best results.
2. **Subject.** Add up to 14 pictures in order; the first one leads. A library character adds its own reference images after yours.
3. **Directions** (optional) are added after the instructions Shapeshift writes for the model.
4. **Model.** **Auto** chooses for you, or pick any model that can do the job. **Variations** (1–3) run different model families side by side with Auto.
5. **Plan.** Before anything is spent, the panel shows the models, how many generations the run needs and the estimated price.
6. **Generate** cuts the source into pieces when it is longer than a model makes in one go (even pieces of up to 15 seconds), then queues every generation as one durable run that survives restarts.
7. **Results** appear as each variation finishes. Shapeshift joins its pieces, fits them to the source frame at the chosen quality (480p, 720p or 1080p), cuts or holds each piece to its exact length and puts the source's sound back. **Add to timeline** places the result in the editor.

## How Auto chooses

Auto ranks every connected model that takes a reference video and reference images:

1. Services that report credit come first, services that report nothing next, and services out of credit are skipped. Sume, fal, Runway and ElevenLabs report their balance.
2. A model this account was refused in the last week (for example a route the API key may not call) is tried last.
3. When the main picture shows a face, Seedance 2.5 video edit moves behind the other models: it declines reference photos that may show a real person, and with a drawn face it keeps the source's facial structure.
4. Within that order each mode prefers its strongest model families:
   - Motion transfer: Act-Two, Kling motion control, Seedance 2.5 references, MiniMax H3, Wan 3, then other reference-to-video models.
   - Object swap: Wan Animate replace, Seedance 2.5 video edit, Aleph, Kling O3 and V4 video edit, Seedance 2.5 references, MiniMax H3, Wan 3, then other reference-to-video models.

With several variations, each one uses a different family, so one run compares, for example, Seedance 2.5, MiniMax H3 and Wan 3.0 on the same shot.

The instructions sent with the pictures say which input supplies what. For object swap: take only the subject's look (face, hair, outfit, body shape, colours, materials) from the pictures and everything else from the video. For motion transfer: perform exactly the video's motion, with the look and the setting from the pictures. The chosen style and your directions follow.

## Scores

Scoring runs locally and costs nothing.

- **Motion** compares small grayscale frames of the result and the source, sampled at the same rate. Each step between frames becomes a grid of motion energy. Object swap compares where and when things move; motion transfer compares when, since the new scene may place the subject elsewhere.
- **Face** uses OpenCV face matching: how much the result resembles the subject pictures, and how much it still resembles the person in the middle of the source. The verdict is **New face**, **Mixed faces** or **Original face**.
- The score combines both, and a face that still resembles the original costs points. The best variation is marked **Best**.

## Models added for Shapeshift

The Sume connector adds **Seedance 2.5 video edit**, which edits the source clip itself and keeps its length and framing (4–30 s clips), and **Wan 3.0 references**, which takes up to 10 pictures and 15 seconds of reference video. The connector also reports the key's remaining balance, so Auto tries Sume first while other services are empty.

## Interfaces

| Interface | Use |
| --- | --- |
| Page | `/shapeshift/<project>` |
| HTTP | `GET` lists runs; `POST` with `action` `models`, `plan`, `produce`, `list` or `finish` |
| MCP | `viral_hit_shapeshift` with the same actions |

`finish` joins and scores every variation whose pieces have all arrived; the page calls it on its own as soon as they do. Results are project videos with `operation: shapeshift` in their metadata.

Live runs are recorded in the [validation ledger](VALIDATION.md#shapeshift--2026-11-03).
