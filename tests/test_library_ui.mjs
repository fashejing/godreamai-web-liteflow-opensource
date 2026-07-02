import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLibraryCardMode,
  getLibraryCardMode,
  resetLibraryCardMode,
} from "../web_lite3/static/js/library_card_modes.js";

function createClassList() {
  const values = new Set();
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    toggle: (token, force) => {
      if (force === undefined) {
        if (values.has(token)) {
          values.delete(token);
          return false;
        }
        values.add(token);
        return true;
      }
      if (force) {
        values.add(token);
        return true;
      }
      values.delete(token);
      return false;
    },
    contains: (token) => values.has(token),
  };
}

function createRefs() {
  return {
    nameReadonly: { hidden: false },
    nameInput: { hidden: false },
    actions: { hidden: false },
  };
}

test("editable library items keep input and delete actions visible", () => {
  const card = { classList: createClassList() };
  const refs = createRefs();

  assert.equal(getLibraryCardMode({ origin: "workspace" }), "editable");
  applyLibraryCardMode(card, refs, "editable");

  assert.equal(card.classList.contains("is-editable"), true);
  assert.equal(card.classList.contains("is-readonly-mirror"), false);
  assert.equal(refs.nameInput.hidden, false);
  assert.equal(refs.actions.hidden, false);
  assert.equal(refs.nameReadonly.hidden, true);
});

test("library_source items stay readonly and hide destructive actions", () => {
  const card = { classList: createClassList() };
  const refs = createRefs();

  assert.equal(getLibraryCardMode({ origin: "library_source" }), "readonly-mirror");
  applyLibraryCardMode(card, refs, "readonly-mirror");

  assert.equal(card.classList.contains("is-editable"), false);
  assert.equal(card.classList.contains("is-readonly-mirror"), true);
  assert.equal(refs.nameInput.hidden, true);
  assert.equal(refs.actions.hidden, true);
  assert.equal(refs.nameReadonly.hidden, false);

  resetLibraryCardMode(card);
  assert.equal(card.classList.contains("is-editable"), false);
  assert.equal(card.classList.contains("is-readonly-mirror"), false);
});
