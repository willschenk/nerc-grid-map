#!/usr/bin/env python3
"""Append geocoded records for research-queue lines 811-910 (batches 82-91)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"

FIXES = {
    "NCR11694": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "Invenergy GOP portfolio; operator HQ Chicago IL (outside TRE).",
    },
    "NCR13103": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "JP Remote Operations Center GOP; corporate office Schaumburg IL (outside TRE).",
    },
    "NCR13266": {
        "lat": 32.4709,
        "lng": -100.4059,
        "headquarters_address": "Cross Trails Wind Ranch, Nolan County, TX",
        "city": "Sweetwater",
        "state": "TX",
        "confidence": "MEDIUM",
        "source": "eia_861",
        "source_url": None,
        "notes": "NAES GOP at Cross Trails wind site west-central Texas (not CO).",
    },
    "NCR11463": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "Mojave GOP portfolio; operator likely outside TX—plant sites in ERCOT.",
    },
    "NCR11392": {
        "lat": 31.7619,
        "lng": -106.485,
        "headquarters_address": "4171 N Mesa St, El Paso, TX 79902",
        "city": "El Paso",
        "state": "TX",
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "IBWC US Section; El Paso district office for Rio Grande facilities.",
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(810, 910)]
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
    print(f"Appended {len(records)} Texas RE; total {len(data['orgs'])}; confidence {conf}")


if __name__ == "__main__":
    main()
