#!/usr/bin/env python3
"""Append geocoded records for research-queue lines 911-1010 (batches 92-101)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "src/data/nerc/research-queue.jsonl"
GEOCODED = ROOT / "src/data/nerc/geocoded-orgs.json"
B1 = Path(__file__).parent / "_agent_b1.json"
B2 = Path(__file__).parent / "_agent_b2.json"

FIXES = {
    "NCR11383": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "RWE Clean Energy QSE GOP; US office Chicago IL (outside TRE).",
    },
    "NCR13538": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "RES Energy Services GOP; corporate HQ Broomfield CO (outside TRE).",
    },
    "NCR12156": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "RES America Asset Management GOP; parent HQ Broomfield CO.",
    },
    "NCR12469": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "RES Americas Frye Solar GOP; operator HQ Broomfield CO.",
    },
    "NCR13127": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "RES Outpost Solar GOP; operator HQ Broomfield CO.",
    },
    "NCR12275": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "Spark Power Renewables GOP; corporate HQ Houston area with national HQ Canada.",
    },
    "NCR12412": {
        "confidence": "MEDIUM",
        "source": "official_website",
        "source_url": None,
        "notes": "Pearce Renewables GOP; HQ Paso Robles CA (outside TRE); Texas asset O&M.",
    },
    "NCR13464": {
        "confidence": "MEDIUM",
        "source": "parent_company_inference",
        "source_url": None,
        "notes": "QE Solar ROC GOP; operator office outside TX (NJ).",
    },
}


def main():
    queue = [json.loads(l) for l in QUEUE.read_text().splitlines()]
    expected = [queue[i] for i in range(910, 1010)]
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
