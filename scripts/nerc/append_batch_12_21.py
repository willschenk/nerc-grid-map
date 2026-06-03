#!/usr/bin/env python3
"""Append geocoded RF records for research-queue lines 111-210 (batches 12-21)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"

# Fixes applied on top of agent output
FIXES = {
    "NCR12045": {
        "lat": 39.7699,
        "lng": -86.157,
        "headquarters_address": "1 American Square, Suite 2900, Indianapolis, IN 46282",
        "city": "Indianapolis",
        "state": "IN",
        "confidence": "MEDIUM",
        "source": "state_puc",
        "source_url": None,
        "notes": "Indiana-formed TO subsidiary; Indianapolis registered office (parent NEET Juno Beach FL).",
    },
    "NCR12387": {"lat": 40.0676},
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(110, 210)]
    agent = json.loads(B1.read_text()) + json.loads(B2.read_text())
    by_id = {r["ncr_id"]: r for r in agent}
    records = []
    for row in expected:
        nid = row["ncr_id"]
        if nid not in by_id:
            raise SystemExit(f"missing agent record {nid}")
        rec = by_id[nid]
        rec = {**rec, **FIXES.get(nid, {})}
        rec["entity_name"] = row["entity_name"]
        rec["roles"] = row["roles"]
        rec["region"] = "RF"
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
    print(f"Appended {len(records)} orgs; total {len(data['orgs'])}; confidence {conf}")


if __name__ == "__main__":
    main()
