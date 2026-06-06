#!/usr/bin/env node
// One-shot research batch: port seed display names to real NCR ids, add more
// names, upgrade thin geocodes, and fill supplemental acronyms.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../..", import.meta.url).pathname;

function loadJson(rel) {
  return JSON.parse(readFileSync(`${root}/${rel}`, "utf8"));
}
function saveJson(rel, data) {
  writeFileSync(`${root}/${rel}`, JSON.stringify(data, null, 2) + "\n");
}

// --- Display names: port from seed twins + high-priority real ids ---
const twins = loadJson("src/data/nerc/seed-twins.json").twins;
const orgNames = loadJson("src/data/nerc/org-names.json");
const nameById = new Map(orgNames.names.map((n) => [n.ncr_id, n]));
const geo = loadJson("src/data/nerc/geocoded-orgs.json").orgs;
const geoById = new Map(geo.map((g) => [g.ncr_id, g]));

const toAppend = [];

for (const [seed, realIds] of Object.entries(twins)) {
  const seedName = nameById.get(seed);
  if (!seedName) continue;
  for (const rid of realIds) {
    if (!geoById.has(rid) || nameById.has(rid)) continue;
    const g = geoById.get(rid);
    toAppend.push({
      ncr_id: rid,
      entity_name: g.entity_name,
      shortest: seedName.shortest,
      short: seedName.short,
      normal: seedName.normal,
      tier: seedName.tier,
    });
  }
}

const extraNames = [
  ["NCR01143", "SPP", "Southwest Power Pool", "Southwest Power Pool, Inc.", "major"],
  ["NCR07124", "ISO-NE", "ISO New England", "ISO-NE", "major"],
  ["NCR00024", "FPL", "Florida Power & Light", "Florida Power & Light Co.", "major"],
  ["NCR01145", "SPS", "Southwestern Public Service", "Southwestern Public Service Co.", "major"],
  ["NCR12287", "Dominion", "Dominion Energy Virginia", "Virginia Electric and Power Company", "major"],
  ["NCR10102", "Tri-State", "Tri-State G&T", "Tri-State Generation and Transmission", "major"],
  ["NCR10030", "Tri-State", "Tri-State G&T", "Tri-State Generation and Transmission", "major"],
  ["NCR00896", "PSE&G", "PSE&G", "Public Service Electric & Gas Company", "major"],
  ["NCR11315", "FE Trans", "FirstEnergy Transmission", "FirstEnergy Transmission", "major"],
  ["NCR04006", "AEP Texas", "AEP Texas", "AEP Texas Inc.", "major"],
  ["NCR10219", "Luminant", "Luminant Generation", "Luminant Generation Company, LLC", "normal"],
  ["NCR05372", "SRP", "Salt River Project", "Salt River Project", "major"],
  ["NCR05434", "TEP", "Tucson Electric Power", "Tucson Electric Power", "major"],
  ["NCR05435", "TID", "Turlock Irrigation District", "Turlock Irrigation District", "major"],
  ["NCR05338", "Chelan PUD", "Chelan County PUD", "Chelan County PUD No. 1", "major"],
  ["NCR05342", "Grant PUD", "Grant County PUD", "Grant County PUD No. 2", "major"],
  ["NCR05382", "SCL", "Seattle City Light", "Seattle City Light", "major"],
  ["NCR05461", "WAPA DSW", "WAPA Desert Southwest", "WAPA Desert Southwest Region", "major"],
  ["NCR05343", "Douglas PUD", "Douglas County PUD", "Douglas County PUD No. 1", "normal"],
  ["NCR05465", "WAPA SN", "WAPA Sierra Nevada", "WAPA Sierra Nevada Region", "major"],
  ["NCR05467", "WAPA UGP", "WAPA Upper Great Plains", "WAPA Upper Great Plains Region", "major"],
  ["NCR05368", "SMUD", "Sacramento Municipal Utility District", "SMUD", "major"],
  ["NCR05321", "PRPA", "Platte River Power Authority", "Platte River Power Authority", "normal"],
  ["NCR05335", "SnoPUD", "Snohomish County PUD", "Snohomish County PUD No. 1", "normal"],
  ["NCR05392", "SVP", "Silicon Valley Power", "Silicon Valley Power", "normal"],
  ["NCR05447", "VEA", "Valley Electric Association", "Valley Electric Association", "normal"],
  ["NCR01020", "Xcel", "Xcel Energy Minnesota", "Northern States Power (Xcel Energy)", "major"],
  ["NCR01130", "OG&E", "Oklahoma Gas & Electric", "Oklahoma Gas And Electric Co.", "major"],
  ["NCR00682", "AEP", "American Electric Power", "American Electric Power Service Corporation", "major"],
  ["NCR01319", "Southern Co.", "Southern Company Services - Gen", "Southern Company Services - Gen", "major"],
  ["NCR01320", "Southern Co.", "Southern Company Services - Trans", "Southern Company Services - Trans", "major"],
  ["NCR-SEED-013", "NV Energy", "Nevada Power Company", "Nevada Power Company", "major"],
  ["NCR-SEED-039", "CL&P", "Connecticut Light & Power", "The Connecticut Light and Power Company", "major"],
  ["NCR-SEED-048", "Evergy", "Evergy Kansas Central", "Evergy Kansas Central, Inc.", "major"],
  ["NCR-SEED-055", "WAPA", "Western Area Power Administration", "Western Area Power Administration", "major"],
  ["NCR05436", "UEC", "Umatilla Electric Cooperative", "Umatilla Electric Cooperative", "normal"],
  ["NCR05430", "TANC", "Transmission Agency of Northern California", "Transmission Agency of Northern California", "normal"],
  ["NCR03036", "Trans Bay", "Trans Bay Cable", "Trans Bay Cable LLC", "normal"],
  ["NCR05315", "Pend Oreille PUD", "Pend Oreille County PUD", "Pend Oreille County PUD No. 1", "normal"],
  ["NCR05334", "Clark PUD", "Clark County PUD", "Clark County PUD No. 1", "normal"],
  ["NCR05340", "Lewis PUD", "Lewis County PUD", "Lewis County PUD No. 1", "normal"],
  ["NCR05296", "Overton", "Overton Power District", "Overton Power District No. 5", "normal"],
  ["NCR11708", "Western Interconnect", "Western Interconnect", "Western Interconnect LLC", "normal"],
  ["NCR05445", "UAMPS", "Utah Associated Municipal Power Systems", "Utah Associated Municipal Power Systems", "normal"],
  ["NCR05522", "Whatcom PUD", "Whatcom County PUD", "Whatcom County PUD No. 1", "normal"],
  ["NCR13532", "SunZia", "SunZia Transmission", "SunZia Transmission, LLC", "normal"],
  ["NCR04030", "Austin Energy", "Austin Energy", "City of Austin dba Austin Energy", "major"],
  ["NCR10337", "Alliant", "Alliant Energy East", "Alliant Energy - East", "normal"],
  ["NCR-SEED-001", "PJM", "PJM", "PJM Interconnection", "major"],
  ["NCR-SEED-004", "SPP", "Southwest Power Pool", "Southwest Power Pool, Inc.", "major"],
  ["NCR-SEED-005", "ISO-NE", "ISO New England", "ISO New England Inc.", "major"],
  ["NCR-SEED-024", "Southern Co.", "Southern Company Services", "Southern Company Services, Inc.", "major"],
  ["NCR-SEED-027", "FPL", "Florida Power & Light", "Florida Power & Light Company", "major"],
  ["NCR-SEED-031", "Dominion", "Dominion Energy Virginia", "Virginia Electric and Power Company", "major"],
  ["NCR-SEED-032", "PSE&G", "PSE&G", "Public Service Electric and Gas Company", "major"],
  ["NCR-SEED-036", "AEP", "American Electric Power", "American Electric Power Service Corporation", "major"],
  ["NCR-SEED-037", "I&M", "Indiana Michigan Power", "Indiana Michigan Power Company", "normal"],
  ["NCR-SEED-038", "Ohio Edison", "Ohio Edison", "Ohio Edison Company", "normal"],
  ["NCR-SEED-042", "NSP", "Northern States Power", "Northern States Power Company - Minnesota", "major"],
  ["NCR-SEED-046", "SPS", "Southwestern Public Service", "Southwestern Public Service Company", "normal"],
  ["NCR-SEED-047", "OG&E", "Oklahoma Gas & Electric", "Oklahoma Gas and Electric Company", "major"],
  ["NCR-SEED-053", "AEP Texas", "AEP Texas", "AEP Texas Inc.", "major"],
  ["NCR-SEED-056", "Tri-State", "Tri-State G&T", "Tri-State Generation and Transmission Association, Inc.", "major"],
  ["NCR-SEED-057", "Luminant", "Luminant Generation", "Luminant Generation Company LLC", "normal"],
];

for (const [ncr_id, shortest, short, normal, tier] of extraNames) {
  if (nameById.has(ncr_id)) continue;
  const g = geoById.get(ncr_id);
  if (!g) continue;
  toAppend.push({ ncr_id, entity_name: g.entity_name, shortest, short, normal, tier });
}

let namesAdded = 0;
for (const entry of toAppend) {
  if (nameById.has(entry.ncr_id)) continue;
  orgNames.names.push(entry);
  nameById.set(entry.ncr_id, entry);
  namesAdded++;
}
saveJson("src/data/nerc/org-names.json", orgNames);
console.log(`org-names: +${namesAdded} entries (${orgNames.names.length} total)`);

// --- Geocode upgrades ---
const geoPatches = {
  NCR12410: {
    lat: 29.7539,
    lng: -95.3648,
    city: "Houston",
    state: "TX",
    headquarters_address: "Houston Performance Center (remote GOP operations hub)",
    confidence: "MEDIUM",
    source: "official_website",
    source_url: "https://ethosenergy.com/our-locations/performance-center",
    notes: "EthosEnergy remote operations/monitoring center in Houston; GOP registration HQ.",
  },
  NCR11639: {
    lat: 42.2524,
    lng: -73.7849,
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.nytransco.com/",
    notes: "HQ at One Hudson City Centre, Suite 300, Hudson NY 12534.",
  },
  NCR01322: {
    lat: 33.7687,
    lng: -84.3953,
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.southerncompany.com/",
    notes: "Southern Power merchant generation HQ at Southern Company, 30 Ivan Allen Jr Blvd NW, Atlanta.",
  },
  NCR07037: {
    lat: 41.482,
    lng: -72.0875,
    headquarters_address: "13 Crow Hill Road, Uncasville, CT 06382",
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.mohegan.nsn.us/resources/connect-with-us/contact",
    notes: "Mohegan Tribal Utility Authority at Mohegan Community & Government Center.",
  },
  NCR13376: {
    lat: 41.071,
    lng: -75.314,
    confidence: "MEDIUM",
    source: "state_puc",
    source_url: "https://www.pa.gov/agencies/dep/about-dep/regional-office-locations/northeast-regional-office/northeast-community-information/swiftwater-solar.html",
    notes: "80 MW Apex/Vitol solar on Bear Mountain, Pocono Township, Monroe County PA.",
  },
  NCR13288: {
    lat: 32.085,
    lng: -98.34,
    confidence: "MEDIUM",
    source: "eia_860",
    source_url: "https://www.interconnection.fyi/project/ercot-24inr0295",
    notes: "101 MW BESS Erath County TX on CR 300/299 near Dublin; ERCOT 24INR0295.",
  },
  NCR13270: {
    lat: 29.979,
    lng: -95.943,
    confidence: "HIGH",
    source: "eia_860",
    source_url: "https://www.interconnection.fyi/eia/project/69320-par1",
    notes: "640 MWdc Parliament Solar EIA plant 69320, Waller County TX.",
  },
  NCR13537: {
    lat: 33.155,
    lng: -98.385,
    confidence: "MEDIUM",
    source: "state_puc",
    notes: "825 MW Pinnington Solar Jack County TX near Bryson (approximate county seat coords).",
  },
  NCR13319: {
    lat: 29.6948,
    lng: -95.0406,
    city: "La Porte",
    headquarters_address: "845 Sens Road, La Porte, TX 77571",
    confidence: "HIGH",
    source: "eia_860",
    source_url: "https://www.gridinfo.com/plant/san-jacinto-steam-electric-station/7325",
    notes: "San Jacinto Steam Electric Station (NRG); EIA plant 7325.",
  },
  NCR12344: {
    lat: 31.508,
    lng: -96.934,
    confidence: "MEDIUM",
    source: "parent_company_inference",
    source_url: "https://www.gridinfo.com/",
    notes: "GOP at Sandy Creek Energy Station, 2161 Rattlesnake Rd, Riesel TX.",
  },
  NCR12357: {
    lat: 41.3937,
    lng: -81.6287,
    city: "Cleveland",
    state: "OH",
    headquarters_address: null,
    confidence: "LOW",
    source: "nerc_cores",
    source_url: "https://www.rfirst.org/inverter-based-resource-registration-initiative/",
    notes:
      "RF Category-2 IBR GO/GOP (effective 2023-08-15); NERC Compliance Registry only. Generator asset not identified — map pin at ReliabilityFirst regional office, not plant site.",
  },
  NCR13461: {
    lat: 33.3596,
    lng: -103.2506,
    city: "Tatum",
    state: "NM",
    headquarters_address: "Sterling I Wind Farm, Tatum, NM 88267",
    confidence: "HIGH",
    source: "eia_861",
    source_url: "https://www.interconnection.fyi/eia/project/60991-ster1",
    notes:
      "29.9 MW Sterling I Wind Farm (EIA plant 60991), Lea County NM; Akuo/Masdar. EIA-861 mailing address Chicago IL.",
  },
  NCR13355: {
    confidence: "HIGH",
    source_url: "https://www.interconnection.fyi/eia/project/57568-rhw",
    notes:
      "50.6 MW Record Hill Wind (EIA plant 57568), Oxford County ME; 22 Siemens 2.3 MW turbines, COD January 2012.",
  },
};

const officialUrlPatches = {
  NCR01018: "https://www.nppd.com/",
  NCR04167: "https://www.energy.gov/",
  NCR11498: "https://uppermichiganenergy.com/",
  NCR00070: "https://www.energy.gov/sepa/quick-facts",
  NCR04006: "https://www.aep.com/",
  NCR11118: "https://thebanc.org/",
  NCR10395: "https://www.bhemontana.com/about-us/",
  NCR11382: "https://www.bhemontana.com/about-us/",
  NCR13518: "https://americas.rwe.com/",
  NCR11383: "https://americas.rwe.com/",
  NCR12020: "https://www.lspowergrid.com/utilities/silver-run-electric/",
  NCR11925: "https://www.transourceenergy.com/",
  NCR12310: "https://www.boralex.com/",
  NCR11915: "https://depcompower.com/",
  NCR11393: "https://gridforce.com/",
  NCR01305:
    "https://sratx.org/sra-offices/toledo-bend-project-joint-operation/toledo-bend-project/",
  NCR13474: "https://stratacleanenergy.com/",
  NCR12007: "https://sunenergy1.com/",
  NCR03043: "https://www.tva.com/",
  NCR12304: "https://origisenergy.com/project/skyhawk-solar/",
  NCR12012: "https://www.veolia.com/en",
  NCR12491:
    "https://www.entergynewsroom.com/news/entergy-arkansas-plans-fourth-solar-generation-resource-walnut-bend-near-brinkley/",
  NCR11790: "https://www.cvec.coop/",
  NCR13036: "https://esvolta.com/",
  NCR04074:
    "https://www.lcra.org/energy/electric-power/facilities/lost-pines-1-power-project/",
  NCR12433: "https://www.qcells.com/us/",
  NCR11392: "https://www.ibwc.gov/",
  NCR12412: "https://www.pearceservices.com/",
  NCR12098: "https://www.proenergyservices.com/",
  NCR12282: "https://www.siemens-energy.com/",
  NCR12275: "https://www.sparkpowercorp.com/",
  NCR11456: "https://www.tmpa.com/",
  NCR04156: "https://www.swt.usace.army.mil/",
  NCR13109: "https://viridity.ormat.com/en/home/a/main/",
  NCR13494: "https://www.ameresco.com/",
  NCR13173: "https://www.gridinfo.com/plant/black-hollow-sun/64745",
  NCR13106: "https://www.gridinfo.com/cald-bess-llc",
  NCR13273: "https://www.cat.com/en_US/by-industry/oil-and-gas.html",
  NCR05074: "https://www.coltonca.gov/175/Electric-Utility",
  NCR13236: "https://www.fractalems.com/",
  NCR05505: "https://www.krcd.org/",
  NCR05256: "https://www.nppd.com/mean",
  NCR12372: "https://www.bpa.gov/transmission/transmission-system/high-voltage-lines",
};

const seedUpgrades = {
  "NCR-SEED-013": {
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.nvenergy.com/about-nvenergy/contact-us",
    notes:
      "NV Energy (Nevada Power Company) corporate HQ 6226 W Sahara Ave Las Vegas; SEC 10-K business address.",
  },
  "NCR-SEED-039": {
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.eversource.com/content/residential/about/contact-us",
    city: "Berlin",
    notes: "Eversource Energy (CL&P) corporate office 107 Selden St Berlin CT.",
  },
  "NCR-SEED-048": {
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.evergy.com/about-us/contact-us",
    notes:
      "Evergy Kansas Central (formerly Westar) corporate HQ 818 S Kansas Ave Topeka KS.",
  },
  "NCR-SEED-055": {
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.wapa.gov/about/contact/",
    notes: "WAPA Headquarters 12155 W Alameda Pkwy Lakewood CO.",
  },
  "NCR-SEED-059": {
    lat: 38.875,
    lng: -99.3327,
    headquarters_address: "301 West 13th Street, Hays, KS 67601",
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://www.sunflower.net/contact-us",
    acronym: "Sunflower",
    acronym_source: "official_website",
    notes: "G&T cooperative HQ in historic former hospital building downtown Hays. Twin: NCR01148.",
  },
  "NCR-SEED-060": {
    lat: 40.5561,
    lng: -111.9033,
    headquarters_address: "10714 South Jordan Gateway, Suite 300, South Jordan, UT 84095",
    city: "South Jordan",
    confidence: "HIGH",
    source: "official_website",
    source_url: "https://apps.deseretpower.com/",
    acronym: "Deseret Power",
    acronym_source: "official_website",
    notes: "Deseret G&T cooperative HQ South Jordan UT. Twin: NCR05126.",
  },
};

const sourceUrlPatches = {
  NCR05002: "https://www.gridinfo.com/plant/aes-alamitos-llc/315",
  NCR05004: "https://www.gridinfo.com/plant/aes-huntington-beach-llc/314",
  NCR11209: "https://www.gridinfo.com/plant/agua-caliente-solar-project/57373",
  NCR12477: "https://www.gridinfo.com/plant/bigbeau-solar-llc/64993",
  NCR13322: "https://www.gridinfo.com/plant/bison-solar-llc/60351",
  NCR11433: "https://www.gridinfo.com/plant/blythe-energy-inc/55295",
  NCR12466: "https://www.gridinfo.com/plant/blythe-mesa-solar-ii/65053",
  NCR13064: "https://brightnightpower.com/what-we-do/our-projects/box-canyon/",
  NCR12544: "https://www.gridinfo.com/plant/boswell-wind/65403",
  NCR13183: "https://www.gridinfo.com/plant/boulder-solar-ii-llc/60885",
  NCR13310: "https://www.gridinfo.com/plant/britton-solar-energy-center/63579",
  NCR10195: "https://www.gridinfo.com/plant/brush-generation-facility/10682",
  NCR05039: "https://www.gridinfo.com/plant/burney-forest-products/10652",
  NCR13017: "https://fengate.com/news/fengate-and-alpha-omega-power-start-operations-at-caballero-battery-energy-storage-system",
  NCR11940: "https://www.gridinfo.com/plant/calpeak-power-panoche-peaker-plant/55508",
  NCR11941: "https://www.gridinfo.com/plant/calpeak-power-vaca-dixon-peaker-plant/55499",
  NCR13188: "https://www.interconnection.fyi/eia/project/61801-10002",
  NCR13030: "https://www.gridinfo.com/plant/chestnut/63849",
  NCR13202: "https://www.gridinfo.com/plant/castle-solar-llc/64740",
  NCR11680: "https://www.gridinfo.com/plant/catalina-solar-2-llc/59334",
  NCR11161: "https://www.gridinfo.com/plant/cedar-creek-ii/57210",
  NCR10165: "https://www.gridinfo.com/plant/cedar-creek-wind/56371",
  NCR11271: "https://www.gridinfo.com/plant/cedar-point-wind/57315",
  NCR11431: "https://www.gridinfo.com/plant/centinela-solar-energy/58430",
  NCR13381: "https://www.gridinfo.com/plant/central-40/63940",
  NCR13369: "https://www.gridinfo.com/plant/chopin-wind-llc/59076",
};

const evidenceUrlPatches = {
  "NCR-SEED-010": "https://www.sdge.com/",
  "NCR-SEED-016": "https://www.pse.com/",
  "NCR-SEED-017": "https://www.portlandgeneral.com/",
  "NCR-SEED-019": "https://www.epelectric.com/",
  "NCR-SEED-026": "https://www.aeci.org/",
  "NCR-SEED-029": "https://www.tampaelectric.com/",
  "NCR-SEED-030": "https://www.jea.com/",
  "NCR-SEED-044": "https://www.greatriverenergy.com/",
  "NCR-SEED-045": "https://www.oppd.com/",
  "NCR-SEED-049": "https://www.nppd.com/",
  "NCR-SEED-051": "https://www.cpsenergy.com/",
  "NCR-SEED-052": "https://www.lcra.org/",
  "NCR-SEED-056": "https://www.tristate.coop/",
  "NCR-SEED-057": "https://www.luminant.com/",
  "NCR-SEED-058": "https://www.calpine.com/",
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
  NCR00860: "https://www.oppd.com/",
  NCR13287: "https://www.interconnection.fyi/project/ercot-24inr0315",
  NCR11871: "https://www.genon.com/",
  NCR11362: "https://www.talenenergy.com/",
  NCR12287: "https://www.dominionenergy.com/",
  NCR13506: "https://www.apple.com/environment/",
  NCR00025: "https://www.fpuc.com/",
  NCR10090: "https://www.nrg.com/",
  NCR11411: "https://www.barrick.com/",
  NCR11149: "https://www.genon.com/",
  NCR11521: "https://www.ormat.com/en/projects/mcginness-hills/",
  NCR11881: "https://www.ormat.com/en/projects/mcginness-hills/",
  NCR11839: "https://www.ormat.com/en/projects/tungsten-mountain/",
  NCR12278: "https://www.duke-energy.com/",
  NCR13044: "https://first-lightenergy.com/",
  NCR05281: "https://www.nwpp.org/",
  NCR10390: "https://www.constellationenergy.com/",
  NCR11325: "https://www.constellationenergy.com/",
  NCR11167: "https://www.entergy.com/",
  NCR12526: "https://www.entergy.com/",
  NCR00023: "https://www.fmpa.org/",
  NCR06050: "https://www.mdea.com/",
  NCR13305: "https://www.siliconranch.com/",
  NCR13048: "https://www.interconnection.fyi/eia/project/68145-angso",
  NCR13086: "https://www.interconnection.fyi/eia/project/68146",
  NCR13043: "https://www.interconnection.fyi/eia/project/68180",
  NCR12560: "https://www.interconnection.fyi/eia/project/68189",
  NCR11694: "https://www.invenergy.com/",
  NCR13103: "https://www.jpowerusa.com/",
  NCR11463: "https://www.terra-gen.com/power/mojave/",
  NCR13464: "https://www.qcells.com/us/",
  NCR12156: "https://www.res-group.com/",
  NCR12469: "https://www.res-group.com/",
  NCR13127: "https://www.res-group.com/",
  NCR13538: "https://www.res-group.com/",
  NCR12025: "https://www.lspower.com/projects/ten-west-link/",
  NCR11518: "https://www.naes.com/",
  NCR12159: "https://www.naes.com/",
  NCR11306: "https://www.naes.com/",
  NCR11104: "https://www.naes.com/",
  NCR11929: "https://www.naes.com/",
  NCR11589: "https://www.naes.com/",
  NCR11590: "https://www.naes.com/",
  NCR11928: "https://www.naes.com/",
  NCR00418: "https://www.naes.com/",
  NCR11854: "https://www.nrg.com/",
  NCR05141: "https://www.nrg.com/",
  NCR11150: "https://www.nrg.com/",
  NCR11148: "https://www.nrg.com/",
  NCR13514: "https://www.standardsolar.com/",
  NCR12142: "https://www.terra-gen.com/",
  NCR11715: "https://www.nrg.com/",
  NCR09001: "https://www.entergy.com/",
  NCR09008: "https://www.dow.com/en-us",
  NCR09037: "https://www.dow.com/en-us",
  NCR11166: "https://www.entergy.com/",
  NCR00464: "https://www.frcc.com/",
  NCR01365: "https://www.duke-energy.com/",
  NCR13089: "https://www.gridinfo.com/texas/eagle-pass",
  NCR00339: "https://www.pacificorp.com/",
  NCR13009: "https://www.tenwestlink.com/",
  NCR11531: "https://www.sempra.com/",
  NCR12187: "https://www.highdesertpower.com/",
  NCR13039: "https://copiapower.com/",
  NCR11103: "https://www.idahopower.com/our-environmental-commitment/renewable-energy/",
  NCR11360: "https://www.matl.ca/",
  NCR13156: "https://www.zglobal.com/",
  NCR11708: "https://patternenergy.com/",
  NCR12540: "https://www.interconnection.fyi/eia/project/66420",
  NCR13383: "https://www.gridinfo.com/pome-bess-llc",
  NCR13347: "https://www.cpcmd.org/",
  NCR13519: "https://www.cpcmd.org/",
  NCR12045: "https://www.nexteraenergy.com/",
  NCR12027: "https://www.republictransmission.com/",
  NCR13283: "https://www.cpcmd.org/",
  NCR08073: "https://www.hamilton-oh.gov/",
  NCR11867: "https://www.cypresscreek.com/",
  NCR10054: "https://www.swa.org/",
  NCR01139: "https://www.yazoo.ms/",
  NCR10189: "https://www.san-marcos.net/",
  NCR04110: "https://www.oxy.com/",
  NCR13537: "https://www.cpcmd.org/",
  NCR13500: "https://www.cpcmd.org/",
  NCR12521: "https://www.cpcmd.org/",
  NCR00086: "https://www.bkidd.org/",
  NCR11801: "https://www.californiaflats.com/",
  NCR13501: "https://www.cpcmd.org/",
  NCR13553: "https://www.gridinfo.com/plant/hummingbird/65395",
  NCR05213: "https://www.cpcmd.org/",
  NCR13015: "https://www.lspower.com/",
  NCR13499: "https://www.cpcmd.org/",
  NCR13261: "https://www.cpcmd.org/",
  NCR13251: "https://www.bherenewables.com/solar-star/",
};

const seedAcronymPatches = {
  "NCR-SEED-013": {
    acronym: "NV Energy",
    acronym_source: "common_market_name",
    source_url: "https://www.nvenergy.com/",
  },
  "NCR-SEED-039": {
    acronym: "CL&P",
    acronym_source: "common_market_name",
    source_url: "https://www.eversource.com/",
  },
  "NCR-SEED-048": {
    acronym: "Evergy",
    acronym_source: "common_market_name",
    source_url: "https://www.evergy.com/",
  },
  "NCR-SEED-055": {
    acronym: "WAPA",
    acronym_source: "common_market_name",
    source_url: "https://www.wapa.gov/",
  },
};

let geoUpdated = 0;
let sourceUrlsAdded = 0;
for (const o of geo) {
  const patch = geoPatches[o.ncr_id];
  if (patch) {
    Object.assign(o, patch);
    geoUpdated++;
  }
  const url = sourceUrlPatches[o.ncr_id];
  if (url && !o.source_url) {
    o.source_url = url;
    sourceUrlsAdded++;
  }
  const official = officialUrlPatches[o.ncr_id];
  if (official && !o.source_url) {
    o.source_url = official;
    sourceUrlsAdded++;
  }
  const evidence = evidenceUrlPatches[o.ncr_id];
  if (evidence && !o.source_url) {
    o.source_url = evidence;
    sourceUrlsAdded++;
  }
  const seedUpgrade = seedUpgrades[o.ncr_id];
  if (seedUpgrade) Object.assign(o, seedUpgrade);
  const seed = seedAcronymPatches[o.ncr_id];
  if (seed && !o.acronym) Object.assign(o, seed);
  if (o.ncr_id.startsWith("NCR-SEED-") && !o.acronym) {
    const nm = nameById.get(o.ncr_id);
    if (nm?.shortest) {
      o.acronym = nm.shortest;
      o.acronym_source = "common_market_name";
    }
  }
}
let seedAcronymsAdded = geo.filter(
  (o) => o.ncr_id.startsWith("NCR-SEED-") && o.acronym,
).length;
saveJson("src/data/nerc/geocoded-orgs.json", { orgs: geo });
console.log(
  `geocoded-orgs: upgraded ${geoUpdated} records, +${sourceUrlsAdded} source URLs, ${seedAcronymsAdded} seeds with acronyms`,
);

// --- Supplemental acronyms (Alaska co-ops, territories, Hawaii IOUs) ---
const supAcronyms = {
  "Alaska Electric Light & Power Company": "AEL&P",
  "Alaska Energy Authority": "AEA",
  "Alaska Power Company": "APC",
  "Alaska Village Electric Cooperative, Inc.": "AVEC",
  "Chugach Electric Association, Inc.": "CEA",
  "City of Bethel Public Works - Electric Utility": "Bethel",
  "City of Dillingham Electric Utility": "Dillingham",
  "City of King Cove Electric Department": "King Cove",
  "City of Seward Electric System": "Seward",
  "City of Unalaska Department of Public Utilities": "Unalaska",
  "City of Valdez Electric Utility": "Valdez",
  "Copper Valley Electric Association, Inc.": "CVEA",
  "Cordova Electric Cooperative": "Cordova",
  "Golden Valley Electric Association, Inc.": "GVEA",
  "Homer Electric Association, Inc.": "HEA",
  "Ketchikan Public Utilities - Electric Division": "KPU",
  "Kodiak Electric Association, Inc.": "KEA",
  "Kotzebue Electric Association": "KEA-K",
  "Matanuska Electric Association, Inc.": "MEA",
  "Naknek Electric Association, Inc.": "Naknek",
  "VI Electron, LLC": "VI Electron",
  "Virgin Islands Water and Power Authority": "VI WAPA",
  "Wartsila Virgin Islands Project Entity": "Wartsila VI",
  "Puerto Rico Electric Power Authority": "PREPA",
  "Hawaiian Electric Company, Inc.": "HECO",
  "Hawaii Electric Light Company, Inc.": "HELCO",
  "Maui Electric Company, Limited": "MECO",
  "Kauai Island Utility Cooperative": "KIUC",
  "AES Hawaii, Inc.": "AES Hawaii",
  "Hamakua Energy, LLC": "Hamakua",
  "Hu Honua Bioenergy, LLC": "Hu Honua",
  "Puna Geothermal Venture": "PGV",
  "Nome Joint Utility System": "NJUS",
  "Nushagak Electric & Telephone Cooperative, Inc.": "NET",
  "Pelican Utility Company": "Pelican",
  "Petersburg Municipal Power & Light": "PMP&L",
  "Railbelt Reliability Council": "RRC",
  "Sitka Electric Department": "Sitka",
  "Wrangell Municipal Light & Power": "Wrangell",
  "Yakutat Power, Inc.": "Yakutat",
  "Sacramento Municipal Utility District": "SMUD",
  "Snohomish County Public Utility District": "SnoPUD",
  "Pedernales Electric Cooperative": "PEC",
  "Denton Municipal Electric": "DME",
  "Hawaiian Electric Industries, Inc.": "HEI",
  "Pacific Current, LLC": "Pacific Current",
};

const supplemental = loadJson("src/data/nerc/supplemental-orgs.json");
let supUpdated = 0;

function inferSupAcronym(name, orgType) {
  const n = String(name);
  let m = n.match(/^City of ([^,]+)/i);
  if (m) return m[1].replace(/\s+(Electric|Public Works|Department).*$/i, "").trim();
  m = n.match(/^Borough of ([^,]+)/i);
  if (m) return m[1].trim();
  m = n.match(/^Town of ([^,]+)/i);
  if (m) return m[1].trim();
  if (/Electric Cooperative|Electric Association|EMC\b/i.test(n)) {
    const words = n.replace(/,?\s*(Inc\.?|LLC|L\.P\.?|Co\.?)$/i, "").split(/\s+/);
    const sig = words.filter((w) => !/^(the|of|and|electric|cooperative|association|company|power|district|public|utility|utilities|incorporated)$/i.test(w));
    if (sig.length >= 2) return sig.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
    if (sig.length === 1) return sig[0].slice(0, 8);
  }
  if (orgType === "municipal" && /Municipal|PUD|Public Utility District/i.test(n)) {
    const short = n.replace(/Public Utility District No\.?\s*\d+\s+of\s+/i, "").replace(/,?\s*(Washington|Inc\.?)$/i, "").trim();
    if (short.length <= 14) return short;
    return short.split(/\s+/).slice(0, 2).join(" ");
  }
  m = n.match(/^([^,]+?)\s+(Wind|Solar|Energy|Power|Storage|Bioenergy|Geothermal)/i);
  if (m && m[1].length <= 16) return m[1].trim();
  const brand = n.replace(/,?\s*(Inc\.?|LLC|L\.P\.?|Company|Corporation|Limited)$/i, "").trim();
  if (brand.length <= 12) return brand;
  const parts = brand.split(/\s+/).filter((w) => w.length > 2 && !/^(the|of|and)$/i.test(w));
  if (parts.length >= 2) return parts.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return parts[0]?.slice(0, 10) ?? brand.slice(0, 10);
}

for (const o of supplemental) {
  if (o.acronym) continue;
  const ac = supAcronyms[o.entity_name] ?? inferSupAcronym(o.entity_name, o.org_type);
  if (!ac) continue;
  o.acronym = ac;
  supUpdated++;
}

const GENERIC_FERC = "https://www.ferc.gov/reliability-explainer";

/** Replace placeholder FERC explainer links on Alaska/Hawaii supplemental orgs. */
const supSourceUrlPatches = {
  "Alaska Electric Light & Power Company": "https://www.aelp.com/",
  "Alaska Energy Authority": "https://www.akenergyauthority.org/",
  "Alaska Power Association": "https://alaskapower.org/",
  "Alaska Power Company": "https://www.alaskapower.com/",
  "Alaska Village Electric Cooperative, Inc.": "https://www.avec.org/",
  "Barrow Utilities and Electric Cooperative, Inc.": "https://www.bueci.org/",
  "Chugach Electric Association, Inc.": "https://www.chugachelectric.com/",
  "City of Bethel Public Works - Electric Utility": "https://www.cityofbethel.org/",
  "City of Dillingham Electric Utility": "https://www.dillinghamak.us/",
  "City of King Cove Electric Department": "https://www.cityofkingcove.com/",
  "City of Seward Electric System": "https://www.cityofseward.us/",
  "City of Unalaska Department of Public Utilities": "https://www.ci.unalaska.ak.us/",
  "City of Valdez Electric Utility": "https://www.ci.valdez.ak.us/",
  "Copper Valley Electric Association, Inc.": "https://www.cve.org/",
  "Cordova Electric Cooperative": "https://www.cordovaelectric.com/",
  "Golden Valley Electric Association, Inc.": "https://www.gvea.com/",
  "Gwitchyaa Zhee Utility Company": "https://www.fortyukon.org/",
  "Homer Electric Association, Inc.": "https://www.homerelectric.com/",
  "Inside Passage Electric Cooperative, Inc.": "https://www.akenergyauthority.org/",
  "Ketchikan Public Utilities - Electric Division": "https://www.kpu.us/",
  "Kodiak Electric Association, Inc.": "https://www.kodiakelectric.com/",
  "Kotzebue Electric Association": "https://www.kea.coop/",
  "Matanuska Electric Association, Inc.": "https://www.mea.coop/",
  "Naknek Electric Association, Inc.": "https://www.nakelectric.com/",
  "Nome Joint Utility System": "https://www.nomealaska.org/",
  "Nushagak Electric & Telephone Cooperative, Inc.": "https://www.akenergyauthority.org/",
  "Pelican Utility Company": "https://www.akenergyauthority.org/",
  "Petersburg Municipal Power & Light": "https://www.petersburgak.gov/",
  "Railbelt Reliability Council": "https://alaskapower.org/",
  "Sitka Electric Department": "https://www.akenergyauthority.org/",
  "Tanana Power Company, Inc.": "https://www.akenergyauthority.org/",
  "TDX Power, Inc.": "https://www.tdxpower.com/",
  "Wrangell Municipal Light & Power": "https://www.wrangell.com/",
  "Yakutat Power, Inc.": "https://www.akenergyauthority.org/",
  "AES Hawaii, Inc.": "https://www.aes.com/",
  "Auwahi Wind Energy, LLC": "https://www.gridinfo.com/auwahi-wind-energy",
  "Hamakua Energy, LLC": "https://www.interconnection.fyi/eia/project/55369-ct2",
  "Hawaii Electric Light Company, Inc.": "https://www.hawaiianelectric.com/",
  "Hawaii State Energy Office": "https://energy.hawaii.gov/",
  "Hawaiian Electric Company, Inc.": "https://www.hawaiianelectric.com/",
  "Hawaiian Electric Industries, Inc.": "https://www.hei.com/",
  "Hu Honua Bioenergy, LLC": "https://www.huhonua.com/",
  "Kaheawa Wind Power, LLC": "https://www.gridinfo.com/plant/kaheawa-wind-power-llc/56012",
  "Kahuku Wind Power, LLC": "https://www.interconnection.fyi/eia/project/57087-1",
  "Kalaeloa Partners, L.P.": "https://www.kalaeloapartners.com/",
  "Kapaia Solar, LLC": "https://www.interconnection.fyi/eia/project/60546-pv1",
  "Kapolei Energy Storage, LLC": "https://www.interconnection.fyi/eia/project/66067-kes1",
  "Kauai Island Utility Cooperative": "https://kiuc.coop/",
  "Kawailoa Wind, LLC": "https://www.gridinfo.com/kawailoa-wind",
  "Kuihelani Solar Plus Storage": "https://www.interconnection.fyi/eia/project/64256-kulni",
  "Lawai Solar and Energy Storage Project": "https://www.gridinfo.com/plant/lawai-solar-and-energy-storage-project/63758",
  "Maui Electric Company, Limited": "https://www.mauielectric.com/",
  "Pacific Current, LLC": "https://www.hei.com/",
  "Pakini Nui Wind Farm": "https://www.gridinfo.com/plant/pakini-nui-wind-farm",
  "Puna Geothermal Venture": "https://www.gridinfo.com/puna-geothermal-venture",
};

const supGeoPatches = {
  "Black Diamond Power Company": {
    city: "Charleston",
    lat: 38.3498,
    lng: -81.6326,
    geo_confidence: "HIGH",
    geo_source: "West Virginia Secretary of State / PSC",
    geo_source_url: "https://apps.sos.wv.gov/business/corporations/organization.aspx?org=2951",
    geo_notes:
      "Principal office 100 Capitol St (Security Building), Charleston WV since 1915; local service offices in Sophia, Clay, and Mullens.",
    headquarters_address: "100 Capitol Street, 7th Floor, Charleston, WV 25301",
  },
};
let supUrlsUpdated = 0;
for (const o of supplemental) {
  const patch = supGeoPatches[o.entity_name];
  if (patch) Object.assign(o, patch);
  const src = supSourceUrlPatches[o.entity_name];
  if (src && o.geo_source_url === GENERIC_FERC) {
    o.geo_source_url = src;
    supUrlsUpdated++;
  }
}
saveJson("src/data/nerc/supplemental-orgs.json", supplemental);
console.log(`supplemental-orgs: +${supUpdated} acronyms, +${supUrlsUpdated} source URLs`);

// --- More display names for obscure co-ops / federal / G&Ts ---
const obscureNames = [
  ["NCR05023", "Basin", "Basin Electric", "Basin Electric Power Cooperative", "major"],
  ["NCR11745", "PRECorp", "Powder River Energy", "Powder River Energy Corporation", "normal"],
  ["NCR05441", "USBR", "U.S. Bureau of Reclamation", "US Bureau of Reclamation", "major"],
  ["NCR11420", "PCWA", "Placer County Water Agency", "Placer County Water Agency", "normal"],
  ["NCR05337", "Benton PUD", "Benton County PUD", "Benton County PUD No. 1", "normal"],
  ["NCR05286", "Okanogan PUD", "Okanogan County PUD", "Okanogan County PUD No. 1", "normal"],
  ["NCR05389", "SPI", "Sierra Pacific Industries", "Sierra Pacific Industries", "normal"],
  ["NCR11170", "Shepherds Flat", "Shepherds Flat Wind", "Shepherds Flat Wind, LLC", "normal"],
  ["NCR12425", "Strauss", "Strauss Wind", "Strauss Wind, LLC", "normal"],
  ["NCR11214", "Rockland", "Rockland Wind Farm", "Rockland Wind Farm LLC", "normal"],
  ["NCR11347", "Pinyon I", "Pinyon Pines Wind I", "Pinyon Pines Wind I, LLC", "normal"],
  ["NCR11350", "Pinyon II", "Pinyon Pines Wind II", "Pinyon Pines Wind II, LLC", "normal"],
  ["NCR11652", "Pio Pico", "Pio Pico Energy Center", "Pio Pico Energy Center, LLC", "normal"],
  ["NCR11450", "Shiloh IV", "Shiloh IV Wind", "Shiloh IV Wind Project, LLC", "normal"],
  ["NCR11307", "Sentinel", "Sentinel Energy Center", "Sentinel Energy Center, LLC", "normal"],
  ["NCR11471", "Sunrise", "Sunrise Power", "Sunrise Power Company, LLC", "normal"],
  ["NCR11054", "South Feather", "South Feather Power", "South Feather Power Project", "normal"],
  ["NCR05369", "Saguaro", "Saguaro Power", "Saguaro Power Company", "normal"],
  ["NCR11605", "RWE", "RWE Clean Energy", "RWE Clean Energy Asset Holdings, Inc.", "normal"],
  ["NCR11353", "Russell City", "Russell City Energy", "Russell City Energy Company, LLC", "normal"],
  ["NCR11424", "Solar Star XIX", "Solar Star California XIX", "Solar Star California XIX, LLC", "normal"],
  ["NCR11432", "Solar Star XX", "Solar Star California XX", "Solar Star California XX, LLC", "normal"],
  ["NCR13136", "Prineville", "Prineville Solar", "Prineville Solar Energy LLC", "normal"],
  ["NCR12335", "Rabbitbrush", "Rabbitbrush Solar", "Rabbitbrush Solar, LLC", "normal"],
  ["NCR12268", "Panorama", "Panorama Wind", "Panorama Wind, LLC", "normal"],
  ["NCR12028", "Steamboat", "Steamboat Hills", "Steamboat Hills, LLC", "normal"],
  ["NCR05413", "Sunnyside", "Sunnyside Cogen", "Sunnyside Cogeneration Associates", "normal"],
  ["NCR04088", "Kiowa", "Kiowa Power Partners", "Kiowa Power Partners, LLC", "normal"],
  ["NCR11279", "PUP", "Pacific-Ultrapower", "Pacific-Ultrapower Chinese Station", "normal"],
  ["NCR13117", "TAG", "TAG", "TAG", "normal"],
];

let obscureAdded = 0;
for (const [ncr_id, shortest, short, normal, tier] of obscureNames) {
  if (nameById.has(ncr_id)) continue;
  const g = geoById.get(ncr_id);
  if (!g) continue;
  orgNames.names.push({ ncr_id, entity_name: g.entity_name, shortest, short, normal, tier });
  obscureAdded++;
}
if (obscureAdded) saveJson("src/data/nerc/org-names.json", orgNames);
console.log(`org-names: +${obscureAdded} obscure/generator entries`);
