import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateModelSelection } from "../../extensions/crew/crew/lib/model-selection.mjs";

const catalog = [
  { id: "claude-sonnet-4-5", provider: "anthropic" },
  { id: "gpt-5", provider: "openai" },
];
const ctxWithCatalog = { modelRegistry: { getAll: () => catalog } };

test("validateModelSelection allows an omitted model (undefined or blank)", () => {
  assert.doesNotThrow(() => validateModelSelection([undefined, "", "   "], ctxWithCatalog));
  // No catalog wired in at all: validation is skipped, not failed.
  assert.doesNotThrow(() => validateModelSelection([undefined], undefined));
});

test("validateModelSelection accepts a valid explicit model, bare or canonical", () => {
  assert.doesNotThrow(() => validateModelSelection(["gpt-5"], ctxWithCatalog));
  assert.doesNotThrow(() => validateModelSelection(["anthropic/claude-sonnet-4-5"], ctxWithCatalog));
});

test("validateModelSelection rejects an explicit model absent from the SDK-visible catalog", () => {
  assert.throws(
    () => validateModelSelection(["not-a-real-model"], ctxWithCatalog),
    /not found in Pi's available model catalog/,
  );
});

test("validateModelSelection rejects sentinel/default values before touching the catalog", () => {
  for (const sentinel of ["inherit", "Default", "  ", ""]) {
    if (sentinel.trim() === "") continue; // blank is "omitted", covered above
    assert.throws(() => validateModelSelection([sentinel], ctxWithCatalog), /Omit model to use Pi's current default/);
  }
});

test("validateModelSelection skips catalog validation when no registry is wired in (e.g. in tests)", () => {
  assert.doesNotThrow(() => validateModelSelection(["anything-at-all"], { modelRegistry: undefined }));
  assert.doesNotThrow(() => validateModelSelection(["anything-at-all"], {}));
});
