# Shot controls

Open **Shot** in the Canvas composer of an image or video draft to choose framing, angle, lens, light and look; video drafts also offer camera moves such as push in, orbit, tracking or dolly zoom. Choices are written as the last line of the prompt:

> A fox runs through tall grass.
> Shot: close-up, low angle, slow push in, golden hour.

Every model receives the same plain text, and the line stays editable. Choosing an option again removes it, **Clear shot** removes the built-in terms, and terms you typed yourself (for example `rain on the lens`) are kept. Agents write the same line through the prompt with `viral_hit_canvas_apply`; the picker shows the built-in terms it finds as chosen.

| Group | Options |
|---|---|
| Framing | extreme wide, wide, medium, close-up, extreme close-up |
| Angle | eye level, low, high, overhead, dutch |
| Lens | 24mm wide, 35mm, 50mm, 85mm portrait, macro |
| Camera move (video) | static, push in, pull out, pan left/right, tilt up/down, orbit, crane up, tracking, handheld, dolly zoom |
| Light | natural, golden hour, soft studio, neon, low-key, backlight |
| Look | 35mm film, documentary, commercial, anime, black and white |

Labels are translated in the interface; the prompt line stays in English because most image and video models follow English camera terms best. Shot controls describe the shot to the model and do not drive a camera rig; how closely a result follows them depends on the model. Multi-shot sequences and per-shot regeneration are not part of this yet.

## Cinema page

**Cinema** in the project sidebar directs one shot at a time: subject, action, setting, up to two camera moves, framing, light, look, sound, length and aspect ratio. The plan beside the form shows the chosen keyframe and video models, the prompt written for each model family and the settings it will send, and updates without spending credits. **Render takes** queues the keyframe and every take as one durable run. Finished takes show a measured quality check (frozen, black, cut, silent or low-resolution footage) and go to the timeline one at a time or as the best take per shot.

A shot can start from a generated keyframe, a project image or straight from text, and can optionally end on a second project image. Start and end frames go only to models that declare ordered frames; character images go only to models that accept references. **Reuse keyframe** on a finished shot makes that keyframe the next start frame, so a variant with a different action, camera or model renders new takes without generating or paying for another keyframe. Agents use the same operation through the `viral_hit_shot` MCP tool.

### Sequences

**Continue** on a finished take extracts its last frame as a project image and starts the next shot from it, keeping the subject, look, camera, models and service of the shot it continues; write the next action and render. The new shot joins the same sequence at the next position, and the banner above the form says where the next render goes. **Edit shot** loads a shot back into the form, and **Render again** makes another attempt of the same shot, animating its finished keyframe so only the takes are new. Attempts keep their position, so a sequence can be redone one shot at a time.

A sequence with two or more shots appears above the shot list. **Add sequence to timeline** places the best finished take of each position in order and joins them with the chosen transition. Through MCP, `produce` accepts `sequence: { id, shotId?, continuesFrom? }`, `continue` returns the last-frame image of a take (the same image for the same take every time), and `list` reports each run's sequence, position, attempt, stored shot description and source take.
