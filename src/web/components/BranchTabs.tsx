import * as stylex from "@stylexjs/stylex";
import { Tabs } from "@base-ui/react/tabs";
import { useMemo, useState } from "react";
import type { Branch, Worktree } from "../../shared/protocol";
import { tokens, ui } from "../theme.stylex";
import { CommandDialog } from "./Controls";
import { Icon } from "./Icon";
import { distinctLabels } from "../data/tab-labels";

export function BranchTabs({
  branches,
  worktrees,
  activeBranch,
  repo,
  error,
  onBranch,
  onWorktree,
  pickerOpen,
  onPickerOpenChange,
}: {
  branches: Branch[];
  worktrees: Worktree[];
  activeBranch: string | null;
  repo?: string;
  error: string | null;
  onBranch(name: string): void;
  onWorktree(path: string): void;
  pickerOpen: boolean;
  onPickerOpenChange(open: boolean): void;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const entries = useMemo(
    () => [
      ...branches.map((branch) => ({
        key: `branch:${branch.name}`,
        label: branch.name,
        path: branch.worktreePath,
        head: branch.head,
        run: () => onBranch(branch.name),
      })),
      ...worktrees
        .filter((tree) => !tree.bare && (!tree.branch || tree.branch === "Detached HEAD"))
        .map((tree) => ({
          key: `tree:${tree.path}`,
          label: `Detached · ${tree.head.slice(0, 7)}`,
          path: tree.path,
          head: tree.head,
          run: () => onWorktree(tree.path),
        })),
    ],
    [branches, worktrees, onBranch, onWorktree],
  );
  const active = activeBranch ? `branch:${activeBranch}` : `tree:${repo}`;
  const labels = distinctLabels(
    entries.map((entry) => ({ label: entry.label, qualifier: entry.path ?? repo ?? "Repository" })),
  );
  const labelFor = (key: string) => labels[entries.findIndex((entry) => entry.key === key)];
  // Keep existing checkouts visible; other branches can be opened from the picker.
  const visible = entries.filter(
    (entry, index) => index < 5 || entry.path || entry.key === active || opened.includes(entry.key),
  );
  if (!entries.length && !error) return null;
  return (
    <div {...stylex.props(styles.row)}>
      <Tabs.Root
        value={active}
        onValueChange={(key) => entries.find((entry) => entry.key === key)?.run()}
        {...stylex.props(styles.root)}
      >
        <Tabs.List aria-label="Branches and worktrees" {...stylex.props(styles.list)}>
          {visible.map((entry) => (
            <Tabs.Tab
              key={entry.key}
              value={entry.key}
              aria-controls="review-workspace"
              title={
                entry.path
                  ? `${entry.label}\nWorktree: ${entry.path}`
                  : `${entry.label}\nCommit ${entry.head.slice(0, 7)} · no worktree`
              }
              {...stylex.props(styles.tab, entry.key === active && styles.active)}
            >
              <Icon name="branch" size={14} />
              <span {...stylex.props(styles.name)}>{labelFor(entry.key)}</span>
              {entry.path && (
                <span
                  aria-label="Existing worktree"
                  title="Existing worktree"
                  {...stylex.props(styles.dot)}
                />
              )}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <button
        {...stylex.props(ui.button, ui.iconButton)}
        aria-label="Open branch"
        title="Open branch"
        onClick={() => onPickerOpenChange(true)}
      >
        <Icon name="plus" size={15} />
      </button>
      {error && (
        <span role="status" {...stylex.props(ui.faint)} title={error}>
          Branches unavailable
        </span>
      )}
      <CommandDialog
        title="Branches"
        searchLabel="Search branches"
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        commands={entries.map((entry) => ({
          id: entry.key,
          label: labelFor(entry.key) ?? entry.label,
          run: () => {
            setOpened((current) =>
              [...current.filter((key) => key !== entry.key), entry.key].slice(-20),
            );
            entry.run();
          },
        }))}
      />
    </div>
  );
}
const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 37,
    backgroundColor: tokens.panel,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    paddingInline: 8,
    gap: 4,
  },
  root: { minWidth: 0, flex: "1" },
  list: { display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "thin" },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 36,
    minWidth: 115,
    maxWidth: 240,
    paddingInline: 13,
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    borderRadius: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    flexShrink: 0,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accent}` },
    outlineOffset: -3,
  },
  active: { color: tokens.text, backgroundColor: tokens.canvas, borderBottomColor: tokens.accent },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dot: { width: 5, height: 5, borderRadius: "50%", backgroundColor: tokens.green, flexShrink: 0 },
});
