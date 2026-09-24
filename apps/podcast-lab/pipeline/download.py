"""Download one immutable audio version. Partial bytes survive interruptions."""

import hashlib
import json
import re
import urllib.request
from pathlib import Path


def download(url: str, target: Path):
    part = target.with_suffix(target.suffix + ".part")
    meta = target.with_suffix(target.suffix + ".download.json")
    previous = json.loads(meta.read_text()) if meta.exists() else {}
    if target.exists():
        if previous.get("url") != url or not previous.get("sha256"):
            raise ValueError(
                "Existing audio has a different or missing manifest; use a new output directory"
            )
        with target.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest == previous["sha256"]:
            return previous
        raise ValueError("Cached audio hash changed; use a new output directory")
    offset = part.stat().st_size if part.exists() else 0
    validator = previous.get("validator")
    if previous.get("url") != url or not validator:
        offset = 0
    headers = {"User-Agent": "WorkbenchPodcastLab/0.1", "Accept-Encoding": "identity"}
    if offset:
        headers.update({"Range": f"bytes={offset}-", "If-Range": validator})
    with urllib.request.urlopen(
        urllib.request.Request(url, headers=headers), timeout=90
    ) as response:
        resumed = response.status == 206 and offset > 0
        if response.status == 206:
            match = re.fullmatch(
                r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", "")
            )
            if not match or int(match[1]) != offset:
                raise ValueError("Server returned an inconsistent byte range")
            total = int(match[3])
        else:
            total = int(response.headers.get("Content-Length", 0))
        etag = response.headers.get("ETag", "")
        validator = (
            etag
            if etag and not etag.startswith("W/")
            else response.headers.get("Last-Modified")
        )
        if resumed and validator != previous.get("validator"):
            raise ValueError("Server changed its validator during a partial response")
        record = {"url": url, "validator": validator, "bytes": total}
        meta.write_text(json.dumps(record, indent=2))
        with part.open("ab" if resumed else "wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if total and part.stat().st_size != total:
            raise ValueError("Incomplete download; run again to resume")
    with part.open("rb") as source:
        record["sha256"] = hashlib.file_digest(source, "sha256").hexdigest()
    record["bytes"] = part.stat().st_size
    part.replace(target)
    meta.write_text(json.dumps(record, indent=2))
    return record


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("target", type=Path)
    a = p.parse_args()
    print(json.dumps(download(a.url, a.target), indent=2))
