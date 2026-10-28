// Rendering + keyboard wiring for the expandable Crew dashboard. Row data
// comes entirely from monitor-dashboard.mjs (itself sourced from
// monitor-snapshot.mjs and selected_crew_<uuid>.json / the dependency
// ledger); this file only turns those rows into a table and handles tab
// switching. No pi-tui import: `render(width): string[]` is the whole
// Component contract this needs, so the formatting logic stays testable
// without the real TUI package installed.
const TABS = Object.freeze(["automata", "plan"]);

// Used only when a caller (tests, mainly) renders a table without a real
// overlay width. The real render path always supplies the overlay's actual
// column count via render(width).
const DEFAULT_WIDTH = 120;

const SEP = " \u2502 ";

const truncate = (value, width) => {
  const text = String(value);
  if (text.length <= width) return text.padEnd(width);
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}\u2026`;
};

// Builds a header + divider + one line per row, sizing every column except
// `flexIndex` to the widest of its header/cell content, then giving the
// flex column whatever width is left in `width` (clamped to a sane
// minimum/maximum) instead of a fixed guessed width. This is the one
// layout primitive both tabs share.
function renderTable(columns, rows, width, flexIndex, maxFlexWidth = 80) {
  const widths = columns.map((column, index) => {
    if (index === flexIndex) return 0;
    return Math.max(column.label.length, ...rows.map((row) => String(column.get(row)).length));
  });
  const fixedTotal = widths.reduce((sum, w) => sum + w, 0) + SEP.length * (columns.length - 1);
  const flexNatural = Math.max(
    columns[flexIndex].label.length,
    ...rows.map((row) => String(columns[flexIndex].get(row)).length),
    3,
  );
  widths[flexIndex] = Math.min(maxFlexWidth, Math.max(3, Math.min(flexNatural, width - fixedTotal)));

  const line = (get) => columns.map((column, index) => truncate(get(column), widths[index])).join(SEP);
  const header = line((column) => column.label);
  const divider = widths.map((w) => "\u2500".repeat(Math.max(1, w))).join("\u2500\u253c\u2500");
  const dataRows = rows.map((row) => line((column) => column.get(row)));
  return [header, divider, ...dataRows];
}

const AUTOMATA_COLUMNS = [
  { label: "NAME", get: (row) => row.name },
  { label: "BUCKET", get: (row) => row.bucket },
  { label: "TURNS", get: (row) => row.turns },
  { label: "TOOLS", get: (row) => row.toolCalls },
  { label: "ERRS", get: (row) => row.toolErrors },
  { label: "IN", get: (row) => row.providerTraffic?.uncachedInput ?? 0 },
  { label: "OUT", get: (row) => row.providerTraffic?.generatedOutput ?? 0 },
  {
    label: "CACHE R/W",
    get: (row) => `${row.providerTraffic?.cacheRead ?? 0}/${row.providerTraffic?.cacheWrite ?? 0}`,
  },
  { label: "CTX", get: (row) => row.sessionContext },
  { label: "COMPACT", get: (row) => row.compactions },
];

// formatAutomataLines is pure and independently testable: a header, a
// divider, and one aligned line per automaton detail row from
// monitor-dashboard's buildAutomataTab. NAME is the flex column -- names
// vary the most, everything else is a bounded metric.
export function formatAutomataLines(rows, width = DEFAULT_WIDTH) {
  if (!rows.length) return ["(no automata on the roster yet)"];
  return renderTable(AUTOMATA_COLUMNS, rows, width, 0, 40);
}

const PLAN_COLUMNS = [
  { label: "AUTOMATON", get: (row) => row.assignedAutomaton },
  { label: "STATUS", get: (row) => row.status },
  { label: "DEPENDS-ON", get: (row) => (row.dependsOn.length ? row.dependsOn.join(", ") : "-") },
  { label: "TASK", get: (row) => row.task },
];

// formatPlanLines is pure and independently testable: a header, a divider,
// and one aligned line per Crew member's static task/dependsOn plan entry
// plus whatever live status the dependency ledger currently reports for
// it. TASK is the flex column -- it holds the longest, most variable text.
export function formatPlanLines(rows, width = DEFAULT_WIDTH) {
  if (!rows.length) return ["(no plan recorded for this Crew yet)"];
  return renderTable(PLAN_COLUMNS, rows, width, 3);
}

function linesForTab(tab, data, width) {
  return tab === "plan" ? formatPlanLines(data.planRows, width) : formatAutomataLines(data.automataRows, width);
}

// createCrewDashboardComponent builds a pi-tui Component: `getData()` is
// called fresh on every render so the dashboard reflects the live snapshot,
// not a stale one captured at open time. `tab`/`switchTab` are exposed
// directly so tests can drive tab state without a real render pass.
export function createCrewDashboardComponent({ getData, onClose }) {
  let tab = TABS[0];
  return {
    get tab() {
      return tab;
    },
    switchTab() {
      tab = tab === "automata" ? "plan" : "automata";
    },
    render(width) {
      const data = getData();
      const tabBar = TABS.map((name) => (name === tab ? `[${name}]` : ` ${name} `)).join(" ");
      // One blank line after the tab bar and one before the closing border
      // give the panel breathing room instead of table rows butting
      // directly against the border chrome (monitor-dashboard-chrome.mjs
      // wraps this content with a top/bottom DynamicBorder rule and adds no
      // vertical padding of its own). Content-driven height is intentional
      // (pi-tui's overlay maxHeight is a ceiling, not a forced fill), so
      // this only adds two lines rather than trying to fill remaining space.
      const lines = [
        `Crew dashboard \u2014 ${tabBar}  (tab: switch, esc: close)`,
        "",
        ...linesForTab(tab, data, Math.max(0, width)),
        "",
      ];
      return lines.map((line) => line.slice(0, Math.max(0, width)));
    },
    handleInput(data) {
      if (data === "\t") {
        this.switchTab();
        return;
      }
      if (data === "\x1b" || data === "escape" || data === "q") onClose?.();
    },
    invalidate() {},
  };
}
