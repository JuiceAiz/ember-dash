# Ember Dash

An endless lava-runner for [start.ng](https://start.ng). The mountain is awake — run.

Your start.ng character flees a chasing wall of lava across crumbling obsidian
platforms: leap the gaps, slide under the basalt arches, dodge the flame vents
and grab every crystal. Crystals give you a small speed burst, the lava surges
now and then, and the further you get the faster it all goes.

The run warms up slowly — the first few hundred metres are gentle, then gaps,
arches and vents grow denser and faster until around 2 km, when it is full pace.
Along the way you can unlock nine achievements, like *Slipstream* (slide under
10 arches in one run), *Crystal Cache* (30 crystals in one run) and *Marathon*
(run 1000 m).

## Play

Live at **https://ember-dash.start.ng** — or open `index.html` from any static
file server.

## Controls

| Action | Keys / touch |
| --- | --- |
| Jump (twice = double-jump) | `Space`, `↑`, `W`, or tap / JUMP button |
| Slide | hold `↓`, `S`, or the SLIDE button |
| Pause | `P` or `Esc` |
| Mute | `M` or the speaker button |

## How it works

- Plain HTML/CSS/JavaScript + canvas. No build step, no dependencies.
- start.ng integration via the connect page (`postMessage`): who the player is,
  their start.ng character (drawn in-game from `style`), saving runs, and the
  shared leaderboard.
- `startng.json` declares the leaderboard columns: **Metres run** and
  **Crystals** (both ranked highest-first; distance breaks ties).
- Personal best is stored in `localStorage`; shared bests go to start.ng.
- `cover.png` is the 16:10 start.ng card art.
