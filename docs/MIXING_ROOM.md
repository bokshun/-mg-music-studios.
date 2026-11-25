# Mixing Room (milestone 1)

Open it from the Lobby with the **Mixing Room** button (works in `?mock=1` too, because it only uses files you pick on your own device).

## What it does
- Load any number of WAV or MP3 files. Nothing is uploaded; it all stays in the browser.
- Play them together in sync, with **volume, pan, mute, solo** for each track and a **nudge** (±5 s, in 10 ms steps) to line a track up.
- **Voice by section.** Set two or more tracks to "Voice option" (for example one file with Bokshun 1 singing and one with Flomar singing, both made from the same song). Everything set to "Plays the whole song" (band, backing singers, the girl) keeps playing. Then list who sings where, one line per section:

```
# start-end  voice name
0:11-0:25 Flomar
0:53-1:14 Flomar
```
  Anything not listed uses the default voice. Each change crossfades over 30 ms, so there are no clicks. Later lines win where two overlap. Problems (unknown name, end before start, two tracks with the same name) are shown next to the box.
- **Save mix as WAV** renders the same mix to a 16-bit stereo WAV. If the mix would clip, its level is lowered to a -1 dB ceiling and the person is told.

## How it is built
- `src/lib/mixMath.js`: all the mixing decisions as plain functions (pan law, solo/mute, cut-list parsing and tidying, voice crossfade envelopes, and the offline mixdown). Unit tested.
- `src/lib/mixEngine.js`: Web Audio playback only (decode, play, pause, seek, live volume/pan).
- `src/components/MixingRoom.jsx`: the screen.
- Export uses `encodeWav` from `fxMath.js`.

## Tested
- `npm test`: 14 new unit tests for the mixing maths (all pass).
- Real files: mixing two 3-minute stereo songs with two swap sections took about half a second. Inside each swap section the output matched the second voice file exactly (correlation 1.000); everywhere else it matched the first (1.000).
- `npm run build` succeeds.

## Not tested yet / limits
- The screen and Web Audio playback were **not** run in a real browser in this build environment. Please try it in Chrome or Edge with two or three files.
- Mute, solo and role changes while playing restart playback from the current spot (a tiny gap). Volume and pan on "Plays the whole song" tracks change live.
- It does not line up files by itself. Versions of a song made separately by Suno can differ in length by a few seconds, so use Nudge or pick versions of similar length.
- Saving and reloading a mix, waveform display and effects are not part of this milestone.
- No Supabase reads or writes, no storage access, no database changes.
