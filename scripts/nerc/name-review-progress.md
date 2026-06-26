# Name review progress

Track short-name review batches against `src/data/nerc/name-queue.{jsonl,csv}`.
Standard: [docs/standards/name-shortest.md](../../docs/standards/name-shortest.md).
Editable names: `src/data/nerc/org-names.json`.

## Status

| Field | Value |
| --- | --- |
| Current status | IN PROGRESS |
| Last completed queue order | 80 |
| Next queue order | 81 |
| Batch size | 20 |

Do not rerun the queue during an active pinned batch unless intentionally resetting.

## Needs user review

_None._

## Completed batches

### Batch 001 — orders 1–20 (2026-06-10)

Major IOU/ISO/RTO utilities. All entries already had verified official acronyms and complete metadata; no edits required.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 1 | NCR00024 | Florida Power & Light Co. | FPL | unchanged |
| 2 | NCR01151 | Tennessee Valley Authority | TVA | unchanged |
| 3 | NCR07124 | ISO-NE | ISO-NE | unchanged |
| 4 | NCR07160 | New York Independent System Operator | NYISO | unchanged |
| 5 | NCR00879 | PJM Interconnection, LLC | PJM | unchanged |
| 6 | NCR05016 | Arizona Public Service Company | APS | unchanged |
| 7 | NCR01177 | Associated Electric Cooperative, Inc. | AECI | unchanged |
| 8 | NCR01219 | Duke Energy Carolinas, LLC | DEC | unchanged |
| 9 | NCR00063 | Duke Energy Florida, LLC | DEF | unchanged |
| 10 | NCR01298 | Duke Energy Progress, LLC | DEP | unchanged |
| 11 | NCR05140 | El Paso Electric Company | EPE | unchanged |
| 12 | NCR05191 | Idaho Power Company | IPCO | unchanged |
| 13 | NCR00040 | JEA | JEA | unchanged |
| 14 | NCR05282 | NorthWestern Corporation | NWE | unchanged |
| 15 | NCR05304 | PacifiCorp | PacifiCorp | unchanged |
| 16 | NCR05325 | Portland General Electric Company | PGE | unchanged |
| 17 | NCR05521 | Public Service Company of Colorado | PSCo | unchanged |
| 18 | NCR05333 | Public Service Company of New Mexico | PNM | unchanged |
| 19 | NCR05344 | Puget Sound Energy, Inc. | PSE | unchanged |
| 20 | NCR00074 | Tampa Electric Company | TECO | unchanged |

**Notes:** Queue flags `duplicate_label` / `nearby_label_collision` against retired seeds (expected; seeds drop when twins are geocoded). NCR05282/NCR01021 share `NWE` but are map-combined at one HQ dot.

### Batch 002 — orders 21–40 (2026-06-10)

ISO/RTO, federal power marketing, major IOU/co-op/muni utilities. One metadata gap filled; all labels verified.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 21 | NCR04056 | Electric Reliability Council of Texas, Inc. | ERCOT | unchanged |
| 22 | NCR00826 | Midcontinent Independent System Operator, Inc. | MISO | unchanged |
| 23 | NCR05048 | California Independent System Operator | CAISO | unchanged |
| 24 | NCR05382 | Seattle City Light | SCL | metadata added |
| 25 | NCR05032 | Bonneville Power Administration | BPA | unchanged |
| 26 | NCR01143 | Southwest Power Pool, Inc. | SPP | unchanged |
| 27 | NCR00992 | Great River Energy | GRE | unchanged |
| 28 | NCR01020 | Northern States Power (Xcel Energy) | NSP | unchanged |
| 29 | NCR05023 | Basin Electric Power Cooperative | BEPC | unchanged |
| 30 | NCR05368 | Sacramento Municipal Utility District | SMUD | unchanged |
| 31 | NCR00682 | American Electric Power Service Corporation… | AEP | unchanged |
| 32 | NCR01018 | Nebraska Public Power District | NPPD | unchanged |
| 33 | NCR01130 | Oklahoma Gas And Electric Co. | OG&E | unchanged |
| 34 | NCR00860 | Omaha Public Power District | OPPD | unchanged |
| 35 | NCR05299 | Pacific Gas and Electric Company | PG&E | unchanged |
| 36 | NCR05377 | San Diego Gas & Electric | SDG&E | unchanged |
| 37 | NCR05398 | Southern California Edison Company | SCE | unchanged |
| 38 | NCR01145 | Southwestern Public Service Co. (Xcel Energy) | SPS | unchanged |
| 39 | NCR01148 | Sunflower Electric Power Corporation | SECI | unchanged |
| 40 | NCR04037 | CPS Energy | CPS | unchanged |

**Notes:** NCR05023/NCR00102 share `BEPC` but are map-combined. NCR05382 metadata aligned with existing `SUP-seattle-city-light` entry.

### Batch 003 — orders 41–60 (2026-06-10)

Texas/muni/co-op utilities, USACE, Southern Company IOUs, merchant generators. Two label fixes; remainder verified.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 41 | NCR04049 | Denton Municipal Electric | DME | unchanged |
| 42 | NCR05126 | Deseret Generation & Transmission Co-operative | Deseret | unchanged |
| 43 | NCR05335 | Public Utility District No. 1 of Snohomish County | SnoPUD | unchanged |
| 44 | NCR10102 | Tri-State G&T — Transmission | TriState | unchanged |
| 45 | NCR00740 | Consumers Energy Company | CONS | unchanged |
| 46 | NCR00753 | DTE Electric Company | DTE | unchanged |
| 47 | NCR04015 | Brazos Electric Power Co Op, Inc. | Brazos | unchanged |
| 48 | NCR04029 | City of Austin dba Austin Energy | Austin | unchanged |
| 49 | NCR04033 | City of Garland | GP&L | unchanged |
| 50 | NCR04109 | Oncor Electric Delivery Company LLC | Oncor | unchanged |
| 51 | NCR04111 | Pedernales Elec Co Op Inc. | PEC | unchanged |
| 52 | NCR07161 | New York Power Authority | NYPA | unchanged |
| 53 | NCR00004 | Beaches Energy Services of Jacksonville Beach | Beaches | unchanged |
| 54 | NCR04088 | Kiowa Power Partners, LLC | Kiowa Power | KiowaPwr → Kiowa Power |
| 55 | NCR00978 | USACE - Omaha District | USACE OM | metadata added |
| 56 | NCR07163 | Niagara Mohawk Power Corporation | NiMo | unchanged |
| 57 | NCR01166 | Alabama Power Company | APC | unchanged |
| 58 | NCR01247 | Georgia Power Company | GPC | unchanged |
| 59 | NCR00006 | Calpine Corporation | Calpine | unchanged |
| 60 | NCR04136 | Tenaska Frontier Partners LTD | TenFront | unchanged |

**Notes:** NCR10102/NCR10030 share `TriState` (map-combined). NCR04136/NCR00632 share `TenFront` (map-combined). Combined member NCR01113 still has legacy `KiowaPwr` — fix when that row is reviewed.

### Batch 004 — orders 61–80 (2026-06-10)

Merchant peakers, Heritage portfolio sites, IOU acronyms. Replaced cryptic compressed labels with parent+site readable names.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 61 | NCR04137 | Tenaska Gateway Partners LTD | TenGate | unchanged |
| 62 | NCR08013 | Commonwealth Edison Company | ComEd | unchanged |
| 63 | NCR00896 | Public Service Electric & Gas Company | PSE&G | unchanged |
| 64 | NCR00690 | Big Sandy Peaker Plant, LLC | Big Sandy Peaker | BigSandy → Big Sandy Peaker |
| 65 | NCR11910 | Birdsboro Power LLC | Birdsboro Power | BirdsPwr → Birdsboro Power |
| 66 | NCR10382 | Castleton Power, LLC | Castleton | CastPwr → Castleton |
| 67 | NCR12393 | Heritage Mountain | Heritage Mountain | H Mtn → Heritage Mountain |
| 68 | NCR12395 | Heritage Portland | Heritage Portland | H Port → Heritage Portland |
| 69 | NCR12396 | Heritage Sayreville | Heritage Sayreville | H Sayr → Heritage Sayreville |
| 70 | NCR12397 | Heritage Shawville | Heritage Shawville | H Shaw → Heritage Shawville |
| 71 | NCR12398 | Heritage Titus | Heritage Titus | H Titus → Heritage Titus |
| 72 | NCR12399 | Heritage Tolna | Heritage Tolna | H Tolna → Heritage Tolna |
| 73 | NCR12390 | Heritage Brunot Island | Heritage Brunot | H Brunot → Heritage Brunot |
| 74 | NCR12391 | Heritage Gilbert | Heritage Gilbert | H Gilbrt → Heritage Gilbert |
| 75 | NCR12394 | Heritage New Castle | Heritage New Castle | H NewC → Heritage New Castle |
| 76 | NCR11141 | Heritage Single Units | Heritage Single | H SU → Heritage Single |
| 77 | NCR12133 | Hill Top Energy, LLC | Hill Top | unchanged |
| 78 | NCR11694 | Invenergy Services LLC | Inv Svc | unchanged |
| 79 | NCR13103 | JP Remote Operations Center I LLC | J-Power ROC I | J-Power → J-Power ROC I |
| 80 | NCR11126 | Kleen Energy Systems, LLC. | Kleen | metadata added |

**Notes:** Map-combined NAES GOP members (NCR00839, NCR11911, NCR11705, NCR12404, etc.) still carry legacy compressed labels — align when those rows are reviewed. NCR13074 still `J-Power`; should become `J-Power ROC II`.
