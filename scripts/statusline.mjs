#!/usr/bin/env node
// claudemeter — renders the Claude Code status line.
//
// Claude Code pipes a JSON payload on stdin and prints whatever this writes to
// stdout on the line directly above the mode indicator. Keep the output to a
// single short line: it is truncated, not wrapped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  THEMES,
  clampPct,
  createPalette,
  hue,
  isOff,
  isOn,
  meter,
  pace,
  paceColor,
  pill,
  resolveBarStyle,
  resolveIconSet,
  resolveTheme,
  sparkline,
  valueColor,
  WINDOW_SECONDS,
} from "./theme.mjs";

const STATE_DIR = join(homedir(), ".claude", "claudemeter");
const LAST_FILE = join(STATE_DIR, "last.json");
const LEDGER_FILE = join(STATE_DIR, "daily.json");
const HISTORY_FILE = join(STATE_DIR, "history.json");

const DEFAULT_SEGMENTS = "model,daily,weekly,dir,branch";

// One sample every few minutes is plenty to draw a legible trend, and it keeps
// the file small enough to rewrite on every status line refresh.
const HISTORY_INTERVAL_MS = 3 * 60 * 1000;
const HISTORY_MAX = 480;

const env = process.env;
const palette = createPalette(env);
const style = resolveStyle(env.CLAUDEMETER_STYLE);
const themeName = resolveTheme(env.CLAUDEMETER_THEME);
const theme = THEMES[themeName];
const barStyle = resolveBarStyle(env.CLAUDEMETER_BAR_STYLE);
const useBars = !isOff(env.CLAUDEMETER_BARS);
const iconSet = resolveIconSet(env.CLAUDEMETER_ICONS);
// `words` is the prose layout — "daily usage 78%, resets in 1h 54m" — and a
// glyph in the middle of a sentence reads as a typo.
const icons = style === "words" ? {} : iconSet.glyphs;
const resetMode = resolveResetMode(env.CLAUDEMETER_RESETS);
const showPace = !isOff(env.CLAUDEMETER_PACE);
const barWidth = clampInt(env.CLAUDEMETER_BAR_WIDTH, style === "pill" ? 8 : 6, 1, 30);
const separator = env.CLAUDEMETER_SEPARATOR ?? defaultSeparator();
const showEffort = !isOff(env.CLAUDEMETER_EFFORT);
// The theme preview renders the real status line once per theme, in-process, to
// guarantee what it shows is what you will get. It must not leave nine samples
// and a rewritten snapshot behind for doing so.
const dryRun = isOn(env.CLAUDEMETER_DRY);

// Labels differ by style only; the underlying number is identical.
// `daily` is Claude's 5-hour session window — the shortest bucket Claude
// reports, and the one that throttles you during a working day. Claude has no
// calendar-day bucket; `today` below is the closest true one.
const SEGMENTS = {
  daily: { words: "daily usage", compact: "5h", pill: "5h", chill: "Daily:" },
  weekly: { words: "weekly usage", compact: "wk", pill: "wk", chill: "Weekly:" },
  today: { words: "today", compact: "today", pill: "day", chill: "Today:" },
  ctx: { words: "context", compact: "ctx", pill: "ctx", chill: "Context:" },
  cost: { words: "cost", compact: "$", pill: "", chill: "" },
  model: {},
  dir: {},
  branch: {},
  lines: {},
  spark: {},
  pace: { words: "pace", compact: "pace", pill: "pace", chill: "Pace:" },
};
const ALIASES = { "5h": "daily", week: "weekly", session: "daily", trend: "spark" };

main();

async function main() {
  let payload;
  try {
    // `JSON.parse("null")` succeeds and hands back null, which then throws on
    // the first property read — so coerce before anything touches it.
    payload = JSON.parse(await readStdin()) ?? {};
  } catch {
    // No usable payload (manual run, malformed input) — print nothing rather
    // than parking an error message in the user's status line.
    process.exit(0);
  }
  writeJson(LAST_FILE, { at: Date.now(), payload });
  const ledger = updateLedger(payload.rate_limits?.seven_day);
  const history = updateHistory(payload);
  const line = render(payload, ledger, history);
  if (line) process.stdout.write(line + "\n");
}

function render(payload, ledger, history) {
  const names = (env.CLAUDEMETER_SEGMENTS ?? DEFAULT_SEGMENTS)
    .split(",")
    .map((s) => ALIASES[s.trim()] ?? s.trim())
    .filter((s) => s in SEGMENTS);

  const parts = [];
  for (const name of names) {
    const part = renderSegment(name, payload, ledger, history);
    if (part) parts.push(part);
  }
  return parts.join(palette.paint(separator, theme.rule));
}

function renderSegment(name, p, ledger, history) {
  switch (name) {
    case "daily":
      return renderLimit(name, p.rate_limits?.five_hour, WINDOW_SECONDS.five_hour);
    case "weekly":
      return renderLimit(name, p.rate_limits?.seven_day, WINDOW_SECONDS.seven_day);
    case "pace":
      return renderPace(p.rate_limits?.seven_day);
    case "today":
      return ledger ? capsule(name, [pct(ledger.accumulated)]) : null;
    case "ctx":
      return renderContext(name, p.context_window, p.exceeds_200k_tokens);
    case "cost":
      return renderCost(name, p.cost);
    case "model":
      return renderPlain("model", p.model?.display_name, showEffort ? effortTag(p.effort?.level) : "");
    case "dir":
      return renderPlain("dir", basename(p.workspace?.current_dir));
    case "branch":
      return renderPlain("branch", p.workspace?.git_worktree?.branch ?? p.workspace?.repo?.branch);
    case "lines":
      return renderLines(p.cost);
    case "spark":
      return renderSpark(history);
    default:
      return null;
  }
}

// Rate limits are only present on subscription plans; API-key users get nothing
// here, which is why the segment returns null rather than a zeroed-out meter.
function renderLimit(name, limit, windowSeconds) {
  if (!limit || typeof limit.used_percentage !== "number") return null;
  const value = clampPct(limit.used_percentage);
  const budget = showPace ? pace(limit, windowSeconds) : null;
  const pieces = [];
  if (useBars) {
    pieces.push(
      meter(value, {
        width: barWidth,
        palette,
        theme,
        style: barStyle,
        pace: budget?.target ?? null,
      }),
    );
  }
  pieces.push(pct(value));
  const reset = resetLabel(limit.resets_at);
  // "…34%, resets in 4d 2h" is a clause and wants its comma; "…34% until 4:49pm"
  // is a modifier and reads wrong with one. The token styles are a list either
  // way, so they just take the space.
  if (reset) {
    const comma = style === "words" && resetMode !== "clock";
    pieces.push(palette.paint(comma ? `, ${reset}` : reset, theme.muted));
  }
  return capsule(name, pieces, { joinLast: Boolean(reset) && style === "words" });
}

// How fast the weekly allowance is going relative to what the window can carry.
// 1.0× is exactly on budget; 2.0× means the cap arrives at half-time. The weekly
// window rather than the 5-hour one, because the 5-hour window is bursty by
// design — spending it fast is what it is for.
function renderPace(weekly) {
  const budget = pace(weekly, WINDOW_SECONDS.seven_day);
  if (!budget) return null;
  const ratio = budget.ratio;
  const text = `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}×`;
  return capsule("pace", [palette.paint(text, paceColor(theme, ratio))]);
}

function renderContext(name, ctx, exceeds200k) {
  if (!ctx || typeof ctx.used_percentage !== "number") return null;
  const value = clampPct(ctx.used_percentage);
  const pieces = [];
  if (useBars && style === "pill") {
    pieces.push(meter(value, { width: Math.max(3, barWidth - 3), palette, theme, style: barStyle }));
  }
  // The 200k mark is where long-context pricing starts, so it is worth a mark
  // of its own rather than being folded into the percentage. The shapes and
  // ascii sets mark it with a superscript that wants to sit tight against the
  // number; an emoji is a glyph in its own right and needs the space.
  const over = exceeds200k && icons.over ? (iconSet.painted ? "" : " ") + glyph("over") : "";
  pieces.push(pct(value) + over);
  return capsule(name, pieces);
}

function renderCost(name, cost) {
  const usd = cost?.total_cost_usd;
  if (typeof usd !== "number" || usd <= 0) return null;
  const amount = `$${usd < 10 ? usd.toFixed(2) : Math.round(usd)}`;
  // The compact label for cost is the "$" the amount already carries.
  if (style === "compact") return palette.paint(amount, theme.text);
  return capsule(name, [palette.paint(amount, theme.text)]);
}

function renderLines(cost) {
  const added = cost?.total_lines_added ?? 0;
  const removed = cost?.total_lines_removed ?? 0;
  if (!added && !removed) return null;
  const counts =
    palette.paint(`+${added}`, theme.ramp[2]) +
    " " +
    palette.paint(`-${removed}`, theme.ramp[theme.ramp.length - 1]);
  if (style === "pill") return pill(` ${counts} `, { palette, theme });
  if (style === "words" || style === "compact") return counts;
  const icon = glyph("lines");
  return `${icon ? icon + " " : ""}${counts}`;
}

const EFFORT_COLORS = {
  medium: ["#4ade80"],
  high: ["#a78bfa"],
  xhigh: ["#e879f9"],
  max: ["#ef4444", "#cb679f", "#a78bfa"],
};

function effortTag(level) {
  if (!level) return "";
  const colors = EFFORT_COLORS[level] ?? [hue(theme, "model")];
  const text = colors.length > 1
    ? [...level].map((c, i) => palette.paint(c, colors[Math.min(i, colors.length - 1)])).join("")
    : palette.paint(level, colors[0]);
  return palette.paint(" · ", theme.muted) + text;
}

function renderPlain(name, value, tail = "") {
  if (!value) return null;
  const body = palette.paint(String(value), hue(theme, name)) + tail;
  if (style === "words" || style === "compact") return body;
  const icon = glyph(name);
  const run = `${icon ? icon + " " : ""}${body}`;
  return style === "pill" ? pill(` ${run} `, { palette, theme }) : run;
}

// The trend of the weekly window over the samples this machine has collected —
// the one thing a single percentage cannot tell you, which is whether the number
// is climbing fast or has been flat all afternoon.
function renderSpark(history) {
  const points = (history?.samples ?? []).slice(-16).map((s) => s.wk);
  if (points.length < 3) return null;
  const floor = Math.min(...points);
  // Rebased on the window's own low point: absolute percentages barely move over
  // an afternoon, and a sparkline of a flat line is worth nothing.
  const rebased = points.map((v) => v - floor);
  const spark = sparkline(rebased, { palette, theme });
  if (style === "pill") return pill(` ${spark} `, { palette, theme });
  if (style === "words" || style === "compact") return spark;
  const icon = glyph("spark");
  return `${icon ? icon + " " : ""}${spark}`;
}

// A capsule in `pill` style, `emoji Label: value` in `chill`, a bare labelled
// run in the text styles.
function capsule(name, pieces, { joinLast = false } = {}) {
  const label = SEGMENTS[name]?.[style] ?? "";
  if (style === "chill") {
    return [glyph(name), label && palette.paint(label, theme.muted), ...pieces]
      .filter(Boolean)
      .join(" ");
  }
  if (style !== "pill") {
    const body = joinLast
      ? pieces.slice(0, -1).join(" ") + pieces[pieces.length - 1]
      : pieces.join(" ");
    return label ? `${palette.paint(label, theme.muted)} ${body}` : body;
  }
  const head = [glyph(name), label && palette.paint(label, theme.muted)]
    .filter(Boolean)
    .join(" ");
  const body = [head, ...pieces].filter(Boolean).join(" ");
  return pill(` ${body} `, { palette, theme });
}

// An icon set may have no glyph for a segment — `ascii` mode deliberately omits
// the labelled ones. Painting the empty string still emits escape codes, which
// are invisible but truthy, so the caller's `filter(Boolean)` would keep them
// and leave a doubled space where the icon should be.
function glyph(name) {
  const icon = icons[name];
  if (!icon) return "";
  // Emoji render as their own colour glyph; a foreground escape around one is
  // ignored by most terminals and would only pad the string with dead bytes.
  return iconSet.painted ? palette.paint(icon, theme.muted) : icon;
}

function pct(value) {
  return palette.paint(`${Math.round(clampPct(value))}%`, valueColor(theme, value));
}

function defaultSeparator() {
  if (style === "words") return " and ";
  if (style === "compact") return " · ";
  // Pills already read as separate objects, so they only need breathing room.
  if (style === "pill") return " ";
  return " │ ";
}

function resolveStyle(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "compact" || value === "words" || value === "chill") return value;
  if (value === "pill") {
    // A capsule is drawn entirely in colour — its edges are half-blocks tinted
    // to match the fill. Strip the colour and no capsule is left, just runs of
    // text jammed together, so an uncoloured terminal gets a token style.
    return palette.enabled ? "pill" : "chill";
  }
  return "chill";
}

// A genuine calendar-day figure, since Claude reports no daily bucket: how many
// points of the weekly allowance were consumed since local midnight. Built by
// diffing successive samples of the weekly percentage, so it only counts usage
// that happened while some Claude Code session had this status line running.
function updateLedger(weekly) {
  if (!weekly || typeof weekly.used_percentage !== "number") return null;
  const current = clampPct(weekly.used_percentage);
  const resetsAt = typeof weekly.resets_at === "number" ? weekly.resets_at : null;
  const today = localDay();

  const stored = readJson(LEDGER_FILE);
  // `lastPct` is what ledgers written before the high-water fix below carry.
  const peak =
    typeof stored?.peakPct === "number"
      ? stored.peakPct
      : typeof stored?.lastPct === "number"
        ? stored.lastPct
        : null;

  if (!stored || stored.day !== today || peak === null) {
    const fresh = { day: today, accumulated: 0, peakPct: current, resetsAt };
    writeJson(LEDGER_FILE, fresh);
    return fresh;
  }

  // A rollover is a *new window*, not merely a smaller number. Claude's reported
  // percentage also drifts down on its own — rounding, backend recalculation —
  // and reading any decrease as a reset banks the whole current figure as if it
  // had all been spent since midnight, which saturates the tally at 100% within
  // a day. `resets_at` moving forward is the unambiguous signal.
  //
  // A ledger written before this field existed, or a payload without
  // `resets_at`, leaves `rolled` false: a real rollover then under-counts by one
  // window instead of over-counting, which is the safer direction to be wrong.
  const rolled =
    resetsAt !== null && typeof stored.resetsAt === "number" && resetsAt > stored.resetsAt;

  // Measured against the window's high-water mark, not the previous sample.
  // `used_percentage` arrives rounded to whole points, so a window sitting
  // between 4 and 5 reports 4, 5, 4, 5 as it jitters across the boundary. Every
  // rise off the previous sample would be banked and every fall floored at
  // zero, so the tally ratchets up a point per oscillation and reads far above
  // what was actually spent. Within a window usage only ever grows, so the peak
  // is the honest baseline: the same point cannot be charged twice.
  const state = {
    day: today,
    accumulated: clampPct(stored.accumulated + (rolled ? current : Math.max(0, current - peak))),
    peakPct: rolled ? current : Math.max(peak, current),
    resetsAt: resetsAt ?? stored.resetsAt,
  };
  writeJson(LEDGER_FILE, state);
  return state;
}

// A ring buffer of usage samples, so both the status line sparkline and the
// report's trend chart can show shape over time rather than one instant.
function updateHistory(payload) {
  const weekly = payload.rate_limits?.seven_day;
  const fiveHour = payload.rate_limits?.five_hour;
  if (typeof weekly?.used_percentage !== "number") return readJson(HISTORY_FILE);

  const state = readJson(HISTORY_FILE) ?? { samples: [] };
  if (!Array.isArray(state.samples)) state.samples = [];
  const now = Date.now();
  const last = state.samples[state.samples.length - 1];
  const sample = {
    t: now,
    wk: round2(clampPct(weekly.used_percentage)),
    fh: typeof fiveHour?.used_percentage === "number" ? round2(clampPct(fiveHour.used_percentage)) : null,
  };

  if (last && now - last.t < HISTORY_INTERVAL_MS) {
    // Within the sampling interval, overwrite rather than append: the status
    // line can refresh several times a second and each of those is the same
    // moment as far as a trend is concerned.
    state.samples[state.samples.length - 1] = sample;
  } else {
    state.samples.push(sample);
  }
  if (state.samples.length > HISTORY_MAX) {
    state.samples = state.samples.slice(-HISTORY_MAX);
  }
  writeJson(HISTORY_FILE, state);
  return state;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function localDay() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Reset times are shown by default: that a window sits at 78% matters far less
// than whether it clears in ten minutes or three hours.
function resolveResetMode(raw) {
  if (isOff(raw)) return "off";
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "clock" || value === "at" || value === "time") return "clock";
  return "relative";
}

function resetLabel(epochSeconds) {
  if (resetMode === "off") return null;
  if (resetMode === "clock") {
    const clock = clockTime(epochSeconds);
    if (!clock) return null;
    if (style === "pill") return `${icons.at ?? ""} ${clock}`.trim();
    if (style === "chill") return clock;
    return `until ${clock}`;
  }
  const rest = relativeTime(epochSeconds);
  if (!rest) return null;
  // The pill has the icon and the meter carrying the context already, so the
  // countdown can drop to a bare duration behind a clock glyph.
  if (style === "pill") return `${icons.reset ?? ""} ${rest}`.trim();
  // `chill` is the widest layout — five segments of emoji and labels — so its
  // countdown is squeezed to `1h54m`: the same reading in four fewer columns.
  if (style === "chill") return rest.replace(/ /g, "");
  return `resets in ${rest}`;
}

// Absolute wall-clock form, for reading "until 6:10pm" instead of doing the
// arithmetic. A reset that lands on a later date carries its weekday, since a
// bare time would otherwise read as only hours away.
function clockTime(epochSeconds) {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const now = new Date();
  if (epochSeconds <= now.getTime() / 1000) return null;
  const date = new Date(epochSeconds * 1000);
  const time = date
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s*([AP]M)/i, (_, meridiem) => meridiem.toLowerCase());
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function relativeTime(epochSeconds) {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const seconds = Math.round(epochSeconds - Date.now() / 1000);
  if (seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function readJson(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  if (dryRun) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  } catch {
    // A read-only or full home directory must not take the status line down.
  }
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function basename(path) {
  if (!path) return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
