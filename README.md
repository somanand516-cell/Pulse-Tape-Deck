# Pulse Tape Deck

A free, offline music and video player styled like a retro cassette deck (graphite and brushed-aluminum finishes), that runs in the browser and installs as an app on Android, Windows, macOS and Linux. Your media never leaves your device.

## Run it

- **Windows:** double-click `start.bat`. It opens http://localhost:8080.
- **Any OS:** run `python -m http.server 8080` (or `npx serve -l 8080 .`) in this folder, then open http://localhost:8080.
- Opening `index.html` directly also works, but installing the app and offline mode need the local server.

**Install as an app:** in Chrome or Edge, click the install icon in the address bar, or use Settings → *Install Pulse as an app*. On Android: Chrome menu → *Add to Home screen / Install app*. To use it on your phone, host this folder on any HTTPS static host (GitHub Pages, Netlify, …) and open it there once. After that it works offline.

## Features

| Feature | Details |
|---|---|
| Formats | MP3, FLAC, WAV, M4A/AAC, OGG, OPUS, **MIDI** (built-in synthesizer) · MP4, MKV, WEBM, 3GP, MOV (whatever your browser can decode) |
| Library | Songs, Videos, Artists, Albums, Genres, Folders; search; sorting; reads tags and cover art (ID3, FLAC, MP4, Ogg) |
| Playlists | Your own playlists (rename, delete, export to M3U), plus Favorites, Recently played, Most played and Recently added |
| Equalizer | 10 bands with presets (Rock, Pop, Jazz, Classical, Hip-hop, Heavy Metal, Dance, …), preamp, bass boost, reverb (rooms, hall, plate), sound field / stereo width, balance, volume normalizer |
| Lyrics | Synced `.lrc` lyrics matched by file name, embedded lyrics, load an `.lrc` by hand, optional online lookup (lrclib.net), timing offset, tap a line to jump to it |
| Floating window | Video → system picture-in-picture (floats over other apps). Music → pop-out mini player window (Chrome/Edge desktop), or a draggable, resizable in-app mini player |
| Tools | Sleep timer (with fade-out, or "stop after this track"), ringtone maker (cut, fade, save as MP3/WAV), video-to-MP3 converter, playback speed with pitch lock |
| Background play | Lock-screen and notification controls through the Media Session API, resume where you left off |
| Themes | Graphite (night) / brushed aluminum (day) / follow system / switch by time of day, 8 label colours |
| Tape deck | The cassette label shows the playlist you're playing from; reels spin and the tape moves from one reel to the other as the song plays; SIDE A / SIDE B; working VU meters; rolling tape counter (tap to zero); piano-key transport that latches down while playing; radio-dial seek bar |
| Tape extras | **Tape mode** (warm saturation, wow & flutter, hiss), **tape motor effect** (pitch slides down on stop, up on start), **hold ⏮/⏭** to rewind/fast-forward, mechanical key clicks — all can be turned off in Settings |
| Collections | Albums, artists, genres and playlists shown as a shelf of cassettes, each with its own label colour and a cover sticker |

## Adding music

- **＋ → Add files**, or drag and drop files or whole folders onto the window.
- **Add folder:** in Chrome/Edge on desktop, Pulse remembers the folder and re-reads it on each start. You may need to click *Reconnect* once per session.
- With *Keep an offline copy* turned on (the default), files you add are copied into the app's storage, so the library survives restarts on phones too.

## Keyboard shortcuts

`Space` play/pause · `←/→` seek 5 s · `Shift+←/→` previous/next · `↑/↓` volume · `M` mute · `L` lyrics · `Q` queue · `E` equalizer · `F` full screen

## Project layout

```
index.html            page structure
css/style.css         styles and themes
js/db.js              IndexedDB and localStorage helpers
js/ui.js              dialogs, toasts and menus
js/metadata.js        tag and cover-art reader
js/midi.js            MIDI parser and synthesizer
js/audio.js           Web Audio EQ/effects engine, WAV/MP3 encoders
js/lyrics.js          LRC parsing, synced display, online lookup
js/deck.js            cassette artwork, reels, VU meters, counter, key sounds
js/tools.js           equalizer, sleep timer, speed, ringtone maker, converter
js/app.js             library, views, player, queue, floating window, settings
js/vendor/lame.min.js MP3 encoder (lamejs 1.2.1, LGPL)
sw.js, manifest.webmanifest, icons/   installable offline app
```
