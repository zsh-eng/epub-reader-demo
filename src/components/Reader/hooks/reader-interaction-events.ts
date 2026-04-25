export const READER_TOUCH_TAP_HANDLED_EVENT = "reader:touch-tap-handled";
export const TOUCH_TAP_SELECTION_SUPPRESSION_MS = 500;

export function dispatchReaderTouchTapHandled(): void {
  document.dispatchEvent(new Event(READER_TOUCH_TAP_HANDLED_EVENT));
}
