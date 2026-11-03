# Dialogue

**Voice a dialogue** in the editor toolbar turns a script into voiced lines with a different voice for each speaker. Write one turn per line as `Name: words` (a full-width colon works too). A line without a name continues the previous turn, and text before any name belongs to "Narrator".

1. Pick a voice service. Any connected text-to-speech model with a voice option works: ElevenLabs, ElevenLabs v4 through fal, or Sume speech.
2. Each speaker gets a voice. New speakers start with different voices from the model's list, and **Enter your own** takes any voice ID, such as a cloned voice.
3. **Voice N lines** queues one generation per line as a durable run. Each line is a paid generation on the chosen service, and agents follow the ask-before-generating setting.
4. When every line is done, **Add to timeline in order** places the lines as voice clips, 0.3 s apart, after the last voice already on the timeline. Music under them ducks automatically, and measured word timing becomes captions when the service returns it (ElevenLabs does).

Agents use `viral_hit_dialogue`: `produce` with `script`, a text-to-speech `modelId` and `cast` (`{ "Mina": "voice id" }`), `list` for line states, and `place` with an optional `gap` and `captions`. HTTP uses `/api/app/projects/<id>/dialogues`.

A dialogue has at most 40 lines. Lines are generated separately, so the voices do not react to each other's delivery.
