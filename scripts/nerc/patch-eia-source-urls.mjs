#!/usr/bin/env node
// Fill missing source_url on eia_861 geocodes via gridinfo slug probes and
// developer/portfolio rules. Idempotent: skips records that already have a URL.

import { readFileSync, writeFileSync } from "node:fs";

const GEO_PATH = "src/data/nerc/geocoded-orgs.json";

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[,.']/g, "")
    .replace(/\b(llc|l\.l\.c|lp|inc|corp|corporation|company|co|l\.p\.)\b/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractPlantId(notes) {
  const m =
    notes.match(/EIA(?:\s+plant)?\s+(\d{4,5})/i) ||
    notes.match(/plant\s+(?:ID\s+)?(\d{4,5})/i);
  if (m) return m[1];
  const m2 = notes.match(/\b(6[89]\d{3}|5[5-7]\d{3}|57\d{3})\b/);
  return m2?.[1] || null;
}

function extractCandidates(entity, notes) {
  const c = new Set([entity]);
  if (!notes) return [...c];
  for (const m of notes.matchAll(
    /(?:\d+(?:\.\d+)?\s*MW\s+)?([A-Z][A-Za-z0-9&'./\-\s]{2,45}?)(?:\s+(?:in|near|at|phase|BESS|Solar|Wind|Storage|Farm|Plant|Center|Project|Facility|County|TX|GA|CA|AZ|OR|NV|UT|NM|IL|NC|SC|MS))/g,
  )) {
    const t = m[1]
      .trim()
      .replace(/\s+(Solar|Wind|BESS|Storage|Energy|Power|Grid|County)$/i, "")
      .trim();
    if (t.length > 2 && t.length < 50 && !/^(EIA|GEM|NERC|RF|TRE|WECC|SERC|MRO|NPCC)$/i.test(t)) {
      c.add(t);
    }
  }
  for (const part of notes.split(";")) {
    const t = part.replace(/^\d+(?:\.\d+)?\s*MW\s+/, "").replace(/\s+in\s+.*/, "").trim();
    if (t.length > 3 && t.length < 55) c.add(t);
  }
  return [...c];
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    return r.status === 200 ? url : null;
  } catch {
    return null;
  }
}

async function findGridinfoUrl(cands) {
  for (const c of cands) {
    const slug = slugify(c);
    if (slug.length < 3) continue;
    for (const url of [
      `https://www.gridinfo.com/${slug}`,
      `https://www.gridinfo.com/${slug}-llc`,
      `https://www.gridinfo.com/plant/${slug}`,
    ]) {
      const ok = await headOk(url);
      if (ok) return ok;
    }
  }
  return null;
}

const GRIDINFO_PLANT_RE = /gridinfo\.com\/plant\/([^/]+)\/(\d{4,5})/;

function interconnectionCandidates(slug, pid) {
  const skip =
    /^(llc|inc|co|wind|solar|farm|project|energy|power|plant|station|center|hybrid|bess|i|ii|iii|iv|v|1|2|3|the|and|of|at|in)$/i;
  const parts = slug.split("-").filter((p) => p && !skip.test(p));
  const cands = new Set(["1", "2", "gen01", "pv1", "wt1", "bess", "gen1"]);
  if (parts.length) cands.add(parts.map((p) => p[0]).join("").slice(0, 5));
  for (const p of parts) {
    if (p.length >= 4) cands.add(p.slice(0, 4));
  }
  return [...cands].map((s) => `https://www.interconnection.fyi/eia/project/${pid}-${s}`);
}

async function findInterconnectionFromGridinfo(gridinfoUrl) {
  const m = gridinfoUrl.match(GRIDINFO_PLANT_RE);
  if (!m) return null;
  for (const url of interconnectionCandidates(m[1], m[2])) {
    const ok = await headOk(url);
    if (ok) return ok;
  }
  return null;
}

const seedUrls = {
  "NCR-SEED-012": "https://www.xcelenergy.com/",
  "NCR-SEED-018": "https://www.pnm.com/",
  "NCR-SEED-021": "https://www.duke-energy.com/progress",
  "NCR-SEED-023": "https://www.alabamapower.com/",
  "NCR-SEED-028": "https://www.duke-energy.com/florida",
  "NCR-SEED-035": "https://www.consumersenergy.com/",
  "NCR-SEED-037": "https://www.indianamichiganpower.com/",
  "NCR-SEED-038": "https://www.firstenergycorp.com/ohio_edison.html",
  "NCR-SEED-040": "https://www.nationalgridus.com/",
  "NCR-SEED-042": "https://www.xcelenergy.com/",
  "NCR-SEED-046": "https://www.xcelenergy.com/",
  "NCR-SEED-047": "https://www.oge.com/",
  "NCR-SEED-053": "https://www.aeptexas.com/",
};

/** Verified plant / interconnection citations (gridinfo, interconnection.fyi). */
const manualUrlPatches = {
  NCR12436: "https://www.interconnection.fyi/eia/project/66276-us620",
  NCR12157: "https://www.interconnection.fyi/eia/project/63737-chs01",
  NCR11267: "https://www.gridinfo.com/los-vientos-windpower-ia-llc",
  NCR11266: "https://www.gridinfo.com/los-vientos-windpower-ib-llc",
  NCR11591: "https://www.gridinfo.com/cameron-wind-i-llc",
  NCR11930: "https://www.gridinfo.com/fluvanna-wind-energy-2-llc",
  NCR12053: "https://www.gridinfo.com/heart-of-texas-wind-llc",
  NCR12317: "https://www.gridinfo.com/pisgah-ridge-solar-llc",
  NCR12263: "https://www.gridinfo.com/samson-solar-energy-iii-llc",
  NCR12195: "https://www.gridinfo.com/western-trail-wind-llc",
  NCR11544: "https://www.gridinfo.com/route-66-wind-power-llc",
  NCR00087: "https://www.gridinfo.com/mcadoo-wind-energy-llc",
  NCR11202: "https://www.gridinfo.com/signal-hill-generating-llc",
  NCR05124: "https://www.gridinfo.com/crockett-cogeneration-a-california-limited-partnership",
  NCR10027: "https://www.gridinfo.com/scurry-county-wind-lp",
  NCR11579: "https://www.gridinfo.com/south-plains-wind-energy-llc",
  NCR11974: "https://www.gridinfo.com/palmas-wind-llc",
  NCR11885: "https://www.gridinfo.com/lamesa-ii-solar-llc",
  NCR11906: "https://www.gridinfo.com/willow-springs-llc",
  NCR10072: "https://www.gridinfo.com/odyssey-energy-altura-cogen-llc",
  NCR13446: "https://origisenergy.com/project/wheatland-solar/",
  NCR13550: "https://origisenergy.com/project/walker-springs-ii-solar/",
  NCR13434: "https://www.interconnection.fyi/eia/project/68536-ms7-s",
  NCR13545: "https://www.interconnection.fyi/eia/projects/developer/Pineview%20Solar%2C%20LLC",
  NCR12516: "https://www.interconnection.fyi/eia/project/67721-alptr",
  NCR13418: "https://www.interconnection.fyi/eia/project/65493-torto",
  NCR13335: "https://www.interconnection.fyi/eia/project/69360-bays1",
  NCR12484: "https://www.interconnection.fyi/eia/project/66338-call1",
  NCR12541: "https://www.interconnection.fyi/eia/project/67738-citdl",
  NCR12407: "https://www.interconnection.fyi/eia/project/66170-1",
  NCR13067: "https://www.interconnection.fyi/eia/project/69407-3008",
  NCR13129: "https://www.interconnection.fyi/eia/project/68809-hl001",
  NCR12458: "https://www.interconnection.fyi/eia/project/66420-fwbat",
  NCR11976: "https://www.interconnection.fyi/eia/project/62448-lap",
  NCR13050: "https://www.interconnection.fyi/eia/project/67083-lbbes",
  NCR12309: "https://www.interconnection.fyi/eia/project/63757-mad01",
  NCR13228: "https://www.interconnection.fyi/eia/project/58048-1",
  NCR13232: "https://www.interconnection.fyi/eia/project/58537-1",
  NCR13544: "https://www.interconnection.fyi/eia/project/69044-plat",
  NCR12043: "https://www.interconnection.fyi/eia/project/62141-rmblr",
  NCR13077: "https://www.interconnection.fyi/eia/project/67737-smtir",
  NCR12411: "https://www.interconnection.fyi/eia/project/68896-sunvb",
  NCR12261: "https://www.interconnection.fyi/eia/project/66008-ba",
  NCR13233: "https://www.interconnection.fyi/eia/project/69026-tanz",
  NCR13231: "https://www.interconnection.fyi/eia/project/66337-sges1",
  NCR13393: "https://www.interconnection.fyi/eia/project/68748-ts",
  NCR12328: "https://www.vesperenergy.com/",
  NCR12158: "https://www.interconnection.fyi/project/ercot-18inr0062",
  NCR12539: "https://www.interconnection.fyi/eia/project/67739-widwh",
  NCR13542: "https://www.interconnection.fyi/eia/project/69152-wzrd",
  NCR12342: "https://www.interconnection.fyi/eia/project/66616-1",
  NCR13504: "https://www.interconnection.fyi/eia/project/69781-cw140",
  NCR11775: "https://www.interconnection.fyi/eia/project/59315-beac1",
  NCR13209: "https://www.interconnection.fyi/eia/project/58990-1",
  NCR12090: "https://www.interconnection.fyi/eia/project/62469-gen01",
  NCR12348: "https://www.interconnection.fyi/eia/project/61445-pv1",
  NCR13119: "https://www.interconnection.fyi/eia/project/66163-jicb1",
  NCR13212: "https://www.interconnection.fyi/eia/project/58991-1",
  NCR13246: "https://www.interconnection.fyi/eia/project/57816-mck1",
  NCR12320: "https://www.interconnection.fyi/eia/project/64032-mtsun",
  NCR13559: "https://www.interconnection.fyi/eia/project/67260-spd",
  NCR13503: "https://www.interconnection.fyi/eia/project/56012-1",
  NCR12522: "https://www.interconnection.fyi/eia/project/66574-sans",
};

const developerRules = [
  [/Jupiter Power|Crossett Power|St\. Gall/i, "https://www.jupiterpower.io/"],
  [/Plus Power|Ebony BESS/i, "https://pluspower.com/"],
  [/Acciona|La Chalupa|Fort Bend Solar/i, "https://www.acciona.com/"],
  [/Enbridge Solar|Orange Grove|Sequoia/i, "https://www.enbridge.com/"],
  [/Apex|Great Kiskadee/i, "https://www.apexcleanenergy.com/"],
  [/Tesla|Gambit|Giga Texas|GFTX/i, "https://www.tesla.com/"],
  [/Boralex|Spinning Spur/i, "https://www.boralex.com/"],
  [/Repsol|Hecate|Lighthouse|Frye Solar|Outpost/i, "https://www.repsol.com/"],
  [/Vesper|Hornet Solar/i, "https://www.vesperenergy.com/"],
  [/Spearmint|Seven Flags/i, "https://www.spearmintenergy.com/"],
  [/Strata|Justice BESS/i, "https://stratacleanenergy.com/"],
  [/TransGrid|Atlas IX|Atlas VII/i, "https://www.transgridenergy.com/"],
  [/Ormat|North Valley Geothermal/i, "https://www.ormat.com/"],
  [/Petra Nova/i, "https://www.nrg.com/"],
  [/Gregory Power/i, "https://www.nrg.com/"],
  [/Playa Solar|EDF RAH/i, "https://www.edf-re.com/"],
  [/KCE TX|Silicon Hill|Hummingbird Storage/i, "https://www.keycaptureenergy.com/"],
  [/BT Connolly|BT Cooke|BT Cunningham|BT Kellam|BT Smith/i, "https://www.brookfield.com/"],
  [/Shepherds Flat/i, "https://www.caithnessenergy.com/"],
  [/Colstrip|Rosebud Power/i, "https://www.colstripenergy.com/"],
  [/NTUA|Red Mesa Solar/i, "https://www.ntua.com/"],
  [/Tri-Dam|Beardsley/i, "https://www.tridamproject.com/"],
  [/Smoky Mountain|Tapoco/i, "https://www.brookfield.com/"],
  [/Arlington Valley|AVBA/i, "https://www.gridinfo.com/plant/arlington-valley/6006"],
  [/New Harquahala|HGBA/i, "https://www.gridinfo.com/plant/harquahala/6008"],
  [/Notrees/i, "https://www.gridinfo.com/plant/notrees-windpower/57246"],
  [/Sweetwater Wind/i, "https://www.gridinfo.com/plant/sweetwater-wind/57247"],
  [/Invenergy/i, "https://www.invenergy.com/"],
  [/Origis/i, "https://origisenergy.com/"],
  [/Silicon Ranch/i, "https://www.siliconranch.com/"],
  [/Cypress Creek|Cubico/i, "https://www.cypresscreek.com/"],
  [/NAES Corporation/i, "https://www.naes.com/"],
  [/Heritage/i, "https://www.nrg.com/"],
  [/Dominion IBR/i, "https://www.dominionenergy.com/"],
];

const data = JSON.parse(readFileSync(GEO_PATH, "utf8"));
let seedCount = 0;
let plantIdCount = 0;
let ruleCount = 0;
let probeCount = 0;

let manualCount = 0;
for (const o of data.orgs) {
  if (o.source_url) continue;
  const manual = manualUrlPatches[o.ncr_id];
  if (manual) {
    o.source_url = manual;
    manualCount++;
  }
}

for (const o of data.orgs) {
  if (o.source_url) continue;
  const seed = seedUrls[o.ncr_id];
  if (seed) {
    o.source_url = seed;
    seedCount++;
    continue;
  }
  const pid = extractPlantId(o.notes || "");
  if (pid && o.source === "eia_861") {
    o.source_url = `https://www.interconnection.fyi/eia/project/${pid}`;
    plantIdCount++;
    continue;
  }
  for (const [re, url] of developerRules) {
    if (re.test(o.notes || "") || re.test(o.entity_name || "")) {
      o.source_url = url;
      ruleCount++;
      break;
    }
  }
}

const todo = data.orgs.filter((o) => !o.source_url && o.source === "eia_861");
const CONC = 12;
for (let i = 0; i < todo.length; i += CONC) {
  const batch = todo.slice(i, i + CONC);
  await Promise.all(
    batch.map(async (o) => {
      if (o.source_url) return;
      const url = await findGridinfoUrl(extractCandidates(o.entity_name, o.notes));
      if (url) {
        o.source_url = url;
        probeCount++;
      }
    }),
  );
}

let upgradeCount = 0;
const gridinfoPlants = data.orgs.filter((o) => GRIDINFO_PLANT_RE.test(o.source_url || ""));
for (let i = 0; i < gridinfoPlants.length; i += CONC) {
  const batch = gridinfoPlants.slice(i, i + CONC);
  await Promise.all(
    batch.map(async (o) => {
      const ify = await findInterconnectionFromGridinfo(o.source_url);
      if (ify) {
        o.source_url = ify;
        upgradeCount++;
      }
    }),
  );
}

writeFileSync(GEO_PATH, JSON.stringify(data, null, 2) + "\n");
const still = data.orgs.filter((o) => !o.source_url).length;
console.log(
  `patch-eia-source-urls: +${manualCount} manual, +${seedCount} seeds, +${plantIdCount} plant IDs, +${ruleCount} rules, +${probeCount} gridinfo, +${upgradeCount} interconnection upgrades (${still} still missing)`,
);
