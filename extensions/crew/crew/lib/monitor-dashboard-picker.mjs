// Shows a SelectList letting the user choose which active Crew's dashboard
// to open, only when more than one roster is currently active (see
// monitor-active-rosters.mjs). Isolated in its own file for the same reason
// as monitor-dashboard-chrome.mjs: @earendil-works/pi-tui's SelectList and
// @earendil-works/pi-coding-agent's DynamicBorder are only resolvable inside
// an actual running `pi` process, never from plain `node --test` in this
// repo. Follows tui.md's documented SelectList + DynamicBorder framing
// pattern exactly (see docs/tui.md "Pattern 1: Selection Dialog").
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";

// items: SelectItem[] (see monitor-active-rosters.mjs's crewPickerItems).
// Resolves to the chosen roster path, or undefined if the user cancels.
export function pickActiveCrew(sessionCtx, items) {
  return sessionCtx.ui.custom(
    (tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Choose a Crew")), 1, 0));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(undefined);
      container.addChild(selectList);

      container.addChild(
        new Text(theme.fg("dim", "\u2191\u2193 navigate \u00b7 enter select \u00b7 esc cancel"), 1, 0),
      );
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

      return {
        render: (width) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data) => {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    { overlay: true },
  );
}
