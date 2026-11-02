# Spoken-word captions

Captions can light up the word being spoken, the style short-form videos use for hooks and voiceovers. Select a caption in the editor and pick a colour in **Spoken word highlight**; it applies to every caption in the timeline and works with all four caption styles. Choose **Off** to return to plain captions.

## Word timing

Each caption can carry measured word timings. Without them, the editor estimates timing from word length across the cue, and the inspector says so. Measured timings come from an agent or tool that knows when each word is spoken, such as a voice provider's alignment or a speech recogniser.

Editing the text keeps the timing of words that did not change. A replaced word takes the time of the word it replaced; a new word takes the time between its neighbours and, when that gap is too short, borrows half of the previous word. Moving a cue keeps its words aligned because timings are stored relative to the caption.

Words split on spaces. Chinese and Japanese text without spaces is timed per character, with punctuation kept on the preceding character. Korean is timed per space-separated word.

## Commands

UI, HTTP commands and MCP `viral_hit_editor_edit` share three operations:

```json
{ "type": "set_caption_highlight", "color": "#FFD60A" }
{ "type": "set_caption_words", "clipId": "cue-1", "words": [{ "text": "Find", "start": 0, "end": 0.42 }, { "text": "the", "start": 0.42, "end": 0.55 }, { "text": "hit", "start": 0.55, "end": 1.1 }] }
{ "type": "captions_from_words", "words": [{ "text": "Ship", "start": 0.2, "end": 0.5 }, { "text": "it.", "start": 0.5, "end": 0.9 }], "replace": true }
```

`set_caption_words` times are seconds from the start of the caption, and the words must spell its text in order. `captions_from_words` takes timeline times, for example a voice track's alignment, and builds readable cues: it breaks after sentence punctuation, pauses longer than 0.6 s, six words, 3.2 s or 32 characters (`maxWords` and `maxSeconds` change the first two). Use `null` to clear a highlight or return a caption to estimated timing.

## Rendering

The preview colours the word with CSS, the browser export redraws it on the canvas, and the server export renders all captions with libass when highlighting is on (drawtext otherwise). Every renderer uses the same tokens, line breaks and active word, which stays lit until the next word starts. The server path needs an FFmpeg build with libass; the export explains how to install one if it is missing.

Evidence: source tests cover tokenising, estimates, re-timing, cue grouping and a real libass render; a browser test checks the preview colour, both MP4 exports and re-timing after a text edit. See the [validation ledger](VALIDATION.md#spoken-word-captions--2026-11-02).
