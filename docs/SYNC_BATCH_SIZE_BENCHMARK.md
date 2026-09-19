# Larger sync batches — 2026-09-19

This extends the streaming experiment with 500-, 5,000-, and 20,000-record
batches. The previous adaptive writer combined up to about 4,000 records.

## Method

Use the same 97,266-record local snapshot, Chrome browser, Spaced decoder, and
Dexie tables as the first experiment. Each run starts with a new disposable
database. Compare every stored row with the decoded source after timing and
verify count, cursor, bootstrap completion, and an empty outbox.

Plan: three repeats per case, with rotated order. Stopped during the second
repeat because host load and timing variance rose sharply. Nine completed runs
passed row verification; the three-repeat comparison is incomplete. Cases:

- **Fixed stream writes:** one compressed response, no injected latency. Wait
  for a full write batch except at the end or if the queue reaches its byte
  limit. This isolates database write size with the same producer/writer.
- **Larger paginated responses:** inject 100 ms of delay per request; vary the
  response size and write all records in each response in one transaction.
  This changes both request size and write size. It does not separately measure
  large responses with small writes.

The large-page fixture groups existing 500-record envelopes in one outer array.
Both envelope validation passes are retained. It is a benchmark-only transport;
we have not raised the installed library's 500-record page limit.

The server preloads and precompresses the snapshot. Timings exclude production
network conditions, D1, Worker compression/serialization, auth, database setup,
row verification, and the final application memory rebuild. This is a controlled
browser benchmark, not production end-to-end timing.

## Interpretation

A larger network page removes request waits. A larger write transaction does not
remove the cost of decoding, cloning, indexing, and storing each record.

`maxPrepareMs` is the longest synchronous domain preparation call. It measures
main-thread work, but excludes envelope parsing and validation. `maxWriteMs` is
an awaited interval and can overlap with producer parsing; it is not continuous
UI blocking or isolated disk time.

Queue measurements are serialized JSON sizes, not heap measurements. The fixed
stream queue uses a 32 MiB JSON limit and a record limit of at least the requested
write size. Active write batches, decoded objects, partial frames, and browser
buffers use additional memory.

A production page-size option needs a byte limit as well as a row limit. The
fixture's in-memory preload and large page buffers must not be copied directly
into the Worker. No production code or package was changed by this experiment.

## Review and reproduce

1. Read the measurements below and the raw aggregate JSON.
2. See `scripts/sync-benchmark/README.md` for the **Run batch-size comparison**
   button and summary command.
3. Review the `stream-fixed-N` queue policy and `paged-N` path in
   `scripts/sync-benchmark/browser.ts`.
4. Review the local `/group` fixture in `scripts/sync-benchmark/server.ts`.

## Results and limits

The table is the **first complete pass**, not a median of three runs.

| Records per batch | One stream, no injected delay | Paginated, 100 ms per request | Writes |
| ----------------- | ----------------------------: | ----------------------------: | -----: |
| 500               |                        13.6 s |                        34.3 s |    195 |
| 5,000             |                        14.9 s |                        19.5 s |     20 |
| 20,000            |                        14.1 s |                        20.4 s |      5 |

In that pass, increasing write size did not reduce the stream restore time.
The longest synchronous preparation call was 20.5 ms at 500 records, 169.5 ms
at 5,000, and 617.3 ms at 20,000. The stream queue peaked at about 3.5 MB,
4.3 MB, and 16.6 MB of JSON respectively, excluding active batches and heap
overhead. Larger pages reduced request count from 195 to 20 and then five.

The second repeat completed these runs before interruption:

| Case               | First run | Second run |
| ------------------ | --------: | ---------: |
| stream-fixed-20000 |    14.1 s |     16.8 s |
| paged-500          |    34.3 s |     69.8 s |
| paged-5000         |    19.5 s |     48.4 s |

The 500-record paginated run's total domain preparation time rose from 2.7 s
to 24.3 s. The 5,000-record run rose from 3.1 s to 23.5 s. The host's one-minute
load average rose from 23 to above 145 during observation; this Mac reports eight
logical CPUs. A process sample showed substantial renderer and background
activity. We did not isolate the cause, or establish how much was caused by the
benchmark itself. Do not use these repeats to claim a stable speedup or an optimum
batch size. All samples remain in
[the raw results](./SYNC_BATCH_SIZE_BENCHMARK_RESULTS.json).

## Recommendation

Treat larger network pages as a useful candidate: around 5,000 records as a row
ceiling, with a separate byte cap. Keep database writes smaller or configurable.
The first pass offers no evidence for a 20,000-record write default, and it
requires more memory and longer synchronous preparation calls. Large network
pages combined with small writes remain an unmeasured option.

Repeat on a machine with stable load before choosing defaults; test the real
Worker path before changing the shared library. Production remains unchanged.

Validation: strict TypeScript checking passed. Every stored row was checked in
all nine completed runs. The benchmark was stopped and its interrupted-database
cleanup page verified that no disposable benchmark databases remained.
