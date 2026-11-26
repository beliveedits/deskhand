# Deskhand

<img src="docs/icon.png" alt="" width="64" height="64" align="right">

**Give your laptop a command and it does it.** Type or say "open Premiere", "volume to 40" or "remind me at 6pm to send the invoice". Deskhand does it, from a fixed list of 46 safe skills, on Windows, macOS and Linux.

No cloud. No account. No AI model. No packages to install, only [Node.js](https://nodejs.org) 18.15 or newer. MIT licensed.

Try the parser in your browser first, with nothing installed: https://vaghelabhavesh.com/deskhand.html
Guide: [Control your laptop with typed or spoken commands, safely and with no cloud](https://vaghelabhavesh.com/blog/voice-and-text-commands-for-your-laptop-deskhand.html)

## Start

```
node bin/deskhand.js
```

Your browser opens a small page on `127.0.0.1`. Type a command, or press the mic and speak.

| Command | What it does |
|---|---|
| `node bin/deskhand.js` | start Deskhand and open it in your browser |
| `node bin/deskhand.js "open chrome"` | run one command in the terminal |
| `node bin/deskhand.js repl` | talk to it in the terminal |
| `node bin/deskhand.js doctor` | check what works on this computer (`--live` adds three harmless tests) |
| `--dry` | do nothing for real. Shows the exact command each skill would run |
| `--port N`, `--no-open`, `--home DIR` | port, skip opening the browser, where notes and settings live |

`npm link` in this folder gives you a `deskhand` command.

## What it can do

Open and close apps, open websites and folders, search the web, find and open your latest downloads, tidy Downloads into folders (and undo it), volume, mute, play and pause, screenshots, lock and sleep, timers, focus sessions and reminders, notes, the clipboard, maths and unit conversions, frames and timecode for editors, battery and disk checks, saved routines and chained commands ("open Premiere and volume to 20").

Every skill and its example phrases are in the guide: https://vaghelabhavesh.com/deskhand.html

## How it stays safe

- **A fixed list.** There is no "run this command" skill. Commands are built from templates and run as a program with an argument list, never as a shell line. PowerShell and AppleScript values are quoted by tested functions.
- **It never deletes.** No skill deletes, overwrites or leaves the folder it was asked about. Tidy-up only moves files inside Downloads, keeps a log, and `undo` reverses it.
- **Risky things ask first.** Shut down, restart, sleep, close an app, clear notes and tidy Downloads wait for a yes or no that expires after 45 seconds. A routine or chain with one of them asks once, before any step runs.
- **It will not launch downloaded programs.** Installers, scripts, shortcuts, app bundles and macro documents are never opened. Their folder is.
- **A locked-down local page.** Served on 127.0.0.1 only, host and origin checked, single-use sign-in link, HttpOnly cookie, JSON only, size and rate limits, strict Content-Security-Policy, no `innerHTML`.
- **Refuses what it should.** Delete, send, call, install, Wi-Fi and Bluetooth, typing and clicking, and arbitrary shell commands are refused with a reason.

## Voice

Optional and press-to-talk. There is no wake word and no always-on microphone. The mic uses the speech recognition built into Chrome or Edge, which may send audio to the browser's maker. Deskhand cannot control that and shows a notice before the first use. Typing never leaves your computer.

## Honest limits

- It has 46 skills and understands nothing outside them. An unknown command is refused with the closest example, never guessed.
- **Windows and macOS were verified as exact command text, not run on real machines.** The tests check every command the builders produce, and the example phrase corpus runs through all three systems in dry mode. Run `node bin/deskhand.js doctor` on your computer, and please open an issue with its output if something fails.
- The microphone path was not tested, because the build environment had no microphone. Text, the parser and the page are tested, including in a real browser.
- Mute on Windows is a toggle. Windows volume moves in 2% steps.
- Timers and reminders only ring while Deskhand is open. They are saved, and a missed one rings late with a note.
- No live currency rates (it opens a Google search). Timecode is non-drop-frame.
- macOS may ask you to allow your terminal for screenshots and volume. On Linux some skills need a small tool: `pactl` or `amixer`, `playerctl`, a screenshot tool, `wl-copy` or `xclip`.

## Make it yours

Create `config.json` in the `.deskhand` folder in your home folder:

```json
{
  "name": "Bhavesh",
  "apps":    { "edit": "Adobe Premiere Pro" },
  "folders": { "client work": "D:\\Clients" },
  "sites":   { "crm": "https://crm.example.com" }
}
```

Then say "open edit", "open client work" or "open my crm". Entries that are not safe are ignored and reported at start-up.

## Tests

```
npm test             # every suite, no packages needed
npm test -- --e2e    # also the real-browser check (needs Playwright with Chromium)
```

The tests cover the text, number and time parsing, the calculator and unit converter, every parser rule's example phrases, every command for all three systems, the file tools, the engine, the local server's security checks (host spoofing, cross-site posts, size and rate limits, path traversal, one-time sign-in) and the browser page.

## Layout

```
bin/deskhand.js   command line
src/              parser, skills, engine, platform command builders, server, doctor (no dependencies)
ui/               the page you talk to
test/             tests
docs/             icon
```

`src/text.js`, `calc.js`, `clock.js`, `parser.js` and `platform.js` are pure and also run in a browser. That is how the playground on the website works.

## Licence

MIT. See LICENSE. Not affiliated with any film, studio or company. Version 1.0.0, by [Bhavesh Vaghela](https://vaghelabhavesh.com).

## More free tools

All tools are free, open source and run on your device: see [the full list](https://vaghelabhavesh.com/free-tools.html) or [the collection on GitHub](https://github.com/beliveedits/free-video-and-ad-tools).

- [Silence Cutter](https://github.com/beliveedits/silence-cutter): Finds pauses in a recording and exports a cut list for Premiere Pro, DaVinci Resolve or ffmpeg.
- [Beat Marker](https://github.com/beliveedits/beat-marker): Finds the tempo and every beat of a song and exports markers for After Effects, DaVinci Resolve and caption tracks.
- [Loudness Check](https://github.com/beliveedits/loudness-check): Measures LUFS, true peak and loudness range of a video or audio file, compares it with platform levels and gives an ffmpeg fix.
- [Subtitle Fixer](https://github.com/beliveedits/subtitle-fixer): Fixes overlaps, long lines and fast subtitles in SRT and VTT files, retimes them, and converts between formats.
- [Video Review Notes](https://github.com/beliveedits/video-review-notes): Add frame-accurate notes to a video with one key, then export markers for After Effects and Resolve or an email-ready list.
- [Easing Lab](https://github.com/beliveedits/easing-lab): Edit cubic-bezier easing curves and springs, and copy them as CSS, GSAP, Remotion, Lottie or After Effects keyframe values.
- [Frame Grabber](https://github.com/beliveedits/frame-grabber): Grab frames from a video at intervals or exact times, auto-pick the best thumbnails, and download a ZIP or a contact sheet.
- [Ad Copy Checker](https://github.com/beliveedits/ad-copy-checker): Count ad headline and text length for Google, Meta, LinkedIn and TikTok, see where each platform cuts it off, and check lists.
- [Ad Namer](https://github.com/beliveedits/ad-namer): Generate consistent ad names in bulk, add UTM tracking links, copy Meta URL parameters, and check names you already have.
- [Ad Test Planner](https://github.com/beliveedits/ad-test-planner): Plan an ad A/B test: visitors per version, cost and days. Check results with p-values and ranges, and see why peeking misleads.
- [SaaS Metrics Lab](https://github.com/beliveedits/saas-metrics-lab): Work out MRR, NRR, churn, quick ratio, LTV, CAC payback, runway and burn multiple, with every formula shown. Nothing is saved.
- [Creative Diversity Lab](https://github.com/beliveedits/creative-diversity-lab): Check how different your ad creatives really are before you spend.
- [Safe Zone Overlay](https://github.com/beliveedits/safe-zone-overlay): Draws the Reels, TikTok and Shorts safe-zone margins over any video preview.
- [Deskhand](https://github.com/beliveedits/deskhand): Give your laptop a command and it does it. Voice and text, no cloud, no AI model.
