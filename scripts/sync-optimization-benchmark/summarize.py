import json
import statistics
import sys
from pathlib import Path

source = Path(sys.argv[1] if len(sys.argv) > 1 else "cutover.local/optimizations/results.json")
data = json.loads(source.read_text())
print("status:", data.get("status"), "runs:", len(data["results"]))
for mode in dict.fromkeys(row["mode"] for row in data["results"]):
    rows = [row for row in data["results"] if row["mode"] == mode]
    print(mode, "n=", len(rows), "verified=", all(row["verified"] for row in rows))
    for metric in ["totalMs", "prepareMs", "writeMs", "writes", "outboxChecks", "outboxGets"]:
        values = [row[metric] for row in rows]
        print(" ", metric, "median=", round(statistics.median(values), 2), "range=", [round(min(values), 2), round(max(values), 2)])
    print("  longest prepare ms:", round(max(row["maxPrepareMs"] for row in rows), 2))
    print("  peak queued records:", max(row["peakQueueRecords"] for row in rows))
    print("  peak queued JSON bytes:", max(row["peakQueueJsonBytes"] for row in rows))
