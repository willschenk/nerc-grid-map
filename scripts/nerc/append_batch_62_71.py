#!/usr/bin/env python3
"""Append geocoded records for research-queue lines 611-710 (batches 62-71)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"

FIXES = {
    "NCR12012": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "Veolia GOP portfolio; US HQ Boston MA (outside SERC); SERC merchant registration.",
    },
    "NCR04006": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "AEP Service Corp agent for AEP Texas and PSO; corporate HQ Columbus OH (outside TRE).",
        "lat": 39.9612,
        "lng": -82.9988,
        "headquarters_address": "1 Riverside Plaza, Columbus, OH 43215",
        "city": "Columbus",
        "state": "OH",
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(610, 710)]
    by_id = {r["ncr_id"]: r for r in json.loads(B1.read_text()) + json.loads(B2.read_text())}

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
    print(f"Appended {len(records)}; total {len(data['orgs'])}; confidence {conf}")


if __name__ == "__main__":
    main()
