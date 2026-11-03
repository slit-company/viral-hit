# Image edits

Studio's Image tools include two edits that work with any connected model able to edit an image: **Relight** and **Edit text**. Each one writes a precise instruction for the model. You can still change that instruction before you generate. Results land in the project like any other generation.

## Relight

Choose one of eight lights (golden hour, blue hour, neon night, studio softbox, rim light, overcast, candlelight, hard noon sun) and a direction (left, right, front, behind, above), then press **Write the prompt**. The instruction names the new light and lists what must stay the same: people, faces, poses, objects, framing and surface colors. Edit models tend to redraw the whole picture unless they are told what to keep.

Models built only for relighting, such as Comfy's Bria Relight, appear under Relight with their own light settings. They do not read a written prompt, so Studio asks for none.

## Edit text

Add the image, then press **Find text in the image**. The server reads the text locally with [Tesseract](https://github.com/tesseract-ocr/tesseract), using every installed language among English, Korean, Japanese and Chinese, and shows each block it finds. Pick a block, type the new text and press **Write the prompt**. The instruction quotes both texts and asks the model to keep the font, weight, size, color, outline, spacing, perspective and position, and to change nothing else.

Text detection is free and never leaves the machine. Without Tesseract, type the text yourself; install it with `brew install tesseract tesseract-lang` (macOS) or `apt install tesseract-ocr tesseract-ocr-kor` (Debian/Ubuntu). For a project image, `POST /api/app/projects/<projectId>/image-text` with `{ "assetId": "…" }` returns the blocks and their positions as fractions of the image.

## Limits

How well the light changes and how faithfully the lettering is kept depend on the model. Models that follow instructions closely (GPT Image, Nano Banana, FLUX, Seedream) do best. For a small area, mark it with the [mask brush](VISUAL-REFERENCES.md#edit-a-marked-area) on a model that accepts masks.
