/** Focus before the first paint, with the saved query ready to replace. */
export function focusPaletteInput(input: HTMLInputElement | null): false {
  input?.focus({ preventScroll: true });
  input?.select();
  // Base UI must not queue another focus operation on the next frame.
  return false;
}
