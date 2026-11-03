# Image edits

Studio's Image tools include two edits that work with any connected model able to edit an image, **Relight** and **Edit text**, and a split into layers that the **Layers** page edits. Each one writes a precise instruction for the model. You can still change that instruction before you generate. Results land in the project like any other generation.

## Relight

Choose one of eight lights (golden hour, blue hour, neon night, studio softbox, rim light, overcast, candlelight, hard noon sun) and a direction (left, right, front, behind, above), then press **Write the prompt**. The instruction names the new light and lists what must stay the same: people, faces, poses, objects, framing and surface colors. Edit models tend to redraw the whole picture unless they are told what to keep.

Models built only for relighting, such as Comfy's Bria Relight, appear under Relight with their own light settings. They do not read a written prompt, so Studio asks for none.

## Edit text

Add the image, then press **Find text in the image**. The server reads the text locally with [Tesseract](https://github.com/tesseract-ocr/tesseract), using every installed language among English, Korean, Japanese and Chinese, and shows each block it finds. Pick a block, type the new text and press **Write the prompt**. The instruction quotes both texts and asks the model to keep the font, weight, size, color, outline, spacing, perspective and position, and to change nothing else.

Text detection is free and never leaves the machine. Without Tesseract, type the text yourself; install it with `brew install tesseract tesseract-lang` (macOS) or `apt install tesseract-ocr tesseract-ocr-kor` (Debian/Ubuntu). For a project image, `POST /api/app/projects/<projectId>/image-text` with `{ "assetId": "…" }` returns the blocks and their positions as fractions of the image.

## Layers

**Split into layers** (Studio, Image) turns one picture into 2 to 8 transparent layers through Sume's Qwen Image Layered, at $0.05 per layer. On the result, **Edit layers** opens them in the **Layers** page as a stack, bottom layer first. **Stack images** builds a stack from any project images instead; the first one sets the canvas size.

In the layer editor:

- The list shows the top layer first. Each layer can be renamed, shown or hidden, and moved up or down.
- The selected layer has opacity and size sliders and can be dragged on the canvas. **Reset** puts it back at the corner at full size.
- **Edit in Studio** opens the layer in Edit image (or Relight, Edit text) as the source. When the edit is done, **Replace with another image** puts the result in the layer's place, keeping its position and size.
- **Add an image on top** puts another project image above the rest.

Changes save on their own a moment after you make them. When the same stack was saved in another window, saving stops and **Reload** shows the newer version.

**Save as image** renders the visible layers, bottom first, onto a transparent canvas and adds the PNG to the project's media. The same stack always gives the same image, so saving twice adds it once. **Download layers (ZIP)** gives every layer image unchanged, numbered from the bottom, with `stack.json` listing each layer's position and size in pixels, opacity and visibility, so another editor can rebuild the stack. The layer images themselves never change, and deleting a stack keeps every image.

Agents use the same stacks through the MCP tool `viral_hit_image_layers` (`create`, `list`, `get`, `update` with the current revision, `flatten`, `delete`). Over HTTP, use `GET/POST /api/app/projects/<projectId>/image-layers` and `GET /api/app/projects/<projectId>/image-layers/<stackId>/zip`.

## Getting the best results

Models that follow instructions closely (GPT Image, Nano Banana, FLUX, Seedream) give the cleanest relighting and lettering. For a small area, mark it with the [mask brush](VISUAL-REFERENCES.md#edit-a-marked-area) on a model that accepts masks.
