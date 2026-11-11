# MG Vocal Practice Room

Status: **milestone 1 of 3**. Recording and live effects only. Pitch correction and coaching are not built yet.

## What it does
- Opens the microphone with the browser's voice-call processing turned off (no echo cancellation, noise suppression or auto-gain), so singing is captured raw.
- Live effect chain: mic level, low cut, warmth / presence / air EQ, compressor, echo (time, repeats, mix), reverb (size, mix), output level. Five presets: Clean, Warm room, Bright pop, Big hall, Slapback echo.
- "Hear myself" monitoring, **off by default** (use headphones, or the speakers will feed back).
- Input level meter with a clipping warning.
- Records two takes at once: **with effects** and the **original, unprocessed** mic signal. The original is what later coaching will measure.
- Playback of both takes in the page, and download of either as a 16-bit WAV.

## What it does not do (yet)
- No pitch correction and no coaching. Both are the next milestones.
- No conversational AI coach. That depends on which resources are already connected and has not been scoped.
- Takes are **not saved anywhere**: no Supabase upload, no storage writes, no RLS changes. They live in the browser tab and are gone on reload. Saving takes to the private bucket needs a separate, reviewed change.
- No backing track or metronome yet.
- Latency is not measured or compensated.

## Licensing and cost
No new dependencies were added. The room uses only standard browser APIs (Web Audio, getUserMedia, MediaRecorder) and code written for this repo. The reverb impulse response is generated in code, so no sample packs are involved. No paid services or API calls. The existing dependencies (React, Vite, supabase-js, wavesurfer.js) are open-source libraries; run a licence check after `npm install` before launch.

## How it was tested
| Check | Result |
| --- | --- |
| `npm test` (Node built-in runner, 21 tests: DSP helpers, WAV encoder, engine wiring against a fake audio context) | 21 / 21 pass |
| Real Chrome (headless) with a fake microphone, driving the real React room and engine | records both takes, valid WAV download, mic released on turn off, no console errors |
| Effect accuracy with a 3 kHz test tone: flat chain / presence +6 dB / output -12 dB | +0.2 dB / +6.0 dB / -11.9 dB relative to the original |
| Echo at 600 ms | echo present (-19 dB) where the original is silent |
| Reverb 3 s, mix 0.6 | tail about -43 dB one second after the tone; silent with reverb off |
| Compression at maximum | about +1.5 dB louder than original on a steady tone (not a meaningful compression test; see below) |

## Not verified
- **`npm install` and `npm run build` were not run** (the registry is blocked in the build session). The room was bundled with esbuild and run in Chrome, and all JSX parses, but the real Vite build is untested. The app shell, Lobby, sign-in and Supabase paths were only syntax-checked, because their dependencies were not installed. There is no `package-lock.json` yet.
- Only Chrome was tested. Firefox, Safari and mobile browsers are untested; Safari records in a different format (the WAV download should still work).
- Real singing, real headphones and real microphones were not tested. Compression was checked only for sanity on a steady tone, not on dynamic vocals. The fake microphone is a tone, not a voice.
- How the effects *sound* has not been judged by a person. Preset values are starting points and need tuning by ear.
- Monitoring latency depends on the device and browser; USB or Bluetooth audio can add noticeable delay.

## Next
1. You (or CI) run `npm install`, commit the lockfile, then `npm run build` and `npm test`.
2. Listen on headphones and tune presets.
3. Milestone 2: adjustable pitch correction (key and scale, strength, speed).
4. Milestone 3: coaching from local pitch and timing measurements of the original take.
