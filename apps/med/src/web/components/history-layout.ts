import type { Commit } from "../../shared/protocol";

export interface GraphEdge {
  from: number;
  to: number;
  color: number;
  incoming: boolean;
}
export interface GraphRow {
  commit: Commit;
  lane: number;
  width: number;
  incoming: boolean;
  edges: GraphEdge[];
}

/** Route parent links through stable lanes, including parents beyond the current page. */
export function layoutHistory(commits: readonly Commit[]): GraphRow[] {
  let lanes: string[] = [];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const incoming = lanes.includes(commit.id);
    if (!incoming) lanes.push(commit.id);
    const before = lanes.slice();
    const lane = before.indexOf(commit.id);
    const after = before.filter((id) => id !== commit.id);
    let insertion = Math.min(lane, after.length);
    for (const parent of commit.parents) {
      if (!after.includes(parent)) {
        after.splice(insertion, 0, parent);
        insertion++;
      }
    }
    const edges: GraphEdge[] = [];
    for (let index = 0; index < before.length; index++) {
      const id = before[index];
      if (id !== commit.id)
        edges.push({ from: index, to: after.indexOf(id), color: index, incoming: true });
    }
    for (const parent of commit.parents)
      edges.push({ from: lane, to: after.indexOf(parent), color: lane, incoming: false });
    rows.push({ commit, lane, incoming, edges, width: Math.max(before.length, after.length, 1) });
    lanes = after;
  }
  return rows;
}
