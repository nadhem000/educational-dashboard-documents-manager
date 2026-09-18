# Documents Manager

A small static web app that hosts browser-based document and audio tools,
packaged as an installable **PWA**. Currently ships with a **Voice Studio**
containing **Text To Speech** (neural MP3 generation via Netlify Functions)
and a **Voice Separator** (6-band frequency isolation with WAV export, running
entirely in the browser).

No signup, no API keys, no build step for the frontend.

> ⚠️ **Status: in development.** Files, contracts, and UI may change without
> notice. The `/api/tts` endpoint is unstable and both upstream TTS engines
> are unofficial — see [Notes and limitations](#notes-and-limitations).

---

## Tools

### 🎧 Voice Studio
The audio hub. Currently contains two tools:

#### 🎙️ Text To Speech
Turn typed text into downloadable MP3 using Microsoft Edge's neural voices,
with a Google Translate TTS fallback.

- Neural voices for **English**, **French**, and **Arabic**
- Language → gender → voice dropdowns, filtered automatically
- Multi-region voices (US / UK / AU / CA / FR / CA-FR / EG / SA / AE)
- Preferences and text persist across refreshes (`localStorage`)
- One-click **Play** and **Download MP3**
- Automatic fallback to Google TTS if Edge is unavailable
- Long-text support (POST body, no URL length limit)
- Chunked Google fallback — no 200-character truncation
- RTL handling for Arabic

#### ✂️ Voice Separator
Load an audio file and split it into **6 overlapping frequency bands** to
isolate birds, voices, footsteps, and ambient noise — all client-side.

- Drag-and-drop upload (MP3, WAV, OGG, FLAC, M4A, AAC)
- Real-time spectrum analyzer + waveform with click-to-seek playhead
- 6 configurable bands: Movements, Footsteps, Low Voices, Mid Voices,
  High Voices, Birds/Insects
- Logarithmic frequency sliders per band (20 Hz – 20 kHz)
- Per-band volume up to **10×** boost for weak signals
- **Solo** / **Mute** per band, plus live level meters
- Presets: All, Birds, Voices, Movement, Ambient
- **Bypass** toggle to A/B against the original audio
- Export each isolated band as a **WAV** file (rendered offline with the
  current settings)
- Keyboard shortcuts: `Space` = play/pause, `S` = bypass
- Fully responsive; audio never leaves the browser

---

## PWA

The app is installable and works offline for everything except TTS generation
(which requires the Netlify Function to be reachable).

- `manifest.json` — app name, theme, icons, display mode
- `sw.js` — service worker with a cache-first strategy for static assets and
  a network-only passthrough for `/api/tts`
- **Install** button appears in the UI when the browser fires
  `beforeinstallprompt` (Chrome/Edge/Android). iOS Safari users get an
  "Add to Home Screen" hint instead.

When you change any of the HTML/CSS/JS files, bump `CACHE_VERSION` in
`sw.js` so clients pick up the new build.

---

## Project layout

```
.
├── index.html                    # Documents Manager (hub)
├── dm_voiceStudio.html           # Voice Studio (hub)
├── dm_voiceStudio_TTS.html       # Text → Speech → MP3
├── dm_voiceStudio_VS.html        # Voice Separator (6-band filter + WAV export)
├── manifest.json                 # PWA manifest
├── sw.js                         # Service worker
├── icons/                        # PWA icons (see icons/README.md)
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
├── netlify/
│   └── functions/
│       └── tts.js                # Edge TTS + Google fallback
├── netlify.toml                  # build / function / redirect / headers config
├── package.json
├── LICENSE
├── README.md
├── todo.txt
└── .gitignore
```

`netlify.toml` rewrites `/api/tts` → `/.netlify/functions/tts` with
`status = 200`, so the frontend always talks to `/api/tts` and the request
method (POST) is preserved.

The Voice Separator needs **no backend** — it uses the Web Audio API
(`BiquadFilterNode`, `OfflineAudioContext`, `AnalyserNode`) directly in the
browser.

---

## Requirements

- Node.js 18+ (the function pins `NODE_VERSION = "18"`)
- A modern browser for the Voice Separator (Chrome, Edge, Firefox, Safari)
- HTTPS (or `localhost`) for the service worker to register — required by
  every browser
- A Netlify account for deployment (or `netlify dev` locally) — only needed
  for the TTS tool

---

## Install

```bash
npm install
```

---

## Run locally

Using the Netlify CLI (recommended — it emulates Functions, headers, and the
redirect):

```bash
npm install -g netlify-cli
netlify dev
```

Then open the URL it prints (usually <http://localhost:8888>).

> The Voice Separator works fine opened as a plain file (`file://`) or via any
> static server, since it has no backend dependency. The service worker will
> **not** register on `file://` — use a local server if you want to test PWA
> behaviour.

---

## Deploy

```bash
netlify deploy --prod
```

Or connect the repo to Netlify — `netlify.toml` supplies the build, publish,
functions, redirects, and headers, so no dashboard configuration is needed
beyond importing the project.

---

## API

Only the TTS tool uses a backend. The frontend calls a single endpoint:

```
POST /api/tts
Content-Type: application/json

{
  "voice": "fr-FR-HenriNeural",
  "text": "Le cartable de mon grand-père…"
}
```

Response: `audio/mpeg` on success, JSON with an `errors` array on failure.
The response carries an `X-TTS-Source` header (`edge` or `google`) so you can
tell which engine served the audio.

A GET form is still accepted for short text:

```
GET /api/tts?voice=en-US-BrianNeural&text=Hello
```

---

## Voices

Voices are defined in the `VOICES` object at the top of
`dm_voiceStudio_TTS.html`. To add a language or a voice, add an entry there —
the dropdowns build themselves.

Current set:

| Language | Voices |
|----------|--------|
| English  | Brian, Guy, Roger, Aria, Jenny, Michelle (US) · Ryan, Sonia, Libby (UK) · William, Natasha (AU) · Liam, Clara (CA) |
| French   | Henri, Denise, Éloïse (FR) · Antoine, Jean, Sylvie (CA) |
| Arabic   | Shakir, Salma (EG) · Hamed, Zariyah (SA) · Hamdan, Fatima (AE) |

The Google fallback derives its language code from the voice prefix:
`fr-FR-HenriNeural` → `fr`, `ar-EG-ShakirNeural` → `ar`.

---

## Voice Separator — how it works

Each band is a serial chain of two high-pass and two low-pass biquad filters
(Q = 0.7), summed through a per-band gain into a master gain node. When you
export a band, the same chain is rebuilt inside an `OfflineAudioContext` and
the result is encoded to 16-bit PCM WAV in the browser.

- **Sliders** are logarithmic, so the low end gets more resolution.
- **Volume** can be pushed to 10× (useful for faint bird calls).
- **Solo** mutes all other bands without changing their stored state.
- **Bypass** silences the filtered chain and passes the raw signal through.

Frequency-based separation works best when sounds occupy distinct ranges —
overlapping content (e.g. a voice over music) will bleed across bands.

---

## Notes and limitations

- **In development.** Expect breaking changes between commits.
- **Both TTS engines are unofficial.** `msedge-tts` and Google Translate TTS
  are not public APIs. They can rate-limit or break without notice.
- **Netlify function timeout.** Free tier defaults to 10 s. If long TTS texts
  fail in production but work locally, raise the timeout in the Netlify
  dashboard or via `[functions] timeout` in `netlify.toml`.
- **No server-side text cap.** Add one if the TTS endpoint is public — see
  `todo.txt`.
- **Google fallback MP3s are concatenated.** Frame-level stitching may make
  the duration or seek bar slightly off in some players. Audio is fine.
- **`localStorage` stores your TTS text in plaintext.** Fine for a personal
  tool.
- **Voice Separator is frequency-only.** It is not a source separator — it
  cannot pull a voice out of a mix that occupies the same range.
- **Service worker caching.** If you edit a file and don't see the change,
  hard-reload once or bump `CACHE_VERSION` in `sw.js`.

---

## Roadmap

See `todo.txt` for the full list. Highlights:

- Server-side text cap and voice validation for `/api/tts`
- Rate limiting in front of the TTS endpoint
- Caching generated audio in Netlify Blobs
- Streaming TTS responses via an Edge Function
- Speech rate / pitch / volume controls and voice-style dropdown
- Word-boundary highlighting during TTS playback
- Linkwitz-Riley 4th-order crossovers for the Voice Separator
- Persisting Voice Separator band settings in `localStorage`
- Offline TTS queue (deferred generation when back online)

---

## License

MIT — see [LICENSE](LICENSE).