# Character swap

**Swap character** in the editor's clip actions gives the person in a video clip a character's look while the clip keeps its body movement, head turns, expressions, timing, camera, framing, background and light. It follows the reference-to-video approach that works best for this today: a model regenerates every frame from the clip as a reference video and the character's photos as reference images, instead of pasting a face.

1. Pick a character from **Characters** and a model. Any connected video model that takes a reference video and reference images can swap; MiniMax H3 references comes first, then Wan Animate replace, Seedance 2.5 references, Kling O3 video reference, Sume remix and other reference-to-video models.
2. The plan shows how many pieces the clip needs and the estimated cost. Reference videos for these models run 2 to 15 seconds, so longer clips (up to two minutes) are cut into even pieces. Each piece asks for the shortest output length that covers it.
3. The prompt says which input supplies what, because these models follow role assignments closely: identity (face, hair, outfit, body shape) comes only from the images, and everything else from the video. Your notes are added at the end.
4. **Start the swap** cuts the pieces as project videos and queues one paid generation per piece as a durable run. Agents follow the ask-before-generating setting.
5. **Check faces** runs locally and costs nothing. OpenCV face matching compares each result with the character and with the person in the middle frame of its piece: **Swapped** (looks like the character, not the original), **Mixed with the original face** (resembles both, the identity mix reference-to-video tests often show), **Still the original person** or **No clear face**. Borderline scores on both sides count as mixed.
6. **Use on the timeline** puts each result on the clip as a take, splitting the clip where pieces meet, so the original take stays one click away. With **Keep the clip's original sound** the clip's sound goes on an audio track and the swapped picture is muted.

Agents use `viral_hit_character_swap` with `plan`, `produce`, `list`, `evaluate` and `place`; HTTP uses `/api/app/projects/<id>/character-swaps`.
