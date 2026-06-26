# Name review progress

Track short-name review batches against `src/data/nerc/name-queue.{jsonl,csv}`.
Standard: [docs/standards/name-shortest.md](../../docs/standards/name-shortest.md).
Editable names: `src/data/nerc/org-names.json`.

## Status

| Field | Value |
| --- | --- |
| Current status | IN PROGRESS |
| Last completed queue order | 260 |
| Next queue order | 261 |
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

### Batch 005 — orders 81–100 (2026-06-10)

LCRA/Luminant/MEAN utilities, merchant sites, supplemental DP twins, combined members. Metadata gaps filled; six supplemental entries added; one label fix.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 81 | NCR04093 | Lower Colorado River Authority | LCRA | metadata added |
| 82 | NCR10219 | Luminant Generation Company, LLC | Luminant | metadata added |
| 83 | NCR00303 | Municipal Energy Agency Of Nebraska | MEAN | metadata added |
| 84 | NCR10347 | Panoche Energy Center LLC | Panoche | metadata added |
| 85 | NCR13464 | QE Solar ROC | QE Solar | metadata added |
| 86 | NCR11367 | South Boston Energy LLC | South Boston | S Boston → South Boston |
| 87 | SUP-austin-energy | Austin Energy | Austin | entry added |
| 88 | SUP-bartow-electric-department | Bartow Electric Department | Bartow | entry added |
| 89 | NCR00003 | Bartow, City of | Bartow | metadata added |
| 90 | SUP-beaches-energy-services | Beaches Energy Services | Beaches | entry added |
| 91 | NCR01186 | Brazos Electric Power Cooperative, Inc. | Brazos | metadata added |
| 92 | SUP-city-of-vinton-electric-utility | City of Vinton Electric Utility | Vinton | entry added |
| 93 | SUP-pedernales-electric-cooperative | Pedernales Electric Cooperative | PEC | entry added |
| 94 | SUP-snohomish-county-public-utility-district | Snohomish County PUD | SnoPUD | entry added |
| 95 | SUP-vinton-public-power-authority | Vinton Public Power Authority | Vinton | unchanged |
| 96 | NCR10030 | Tri-State G&T — Reliability | TriState | unchanged |
| 97 | NCR00102 | Basin Electric Power Cooperative | BEPC | unchanged |
| 98 | NCR01021 | NorthWestern Energy Public Service | NWE | metadata added |
| 99 | NCR04006 | AEP Texas/PSO Agent | AEP | metadata added |
| 100 | NCR04091 | LCRA Transmission Services Corporation | LCRA | metadata added |

**Notes:** Panoche kept as site name (not inferred `PEC`, which collides with Pedernales). LCRA family shares `LCRA` at map-combined HQ.

### Batch 006 — orders 101–120 (2026-06-10)

Map-combined members and NAES GOP twins aligned to canonical labels from prior batches.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 101 | NCR11940 | Calpeak Power Panoche LLC | Panoche | unchanged |
| 102 | NCR01113 | Kiowa Power Partners, LLC | Kiowa Power | KiowaPwr → Kiowa Power |
| 103 | NCR11396 | Southern Power Company | Southern Power | metadata added |
| 104 | NCR00632 | Tenaska Frontier Partners, Ltd | TenFront | unchanged |
| 105 | NCR00633 | Tenaska Gateway Partners Ltd | TenGate | unchanged |
| 106 | NCR05537 | USACE - Omaha District | USACE OM | metadata added |
| 107 | NCR04034 | City of Garland | GP&L | unchanged |
| 108 | NCR04035 | City of Garland | GP&L | unchanged |
| 109 | NCR11718 | Invenergy Services LLC | Inv Svc | metadata added |
| 110 | NCR13074 | JP Remote Operations Center II LLC | J-Power ROC II | J-Power → J-Power ROC II |
| 111 | NCR04092 | Lower Colorado River Authority | LCRA | metadata added |
| 112 | NCR05256 | Municipal Energy Agency of Nebraska | MEAN | metadata added |
| 113 | NCR11518 | NAES - Panoche | Panoche | metadata added |
| 114 | NCR00839 | NAES Corporation - Big Sandy | Big Sandy Peaker | BigSandy → Big Sandy Peaker |
| 115 | NCR11911 | NAES Corporation - Birdsboro Power | Birdsboro Power | BirdsPwr → Birdsboro Power |
| 116 | NCR11705 | NAES Corporation - Castleton Power | Castleton | CastPwr → Castleton |
| 117 | NCR13061 | NAES Corporation - South Boston Energy | South Boston | S. Boston → South Boston |
| 118 | NCR12400 | NAES Corporation Heritage Brunot Island | Heritage Brunot | H Brunot → Heritage Brunot |
| 119 | NCR12401 | NAES Corporation Heritage Gilbert | Heritage Gilbert | H Gilbrt → Heritage Gilbert |
| 120 | NCR12404 | NAES Corporation Heritage Mountain | Heritage Mountain | H Mtn → Heritage Mountain |

**Notes:** Remaining Heritage NAES GOP members (NCR12403, NCR12405, etc.) still carry legacy compressed labels — align when those rows are reviewed.

### Batch 007 — orders 121–140 (2026-06-10)

Completed Heritage NAES GOP alignment, combined-member metadata, and retired-seed metadata backfill.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 121 | NCR12403 | NAES Corporation Heritage New Castle | Heritage New Castle | H NewC → Heritage New Castle |
| 122 | NCR12385 | NAES Corporation Heritage Portland | Heritage Portland | H Port → Heritage Portland |
| 123 | NCR12386 | NAES Corporation Heritage Sayreville | Heritage Sayreville | H Sayr → Heritage Sayreville |
| 124 | NCR12387 | NAES Corporation Heritage Shawville | Heritage Shawville | H Shaw → Heritage Shawville |
| 125 | NCR12405 | NAES Corporation Heritage Single Units | Heritage Single | H SU → Heritage Single |
| 126 | NCR12388 | NAES Corporation Heritage Titus | Heritage Titus | H Titus → Heritage Titus |
| 127 | NCR12389 | NAES Corporation Heritage Tolna | Heritage Tolna | H Tolna → Heritage Tolna |
| 128 | NCR12134 | NAES Corporation-Hill Top Energy | Hill Top | metadata added |
| 129 | NCR11127 | NAES Corporation-Kleen Energy Systems | Kleen | metadata added |
| 130 | NCR12507 | QE Solar, LLC | QE Solar | metadata added |
| 131 | NCR01322 | Southern Power Company | Southern Power | metadata added |
| 132 | NCR12021 | Southern Power Company | Southern Power | metadata added |
| 133 | NCR05456 | Wellhead Power Panoche, LLC | Panoche | metadata source updated |
| 134 | NCR-SEED-004 | Southwest Power Pool, Inc. | SPP | metadata added |
| 135 | NCR-SEED-002 | Midcontinent ISO | MISO | metadata added |
| 136 | NCR-SEED-001 | PJM Interconnection, LLC | PJM | metadata added |
| 137 | NCR-SEED-020 | Duke Energy Carolinas, LLC | DEC | metadata added |
| 138 | NCR-SEED-027 | Florida Power & Light Company | FPL | metadata added |
| 139 | NCR-SEED-003 | California ISO | CAISO | metadata added |
| 140 | NCR-SEED-007 | Electric Reliability Council of Texas | ERCOT | metadata added |

**Notes:** Heritage NAES GOP set now fully aligned with GO canonical labels. Retired seeds matched to geocoded twin metadata.

### Batch 008 — orders 141–160 (2026-06-10)

Retired-seed metadata backfill from geocoded twins. All labels verified unchanged; twelve seeds received `shortest_type`, `shortest_source`, and `shortest_source_url`.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 141 | NCR-SEED-005 | ISO New England Inc. | ISO-NE | metadata added |
| 142 | NCR-SEED-006 | New York Independent System Operator | NYISO | metadata added |
| 143 | NCR-SEED-025 | Tennessee Valley Authority | TVA | metadata added |
| 144 | NCR-SEED-054 | Bonneville Power Administration | BPA | metadata added |
| 145 | NCR-SEED-015 | PacifiCorp | PacifiCorp | metadata added |
| 146 | NCR-SEED-034 | DTE Electric Company | DTE | unchanged |
| 147 | NCR-SEED-028 | Duke Energy Florida, LLC | DEF | unchanged |
| 148 | NCR-SEED-021 | Duke Energy Progress, LLC | DEP | metadata added |
| 149 | NCR-SEED-014 | Idaho Power Company | IPCO | unchanged |
| 150 | NCR-SEED-018 | Public Service Company of New Mexico | PNM | metadata added |
| 151 | NCR-SEED-016 | Puget Sound Energy, Inc. | PSE | metadata added |
| 152 | NCR-SEED-046 | Southwestern Public Service Company | SPS | unchanged |
| 153 | NCR-SEED-030 | JEA | JEA | metadata added |
| 154 | NCR-SEED-045 | Omaha Public Power District | OPPD | unchanged |
| 155 | NCR-SEED-029 | Tampa Electric Company | TECO | metadata added |
| 156 | NCR-SEED-049 | Nebraska Public Power District | NPPD | unchanged |
| 157 | NCR-SEED-026 | Associated Electric Cooperative, Inc. | AECI | metadata added |
| 158 | NCR-SEED-059 | Sunflower Electric Power Corporation | SECI | unchanged |
| 159 | NCR-SEED-011 | Arizona Public Service Company | APS | metadata added |
| 160 | NCR-SEED-035 | Consumers Energy Company | CONS | unchanged |

**Notes:** All twenty are retired seeds aligned to geocoded twin labels. Seeds auto-drop from published map when twins are geocoded.

### Batch 009 — orders 161–180 (2026-06-10)

Retired-seed metadata backfill from geocoded twins. All labels verified unchanged; seven seeds received metadata.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 161 | NCR-SEED-042 | Northern States Power Company - Minnesota | NSP | metadata added |
| 162 | NCR-SEED-008 | Pacific Gas and Electric Company | PG&E | unchanged |
| 163 | NCR-SEED-017 | Portland General Electric Company | PGE | metadata added |
| 164 | NCR-SEED-012 | Public Service Company of Colorado | PSCo | metadata added |
| 165 | NCR-SEED-010 | San Diego Gas & Electric Company | SDG&E | unchanged |
| 166 | NCR-SEED-036 | American Electric Power Service Corporation | AEP | metadata added |
| 167 | NCR-SEED-009 | Southern California Edison Company | SCE | unchanged |
| 168 | NCR-SEED-056 | Tri-State Generation and Transmission Association, Inc. | TriState | unchanged |
| 169 | NCR-SEED-052 | Lower Colorado River Authority | LCRA | metadata added |
| 170 | NCR-SEED-041 | New York Power Authority | NYPA | unchanged |
| 171 | NCR-SEED-023 | Alabama Power Company | APC | unchanged |
| 172 | NCR-SEED-019 | El Paso Electric Company | EPE | metadata added |
| 173 | NCR-SEED-022 | Georgia Power Company | GPC | unchanged |
| 174 | NCR-SEED-047 | Oklahoma Gas and Electric Company | OG&E | unchanged |
| 175 | NCR-SEED-044 | Great River Energy | GRE | unchanged |
| 176 | NCR-SEED-060 | Deseret Generation & Transmission Co-operative | Deseret | unchanged |
| 177 | NCR-SEED-051 | CPS Energy | CPS | unchanged |
| 178 | NCR-SEED-050 | Oncor Electric Delivery Company LLC | Oncor | unchanged |
| 179 | NCR-SEED-033 | Commonwealth Edison Company | ComEd | metadata added |
| 180 | NCR-SEED-040 | Niagara Mohawk Power Corporation | NiMo | unchanged |

**Notes:** Completes remaining major IOU/ISO retired-seed metadata through NiMo. Next batch begins PSE&G seed and supplemental entries.

### Batch 010 — orders 181–200 (2026-06-10)

Retired-seed metadata, verified two-letter IOU/co-op aliases, and ten new supplemental entries. Replaced invented two-letter municipal codes with readable place/brand names.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 181 | NCR-SEED-032 | Public Service Electric and Gas Company | PSE&G | metadata added |
| 182 | NCR-SEED-058 | Calpine Corporation | Calpine | unchanged |
| 183 | NCR-SEED-057 | Luminant Generation Company LLC | Luminant | metadata added |
| 184 | SUP-cps-energy | CPS Energy | CPS | entry added |
| 185 | SUP-denton-municipal-electric | Denton Municipal Electric | DME | entry added |
| 186 | SUP-sacramento-municipal-utility-district | Sacramento Municipal Utility District | SMUD | entry added |
| 187 | SUP-seattle-city-light | Seattle City Light | SCL | unchanged |
| 188 | NCR01312 | South Carolina Public Service Authority | SC | metadata added |
| 189 | NCR00794 | Hoosier Energy REC, Inc. | HE | metadata added |
| 190 | NCR00674 | Minnesota Power (Allete, Inc.) | MP | metadata added |
| 191 | NCR11315 | FirstEnergy Utilities (agent) | FE | metadata added |
| 192 | NCR07222 | United Illuminating Company | UI | metadata added |
| 193 | SUP-riviera-utilities | Riviera Utilities | Riviera | RU → Riviera |
| 194 | SUP-scottsboro-electric-power-board | Scottsboro Electric Power Board | Scottsboro | SE → Scottsboro |
| 195 | SUP-sheffield-utilities | Sheffield Utilities | Sheffield | SU → Sheffield |
| 196 | SUP-sylacauga-utilities-board | Sylacauga Utilities Board | Sylacauga | SU → Sylacauga |
| 197 | SUP-twin-valleys-public-power-district | Twin Valleys Public Power District | Twin Valleys | TV → Twin Valleys |
| 198 | SUP-wake-electric | Wake Electric | Wake Electric | WE → Wake Electric |
| 199 | SUP-williamstown-utility-commission | Williamstown Utility Commission | Williamstown | WU → Williamstown |
| 200 | SUP-bryan-texas-utilities | Bryan Texas Utilities | BTU | BT → BTU |

**Notes:** SC/HE/MP/FE/UI verified via `area_aliases` or official/common-market evidence. Sheffield/Sylacauga collision resolved with place names. SUP Bryan aligned to geocoded twin NCR04022 (`BTU`).

### Batch 011 — orders 201–220 (2026-06-10)

Turlock SUP twin, Lubbock LP&L metadata, California CCAs, and Hawaii supplemental GO/RP records.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 201 | SUP-turlock-irrigation-district | Turlock Irrigation District | TID | TI → TID |
| 202 | NCR12106 | City of Lubbock / LP&L | LP&L | metadata added |
| 203 | SUP-ava-community-energy | Ava Community Energy | Ava Community | entry added |
| 204 | SUP-hawaii-state-energy-office | Hawaii State Energy Office | HSEO | entry added |
| 205 | SUP-hu-honua-bioenergy-llc | Hu Honua Bioenergy, LLC | Hu Honua | HH → Hu Honua |
| 206 | SUP-kaheawa-wind-power-llc | Kaheawa Wind Power, LLC | Kaheawa WF | entry added |
| 207 | SUP-kahuku-wind-power-llc | Kahuku Wind Power, LLC | Kahuku WF | entry added |
| 208 | SUP-kapaia-solar-llc | Kapaia Solar, LLC | Kapaia PV | entry added |
| 209 | SUP-kapolei-energy-storage-llc | Kapolei Energy Storage, LLC | Kapolei ES | entry added |
| 210 | SUP-kawailoa-wind-llc | Kawailoa Wind, LLC | Kawailoa WF | entry added |
| 211 | SUP-kuihelani-solar-plus-storage | Kuihelani Solar Plus Storage | Kuihelani | KHLN → Kuihelani |
| 212 | SUP-lawai-solar-and-energy-storage-project | Lawai Solar and Energy Storage Project | Lawai | entry added |
| 213 | SUP-marin-clean-energy | Marin Clean Energy | MCE | Marin Clean → MCE |
| 214 | SUP-orange-county-power-authority | Orange County Power Authority | OCPA | entry added |
| 215 | SUP-oriana-energy-llc | Oriana Energy LLC | Oriana | entry added |
| 216 | SUP-pakini-nui-wind-farm | Pakini Nui Wind Farm | Pakini Nui | PN → Pakini Nui |
| 217 | SUP-pattern-santa-isabel-llc | Pattern Santa Isabel, LLC | Pattern SI | Santa Isabel → Pattern SI |
| 218 | SUP-pico-rivera-innovative-municipal-energy | Pico Rivera Innovative Municipal Energy | PRIME | entry added |
| 219 | SUP-pomona-choice-energy | Pomona Choice Energy | PCE | entry added |
| 220 | SUP-puna-geothermal-venture | Puna Geothermal Venture | PGV | entry added |

**Notes:** LP&L kept as official acronym (`&` is brand punctuation, not a legal suffix). Hawaii wind/solar sites use WF/PV/ES asset suffixes where helpful. Marin uses official rebrand acronym MCE.

### Batch 012 — orders 221–240 (2026-06-10)

California CCAs, PR/VI generation sites, and Alaska/Appalachian supplemental DP utilities.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 221 | SUP-punta-lima-wind-farm-llc | Punta Lima Wind Farm, LLC | Punta Lima WF | PL → Punta Lima WF |
| 222 | SUP-rancho-mirage-energy-authority | Rancho Mirage Energy Authority | RMEA | entry added |
| 223 | SUP-redwood-coast-energy-authority | Redwood Coast Energy Authority | RCEA | entry added |
| 224 | SUP-san-fermin-solar-farm-llc | San Fermin Solar Farm, LLC | San Fermin PV | SF → San Fermin PV |
| 225 | SUP-san-jacinto-power | San Jacinto Power | SJP | entry added |
| 226 | SUP-san-jose-clean-energy | San Jose Clean Energy | SJCE | entry added |
| 227 | SUP-santa-barbara-clean-energy | Santa Barbara Clean Energy | SBCE | entry added |
| 228 | SUP-sonoma-clean-power-authority | Sonoma Clean Power Authority | SCP | Sonoma Clean → SCP |
| 229 | SUP-valley-clean-energy-alliance | Valley Clean Energy Alliance | VCE | entry added |
| 230 | SUP-vi-electron-llc | VI Electron, LLC | VI Electron | VLCTRN → VI Electron |
| 231 | SUP-western-community-energy | Western Community Energy | WCE | entry added |
| 232 | SUP-aes-hawaii-inc | AES Hawaii, Inc. | AES Hawaii | AH → AES Hawaii |
| 233 | SUP-alaska-electric-light-power-company | Alaska Electric Light & Power Company | AEL&P | entry added |
| 234 | SUP-alaska-energy-authority | Alaska Energy Authority | AEA | entry added |
| 235 | SUP-alaska-power-association | Alaska Power Association | APA | entry added |
| 236 | SUP-alaska-power-company | Alaska Power Company | Alaska Power | APC → Alaska Power |
| 237 | SUP-alaska-village-electric-cooperative-inc | Alaska Village Electric Cooperative, Inc. | AVEC | entry added |
| 238 | SUP-albemarle-emc | Albemarle EMC | AEMC | entry added |
| 239 | SUP-appalachian-power-company | Appalachian Power Company | APCo | entry added |
| 240 | SUP-barrow-utilities-and-electric-cooperative-inc | Barrow Utilities and Electric Cooperative, Inc. | BUECI | entry added |

**Notes:** Alaska Power Company avoids `APC` collision with Alabama Power (NCR01166). Sonoma uses official CCA acronym SCP. PR solar/wind sites use location + WF/PV suffixes.

### Batch 013 — orders 241–260 (2026-06-10)

Supplemental municipal/co-op DP utilities across TN, NC, KY, GA, FL, AL, AK, and TX.

| Order | NCR ID | Entity | Shortest | Action |
| ---: | --- | --- | --- | --- |
| 241 | SUP-bolivar-energy-authority | Bolivar Energy Authority | Bolivar | entry added |
| 242 | SUP-bowling-green-municipal-utilities | Bowling Green Municipal Utilities | BGMU | entry added |
| 243 | SUP-brightridge | BrightRidge | BrightRidge | BRGHTR → BrightRidge |
| 244 | SUP-bristol-tennessee-essential-services | Bristol Tennessee Essential Services | BTES | entry added |
| 245 | SUP-brunswick-electric | Brunswick Electric | BEMC | entry added |
| 246 | SUP-cape-hatteras-electric-cooperative | Cape Hatteras Electric Cooperative | CHEC | entry added |
| 247 | SUP-carteret-craven-electric-cooperative | Carteret-Craven Electric Cooperative | CCEC NC | CCEC → CCEC NC |
| 248 | SUP-cde-lightband | CDE Lightband | CDE | entry added |
| 249 | SUP-central-electric-membership-corporation | Central Electric Membership Corporation | CEMC | entry added |
| 250 | SUP-chattanooga-electric-power-board | Chattanooga Electric Power Board | EPB | entry added |
| 251 | SUP-chickamauga-electric-system | Chickamauga Electric System | Chickamauga | CHCKMG → Chickamauga |
| 252 | SUP-chugach-electric-association-inc | Chugach Electric Association, Inc. | CEA | entry added |
| 253 | SUP-city-of-acworth | City of Acworth | Acworth | entry added |
| 254 | SUP-city-of-adel | City of Adel | Adel | entry added |
| 255 | SUP-city-of-alachua | City of Alachua | Alachua | entry added |
| 256 | SUP-city-of-alcoa-electric-department | City of Alcoa Electric Department | Alcoa TN | Alcoa → Alcoa TN |
| 257 | SUP-city-of-athens-electric-department | City of Athens Electric Department | Athens AL | Athens → Athens AL |
| 258 | SUP-city-of-bardstown-electric-utility | City of Bardstown Electric Utility | Bardstown | BRDSTW → Bardstown |
| 259 | SUP-city-of-barnesville | City of Barnesville | Barnesville | BRNSVL → Barnesville |
| 260 | SUP-city-of-bellville | City of Bellville | Bellville | BLLVLL → Bellville |

**Notes:** Carteret-Craven uses `CCEC NC` to avoid Coleman County CCEC (NCR11804). Alcoa TN and Athens AL split collisions with NCR11791 and SUP-athens-utilities-board.
