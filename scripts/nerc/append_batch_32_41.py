#!/usr/bin/env python3
"""Append geocoded records for research-queue lines 311-410 (batches 32-41)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"

FIXES = {
    "NCR11915": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "DEPCOM Power merchant GOP/O&M; corporate HQ Scottsdale AZ (outside SERC); SERC portfolio plants.",
    },
    "NCR12310": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "Boralex US Operations GOP; principal office South Glens Falls NY (outside SERC).",
    },
    "NCR10390": {
        "lat": 39.2866,
        "lng": -76.6122,
        "headquarters_address": "750 E Pratt St, Baltimore, MD 21202",
        "city": "Baltimore",
        "state": "MD",
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "Constellation South Region generation portfolio; Baltimore regional office (parent HQ Kennett Square PA).",
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(310, 410)]
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
    print(
        f"Appended {len(records)} SERC; total {len(data['orgs'])}; confidence {conf}"
    )


if __name__ == "__main__":
    main()
