import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { ReviewController, ReviewControllerSnapshot } from "../data/controller";
import { tokens, ui } from "../theme.stylex";

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
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [clearRevision, setClearRevision] = useState<number | null>(null);
  const repositoryCount = new Set(saved.targets.map((target) => target.repositoryId)).size;
  const target = saved.targets.find((entry) => entry.id === state.savedTargetId);
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setNotice("");
    try {
      setNotice(await action());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Saved review" {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.row)}>
        <strong>{saved.title}</strong>
        <span>
          {repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"} ·{" "}
          {saved.commentCount} comments
        </span>
        <span {...stylex.props(styles.grow)} />
        <button
          {...stylex.props(ui.button)}
          disabled={busy || saved.commentCount === 0}
          onClick={() =>
            void run(async () => {
              const feedback = await controller.copyFeedback();
              return `Copied ${feedback.count} comments from ${feedback.repositoryCount} ${feedback.repositoryCount === 1 ? "repository" : "repositories"}.`;
            })
          }
        >
          Copy feedback
        </button>
        <button
          {...stylex.props(ui.button)}
          disabled={busy || saved.commentCount === 0}
          onClick={() => setClearRevision(saved.revision)}
        >
          Clear all comments
        </button>
      </div>
      <div {...stylex.props(styles.row)}>
        <label htmlFor="saved-review-target">Review target</label>
        <select
          id="saved-review-target"
          {...stylex.props(styles.select)}
          value={state.savedTargetId ?? ""}
          onChange={(event) => {
            setNotice("");
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
        {browsing ? (
          <span>
            Browsing files · {browsingSourceLabel ?? "Current files"} · Outside saved comparison
          </span>
        ) : state.savedView ? (
          <span title={saved.createdAt}>
            {target?.captured ? "Captured working changes" : "Saved commit comparison"} ·{" "}
            {new Date(saved.createdAt).toLocaleString()}
          </span>
        ) : (
          <span>
            Browsing outside the saved comparison · Comments here are not included in feedback
          </span>
        )}
        {(!state.savedView || browsing) && (
          <button {...stylex.props(ui.button)} onClick={onReturn}>
            Return to review changes
          </button>
        )}
      </div>
      {clearRevision !== null && (
        <div {...stylex.props(styles.row)} role="alert">
          <span>Clear all comments across every target in “{saved.title}”?</span>
          <button
            {...stylex.props(ui.button)}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await controller.clearSavedComments(clearRevision);
                setClearRevision(null);
                return "All comments in this review cleared.";
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
      )}
      {notice && (
        <p role="status" {...stylex.props(styles.notice)}>
          {notice}
        </p>
      )}
    </section>
  );
}

const styles = stylex.create({
  header: {
    backgroundColor: tokens.panel,
    color: tokens.text,
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 30 },
  grow: { flexGrow: 1 },
  select: {
    color: tokens.text,
    backgroundColor: tokens.canvas,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 4,
    padding: 4,
    maxWidth: "min(600px, 70vw)",
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  notice: { marginBlock: 4 },
});
