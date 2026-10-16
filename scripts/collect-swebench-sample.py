#!/usr/bin/env python3
"""Collect pinned public artifacts without executing task or candidate code.

Requires Python 3, pyarrow, and curl. Run with an output directory that does not exist.
Selection uses only repository/instance identity, before reading outcome reports.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import subprocess

import pyarrow.parquet as parquet


DATASET_REVISION = "78f471bf655a3137b2e8a75af1501690ec009ec3"
INDEX_REVISION = "40f164d5b8f1d249bf95a6df8b74b577fd8e519d"
ASSET_REVISION = "2f6637a2557da1f7b5f2b583ab7090a077bbeed2"
RUN = "20260901_mini-v2.4.2_gemini-3-5-flash"
ASSET_REPO = f"john-b-yang/{RUN}"
RAW_BASE = f"https://raw.githubusercontent.com/{ASSET_REPO}/{ASSET_REVISION}"
DATASET_URL = (
    "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/resolve/"
    f"{DATASET_REVISION}/data/test-00000-of-00001.parquet"
)
SELECTION = (
    "Join the pinned dataset and predictions on instance_id; group by dataset repo; "
    "sort repositories and instance IDs lexicographically; take the first two "
    "instances per repository, without reading outcomes or AgentShip results."
)
HOLDOUT_SELECTION = (
    "Join the pinned dataset and predictions on instance_id; group by dataset repo; "
    "sort repositories and instance IDs lexicographically; take instances at zero-based "
    "positions two and three per repository, excluding the first two pilot instances; "
    "do not inspect outcomes or AgentShip results before selection."
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, maximum=64 * 1024 * 1024):
    body = subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--location",
        "--proto", "=https", "--proto-redir", "=https",
        "--max-time", "30", "--max-filesize", str(maximum), url,
    ], check=True, capture_output=True, timeout=35).stdout
    if not body or len(body) > maximum:
        raise ValueError(f"Empty or oversized public artifact: {url}")
    return body


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--partition", choices=["pilot", "holdout"], default="pilot")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output directory already exists; collection never overwrites evidence.")

    dataset_bytes = fetch(DATASET_URL)
    predictions_bytes = fetch(f"{RAW_BASE}/all_preds.jsonl")
    fields = ["instance_id", "repo", "base_commit", "problem_statement"]
    tasks = parquet.read_table(io.BytesIO(dataset_bytes), columns=fields).to_pylist()
    predictions = [json.loads(line) for line in predictions_bytes.splitlines() if line.strip()]
    by_id = {record["instance_id"]: record for record in predictions}
    if len(by_id) != len(predictions):
        raise ValueError("Public predictions contain duplicate instance identities.")
    task_by_id = {record["instance_id"]: record for record in tasks}
    if len(task_by_id) != len(tasks):
        raise ValueError("Pinned dataset contains duplicate instance identities.")

    groups = {}
    for task in tasks:
        if task["instance_id"] in by_id:
            groups.setdefault(task["repo"], []).append(task["instance_id"])
    offset = 0 if args.partition == "pilot" else 2
    selection = SELECTION if args.partition == "pilot" else HOLDOUT_SELECTION
    selected = [
        instance
        for repo in sorted(groups)
        for instance in sorted(groups[repo])[offset:offset + 2]
    ]
    if not selected:
        raise ValueError("No matching dataset/prediction instances.")
    if any(not all(c.isalnum() or c in "_.-" for c in item) for item in selected):
        raise ValueError("Unsafe instance identity.")

    # Publish the outcome-blind selection before retrieving any outcomes.
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "selection.json").write_bytes(json_bytes({
        "selection": selection,
        "instanceIds": selected,
        "datasetRevision": DATASET_REVISION,
        "assetRevision": ASSET_REVISION,
    }))

    def report(instance):
        url = f"{RAW_BASE}/logs/{instance}/report.json"
        source = fetch(url, 1024 * 1024)
        target = args.output / "logs" / instance / "report.json"
        target.parent.mkdir(parents=True, exist_ok=False)
        target.write_bytes(source)
        return {"instanceId": instance, "url": url, "sha256": digest(source)}

    with ThreadPoolExecutor(max_workers=4) as pool:
        reports = list(pool.map(report, selected))

    exported_tasks = b"".join(json_bytes(task_by_id[item]) for item in selected)
    exported_predictions = b"".join(json_bytes(by_id[item]) for item in selected)
    (args.output / "dataset.jsonl").write_bytes(exported_tasks)
    (args.output / "all_preds.jsonl").write_bytes(exported_predictions)
    manifest = {
        "schemaVersion": 1,
        "run": RUN,
        "indexRevision": INDEX_REVISION,
        "datasetRevision": DATASET_REVISION,
        "assetRepository": ASSET_REPO,
        "assetRevision": ASSET_REVISION,
        "datasetUrl": DATASET_URL,
        "datasetParquetSha256": digest(dataset_bytes),
        "upstreamPredictionsSha256": digest(predictions_bytes),
        "datasetExportSha256": digest(exported_tasks),
        "predictionsExportSha256": digest(exported_predictions),
        "selection": selection,
        "cases": len(selected),
        "repositories": sorted({task_by_id[instance]["repo"] for instance in selected}),
        "reports": reports,
    }
    (args.output / "manifest.json").write_bytes(json_bytes(manifest))
    print(json.dumps({"output": str(args.output), "cases": len(selected),
                      "repositories": len(manifest["repositories"])}, sort_keys=True))


if __name__ == "__main__":
    main()
