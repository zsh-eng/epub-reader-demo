import { HIGHLIGHT_DEFAULTS } from './constants';

/**
 * Options for configuring the highlight interaction manager.
 */
export interface HighlightInteractionOptions {
    /** CSS class on highlight elements (default: 'text-highlight') */
    highlightClass?: string;
    /** Data attribute storing highlight ID (default: 'data-highlight-id') */
    idAttribute?: string;
    /** Class added on hover to all segments of a highlight (default: 'text-highlight-hover') */
    hoverClass?: string;
    /** Class added when a highlight is active/selected (default: 'text-highlight-active') */
    activeClass?: string;
    /** Called when a highlight element is clicked */
    onHighlightClick?: (id: string, position: { x: number; y: number }) => void;
    /** Called when hover state changes on a highlight */
    onHighlightHover?: (id: string, isHovering: boolean) => void;
}

/**
 * Manager interface for controlling highlight interactions.
 */
export interface HighlightInteractionManager {
    /** Set the active highlight (adds active class to matching elements) */
    setActiveHighlight: (id: string | null) => void;
    /** Get the currently active highlight ID */
    getActiveHighlight: () => string | null;
    /** Clean up all event listeners */
    destroy: () => void;
}

/**
 * Creates a manager for handling highlight interactions within a container.
 * Uses event delegation for efficient event handling.
 *
 * @param container - The container element containing highlights
 * @param options - Configuration options
 * @returns A manager object with methods to control highlight state
 *
 * @example
 * ```ts
 * const manager = createHighlightInteractionManager(contentEl, {
 *   highlightClass: 'my-highlight',
 *   onHighlightClick: (id, pos) => showToolbar(id, pos),
 * });
 *
 * // Later: clean up
 * manager.destroy();
 * ```
 */
export function createHighlightInteractionManager(
    container: HTMLElement,
    options: HighlightInteractionOptions = {}
): HighlightInteractionManager {
    const {
        highlightClass = HIGHLIGHT_DEFAULTS.className,
        idAttribute = HIGHLIGHT_DEFAULTS.idAttribute,
        hoverClass = HIGHLIGHT_DEFAULTS.hoverClassName,
        activeClass = HIGHLIGHT_DEFAULTS.activeClassName,
        onHighlightClick,
        onHighlightHover,
    } = options;

    let activeHighlightId: string | null = null;

    /**
     * Check if an element is a highlight element
     */
    const isHighlightElement = (el: Element): boolean => {
        return el.classList.contains(highlightClass);
    };

    /**
     * Get all highlight elements with a given ID
     */
    const getHighlightElements = (id: string): NodeListOf<Element> => {
        return container.querySelectorAll(`[${idAttribute}="${id}"]`);
    };

    /**
     * Handle mouse entering a highlight element
     */
    const handleMouseEnter = (event: Event): void => {
        const target = event.target as HTMLElement;
        if (!isHighlightElement(target)) return;

        const highlightId = target.getAttribute(idAttribute);
        if (!highlightId) return;

        // Add hover class to all segments of this highlight
        const relatedElements = getHighlightElements(highlightId);
        relatedElements.forEach((el) => {
            el.classList.add(hoverClass);
        });

        onHighlightHover?.(highlightId, true);
    };

    /**
     * Handle mouse leaving a highlight element
     */
    const handleMouseLeave = (event: Event): void => {
        const target = event.target as HTMLElement;
        if (!isHighlightElement(target)) return;

        const highlightId = target.getAttribute(idAttribute);
        if (!highlightId) return;

        // Remove hover class from all segments
        const relatedElements = getHighlightElements(highlightId);
        relatedElements.forEach((el) => {
            el.classList.remove(hoverClass);
        });

        onHighlightHover?.(highlightId, false);
    };

    /**
     * Handle click on a highlight element
     */
    const handleClick = (event: Event): void => {
        const target = event.target as HTMLElement;
        if (!isHighlightElement(target)) return;

        const highlightId = target.getAttribute(idAttribute);
        if (!highlightId) return;

        // Calculate position for toolbar placement (center-bottom of element)
        const rect = target.getBoundingClientRect();
        const position = {
            x: rect.left + rect.width / 2,
            y: rect.bottom + 5, // Slight offset below the highlight
        };

        onHighlightClick?.(highlightId, position);
    };

    /**
     * Set the active highlight and update classes accordingly.
     * Clears ALL active highlights first to ensure clean state when
     * active highlight is managed by external state.
     */
    const setActiveHighlight = (id: string | null): void => {
        // Remove active class from ALL highlights (not just tracked one)
        // This handles external state management where we may not know
        // which highlights currently have the active class
        const allHighlights = container.querySelectorAll(`.${highlightClass}`);
        allHighlights.forEach((el) => {
            el.classList.remove(activeClass);
        });

        // Add active class to new highlight
        if (id) {
            const newElements = getHighlightElements(id);
            newElements.forEach((el) => {
                el.classList.add(activeClass);
            });
        }

        activeHighlightId = id;
    };

    /**
     * Get the currently active highlight ID
     */
    const getActiveHighlight = (): string | null => {
        return activeHighlightId;
    };

    // Set up event listeners with capture phase for delegation
    container.addEventListener('mouseenter', handleMouseEnter, true);
    container.addEventListener('mouseleave', handleMouseLeave, true);
    container.addEventListener('click', handleClick, true);

    /**
     * Clean up all event listeners
     */
    const destroy = (): void => {
        container.removeEventListener('mouseenter', handleMouseEnter, true);
        container.removeEventListener('mouseleave', handleMouseLeave, true);
        container.removeEventListener('click', handleClick, true);
    };

    return {
        setActiveHighlight,
        getActiveHighlight,
        destroy,
    };
}
