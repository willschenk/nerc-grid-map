#!/usr/bin/env python3
"""Append geocoded records for research-queue lines 1211-1310 (batches 122-131)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"
GAP = Path(__file__).parent / "_manual_gap.json"

FIXES = {
    "NCR13236": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "Fractal EMS GOP; corporate HQ Austin TX outside WECC.",
    },
    "NCR11149": {
        "confidence": "MEDIUM",
        "source": "sec_filing",
        "source_url": None,
        "notes": "GenOn portfolio GOP; principal office Houston TX outside WECC.",
    },
    "NCR11531": {
        "lat": 32.5647,
        "lng": -116.065,
        "city": "Tecate",
        "state": "BC",
        "country": "MX",
        "confidence": "MEDIUM",
        "source": "ferc_filing",
        "source_url": None,
        "notes": "Sierra Juarez wind near La Rumorosa; Baja California Mexico cross-border to SDG&E.",
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(1210, 1310)]
    chunks = []
    for path in (B1, B2):
        chunks.extend(json.loads(path.read_text()))
    chunks.extend(json.loads(GAP.read_text()))
    by_id = {r["ncr_id"]: r for r in chunks}

    records = []
    for row in expected:
        nid = row["ncr_id"]
        if nid not in by_id:
            raise SystemExit(f"missing agent record {nid}")
        rec = {**by_id[nid], **FIXES.get(nid, {})}
        rec["entity_name"] = row["entity_name"]
        rec["roles"] = row["roles"]
        rec["region"] = row["region"]
        rec["country"] = "US"
        rec["seed"] = False
        rec["lat"] = round(float(rec["lat"]), 4)
        rec["lng"] = round(float(rec["lng"]), 4)
        if rec.get("confidence") != "HIGH":
            rec["source_url"] = None
        records.append(rec)

    data = json.loads(GEOCODED.read_text())
    present = {o["ncr_id"] for o in data["orgs"]}
    for rec in records:
        if rec["ncr_id"] in present:
            raise SystemExit(f"duplicate {rec['ncr_id']}")
    data["orgs"].extend(records)
    GEOCODED.write_text(json.dumps(data, indent=2) + "\n")
    conf = {}
    for r in records:
        conf[r["confidence"]] = conf.get(r["confidence"], 0) + 1
    print(f"Appended {len(records)} WECC; total {len(data['orgs'])}; confidence {conf}")


if __name__ == "__main__":
    main()
