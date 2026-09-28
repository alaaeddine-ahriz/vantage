import type { LaneId, Source } from "./types";

/**
 * Keyword rules per lane. English and French terms live side by side; the
 * regexes are applied case-insensitively after diacritics are stripped, so
 * "électricité" matches "electricite".
 */
const RULES: Record<LaneId, RegExp> = {
  oilgas:
    /\b(oil|crude|brent|wti|opec\+?|petrol(?:eum|ier|iere|iers|ieres)?|petrole|gasoline|natural gas|gaz naturel|gaz|lng|gnl|refiner(?:y|ies)|raffin\w+|upstream|downstream|midstream|offshore(?!\s+wind)|drilling|forage|shale|schiste|pipeline|gazoduc|oleoduc|barrels?|barils?|exxon(?:mobil)?|chevron|shell|bp|totalenergies|aramco|adnoc|eni|equinor|petrobras|gazprom|rosneft|lukoil|qatarenergy|henry hub|ttf|fracking|rig count|condensate|diesel|jet fuel|kerosene|fioul|naphtha|fpso|petrochemical|e&p)\b/i,
  power:
    /\b(electricit[ye]|power (?:grid|plant|plants|price|prices|market|outage|outages|generation|demand|supply|station|sector|cut|cuts)|grid|reseau electrique|utility|utilities|nuclear|nucleaire|reactors?|reacteurs?|edf|engie|enel|iberdrola|rwe|e\.on|vattenfall|national grid|rte|enedis|transmission|substation|blackouts?|coupures? (?:de courant|d'electricite)|centrale|centrales|smr|uranium|coal|charbon|gas-fired|ccgt|capacity market|interconnector|epex|entso-e|ferc|nerc|ercot|pjm|kwh|mwh|gwh|twh|data cent(?:er|re)s?|hydropower|dam)\b/i,
  renewables:
    /\b(renewables?|renouvelables?|solar|solaire|photovolta\w+|wind (?:farm|farms|power|turbine|turbines|energy)|eolien\w*|offshore wind|orsted|hydrogen|hydrogene|electrolys\w+|batter(?:y|ies|ie)|storage|stockage|evs?|electric vehicles?|vehicules? electriques?|charging|net[- ]zero|decarboni[sz]\w+|carbon (?:capture|credits?|price|prices|market|tax|border)|cbam|ccs|ccus|emissions?|climate|climat\w*|ets|eua|biofuels?|biocarburants?|biomethane|geothermal|geothermi\w*|hydroelectric|heat pumps?|pompes? a chaleur|energy transition|transition energetique|clean energy|cop\d{2}|ppa|green (?:energy|hydrogen|steel|deal)|sustainab\w+|nuclear fusion|fusion nucleaire)\b/i,
  industry:
    /\b(manufactur\w+|industri\w+|usines?|factor(?:y|ies)|steel|acier|aluminium|aluminum|copper|cuivre|nickel|lithium|cobalt|rare earths?|terres rares|mining|mines?|minier\w*|metals?|metaux|chemicals?|chimi\w+|petrochimi\w+|cement|ciment|automotive|automobile|carmakers?|constructeurs? automobiles?|aerospace|aeronautique|airbus|boeing|safran|thales|siemens|schneider|abb|arcelormittal|thyssenkrupp|basf|dow|rio tinto|bhp|glencore|vale|freeport|shipping|maritime|containers?|ports?|supply chains?|chaines? d'approvisionnement|logistics|logistique|semiconductors?|semi-conducteurs?|chips?|robot\w*|machinery|equipment|pmi|industrial production|production industrielle|reshoring|nearshoring|shipyards?|chantiers? navals?|defen[cs]e industry|arms|defense|smelters?|fonderies?|alumina|iron ore|minerai)\b/i,
  policy:
    /\b(sanctions?|tariffs?|droits? de douane|tarifs? douaniers?|embargo|regulat\w+|reglement\w+|legislation|law|loi|policy|politique|parliament|parlement|congress|senate|senat|white house|maison blanche|commission europeenne|european commission|eu|ue|brussels|bruxelles|government|gouvernement|ministers?|ministres?|ministry|ministere|elections?|geopolit\w+|war|guerre|conflict|conflit|ceasefire|cessez-le-feu|strikes?|greves?|subsid\w+|subventions?|ban|interdiction|export controls?|price cap|plafonnement|iea|aie|g7|g20|wto|omc|trade (?:war|deal|talks)|guerre commerciale|treaty|traite|summit|sommet|ukraine|russia|russie|iran|israel|gaza|houthis?|red sea|mer rouge|hormuz|taiwan|china|chine|beijing|pekin|washington|kremlin|moscow|moscou|nato|otan|decree|decret|court|tribunal|lawsuit|antitrust|permits?|permis|licen[cs]es?|trump|macron|xi jinping|putin|poutine)\b/i,
  markets:
    /\b(shares?|stocks?|actions?|bourse|equit(?:y|ies)|earnings|resultats|profits?|benefices?|revenues?|chiffre d'affaires|dividends?|mergers?|acquisitions?|fusion|rachat|takeover|opa|ipo|introduction en bourse|bonds?|obligations?|yields?|rendements?|fed|ecb|bce|central banks?|banques? centrales?|rate (?:hike|cut)s?|taux (?:directeurs?|d'interet)|inflation|gdp|pib|recession|futures|prices? (?:rise|rises|fall|falls|jump|jumps|drop|drops|surge|surges|slide|slides|climb|climbs|tumble|tumbles)|prix|markets?|marches?|traders?|hedge funds?|private equity|investors?|investisseurs?|forecasts?|previsions?|outlook|perspectives|rally|selloff|wall street|dow jones|nasdaq|s&p|cac 40|dax|ftse|nikkei|dollar|euro|yuan|commodit\w+|matieres premieres|quarterly|trimestre)\b/i,
};

export const LANE_ORDER: LaneId[] = [
  "oilgas",
  "power",
  "renewables",
  "industry",
  "policy",
  "markets",
];

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l");
}

function countMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, "gi");
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
  const scores = new Map<LaneId, number>();
  for (const lane of LANE_ORDER) {
    const score = countMatches(RULES[lane], t) * 3 + countMatches(RULES[lane], s);
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
