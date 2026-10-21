# Ember Dash

An endless lava-runner for [start.ng](https://start.ng). The mountain is awake — run.

Your start.ng character flees a chasing wall of lava across crumbling obsidian
platforms: leap the gaps, slide under the basalt arches, dodge the flame vents
and grab every crystal. Crystals give you a small speed burst, the lava surges
now and then, and the further you get the faster it all goes.

You carry three **ember hearts**. Clipping an arch or a flame vent costs one,
and falling into a gap costs one too (you get slapped onto the next platform) —
only the lava itself, or an empty heart bar, ends the run. Rare Ember Hearts
float at jump height and restore what you lost.

When the lava does catch you, the **Phoenix** offers a way back: spend
crystals (15, then 40, 100, 250 — up to four times a run) to rise again with
full hearts and the lava blasted far behind. Score or survival, your call.

The run warms up slowly — the first few hundred metres are gentle, then gaps,
arches and vents grow denser and faster until around 2 km, when it is full pace.
Along the way you can unlock twelve achievements, like *Slipstream* (slide under
10 arches in one run), *Untouchable* (run 500 m without losing a heart),
*Phoenix* (rise from the lava) and *Marathon* (run 1000 m). Pause any time with
`P`, `Esc` or the ⏸ button.

## Play

Live at **https://ember-dash.start.ng** — or open `index.html` from any static
file server.

## Controls

| Action | Keys / touch |
| --- | --- |
| Jump (twice = double-jump) | `Space`, `↑`, `W`, or tap / JUMP button |
| Slide | hold `↓`, `S`, or the SLIDE button |
| Pause / resume | `P`, `Esc`, or the ⏸ / ▶ button |
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
