"""Summarize elapsed spans. Child spans partition apply; producer spans overlap it."""
import collections
import json
import sys
from pathlib import Path

source = Path(sys.argv[1] if len(sys.argv) > 1 else 'cutover.local/optimizations/trace-results.json')
data = json.loads(source.read_text())
for sample in data['results']:
    sums = collections.defaultdict(float)
    # First-pass traces included verification; exclude it at the final checkpoint.
    cutoff = max(s['end'] for s in sample['spans'] if s['name'] == 'checkpoint')
    spans = [s for s in sample['spans'] if s['end'] <= cutoff]
    for span in spans:
        sums[span['name']] += span['end'] - span['start']
    child_names = ['transaction-start', 'outbox-count', 'bulk-put', 'transaction-commit']
    sums['apply-other'] = sums['apply'] - sum(sums[n] for n in child_names)
    top_names = ['prepare', 'hlc', 'apply', 'checkpoint', 'consumer-wait']
    sums['restore-other'] = sample['totalMs'] - sum(sums[n] for n in top_names)
    overlaps = collections.defaultdict(float)
    for producer in (s for s in spans if s['name'] == 'producer-page-work'):
        for target in (s for s in spans if s['name'] in child_names):
            overlaps[target['name']] += max(0, min(producer['end'], target['end']) - max(producer['start'], target['start']))
    print(json.dumps({'repeat': sample['repeat'], 'totalMs': sample['totalMs'],
        'elapsedMs': dict(sums), 'producerOverlapMs': dict(overlaps),
        'native': sample.get('native'), 'verified': sample['verified']}, indent=2))
