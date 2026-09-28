import { fold } from "./text";
import type { LaneId, Source } from "./types";

/**
 * Keyword rules per lane. English and French terms live side by side; the
 * regexes are applied case-insensitively after diacritics are stripped, so
 * "électricité" matches "electricite". Short acronyms live in ACRONYMS and
 * are matched case-sensitively on the raw text, so that the French "eu" or
 * "25 bp" do not count; French tokens that are also English words live in
 * RULES_FR and only apply to French sources.
 */
const RULES: Record<LaneId, RegExp> = {
  oilgas:
    /\b((?<!\b(?:olive|palm|cooking|vegetable|sunflower|seed|fish|coconut)\s)oil|crude|brent|petrol(?:eum|ier|iere|iers|ieres)?|petrole|gasoline|natural gas|gaz naturel|gaz|(?<!\b(?:greenhouse|tear)\s)gas(?!-fired)|refiner(?:y|ies)|raffin\w+|upstream|downstream|midstream|offshore(?!\s+wind)|drilling|forage|shale|schiste|pipeline|gazoduc|oleoduc|barrels?|barils?|exxon(?:mobil)?|chevron|shell(?!\s+compan)|totalenergies|aramco|adnoc|equinor|petrobras|gazprom|rosneft|lukoil|qatarenergy|henry hub|fracking|rig count|condensate|diesel|jet fuel|kerosene|fioul|naphtha|fpso|petrochemical|e&p)\b/i,
  power:
    /\b(electricit[ye]|power (?:grid|plant|plants|price|prices|market|outage|outages|generation|demand|supply|station|sector|cut|cuts)|grid|reseau electrique|utility|utilities|nuclear|nucleaire|reactors?|reacteurs?|edf|engie|enel|iberdrola|rwe|e\.on|vattenfall|national grid|rte|enedis|transmission|substation|blackouts?|coupures? (?:de courant|d'electricite)|(?<!banques?\s)centrales?(?!\s+(?:d'achat|syndicale))|smr|uranium|coal|charbon|gas-fired|ccgt|capacity market|interconnector|epex|entso-e|ferc|nerc|ercot|pjm|kwh|mwh|gwh|twh|data cent(?:er|re)s?|hydropower|(?<!grand\s)dams?)\b/i,
  renewables:
    /\b(renewables?|renouvelables?|solar|solaire|photovolta\w+|wind (?:farm|farms|power|turbine|turbines|energy)|eolien\w*|offshore wind|orsted|hydrogen|hydrogene|electrolys\w+|batter(?:y|ies|ie)|(?<!\b(?:gas|oil|crude|lng|data|cloud|fuel)\s)storage|stockage|electric vehicles?|vehicules? electriques?|ev charging|charging (?:station|stations|network|networks|infrastructure|point|points|hub|hubs)|chargers?|net[- ]zero|decarboni[sz]\w+|carbon (?:capture|credits?|price|prices|market|tax|border)|emissions?|climate|climat\w*|biofuels?|biocarburants?|biomethane|geothermal|geothermi\w*|hydroelectric|heat pumps?|pompes? a chaleur|energy transition|transition energetique|clean energy|cop\d{2}|green (?:energy|hydrogen|steel|deal)|sustainab\w+|nuclear fusion|fusion nucleaire)\b/i,
  industry:
    /\b(manufactur\w+|industri\w+|usines?|factor(?:y|ies)|steel|acier|aluminium|aluminum|copper|cuivre|nickel|lithium|cobalt|rare earths?|terres rares|mining|mines?|minier\w*|metals?|metaux|chemicals?|chimi\w+|petrochimi\w+|cement|ciment|automotive|automobile|carmakers?|constructeurs? automobiles?|aerospace|aeronautique|airbus|boeing|safran|thales|siemens|schneider|arcelormittal|thyssenkrupp|basf|dow(?!\s+(?:jones|futures|industrials))|rio tinto|glencore|vale(?!\s+of\b)|freeport|shipping|maritime|containers?|ports?|supply chains?|chaines? d'approvisionnement|logistics|logistique|semiconductors?|semi-conducteurs?|(?<!blue[- ])chips?|chipmakers?|robot\w*|machinery|equipment|industrial production|production industrielle|reshoring|nearshoring|shipyards?|chantiers? navals?|defen[cs]e industry|arms (?:industry|makers?|manufacturers?|sales?|exports?|deals?|embargo|trade|race|suppliers?)|defense|smelters?|fonderies?|alumina|iron ore|minerai)\b/i,
  policy:
    /\b(sanctions?|tariffs?|droits? de douane|tarifs? douaniers?|embargo|regulat\w+|reglement\w+|legislation|law|policy|politique|parliament|parlement|congress|senate|senat|white house|maison blanche|commission europeenne|european commission|brussels|bruxelles|government|gouvernement|ministers?|ministres?|ministry|ministere|elections?|geopolit\w+|war|guerre|conflict|conflit|ceasefire|cessez-le-feu|strikes?|greves?|subsid\w+|subventions?|ban|interdiction|export controls?|price cap|plafonnement|trade (?:war|deal|talks)|guerre commerciale|treaty|traite|summit|sommet|ukraine|russia|russie|iran|israel|gaza|houthis?|red sea|mer rouge|hormuz|taiwan|china|chine|beijing|pekin|washington|kremlin|moscow|moscou|decree|decret|(?<!\b(?:a|trop|plus|tres|si|aussi)\s)courts?(?![- ]terme|-circuit)|tribunal|lawsuit|antitrust|permits?|permis|licen[cs]es?|trump|macron|xi jinping|putin|poutine)\b/i,
  markets:
    /\b(shares?|stocks?|bourse|equit(?:y|ies)|earnings|resultats|profits?|benefices?|revenues?|chiffre d'affaires|dividends?|mergers?|acquisitions?|rachat|takeover|introduction en bourse|bonds?|obligations?|yields?|rendements?|federal reserve|fed(?=\s+(?:rate|rates|chair|cut|cuts|hike|hikes|meeting|minutes|officials?|policy|funds?|decision|signals?|holds?|pauses?)|'s\b)|central banks?|banques? centrales?|rate (?:hike|cut)s?|taux (?:directeurs?|d'interet)|inflation|recession|futures|prices? (?:rise|rises|fall|falls|jump|jumps|drop|drops|surge|surges|slide|slides|climb|climbs|tumble|tumbles)|prix|markets?|traders?|hedge funds?|private equity|investors?|investisseurs?|forecasts?|previsions?|outlook|perspectives|(?<!\b(?:protest|political|campaign|election)\s)rall(?:y|ies)(?!\s+(?:against|for|outside|in support))|selloff|wall street|dow jones|nasdaq|s&p|cac 40|dax|ftse|nikkei|dollar|euro|yuan|commodit\w+|matieres premieres|quarterly|trimestre)\b/i,
};

/**
 * Acronyms are matched case-sensitively on the raw text: lowercased they
 * collide with ordinary words ("eu", "bp", "ets"). Capitalised spellings used
 * by the British press ("Opec", "Nato", "Eni") are listed explicitly.
 */
const ACRONYMS: Partial<Record<LaneId, RegExp>> = {
  oilgas: /\b(?:(?<!\d\s?)BP|ENI|Eni|OPEC\+?|Opec\+?|OPEP\+?|Opep\+?|LNG|GNL|TTF|WTI)\b/,
  renewables: /\b(?:ETS|EUA|PPA|CCS|CCUS|CBAM|MACF|EVs?)\b/,
  industry: /\b(?:ABB|BHP|PMI)\b/,
  policy: /\b(?:EU|UE|G7|G20|WTO|OMC|IEA|AIE|NATO|Nato|OTAN|Otan)\b/,
  markets: /\b(?:ECB|BCE|IPO|OPA|GDP|PIB)\b/,
};

/** French tokens that are also English words ("action", "marches"); applied to French sources only. */
const RULES_FR: Partial<Record<LaneId, RegExp>> = {
  policy: /\b(lois?)\b/i,
  markets: /\b(actions?|marches?|fusions?)\b/i,
};

export const LANE_ORDER: LaneId[] = [
  "oilgas",
  "power",
  "renewables",
  "industry",
  "policy",
  "markets",
];

function countMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    seen.add(m[0].toLowerCase());
    if (seen.size > 12) break;
  }
  return seen.size;
}

export function classify(
  title: string,
  summary: string,
  source: Source,
): { lane: LaneId; lanes: LaneId[] } {
  const t = fold(title);
  const s = fold(summary).slice(0, 600);
  const rawSummary = summary.slice(0, 600);
  const scores = new Map<LaneId, number>();
  for (const lane of LANE_ORDER) {
    let score = countMatches(RULES[lane], t) * 3 + countMatches(RULES[lane], s);
    const acronyms = ACRONYMS[lane];
    if (acronyms) score += countMatches(acronyms, title) * 3 + countMatches(acronyms, rawSummary);
    const fr = source.lang === "fr" ? RULES_FR[lane] : undefined;
    if (fr) score += countMatches(fr, t) * 3 + countMatches(fr, s);
    if (score > 0) scores.set(lane, score);
  }
  if (scores.size === 0) return { lane: source.lane, lanes: [source.lane] };

  // Source default lane gets a small bias so a generic energy headline from a
  // power-sector outlet lands in Power rather than Markets.
  const bias = (l: LaneId) => (l === source.lane ? 1.5 : 0);
  const ranked = [...scores.entries()]
    .map(([l, v]) => [l, v + bias(l)] as [LaneId, number])
    .sort((a, b) => b[1] - a[1] || LANE_ORDER.indexOf(a[0]) - LANE_ORDER.indexOf(b[0]));
  const top = ranked[0][1];
  const lanes = ranked.filter(([, v]) => v >= Math.max(2, top * 0.5)).map(([l]) => l);
  return { lane: ranked[0][0], lanes: lanes.length ? lanes : [ranked[0][0]] };
}
