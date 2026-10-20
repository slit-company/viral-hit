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
