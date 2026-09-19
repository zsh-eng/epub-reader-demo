/** Add only enough parent context to distinguish otherwise identical labels. */
export function distinctLabels(entries: { label: string; qualifier: string }[]) {
  return entries.map((entry, index) => {
    const peers = entries.filter((other, i) => i !== index && other.label === entry.label);
    if (!peers.length) return entry.label;
    const parts = entry.qualifier.split("/").filter(Boolean);
    for (let length = 1; length <= parts.length; length++) {
      const suffix = parts.slice(-length).join("/");
      if (
        peers.every(
          (peer) => peer.qualifier.split("/").filter(Boolean).slice(-length).join("/") !== suffix,
        )
      )
        return `${suffix}/${entry.label}`;
    }
    return `${entry.qualifier}/${entry.label}`;
  });
}
