export function getLibraryCardMode(item) {
  return item?.origin === "library_source" ? "readonly-mirror" : "editable";
}

export function applyLibraryCardMode(card, refs, mode) {
  const isReadOnlyMirror = mode === "readonly-mirror";
  card.classList.toggle("is-editable", !isReadOnlyMirror);
  card.classList.toggle("is-readonly-mirror", isReadOnlyMirror);
  refs.nameReadonly.hidden = !isReadOnlyMirror;
  refs.nameInput.hidden = isReadOnlyMirror;
  refs.actions.hidden = isReadOnlyMirror;
}

export function resetLibraryCardMode(card) {
  card.classList.remove("is-editable", "is-readonly-mirror");
}
