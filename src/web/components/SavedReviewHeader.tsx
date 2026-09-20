import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import type { ReviewController, ReviewControllerSnapshot } from "../data/controller";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export function SavedReviewHeader({
  controller,
  state,
  browsing,
  browsingSourceLabel,
  onReturn,
  onTarget,
}: {
  controller: ReviewController;
  state: ReviewControllerSnapshot;
  browsing?: boolean;
  browsingSourceLabel?: string;
  onReturn(): void;
  onTarget(id: string): void;
}) {
  const saved = state.savedReview!;
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clearRevision, setClearRevision] = useState<number | null>(null);
  const repositoryCount = new Set(saved.targets.map((entry) => entry.repositoryId)).size;
  const target = saved.targets.find((entry) => entry.id === state.savedTargetId);
  const outside = !state.savedView || browsing;
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ text: await action(), error: false });
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : "The request failed.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Saved review" {...stylex.props(styles.header)}>
      <Popover.Root
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setClearRevision(null);
        }}
      >
        <Popover.Trigger
          {...stylex.props(ui.button, styles.fixed)}
          aria-label="Review details and actions"
        >
          <span {...stylex.props(styles.desktop)}>Review</span>
          <Icon name="note" size={14} />
          <Icon name="chevron" size={10} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={5}
            {...stylex.props(styles.positioner, ui.instant)}
          >
            <Popover.Popup {...stylex.props(ui.popup, styles.details, ui.instant)}>
              <Popover.Title {...stylex.props(styles.title)}>{saved.title}</Popover.Title>
              <p {...stylex.props(styles.detailText)}>
                {repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"} ·{" "}
                {saved.commentCount} comments
              </p>
              {target && (
                <p {...stylex.props(styles.detailText)}>
                  {target.repo}
                  <br />
                  {target.branch ?? "Detached HEAD"} · {target.label}
                </p>
              )}
              <p {...stylex.props(styles.detailText)}>
                {target?.captured ? "Captured working changes" : "Saved commit comparison"}
                <br />
                {new Date(saved.createdAt).toLocaleString()}
              </p>
              {outside && (
                <p {...stylex.props(styles.detailText)}>
                  {browsing
                    ? `Browsing files · ${browsingSourceLabel ?? "Current files"}.`
                    : "Browsing outside the saved comparison."}{" "}
                  Only comments on the saved comparison are copied.
                </p>
              )}
              {clearRevision === null ? (
                <button
                  {...stylex.props(ui.button)}
                  disabled={busy || saved.commentCount === 0}
                  onClick={() => setClearRevision(saved.revision)}
                >
                  <Icon name="trash" size={14} />
                  Clear all comments
                </button>
              ) : (
                <div role="alert">
                  <p {...stylex.props(styles.detailText)}>
                    Clear all comments across every target in this review?
                  </p>
                  <div {...stylex.props(ui.row)}>
                    <button
                      {...stylex.props(ui.button)}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await controller.clearSavedComments(clearRevision);
                          setClearRevision(null);
                          setDetailsOpen(false);
                          return "Comments cleared";
                        })
                      }
                    >
                      Confirm clear
                    </button>
                    <button
                      {...stylex.props(ui.button)}
                      disabled={busy}
                      onClick={() => setClearRevision(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <span title={saved.title} {...stylex.props(styles.reviewTitle)}>
        {saved.title}
      </span>
      {saved.targets.length > 1 && (
        <select
          aria-label="Review target"
          {...stylex.props(styles.select)}
          value={state.savedTargetId ?? ""}
          onChange={(event) => {
            setNotice(null);
            onTarget(event.target.value);
          }}
        >
          {!state.savedTargetId && <option value="">Select target</option>}
          {saved.targets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.repo.split(/[\\/]/).at(-1)} · {entry.branch ?? "detached"} · {entry.label}
            </option>
          ))}
        </select>
      )}
      <span {...stylex.props(styles.grow)} />
      {outside && (
        <button
          {...stylex.props(ui.button, ui.active, styles.fixed)}
          aria-label="Return to review"
          title="Return to the saved comparison. Only comments on that comparison are copied."
          onClick={onReturn}
        >
          Return<span {...stylex.props(styles.desktop)}>to review</span>
        </button>
      )}
      <button
        {...stylex.props(ui.button, styles.fixed)}
        aria-label="Copy comments"
        title={`Copy ${saved.commentCount} comments from all targets in this review`}
        disabled={busy || saved.commentCount === 0}
        onClick={() =>
          void run(async () => {
            const comments = await controller.copyFeedback();
            return `Copied ${comments.count} ${comments.count === 1 ? "comment" : "comments"}`;
          })
        }
      >
        <Icon name="copy" size={14} />
        <span {...stylex.props(styles.desktop)}>Copy comments</span>
        <span>{saved.commentCount}</span>
      </button>
      {notice && (
        <div role={notice.error ? "alert" : "status"} {...stylex.props(ui.popup, styles.notice)}>
          <span>{notice.text}</span>
          {notice.error && (
            <button
              {...stylex.props(ui.button, ui.iconButton)}
              aria-label="Dismiss message"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const styles = stylex.create({
  header: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 0,
    backgroundColor: tokens.panel,
    color: tokens.text,
    paddingBlock: 3,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  fixed: { flexShrink: 0 },
  desktop: { display: { default: "inline", "@media (max-width: 600px)": "none" } },
  reviewTitle: {
    display: { default: "block", "@media (max-width: 900px)": "none" },
    minWidth: 0,
    maxWidth: 320,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.muted,
    fontSize: 12,
  },
  grow: { flexGrow: 1 },
  select: {
    minWidth: 0,
    maxWidth: "min(280px, 30vw)",
    height: 26,
    color: tokens.text,
    backgroundColor: tokens.canvas,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 4,
    paddingInline: 4,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  positioner: { zIndex: 60 },
  details: { width: "min(360px, calc(100vw - 24px))", padding: 12 },
  title: { fontSize: 13, fontWeight: 600, marginBlock: 0, overflowWrap: "anywhere" },
  detailText: { marginBlock: 10, color: tokens.muted, lineHeight: 1.5, overflowWrap: "anywhere" },
  notice: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 8,
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    maxWidth: "min(420px, calc(100vw - 24px))",
    paddingBlock: 8,
    paddingInline: 12,
    overflowWrap: "anywhere",
  },
});
