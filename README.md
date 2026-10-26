# claudemeter

A Claude Code plugin that puts your plan usage on the status line:

```
✨ Opus 5 │ ⚡ Daily: ████▋░ 78% 1h54m │ 📅 Weekly: ██░░░░ 34% 4d2h │ 📁 my-project │ 🌿 feature/auth
⏵⏵ auto mode on
```

The model you are on, both usage windows with the time until each resets, the
project you are in and the branch you are on — in one row.

Each meter is a true gradient: every cell is coloured at its own point along the
ramp, so the bar shades from calm to alarming as it fills, and the partial blocks
let six characters resolve to about a percent. Segments that carry no severity —
the model, the directory, the branch — take an identity hue from the theme
instead, which is where the colour comes from.

### The tick in the bar

```
⚡ Daily: ███▎│░ 63%      under budget — fill stops short of the tick
⚡ Daily: ████│▊ 78%      over budget  — fill runs past it
```

That notch is the **pace tick**: the percentage an even burn would have reached
by now. A window that resets at a known time has a known start, so the fraction
of it already elapsed is knowable — and that fraction *is* the budget. Two days
into the week you are entitled to 29%; the tick is drawn there.

So the bar answers a question a percentage cannot. 78% used means nothing on its
own: it is fine four days into the week and a problem four hours in. Fill short
of the tick means you are spending slower than the window can carry. Fill past it
means the cap arrives before the reset does.

Set `CLAUDEMETER_PACE=0` to turn it off.

Six themes, seven meter styles, four layouts, four icon sets.
`/claudemeter:themes` renders every one of them against a sample reading so you
can see it before you set it.

The numbers come straight from Claude's own rate-limit payload — the same source
`/usage` reads — so they match what actually throttles you. No dependencies, no
network calls, nothing to build.

## Requirements

| | |
| --- | --- |
| Claude Code | v2.0 or later (any version with `/plugin`) |
| `node` or `bun` | on your `PATH` — the renderer is a small ES module |
| Auth | a **Claude subscription** (Pro, Max, Team) — API keys report no plan limits |

## Install

```
/plugin marketplace add arifbsmrstu/claudemeter
/plugin install claudemeter@ariful-plugins
```

Claude Code asks for a scope — pick **User** to get it in every project. The same
commands work from a shell as `claude plugin marketplace add …`. To pin a release
instead of tracking `main`, append `@v0.5.0` to the marketplace source.

Then restart Claude Code. The line appears on the row **directly above** the mode
indicator.

### It writes to your settings

Worth knowing before you install: on session start the plugin adds a `statusLine`
entry to `~/.claude/settings.json`.

It has to. A plugin cannot ship a status line of its own — Claude Code's plugin
`settings` block is allowlisted to `agent` and `subagentStatusLine`, so
`statusLine` cannot live in `plugin.json`. Editing user settings is the only way
for a plugin to occupy that row.

The edit is deliberate and reversible:

- It **never overwrites a status line you already configured** — it backs off
  silently. Run `/claudemeter:enable --force` to hand the row over.
- `--force` saves what it replaces to `~/.claude/claudemeter/previous-statusline.json`
  and `~/.claude/settings.json.claudemeter.bak`.
- `/claudemeter:disable` restores it.
- `CLAUDEMETER_NO_AUTO=1` stops the automatic wiring entirely, leaving
  `/claudemeter:enable` as the only way it happens.

## Commands

| Command | What it does |
| --- | --- |
| `/claudemeter:usage` | Full dashboard — both windows with reset times and pace ticks, today's tally, weekly trend, the budget chart, context window, session cost |
| `/claudemeter:themes` | Preview every theme, icon set, meter style, layout and segment set against a sample reading |
| `/claudemeter:enable` | Wire the status line in. `--force` replaces an existing one. Safe to re-run |
| `/claudemeter:disable` | Remove it and restore whatever was there before |

## Configuration

Set these in your shell environment (`.bashrc`, `.zshrc`, …) — the status line
command inherits them.

Run `/claudemeter:themes` to see every one of these rendered before you commit
to it.

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDEMETER_THEME` | `aurora` | `aurora`, `neon`, `sunset`, `matrix`, `ice`, `mono` |
| `CLAUDEMETER_SEGMENTS` | `model,daily,weekly,dir,branch` | Comma-separated, in display order. Also available: `today`, `ctx`, `cost`, `pace`, `spark`, `lines` |
| `CLAUDEMETER_STYLE` | `chill` | `chill` → `⚡ Daily: ████▋░ 78% 1h54m`; `pill` → colour capsules; `compact` → `5h ████▋░ 78% resets in 1h 54m`; `words` → `daily usage ████▋░ 78%, resets in 1h 54m` |
| `CLAUDEMETER_ICONS` | `emoji` | `emoji` → ✨⚡📅📁🌿; `shapes` → ✦◔▦▸⌥ for fonts with no emoji coverage; `ascii` → `* > @`; `none` |
| `CLAUDEMETER_BAR_STYLE` | `smooth` | Meter glyphs: `smooth` (partial blocks), `blocks`, `shade`, `dots`, `line`, `bars`, `ascii` |
| `CLAUDEMETER_SEPARATOR` | ` │ ` (` ` in pill, ` and ` in words, ` · ` in compact) | Text between segments |
| `CLAUDEMETER_RESETS` | `relative` | `relative` → `1h54m`; `clock` → `7:31pm` (gaining a weekday when it lands on a later day); `0` → omit it |
| `CLAUDEMETER_BARS` | `1` | `0` drops the meter before each percentage |
| `CLAUDEMETER_PACE` | `1` | `0` removes the pace tick from the meters, the `pace` segment and the budget chart |
| `CLAUDEMETER_BAR_WIDTH` | `6` (`8` in pill) | Characters per meter (1–30) |
| `CLAUDEMETER_EFFORT` | `1` | `0` hides the effort level after the model |
| `CLAUDEMETER_COLOR` | `1` | `0` disables colour; `NO_COLOR` is honoured too |
| `CLAUDEMETER_COLOR_DEPTH` | auto | Force `24`, `8`, `4` or `0` if the terminal is detected wrong |
| `CLAUDEMETER_REPORT_WIDTH` | `72` | Columns for the `/claudemeter:usage` dashboard (64–140) |
| `CLAUDEMETER_NO_AUTO` | unset | `1` stops the SessionStart hook from touching your settings |

Colour depth is detected from `COLORTERM` and `TERM`: truecolour terminals get
the full gradient, a 256-colour terminal gets the nearest cube colours, and a
16-colour one still gets the red/amber/green reading.

The status line is truncated rather than wrapped, and the default line is 101
columns — five segments of emoji, labels and countdowns is not cheap. If your
terminal is narrower, drop segments or switch off the countdowns;
`/claudemeter:themes` prints the width of every option next to it.

```bash
# a different palette
export CLAUDEMETER_THEME=neon

# just the two windows — 55 columns
export CLAUDEMETER_SEGMENTS=daily,weekly

# no emoji: the terminal font has no coverage for them
export CLAUDEMETER_ICONS=shapes

# minimal — percentages only, no meters, glyphs or countdowns
export CLAUDEMETER_STYLE=compact
export CLAUDEMETER_ICONS=none
export CLAUDEMETER_BARS=0
export CLAUDEMETER_RESETS=0

# API key auth — no plan limits exist, so show what does
export CLAUDEMETER_SEGMENTS=model,ctx,cost,dir,branch
```

## What the numbers mean

Claude tracks usage in two windows and reports exactly those two — both exact,
both straight from Claude:

| Segment | Window |
| --- | --- |
| `daily` | the **5-hour session** window |
| `weekly` | the **7-day** window |

`Daily:` in the status line is that 5-hour window, not a calendar day.

There is no calendar-day bucket in Claude's rate limits; `/usage` shows the same
two (plus a Sonnet-only weekly bar on Max and Team plans). So `daily` is the
5-hour window — the bucket that actually throttles you during a working day. It
resets every 5 hours, not at midnight.

`today` is the one figure the plugin computes itself: weekly-allowance points
spent since local midnight, accumulated by tracking the high-water mark of the
weekly percentage. It only counts usage seen while a session had the status line
running, so it undercounts if you work with Claude Code closed, and it starts
from zero on the first day.

The same samples are kept as a small ring buffer in
`~/.claude/claudemeter/history.json`, which is what the `spark` segment and the
dashboard's **weekly trend** draw. They are read only within the current window:
a reset shows up as the weekly figure dropping, and the trend restarts from there
rather than reading the drop as usage being handed back.

`pace` is the same idea as the tick, as a number: `1.0×` is exactly on budget,
`2.0×` means the cap arrives at half-time. It tracks the weekly window, not the
5-hour one — the 5-hour window is bursty by design, and spending it fast is what
it is for.

## The budget chart

`/claudemeter:usage` draws where the week is heading rather than asserting it:

```
WEEKLY BUDGET ────────────────────────────────────────────────────────
  100 ┤                           ▄▄▄▀▀                        ▄▄▄▄▄▄▀▀▀
      │                     ▄▄▄▀▀▀                 ▄▄▄▄▄▄▀▀▀▀▀▀
      │                ▄▄▄▀▀           ▄▄▄▄▄▄▀▀▀▀▀▀
   50 │           ▄▄█▀▀     ▄▄▄▄▄▄▀▀▀▀▀
      │         ▄▄▄▄▄▄▀▀▀▀▀▀
      │▄▄▄▀▀▀▀▀▀
    0 └─────────────┴───────────────────────────────────────────────────
                  now                                 resets Sun 8:29am

  2.05× even burn  ·  caps Wed 5:39pm, 3d 15h early
```

Three overlaid series: the dim **even-burn diagonal** a perfect spender would
follow to the top-right corner, the **samples** actually collected, and a
**projection** forward from the last one at the measured burn rate. Whether that
ray meets the top of the chart before it reaches the right edge is the answer to
"will I run out this week" — and unlike a percentage, it shows you by how much.

The projection is a straight line through two endpoints. Usage is bursty, so read
it as "if this rate holds", not as a forecast. The chart tells its three series
apart by colour alone, so with colour off the verdict line is printed on its own
rather than over a staircase that cannot be read.

## Troubleshooting

**Nothing appears.**
Run `/claudemeter:enable`. If it says `already enabled`, restart Claude Code — a
`statusLine` added mid-session isn't picked up until the next launch. If it says
it left an existing status line alone, use `--force`.

**The line is there but empty.**
Almost always API key auth. Claude Code doesn't report `rate_limits` at all on an
API key, so there is nothing to show — switch to the `ctx,cost` segments above.

**The emoji show as boxes, or as flat monochrome glyphs.**
Your terminal font has no colour emoji coverage. `CLAUDEMETER_ICONS=shapes` uses
geometric characters instead, and `ascii` falls back further still. If the meters
themselves are the problem, add `CLAUDEMETER_BAR_STYLE=ascii`.

**Everything after the first emoji is shifted by a column.**
The terminal is rendering emoji single-width. Set `CLAUDEMETER_ICONS=shapes`,
whose glyphs are one column by definition.

**The colours look wrong or flat.**
The terminal is being detected at the wrong depth. Check `echo $COLORTERM` — it
should say `truecolor` — and override with `CLAUDEMETER_COLOR_DEPTH=24`.

**`claudemeter: node or bun not found on PATH`.**
Claude Code spawns the status line through a non-login shell, so a `node` that
only exists after your `.bash_profile` runs (typical with `nvm`) won't be found.
The plugin probes the usual locations including `~/.nvm/versions/node/*/bin/node`;
if yours is elsewhere, symlink it somewhere on the default `PATH`.

**The line came back after `/claudemeter:disable`.**
By design — the `SessionStart` hook re-wires it each session. To make the removal
stick, disable the plugin in `/plugin` or set `CLAUDEMETER_NO_AUTO=1`.

**It stopped working after a plugin update.**
The install path is version-scoped, so the `statusLine` command can point at a
directory that no longer exists. Run `/claudemeter:enable` — it detects the stale
path and rewrites it.

**Numbers look stale.**
`/claudemeter:usage` reads the snapshot at `~/.claude/claudemeter/last.json`,
rewritten every time the status line renders. With no session open, the snapshot
is as old as your last one.

## Uninstall

```
/claudemeter:disable
/plugin uninstall claudemeter@ariful-plugins
```

**Run `/claudemeter:disable` first.** It is the only thing that takes the
`statusLine` entry back out of `~/.claude/settings.json`. Uninstalling without it
leaves the entry behind pointing at a directory that no longer exists — the line
goes blank and the plugin is no longer around to repair it. To recover, delete
the `statusLine` block from `~/.claude/settings.json` by hand.

To remove the plugin's own state as well:

```bash
rm -rf ~/.claude/claudemeter
rm -f ~/.claude/settings.json.claudemeter.bak
```

## Development

```bash
git clone https://github.com/arifbsmrstu/claudemeter.git
claude --plugin-dir ./claudemeter
```

`--plugin-dir` takes precedence over an installed copy of the same plugin, so you
can test changes without uninstalling. `claude plugin validate ./` checks the
manifests.

## License

MIT — see [LICENSE](LICENSE).
