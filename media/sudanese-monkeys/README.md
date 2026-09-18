# قوم يا شمبورة — Sudanese monkeys short

A 19-second vertical (9:16) comedy short: one monkey wakes another one up to laugh
at him, the sleeper tells him where to go. Nothing to do with the research
platform — it lives here only because this branch was where the work was asked for.

`monkeys_video.mp4` — the finished film. 720×1280, 24 fps, H.264 + AAC, ~8 MB,
sized for WhatsApp / TikTok / Reels.

## The script

| # | Speaker | Line |
|---|---|---|
| 1 | Monkey A (awake, laughing) | يا شمبورة، قوم نايم ليها شنو يا زول؟ |
| 2 | Monkey B (asleep, furious) | ياخ خليني يا كسم انا داير انوم |
| 3 | Monkey A | قوم يا طيش الليدو، هههااااي قوم |

Subtitles are burned in, bottom centre, white with a black outline — same
treatment as the reference clip.

## How it is made

There is **one** generated image (`keyframe.png`) and no generated video. The
motion comes from driving a virtual camera over that still and warping the
characters, all locally:

- **Camera** — four shots cut on hard cuts: a drift right off monkey A onto the
  sleeper, a close-up on the sleeper for his reply, a close-up on monkey A
  howling, then back to the sleeper. Every shot is a full-height crop of the
  source, so the upscale stays between 1.7× and 2.5×.
- **Lip-sync** — each character has a jaw "rig" (`RIG_A` / `RIG_B` in
  `render.py`): a hinge line under the nose, a chin line, and a blend line below
  it. A displacement field compresses the jaw band and stretches the band below
  it to absorb the difference, so the displacement is zero at every edge of the
  region and there is no seam. The amount is driven by the per-frame loudness
  envelope of that character's voice file.
- **Body** — breathing on the sleeper, a shake while he is being woken, an angry
  head jerk on his line, a shoulder shudder on monkey A's laugh.
- **Grade** — vignette, warm daylight flicker, drifting dust motes in the
  sunbeam, film grain, fade in/out.

Arabic text is shaped by Pillow's RAQM layout engine (harfbuzz + fribidi), so the
letters join and run right-to-left correctly.

## Rebuilding

```bash
./build.sh
```

Takes about 90 seconds. Requires network only for the first run (packages + font).

## Swapping in real voices

The voices are `espeak-ng` + mbrola Arabic diphones — free and offline, but
synthetic. To replace them with real recordings, put three mono 48 kHz WAVs at
`audio/p1.wav`, `audio/p2.wav`, `audio/p3.wav` and run `build.sh` with the two
`espeak-ng` / voicing blocks commented out. `render.py` reads each file's length
and loudness, so the edit timing and the lip-sync follow the new audio
automatically — only the `start` times in `LINES` may need nudging if a take is
much longer than the current one.

## Assets

- `keyframe.png` — the source still (1376×768), generated from two frames of the
  reference clip so the room, the CGI style and the sleeping monkey's design
  carry over. Props added per the brief: his crocheted taqiya on the bed and an
  orange phone lying face-down beside him.
- `audio/p*.wav` — the three processed voice lines.
