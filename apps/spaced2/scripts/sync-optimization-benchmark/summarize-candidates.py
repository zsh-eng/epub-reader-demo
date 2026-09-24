"""Report medians and ranges without treating overlapping phases as additive."""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else 'cutover.local/optimizations/candidate-results.json')
data = json.loads(path.read_text())
groups = defaultdict(list)
for row in data['results']:
    assert row['verified'], 'Unverified result'
    groups[row['mode']].append(row)
base = statistics.median(r['totalMs'] for r in groups['baseline']) if groups.get('baseline') else None
print(f"Status: {data['status']}; completed {len(data['results'])}/{data['plannedRuns']}")
print('| Case | n | Restore median (s) | Range (s) | Change | Read + hydrate (s) | Writes |')
print('| --- | ---: | ---: | --- | ---: | ---: | --- |')
for name, rows in groups.items():
    times = [r['totalMs'] / 1000 for r in rows]
    median = statistics.median(times)
    change = f'{(median * 1000 / base - 1) * 100:+.1f}%' if base else '—'
    load = statistics.median(r['loadAndHydrateMs'] / 1000 for r in rows)
    writes = sorted(set(r['writes'] for r in rows))
    print(f'| {name} | {len(rows)} | {median:.3f} | {min(times):.3f}–{max(times):.3f} | {change} | {load:.3f} | {writes} |')
