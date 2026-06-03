#!/usr/bin/env python3
"""Append geocoded records for research-queue lines 1311-1410 (batches 132-141)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"
GAP = Path(__file__).parent / "_manual_gap.json"

# GOP operators with corporate HQ outside WECC; plant-site coords kept, confidence lowered.
OUTSIDE_WECC_GOP = {
    "NCR11518", "NCR12159", "NCR11306", "NCR11104", "NCR11929", "NCR11589",
    "NCR11590", "NCR11928", "NCR00418",
}

FIXES = {
    "NCR05256": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "MEAN HQ Lincoln NE; registered WECC RP—HQ outside WECC footprint.",
    },
    "NCR05281": {
        "confidence": "MEDIUM",
        "source": "nerc_cores",
        "source_url": None,
        "notes": "NWPP reserve-sharing group; placed at NWPP offices Portland OR area.",
    },
    **{
        nid: {
            "confidence": "MEDIUM",
            "source": "parent_company_inference",
            "source_url": None,
            "notes": "NAES GOP; operator HQ Issaquah WA—dot at served plant in WECC.",
        }
        for nid in OUTSIDE_WECC_GOP
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(1310, 1410)]
    chunks = []
    for path in (B1, B2):
        if path.exists():
            chunks.extend(json.loads(path.read_text()))
    if GAP.exists():
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
        rec["country"] = rec.get("country") or "US"
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
