import type { PageFragment, PageSlice } from "@/lib/pagination-v2";
import {
    CONTENT_ANCHOR_BLOCK_ID_ATTR,
    CONTENT_ANCHOR_END_ATTR,
    CONTENT_ANCHOR_START_ATTR,
    serializeTextCursorOffset,
} from "@/lib/pagination-v2/content-anchor-dom";
import {
    getInlineRaisePx,
    getNoteRefMetrics,
} from "@/lib/pagination-v2/shared/inline-presentation";
import { measureTextWidth } from "@/lib/pagination-v2/shared/measure";
import { cn } from "@/lib/utils";
import {
    EPUB_HIGHLIGHT_END_ATTRIBUTE,
    EPUB_HIGHLIGHT_START_ATTRIBUTE,
    toCssTextAlign,
} from "@/types/reader.types";
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import { LazyImage } from "./shared/LazyImage";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

interface PageSliceViewProps {
  slice: PageSlice;
  sliceIndex: number;
  baseFontSize: number;
}

function NoteRefBadge({ children }: { children: ReactNode }) {
  return <span className="reader-v2-note-ref-badge">{children}</span>;
}

function isClusteredLinkFragment(fragment: PageFragment): boolean {
  return Boolean(fragment.link) && fragment.inlineRole !== "note-ref";
}

function renderFragmentSequence(
  fragments: PageFragment[],
  keyPrefix: string,
  getStyle: (
    fragment: PageFragment,
    fragmentIndex: number,
  ) => CSSProperties,
): ReactNode[] {
  const nodes: ReactNode[] = [];

  for (let index = 0; index < fragments.length; ) {
    const fragment = fragments[index];
    if (!fragment) break;

    if (!isClusteredLinkFragment(fragment)) {
      nodes.push(
        renderInlineFragment(
          fragment,
          `${keyPrefix}-frag-${index}`,
          getStyle(fragment, index),
        ),
      );
      index += 1;
      continue;
    }

    const href = fragment.link?.href;
    const group: PageFragment[] = [fragment];
    let groupEnd = index + 1;

    while (groupEnd < fragments.length) {
      const nextFragment = fragments[groupEnd];
      if (
        !nextFragment ||
        !isClusteredLinkFragment(nextFragment) ||
        nextFragment.link?.href !== href
      ) {
        break;
      }

      group.push(nextFragment);
      groupEnd += 1;
    }

    if (group.length === 1) {
      nodes.push(
        renderInlineFragment(
          fragment,
          `${keyPrefix}-frag-${index}`,
          getStyle(fragment, index),
        ),
      );
      index = groupEnd;
      continue;
    }

    nodes.push(
      <span
        key={`${keyPrefix}-cluster-${index}`}
        className="reader-v2-inline-link-cluster"
      >
        {group.map((groupFragment, groupOffset) =>
          renderInlineFragment(
            groupFragment,
            `${keyPrefix}-frag-${index + groupOffset}`,
            getStyle(groupFragment, index + groupOffset),
          ),
        )}
      </span>,
    );
    index = groupEnd;
  }

  return nodes;
}

function renderFragmentContent(
  fragment: PageFragment,
) {
  if (!fragment.highlightMarks || fragment.highlightMarks.length === 0) {
    return fragment.text;
  }

  return fragment.highlightMarks.reduceRight<ReactNode>(
    (
      content: ReactNode,
      mark: NonNullable<PageFragment["highlightMarks"]>[number],
    ) => {
      return (
        <mark
          className="epub-highlight"
          data-highlight-id={mark.id}
          data-color={mark.color}
          {...(mark.isStart
            ? { [EPUB_HIGHLIGHT_START_ATTRIBUTE]: "true" }
            : {})}
          {...(mark.isEnd
            ? { [EPUB_HIGHLIGHT_END_ATTRIBUTE]: "true" }
            : {})}
        >
          {content}
        </mark>
      );
    },
    fragment.text,
  );
}

function getFragmentAnchorData(fragment: PageFragment) {
  return {
    ...(fragment.anchorStart
      ? {
          [CONTENT_ANCHOR_START_ATTR]: serializeTextCursorOffset(
            fragment.anchorStart,
          ),
        }
      : {}),
    ...(fragment.anchorEnd
      ? {
          [CONTENT_ANCHOR_END_ATTR]: serializeTextCursorOffset(fragment.anchorEnd),
        }
      : {}),
  };
}

function renderInlineFragment(
  fragment: PageFragment,
  key: string,
  style: CSSProperties,
) {
  const className = cn({
    "reader-v2-inline-link":
      Boolean(fragment.link) && fragment.inlineRole !== "note-ref",
    "reader-v2-inline-code": fragment.isCode,
    "reader-v2-inline-superscript": fragment.inlineRole === "superscript",
    "reader-v2-note-ref": fragment.inlineRole === "note-ref",
  });
  const content = renderFragmentContent(fragment);
  const anchorData = getFragmentAnchorData(fragment);
  const raisePx = getInlineRaisePx(fragment.inlineRole, fragment.font);
  const noteRefMetrics =
    fragment.inlineRole === "note-ref"
      ? getNoteRefMetrics(
          fragment.font,
          measureTextWidth(fragment.text, fragment.font),
        )
      : null;

  if (fragment.link) {
    return (
      <a
        key={key}
        href={fragment.link.href}
        style={{
          ...style,
          ...(fragment.inlineRole === "superscript"
            ? {
                display: "inline-block",
                lineHeight: 1,
                transform: `translateY(-${raisePx}px)`,
              }
            : {}),
          ...(noteRefMetrics
            ? {
                boxSizing: "border-box",
                minWidth: `${noteRefMetrics.totalWidthPx}px`,
                height: `${noteRefMetrics.heightPx}px`,
                lineHeight: 1,
                transform: `translateY(-${noteRefMetrics.raisePx}px)`,
              }
            : {}),
        }}
        className={className}
        {...anchorData}
      >
        {noteRefMetrics ? <NoteRefBadge>{content}</NoteRefBadge> : content}
      </a>
    );
  }

  return (
    <span
      key={key}
      style={{
        ...style,
        ...(fragment.inlineRole === "superscript"
          ? {
              display: "inline-block",
              lineHeight: 1,
              transform: `translateY(-${raisePx}px)`,
            }
          : {}),
      }}
      className={className}
      {...anchorData}
    >
      {content}
    </span>
  );
}

export function PageSliceView({
  slice,
  sliceIndex,
  baseFontSize,
}: PageSliceViewProps) {
  const key = `${slice.blockId}-${sliceIndex}`;

  if (slice.type === "spacer") {
    return <div style={{ height: `${slice.height}px` }} />;
  }

  if (slice.type === "image") {
    return (
      <div
        className="flex w-full items-center justify-center"
        style={{ height: `${slice.height}px` }}
      >
        <LazyImage
          src={slice.src}
          alt={slice.alt || "Chapter image"}
          width={slice.width}
          height={slice.height}
          style={{
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

  const textAlign =
    slice.renderMode === "manual-justify"
      ? "left"
      : HEADING_TAGS.has(slice.tag) &&
        (slice.textAlign === "justify" ||
          slice.textAlign === "justify-knuth-plass")
      ? "left"
      : toCssTextAlign(slice.textAlign);

  return (
    <p
      className={cn("m-0 box-border text-foreground", {
        "reader-v2-blockquote": slice.tag === "blockquote",
        "reader-v2-figcaption": slice.tag === "figcaption",
      })}
      {...{ [CONTENT_ANCHOR_BLOCK_ID_ATTR]: slice.blockId }}
      // There is a difference between the line height CSS property and the actual line height
      // that is rendered out.
      // For instance, with "Iowan Old Style" font on 17px, the rendered height of the box is
      // always 0.5px taller than the line height. E.g. 25px line height renders at 25.5px,
      // 24px line height renders at 24.5px, 28px line height renders at 28.5px, and so on.
      // Thus we need to set the `height` property to match the number of lines and line height
      // such that we don't get overflow in these cases.
      style={{
        lineHeight: `${slice.lineHeight}px`,
        height: `${slice.lines.length * slice.lineHeight}px`,
        textAlign,
        fontSize: Math.round(baseFontSize),
      }}
    >
      {slice.renderMode === "manual-justify"
        ? slice.lines.map((line, lineIndex) => {
            const trailingBoundaryFragment =
              line.fragments[line.fragments.length - 1]?.kind === "space"
                ? line.fragments[line.fragments.length - 1]
                : null;
            const contentFragments = trailingBoundaryFragment
              ? line.fragments.slice(0, -1)
              : line.fragments;

            return (
              <Fragment key={`${key}-line-${lineIndex}`}>
                <span
                  style={{
                    whiteSpace: "nowrap",
                    wordSpacing:
                      line.wordSpacingPx !== undefined &&
                      Math.abs(line.wordSpacingPx) > 0.01
                        ? `${line.wordSpacingPx}px`
                        : undefined,
                  }}
                >
                  {renderFragmentSequence(
                    contentFragments,
                    `${key}-line-${lineIndex}`,
                    (fragment) => ({
                      font: fragment.font,
                      lineHeight: "inherit",
                      marginRight:
                        fragment.marginRightPx !== undefined &&
                        Math.abs(fragment.marginRightPx) > 0.01
                          ? `${fragment.marginRightPx}px`
                          : undefined,
                    }),
                  )}
                </span>
                {trailingBoundaryFragment ? (
                  renderInlineFragment(
                    trailingBoundaryFragment,
                    `${key}-line-${lineIndex}-trailing`,
                    {
                      font: trailingBoundaryFragment.font,
                      lineHeight: "inherit",
                    },
                  )
                ) : null}
              </Fragment>
            );
          })
        : slice.lines.map((line, lineIndex) => (
            <Fragment key={`${key}-line-${lineIndex}`}>
              {renderFragmentSequence(
                line.fragments,
                `${key}-line-${lineIndex}`,
                (fragment) => ({
                  marginLeft:
                    fragment.leadingGap > 0
                      ? `${fragment.leadingGap}px`
                      : undefined,
                  font: fragment.font,
                  lineHeight: "inherit",
                }),
              )}
            </Fragment>
          ))}
    </p>
  );
}
