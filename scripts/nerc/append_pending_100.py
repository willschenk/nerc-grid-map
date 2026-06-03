#!/usr/bin/env python3
"""Append next 100 unprocessed research-queue records."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"

FIXES = {
    "NCR12142": {
        "lat": 39.5295,
        "lng": -119.8138,
        "headquarters_address": "6100 Neil Road",
        "city": "Reno",
        "state": "NV",
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "Terra-Gen GOP portfolio; NYC HQ outside WECC; Reno NV regional office.",
    },
    "NCR05537": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "USACE Omaha District HQ Omaha NE; registered WECC for western hydro portfolio.",
    },
    "NCR12028": {
        "notes": "Steamboat  Hills LLC; double space in entity_name per registry.",
    },
    "NCR12050": {
        "notes": "Utah Red Hills Renewable Park; double space before LLC in registry name.",
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    geocoded = {o["ncr_id"] for o in json.loads(GEOCODED.read_text())["orgs"]}
    expected = [r for r in queue if r["ncr_id"] not in geocoded]
    if len(expected) > 100:
        expected = expected[:100]

    chunks = json.loads(B1.read_text()) + json.loads(B2.read_text())
    by_id = {r["ncr_id"]: r for r in chunks}
    if len(by_id) != len(expected):
        raise SystemExit(f"expected {len(expected)} agent records, got {len(by_id)}")

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
        rec.pop("skip", None)
        rec.pop("skip_reason", None)
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
