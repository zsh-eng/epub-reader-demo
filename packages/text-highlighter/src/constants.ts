/**
 * Default class names and data attributes for highlight elements.
 * These can be overridden when using the library functions.
 */
export const HIGHLIGHT_DEFAULTS = {
    /** Default CSS class for highlight elements */
    className: 'text-highlight',
    /** CSS class added when a highlight is active/selected */
    activeClassName: 'text-highlight-active',
    /** CSS class added when hovering over a highlight group */
    hoverClassName: 'text-highlight-hover',
    /** Data attribute storing the highlight ID */
    idAttribute: 'data-highlight-id',
} as const;

export type HighlightDefaults = typeof HIGHLIGHT_DEFAULTS;
