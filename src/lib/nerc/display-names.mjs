// Shared map-label shortening for build-time name_shortest and runtime bubble text.

export const MAP_LABEL_MAX = 8;

const TRAILING_WORD =
  /\s+(?:Edison|Electric|Energy|Power|Gas|Light|Utilities?|Company|Co|Corp|Corporation|Services?|Renewable|Generation|Generating|Operations?|Maintenance|Wind(?:power| Farm| Energy| Project)?|Solar(?: Project| Farm)?|Project|Plant|Station|Facility|Cooperative|Co-?op|Partners?|Holdings?|Mountain)\.?$/i;

const GEO_BRAND =
  /^([A-Za-z][A-Za-z.'&-]{2,14})\s+(Edison|Electric|Energy|Power|Gas|Light|Wind|Solar)$/i;

const DESCRIPTOR_TAIL = new Set([
  "WIND",
  "WINDPOWER",
  "SOLAR",
  "ENERGY",
  "POWER",
  "ELECTRIC",
  "EDISON",
  "GENERATION",
  "GENERATING",
  "PROJECT",
  "PROJECTS",
  "FACILITY",
  "STATION",
  "PLANT",
  "HILLS",
  "CREEK",
  "RIDGE",
  "VALLEY",
  "MOUNTAIN",
  "PARTNERS",
  "PARTNER",
  "OPERATIONS",
  "OPERATION",
  "MAINTENANCE",
  "RENEWABLE",
  "RENEWABLES",
  "SERVICES",
  "SERVICE",
  "UTILITIES",
  "UTILITY",
  "BESS",
  "RENOM",
  "FARM",
  "FARMS",
  "STORAGE",
  "BIOMASS",
  "HOLDINGS",
  "II",
  "III",
  "IV",
]);

const LEADING_FILLER =
  /^(?:Los|Las|El|La|San|Santa|Mount|Mt\.?|Fort|Ft\.?|New|Old|Upper|Lower|North|South|East|West|Lake|Big|Little|Great|Grand|The|A|An)\s+/i;

function stripDescriptorTail(words) {
  let parts = [...words];
  while (parts.length > 1) {
    const tail = parts[parts.length - 1].replace(/[^A-Za-z]/g, "").toUpperCase();
    if (DESCRIPTOR_TAIL.has(tail) || /^(?:I{1,3}|IV|VI{0,3}|IX|X{1,3}|\d+)$/i.test(parts[parts.length - 1])) {
      parts = parts.slice(0, -1);
    } else break;
  }
  return parts;
}

/** Consonant-preserving squeeze for long single tokens (Invenergy -> Invnrgy). */
export function compactToken(word, maxLen = MAP_LABEL_MAX) {
  const w = String(word ?? "").trim();
  if (!w || w.length <= maxLen) return w;
  if (/[&./-]/.test(w)) return w.slice(0, maxLen);

  const prefix = w.slice(0, maxLen);
  if (w.length <= maxLen + 3) return prefix;

  const skeleton = w[0] + w.slice(1).replace(/[aeiouy]/gi, "");
  if (skeleton.length >= 4 && skeleton.length <= maxLen) return skeleton;
  return prefix;
}

/** Shorten a token for on-map labels (default max 8 chars). */
export function tightenMapLabel(text, maxLen = MAP_LABEL_MAX) {
  let s = String(text ?? "").trim();
  if (!s) return s;

  const geo = s.match(GEO_BRAND);
  if (geo) s = geo[1];

  let words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const parts = stripDescriptorTail(words);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const first = parts[0];
      if (
        last.length >= 3 &&
        last.length <= maxLen &&
        !DESCRIPTOR_TAIL.has(last.replace(/[^A-Za-z]/g, "").toUpperCase()) &&
        last.length < first.length
      ) {
        s = last;
      } else {
        s = parts.length === 1 ? parts[0] : parts.join(" ");
      }
    } else {
      s = parts.length === 1 ? parts[0] : parts.join(" ");
    }
    words = s.split(/\s+/).filter(Boolean);
  }

  for (let i = 0; i < 3; i++) {
    const next = s.replace(TRAILING_WORD, "").trim();
    if (next === s) break;
    s = next;
  }

  if (s.length > maxLen && words.length >= 2) {
    const withoutLead = s.replace(LEADING_FILLER, "").trim();
    if (withoutLead !== s && withoutLead.length >= 3 && withoutLead.length <= maxLen) s = withoutLead;
  }

  if (s.length <= maxLen) return s;

  const again = s.split(/\s+/).filter(Boolean);
  if (again.length >= 2 && again[0].length <= 4 && again.slice(1).join(" ").length <= maxLen) {
    const tail = again.slice(1).join(" ");
    if (tail.length <= maxLen) s = tail;
  }
  if (s.length <= maxLen) return s;

  if (again[0]?.length >= 3 && again[0].length <= maxLen) return again[0];

  if (/&/.test(s) && s.length <= maxLen + 2) return s.slice(0, maxLen);

  if (!s.includes(" ")) return compactToken(s, maxLen);

  if (again.length >= 2) {
    const initials = again.map((w) => w[0]).join("");
    if (initials.length >= 2 && initials.length <= maxLen) return initials;
  }
  return compactToken(again[0] || s, maxLen);
}

/** "Potomac Edison" -> "Potomac"; multi-word acronyms lose trailing descriptors. */
export function compressSpacedBrand(acronym, maxLen = MAP_LABEL_MAX) {
  const raw = String(acronym ?? "").trim();
  if (!raw.includes(" ")) return tightenMapLabel(raw, maxLen);
  const parts = stripDescriptorTail(raw.split(/\s+/).filter(Boolean));
  if (parts.length === 1) return tightenMapLabel(parts[0], maxLen);
  return tightenMapLabel(parts.join(" "), maxLen);
}
