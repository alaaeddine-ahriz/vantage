import { classify } from "./classify";
import { hashId } from "./feeds";
import { SYMBOLS } from "./markets";
import { sourcesForBatch } from "./sources";
import type {
  FeedsResponse,
  Lang,
  LaneId,
  MarketsResponse,
  NewsItem,
  Quote,
  Source,
  SourceStatus,
} from "./types";

/**
 * Deterministic sample data for WW_MOCK=1. Nothing here touches the network
 * or Math.random, so screenshots and UI work are reproducible offline.
 */

/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// ------------------------------------------------------------------ Headlines

interface Story {
  lane: LaneId;
  lang: Lang;
  title: string;
  summary: string;
}

const s = (lane: LaneId, lang: Lang, title: string, summary: string): Story => ({ lane, lang, title, summary });

const STORIES: Story[] = [
  // ---- EN: oil & gas
  s("oilgas", "en", "OPEC+ agrees to extend voluntary output cuts through the first quarter", "Eight members led by Saudi Arabia and Russia will hold the 2.2 million bpd curbs, citing fragile demand. Brent held near $68 after the decision."),
  s("oilgas", "en", "Brent slips below $70 as US crude stockpiles build for a third week", "EIA data showed inventories rising by 4.1 million barrels, well above expectations. Refinery runs eased ahead of autumn maintenance."),
  s("oilgas", "en", "QatarEnergy signs 20-year LNG supply deal with China's Sinopec", "The 3 mtpa contract will be sourced from the North Field East expansion, which starts up in 2026."),
  s("oilgas", "en", "TotalEnergies takes final investment decision on Papua LNG", "The $10 billion project will add 4 mtpa of capacity, with Technip Energies leading the onshore work."),
  s("oilgas", "en", "Dutch TTF gas climbs 5% on Norwegian outage and colder forecast", "Unplanned maintenance at Troll cut flows by 30 mcm/d. Storage across the EU stands at 87% full."),
  s("oilgas", "en", "Henry Hub gas futures hit a 4-month high as LNG feedgas demand surges", "Feedgas deliveries to US export plants topped 16 bcf/d for the first time, with Plaquemines ramping up."),
  s("oilgas", "en", "Aramco cuts October official selling prices for Asian buyers", "Arab Light was reduced by $0.50 a barrel versus the Oman/Dubai benchmark, a smaller cut than refiners had expected."),
  s("oilgas", "en", "Shell scales back Rotterdam biofuels plant, books $780 million impairment", "The company said margins for hydrotreated vegetable oil have collapsed under an import surge."),
  s("oilgas", "en", "Equinor starts production at Johan Castberg field in the Barents Sea", "The FPSO will produce up to 220,000 barrels a day at plateau, the first oil from Norway's Arctic in a decade."),
  s("oilgas", "en", "Freeport LNG train 2 trips again, tightening Atlantic spot cargoes", "The Texas plant has suffered repeated outages this year, keeping JKM and TTF spreads volatile."),
  s("oilgas", "en", "ExxonMobil greenlights Guyana's Hammerhead project", "The sixth development will add 150,000 bpd from 2029, lifting national output above 1.3 million bpd."),
  s("oilgas", "en", "Refinery margins slump as European diesel cracks fall to 2-year low", "Weak industrial demand and rising Middle East exports are pressuring the crack spread below $15 a barrel."),
  s("oilgas", "en", "Nigeria's Dangote refinery begins gasoline exports to West Africa", "The 650,000 bpd plant shipped its first RBOB-spec cargoes, reshaping Atlantic Basin product flows."),
  s("oilgas", "en", "US rig count falls for the fifth week as shale drillers hold back", "Baker Hughes counted 540 active oil rigs, the lowest since 2021, as producers keep capex flat."),
  // ---- EN: power & grid
  s("power", "en", "EDF restarts Flamanville 3 reactor after turbine repair", "The 1,650 MW EPR reconnected to the grid on Saturday night. Output will ramp to full power over two weeks."),
  s("power", "en", "Spanish grid operator blames voltage surge for April blackout", "Red Electrica's final report points to a cascade of generator disconnections in the south-west."),
  s("power", "en", "Rolls-Royce SMR selected for first Czech small modular reactor at Temelin", "CEZ picked the 470 MW design over GE Hitachi and Westinghouse, with construction targeted for the early 2030s."),
  s("power", "en", "German power prices spike to EUR 320/MWh during evening wind lull", "Dunkelflaute conditions across northern Europe forced gas plants to set the marginal price."),
  s("power", "en", "National Grid awards GBP 4.7 billion in contracts for Great Grid Upgrade", "The transmission projects include the Eastern Green Link subsea cables between Scotland and England."),
  s("power", "en", "Texas grid sets new demand record as data centers drive load growth", "ERCOT peaked above 87 GW, with large flexible loads now exceeding 6 GW of interconnection requests."),
  s("power", "en", "Vattenfall to build 1.6 GW gas-fired plant in Netherlands for grid security", "The hydrogen-ready CCGT at Magnum replaces coal capacity closing under Dutch law."),
  s("power", "en", "Poland signs contract for three Westinghouse AP1000 units at Lubiatowo", "The USD 40 billion project marks the country's first nuclear plant, with first concrete due in 2028."),
  s("power", "en", "Iberdrola lifts grid investment plan to EUR 55 billion through 2030", "Networks in the UK, US and Brazil take most of the money as the utility pivots away from generation."),
  s("power", "en", "Ukraine restores 2 GW of thermal capacity ahead of winter after Russian strikes", "Ukrenergo warned that further attacks on substations could bring back rolling outages."),
  s("power", "en", "Kazatomprom trims 2026 uranium production guidance on sulphuric acid shortage", "The world's largest producer will mine 10% less than planned, supporting spot prices above $80/lb."),
  s("power", "en", "France's RTE warns of tight winter margins if cold snap coincides with reactor outages", "The system operator expects 50 GW of nuclear available in January, with imports needed on peak days."),
  s("power", "en", "Enel sells Peruvian grid assets to CSG for USD 2.9 billion", "The deal completes the Italian utility's exit from Latin American distribution outside Brazil."),
  s("power", "en", "Interconnector between Greece and Cyprus approved after EIB financing deal", "The 1,000 MW Great Sea Interconnector will be the world's longest and deepest HVDC subsea cable."),
  // ---- EN: renewables & transition
  s("renewables", "en", "Ørsted cancels Hornsea 4 offshore wind project after cost blowout", "The Danish developer said supply chain prices and interest rates made the 2.4 GW UK project unviable."),
  s("renewables", "en", "Siemens Gamesa returns to profit as onshore turbine fixes near completion", "The wind unit posted its first positive quarter since 2022, though 4.X platform repairs continue."),
  s("renewables", "en", "EU solar installations to fall for first time in a decade, SolarPower Europe says", "Grid connection queues and negative prices are slowing rooftop demand in Germany and the Netherlands."),
  s("renewables", "en", "Air Liquide inaugurates 200 MW electrolyser in Normandy for green hydrogen", "The Normand'Hy plant will supply TotalEnergies' Gonfreville refinery with renewable hydrogen."),
  s("renewables", "en", "Vestas wins 1.1 GW order for Baltic Power offshore wind farm", "The order includes 76 V236-15 MW turbines and a 20-year service contract."),
  s("renewables", "en", "EU carbon price rises above EUR 75 as ETS supply tightens", "Market Stability Reserve withdrawals and the 2026 CBAM phase-in are supporting EUA futures."),
  s("renewables", "en", "BYD overtakes Tesla in European EV sales for the first time", "The Chinese carmaker registered 15,300 battery cars in June, helped by its new Hungarian plant."),
  s("renewables", "en", "Battery storage capacity in Great Britain passes 5 GW milestone", "Modo Energy data shows revenues per MW have recovered as Balancing Mechanism dispatch improves."),
  s("renewables", "en", "Masdar and EDF Renewables close financing for 2 GW Al Ajban solar project", "The Abu Dhabi site will be paired with 5 GWh of batteries to deliver round-the-clock supply."),
  s("renewables", "en", "Empire Wind resumes construction after federal stop-work order is lifted", "Equinor said the 810 MW New York offshore wind project remains on track for first power in 2027."),
  s("renewables", "en", "Heat pump sales in Europe drop 20% as subsidy schemes lapse", "The EHPA says Italy, Germany and France all cut incentives, leaving the 2030 target out of reach."),
  s("renewables", "en", "Northvolt assets sold to Lyten as Europe's battery champion winds down", "The US firm will restart the Skelleftea gigafactory with lithium-sulphur cells from 2027."),
  s("renewables", "en", "Northern Lights receives first CO2 cargo from Heidelberg Materials for carbon capture", "The Brevik cement plant shipped 7,500 tonnes of liquefied CO2 to the Oygarden terminal."),
  s("renewables", "en", "Morocco launches 1 GW green hydrogen tender for Guelmim-Oued Noun", "Bidders include ACWA Power, TotalEnergies and a Chinese consortium, targeting ammonia exports to Europe."),
  // ---- EN: industry & materials
  s("industry", "en", "ArcelorMittal idles blast furnace in Dunkirk as imports surge", "The steelmaker blamed cheap Asian steel and weak automotive demand for the temporary stoppage."),
  s("industry", "en", "Copper hits record high above $11,000 a tonne on Grasberg outage", "Freeport declared force majeure after a mud rush halted Indonesia's largest mine."),
  s("industry", "en", "Thyssenkrupp Steel to cut 11,000 jobs and close Kreuztal plant", "The unit will shrink capacity to 8.7 million tonnes as it seeks a joint venture with EPH."),
  s("industry", "en", "Siemens Energy raises full-year guidance on record grid equipment orders", "Transformer and switchgear backlog climbed to EUR 133 billion, with data center demand a key driver."),
  s("industry", "en", "Airbus deliveries slip as engine shortages hit A320neo output", "The planemaker handed over 62 jets in August, still targeting 820 for the year."),
  s("industry", "en", "Rio Tinto approves $6.7 billion Simandou iron ore rail and port works", "First ore from the Guinean project is expected by the end of 2025, adding 60 million tonnes a year."),
  s("industry", "en", "Glencore to shut Mount Isa copper smelter without government support", "The Queensland site processes a third of Australia's copper concentrate."),
  s("industry", "en", "Maersk warns of Red Sea shipping disruption lasting into 2026", "Container rates on Asia-Europe routes jumped 30% after new attacks near Bab el-Mandeb."),
  s("industry", "en", "Stellantis halts production at Poissy for three weeks on weak demand", "The DS 3 and Opel Mokka lines will pause as European sales fall short of plan."),
  s("industry", "en", "Euro zone manufacturing PMI rises to 50.7, first expansion since 2022", "New orders grew in Germany for the second month, though Italy and France remained below 50."),
  s("industry", "en", "Nippon Steel completes $14.9 billion takeover of US Steel", "The deal closed with a golden share for the US government and a pledge of $11 billion in new investment."),
  s("industry", "en", "Alcoa curtails San Ciprian smelter restart as power costs bite", "The Spanish aluminium plant will run at 30% of capacity until a long-term PPA is signed."),
  s("industry", "en", "Lynas starts heavy rare earths separation at Malaysian plant", "The company becomes the first producer of dysprosium and terbium outside China."),
  s("industry", "en", "Fincantieri wins EUR 1.2 billion order for two LNG-powered cruise ships", "The Norwegian Cruise Line order lifts the shipbuilder's backlog to a record EUR 43 billion."),
  // ---- EN: policy & geopolitics
  s("policy", "en", "EU approves 18th sanctions package targeting Russian LNG transshipment", "The measures ban re-exports of Russian LNG via EU ports from March and lower the oil price cap to $47.60."),
  s("policy", "en", "US raises steel and aluminium tariffs to 50%, extends them to appliances", "The White House said the duties will apply to derivative products including refrigerators and washing machines."),
  s("policy", "en", "Iran threatens to close Strait of Hormuz after Israeli strikes on Kharg", "Tanker insurers doubled war-risk premiums for Gulf loadings within hours."),
  s("policy", "en", "European Commission proposes 90% emissions cut for 2040 with flexibility on credits", "Member states could count up to 3% of international carbon credits from 2036."),
  s("policy", "en", "China imposes export licences on antimony, gallium and germanium products", "The Ministry of Commerce said the controls protect national security; prices in Rotterdam jumped 20%."),
  s("policy", "en", "Washington and Brussels agree 15% tariff ceiling in outline trade deal", "The EU pledged $750 billion of US energy purchases over three years, a figure analysts call unrealistic."),
  s("policy", "en", "Germany's cabinet approves gas power plant strategy with 20 GW of tenders", "Berlin will subsidise hydrogen-ready plants to back up renewables, subject to EU state aid clearance."),
  s("policy", "en", "IEA cuts 2026 oil demand growth forecast to 700,000 bpd", "The agency cited weaker Chinese consumption and faster EV adoption in its monthly report."),
  s("policy", "en", "Houthis claim attack on Greek-owned tanker in Red Sea", "The vessel was hit by drones and rocket-propelled grenades, the fourth ship struck this month."),
  s("policy", "en", "UK government takes control of British Steel to keep Scunthorpe furnaces running", "Emergency legislation passed in a single day after Jingye moved to cancel raw material orders."),
  s("policy", "en", "Saudi Arabia and UAE resolve OPEC+ quota dispute ahead of ministerial meeting", "The UAE secured a 200,000 bpd baseline increase in exchange for compliance commitments."),
  s("policy", "en", "France to delay CBAM certificate sales by a year under EU simplification package", "Importers will start paying for embedded emissions in 2027 instead of 2026."),
  s("policy", "en", "Russia bans gasoline exports until year-end as drone strikes hit refineries", "The Energy Ministry said domestic supply comes first after Ryazan and Novokuibyshevsk went offline."),
  s("policy", "en", "G7 finance ministers back tighter enforcement of Russian oil price cap", "Shadow fleet tankers face port bans in the UK and EU under the coordinated measures."),
  // ---- EN: markets & macro
  s("markets", "en", "European stocks slide as bond yields hit 14-year high", "The Stoxx 600 fell 1.2%, led by utilities and real estate, as German 10-year Bunds rose to 2.9%."),
  s("markets", "en", "Fed holds rates, signals two cuts this year despite tariff inflation", "Chair Powell said the labor market has cooled and goods prices reflect one-off tariff effects."),
  s("markets", "en", "Shell profit beats forecasts on trading gains, lifts buyback to $3.5 billion", "Adjusted earnings reached $5.3 billion in the quarter as LNG trading offset weaker refining."),
  s("markets", "en", "Euro climbs above $1.18 as ECB signals end of easing cycle", "President Lagarde said policy is in a good place, with inflation back at target."),
  s("markets", "en", "Gold tops $3,400 as central bank buying and dollar weakness persist", "ETF inflows reached their highest level since 2020, according to the World Gold Council."),
  s("markets", "en", "Chinese exports jump 8% in August as producers front-run tariffs", "Shipments to ASEAN and the EU offset a 30% drop to the United States."),
  s("markets", "en", "Engie raises dividend after grid and renewables lift first-half earnings", "EBIT reached EUR 5.5 billion, with the utility guiding to the upper end of its full-year range."),
  s("markets", "en", "Oil majors' capex to fall for first time since 2020, Rystad says", "Upstream spending will drop 4% to $490 billion as companies prioritise shareholder returns."),
  s("markets", "en", "TotalEnergies shares drop 4% after cutting buyback on weaker oil prices", "The company will repurchase $1.5 billion of shares per quarter, down from $2 billion."),
  s("markets", "en", "Copper miners rally as Codelco cuts output guidance after El Teniente accident", "Antofagasta and Freeport gained more than 5% in London and New York."),
  s("markets", "en", "Japan's Nikkei hits record above 42,000 on chip and shipping stocks", "A weaker yen and raised stakes in the trading houses by Berkshire Hathaway lifted sentiment."),
  s("markets", "en", "Private equity circles Uniper as Germany prepares stake sale", "Berlin must reduce its 99% holding by 2028 under EU state aid conditions."),
  s("markets", "en", "Wall Street closes at record as tariff fears ease and earnings beat", "The S&P 500 rose 0.8% with industrials and energy leading the gains."),
  s("markets", "en", "Aluminium premiums in Europe hit record on US tariff diversion", "The Rotterdam duty-paid premium climbed to $450 a tonne as metal flows to the US."),

  // ---- FR: pétrole & gaz
  s("oilgas", "fr", "Le prix du gaz TTF grimpe de 5% après un incident sur Freeport LNG", "Le contrat de référence européen a dépassé 36 euros le MWh alors que les stocks sont remplis à 87%."),
  s("oilgas", "fr", "TotalEnergies signe un contrat GNL de 15 ans avec l'Inde", "Le groupe fournira 1,5 million de tonnes par an à IOC à partir de 2027 depuis ses projets américains et qataris."),
  s("oilgas", "fr", "L'OPEP+ prolonge ses coupes de production jusqu'à la fin de l'année", "Le Brent a légèrement reculé après la décision, les marchés anticipant une demande chinoise molle."),
  s("oilgas", "fr", "Raffinerie de Donges : Esso confirme l'arrêt définitif de l'unité de distillation", "La reconversion en dépôt de produits importés supprimera 250 postes d'ici 2026."),
  s("oilgas", "fr", "L'Algérie augmente ses exportations de gaz vers l'Italie via Transmed", "Sonatrach vise 25 milliards de mètres cubes cette année, profitant de la baisse des flux russes."),
  // ---- FR: électricité
  s("power", "fr", "RTE alerte sur un risque de coupures d'électricité en cas de vague de froid", "Le gestionnaire du réseau attend 50 GW de nucléaire disponible en janvier, un niveau jugé suffisant sauf grand froid prolongé."),
  s("power", "fr", "EDF relance Flamanville 3 après trois semaines d'arrêt", "Le réacteur EPR devrait atteindre sa pleine puissance de 1 650 MW d'ici mi-octobre."),
  s("power", "fr", "Les prix négatifs de l'électricité battent un record en France cet été", "Plus de 350 heures à prix négatif ont été enregistrées sur EPEX Spot, dopées par le solaire."),
  s("power", "fr", "Nucléaire : l'ASN autorise le redémarrage de Golfech 1 après réparation des tuyauteries", "La centrale du Tarn-et-Garonne était à l'arrêt depuis mars pour corrosion sous contrainte."),
  s("power", "fr", "Enedis prévoit 96 milliards d'euros d'investissements dans le réseau d'ici 2040", "Le raccordement des bornes de recharge et des data centers explique un tiers de la hausse."),
  // ---- FR: transition
  s("renewables", "fr", "Hydrogène vert : Air Liquide inaugure un électrolyseur de 200 MW en Normandie", "L'unité Normand'Hy alimentera la raffinerie de Gonfreville et les industriels de l'axe Seine."),
  s("renewables", "fr", "Éolien en mer : l'État attribue le parc Centre Manche 2 à EDF Renouvelables", "Le projet de 1,5 GW au large de la Normandie doit produire ses premiers électrons en 2032."),
  s("renewables", "fr", "Le marché européen du carbone dépasse 75 euros la tonne", "Les quotas EUA profitent de la réduction de l'offre par la réserve de stabilité et de l'entrée en vigueur du MACF."),
  s("renewables", "fr", "Voitures électriques : les immatriculations bondissent de 25% en France en septembre", "Le leasing social et le retour du bonus expliquent la reprise, selon la PFA."),
  s("renewables", "fr", "Stockage par batteries : Neoen met en service son plus grand site en France", "Le parc de 200 MWh participera aux réserves de fréquence de RTE dès cet hiver."),
  // ---- FR: industrie
  s("industry", "fr", "ArcelorMittal met à l'arrêt un haut-fourneau à Dunkerque face aux importations", "Le sidérurgiste demande à Bruxelles des quotas plus stricts sur l'acier asiatique."),
  s("industry", "fr", "Bruxelles propose de relever les droits de douane sur l'acier chinois", "La Commission veut réduire de moitié les quotas d'importation sans droits et porter le tarif hors quota à 50%."),
  s("industry", "fr", "Airbus livre 62 avions en août, pénalisé par les moteurs", "Pratt & Whitney et CFM peinent à suivre la cadence de l'A320neo, portée à 75 par mois."),
  s("industry", "fr", "Stellantis suspend la production à Poissy pendant trois semaines", "Le constructeur invoque une demande européenne inférieure aux prévisions pour la DS 3 et l'Opel Mokka."),
  s("industry", "fr", "Safran ouvre une usine de freins carbone à Feyzin pour 200 millions d'euros", "Le site doublera la capacité française du groupe d'ici 2028, tiré par les commandes d'Airbus et de Boeing."),
  // ---- FR: politique
  s("policy", "fr", "L'UE adopte un 18e paquet de sanctions contre la Russie visant le GNL", "Le plafond du prix du pétrole russe est abaissé à 47,60 dollars le baril."),
  s("policy", "fr", "Washington relève à 50% les droits de douane sur l'acier et l'aluminium", "Les exportateurs européens redoutent un détournement des flux asiatiques vers le marché européen."),
  s("policy", "fr", "L'Iran menace de fermer le détroit d'Ormuz après les frappes israéliennes", "Les assureurs ont doublé les primes de risque de guerre pour les pétroliers chargés dans le Golfe."),
  s("policy", "fr", "Le gouvernement reporte d'un an la vente des certificats MACF", "Les importateurs d'acier, de ciment et d'engrais paieront le carbone importé à partir de 2027."),
  s("policy", "fr", "La Chine impose des licences d'exportation sur le gallium et le germanium", "Pékin invoque la sécurité nationale ; les prix à Rotterdam ont bondi de 20%."),
  // ---- FR: marchés
  s("markets", "fr", "La BCE maintient ses taux directeurs inchangés pour la troisième fois", "Christine Lagarde estime que la politique monétaire est « bien positionnée » avec une inflation à 2%."),
  s("markets", "fr", "Le CAC 40 recule de 1,5%, plombé par les valeurs de l'énergie", "TotalEnergies et Engie ont cédé plus de 3% après la baisse du Brent sous 70 dollars."),
  s("markets", "fr", "TotalEnergies réduit ses rachats d'actions, le titre chute de 4%", "Le groupe ramène ses rachats trimestriels à 1,5 milliard de dollars face à la baisse du brut."),
  s("markets", "fr", "L'or dépasse 3 400 dollars l'once, porté par les banques centrales", "Les achats de la Chine et de la Pologne et la faiblesse du dollar soutiennent le métal jaune."),
  s("markets", "fr", "L'euro franchit 1,18 dollar, au plus haut depuis 2021", "Les marchés parient sur la fin du cycle de baisse des taux de la BCE."),

  // ---- AR: energy wire (Attaqa)
  s("oilgas", "ar", "أوبك+ تمدد خفض الإنتاج الطوعي حتى نهاية الربع الأول", "ثماني دول بقيادة السعودية وروسيا تبقي على خفض 2.2 مليون برميل يوميا وسط ضعف الطلب."),
  s("oilgas", "ar", "قطر للطاقة توقع اتفاقية لتوريد الغاز المسال إلى الصين لمدة 20 عاما", "العقد بحجم 3 ملايين طن سنويا من مشروع توسعة حقل الشمال الشرقي."),
  s("oilgas", "ar", "أرامكو تخفض أسعار البيع الرسمية لخام العربي الخفيف إلى آسيا", "الخفض بلغ 50 سنتا للبرميل مقارنة بمعيار عمان ودبي."),
  s("oilgas", "ar", "الإمارات تحصل على زيادة في حصتها بأوبك+ بعد تسوية الخلاف مع السعودية", "الاتفاق يمنح أبوظبي 200 ألف برميل يوميا إضافية مقابل الالتزام بالحصص."),
  s("oilgas", "ar", "مصدر وإي دي إف تغلقان تمويل مشروع العجبان للطاقة الشمسية بقدرة 2 جيجاواط", "المشروع سيقترن ببطاريات بسعة 5 جيجاواط ساعة لتوفير إمداد على مدار الساعة."),
  s("oilgas", "ar", "الجزائر ترفع صادرات الغاز إلى إيطاليا عبر خط ترانسميد", "سوناطراك تستهدف 25 مليار متر مكعب هذا العام مستفيدة من تراجع التدفقات الروسية."),
];

const PUBLISHERS: Record<Lang, string[]> = {
  en: ["Reuters", "Bloomberg", "Financial Times", "S&P Global Commodity Insights", "Argus Media", "Montel", "The Wall Street Journal"],
  fr: ["Les Echos", "Le Figaro", "La Tribune", "L'Usine Nouvelle", "AFP"],
  ar: ["الشرق الأوسط", "العربية"],
};

/** Batch positions marked as failed so the health panel has red rows. */
const FAIL_SLOTS: Array<[number, string]> = [
  [3, "HTTP 403"],
  [11, "timeout"],
  [17, "not a feed"],
];

const HOUR = 3_600_000;

/** Age in ms: about half of the items land in the last 24h, the rest fan out to 7 days. */
function spreadMs(rand: () => number): number {
  const r = rand();
  if (r < 0.55) return Math.pow(rand(), 1.6) * 24 * HOUR;
  if (r < 0.8) return (24 + rand() * 48) * HOUR;
  return (72 + rand() * 92) * HOUR;
}

function slug(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function host(src: Source): string {
  try {
    return new URL(src.url).host;
  } catch {
    return "example.com";
  }
}

export function mockFeeds(batch: number, of: number): FeedsResponse {
  const ofN = Math.max(1, Math.floor(Number(of)) || 1);
  const batchN = Math.min(Math.max(0, Math.floor(Number(batch)) || 0), ofN - 1);
  const sources = sourcesForBatch(batchN, ofN);
  const rand = prng(1000 + batchN * 7919 + ofN * 104729);
  const now = Date.now();

  const failed = new Map<string, string>();
  for (const [slot, error] of FAIL_SLOTS) {
    const src = sources[slot];
    if (src) failed.set(src.id, error);
  }
  const healthy = sources.filter((src) => !failed.has(src.id));

  // Round-robin per language and lane so a story lands on an outlet that covers it.
  const counters = new Map<string, number>();
  const pick = (story: Story): Source | undefined => {
    const sameLane = healthy.filter((src) => src.lang === story.lang && src.lane === story.lane);
    const pool = sameLane.length ? sameLane : healthy.filter((src) => src.lang === story.lang);
    if (!pool.length) return undefined;
    const key = `${story.lang}:${sameLane.length ? story.lane : "*"}`;
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    return pool[n % pool.length];
  };

  const counts = new Map<string, number>();
  const items: NewsItem[] = [];
  STORIES.forEach((story, i) => {
    if (i % ofN !== batchN) return;
    const src = pick(story);
    if (!src) return;
    const ts = now - spreadMs(rand);
    const wire = src.kind === "gnews";
    const pubs = PUBLISHERS[story.lang];
    const publisher = wire ? pubs[Math.floor(rand() * pubs.length)] : undefined;
    const link = wire
      ? `https://news.google.com/rss/articles/${hashId(story.title)}${hashId(src.id)}?oc=5`
      : `https://${host(src)}/${slug(story.title) || hashId(story.title)}/`;
    const summary = wire ? "" : story.summary;
    const { lane, lanes } = classify(story.title, summary, src);
    items.push({
      id: hashId(link),
      title: story.title,
      link,
      summary,
      publishedAt: new Date(ts).toISOString(),
      sourceId: src.id,
      source: src.name,
      publisher,
      region: src.region,
      lang: src.lang,
      lanes,
      lane,
    });
    counts.set(src.id, (counts.get(src.id) ?? 0) + 1);
  });
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const statuses: SourceStatus[] = sources.map((src) => {
    const error = failed.get(src.id);
    if (error) {
      const ms = error === "timeout" ? 9000 + Math.round(rand() * 400) : 300 + Math.round(rand() * 900);
      return { id: src.id, name: src.name, ok: false, count: 0, ms, error };
    }
    return { id: src.id, name: src.name, ok: true, count: counts.get(src.id) ?? 0, ms: 120 + Math.round(rand() * 1900) };
  });

  return { generatedAt: new Date(now).toISOString(), batch: batchN, of: ofN, items, sources: statuses };
}

// ------------------------------------------------------------------ Quotes

interface BaseQuote {
  price: number;
  /** Typical daily move in percent, drives the sample change and series. */
  vol: number;
  currency?: string;
}

const BASE: Record<string, BaseQuote> = {
  brent: { price: 68.4, vol: 2.5, currency: "USD" },
  wti: { price: 64.9, vol: 2.5, currency: "USD" },
  henryhub: { price: 3.12, vol: 4, currency: "USD" },
  ttf: { price: 34.8, vol: 4, currency: "EUR" },
  coal: { price: 108.5, vol: 2, currency: "USD" },
  eua: { price: 74.2, vol: 2.5, currency: "EUR" },
  rbob: { price: 2.05, vol: 2.5, currency: "USD" },
  heatingoil: { price: 2.28, vol: 2.5, currency: "USD" },
  copper: { price: 4.62, vol: 2, currency: "USD" },
  aluminium: { price: 2585, vol: 1.5, currency: "USD" },
  hrc: { price: 862, vol: 1.5, currency: "USD" },
  gold: { price: 3385, vol: 1.2, currency: "USD" },
  uranium: { price: 34.6, vol: 2.5, currency: "USD" },
  eurusd: { price: 1.1745, vol: 0.5, currency: "USD" },
  gbpusd: { price: 1.348, vol: 0.5, currency: "USD" },
  usdcny: { price: 7.125, vol: 0.3, currency: "CNY" },
  usdjpy: { price: 147.35, vol: 0.6, currency: "JPY" },
  dxy: { price: 97.85, vol: 0.5 },
  spx: { price: 6480, vol: 1, currency: "USD" },
  sx5e: { price: 5410, vol: 1.2, currency: "EUR" },
  cac: { price: 7780, vol: 1.2, currency: "EUR" },
  dax: { price: 23650, vol: 1.2, currency: "EUR" },
  ftse: { price: 9250, vol: 0.9, currency: "GBP" },
  nikkei: { price: 45200, vol: 1.3, currency: "JPY" },
  hsi: { price: 26300, vol: 1.5, currency: "HKD" },
  us10y: { price: 4.15, vol: 2 },
  vix: { price: 16.4, vol: 7 },
};

/** A couple of symbols come through the fallbacks so their badges show up in the UI. */
const MOCK_PROVIDER: Record<string, { provider: Quote["provider"]; note: string }> = {
  nikkei: { provider: "stooq", note: "vs open" },
  gbpusd: { provider: "frankfurter", note: "ECB daily" },
};

export function mockQuotes(): MarketsResponse {
  const now = new Date();
  const quotes: Quote[] = SYMBOLS.map((def) => {
    const base = BASE[def.id] ?? { price: 100, vol: 1 };
    const rand = prng(seedFrom(def.id));
    const decimals = def.group === "fx" ? 4 : base.price < 10 ? 3 : 2;
    const r = (v: number) => Number(v.toFixed(decimals));

    const pct = (rand() * 2 - 1) * base.vol;
    const price = base.price;
    const prev = price / (1 + pct / 100);
    const walk = [price, prev];
    let p = prev;
    for (let i = 0; i < 3; i++) {
      p = p / (1 + ((rand() * 2 - 1) * base.vol) / 100);
      walk.push(p);
    }
    const series = walk.reverse().map(r);

    const override = MOCK_PROVIDER[def.id];
    const provider = override?.provider ?? "yahoo";
    const noteParts = [def.note, override?.note].filter((n): n is string => !!n);
    const quote: Quote = {
      id: def.id,
      symbol: def.symbol,
      label: def.label,
      group: def.group,
      price: r(price),
      change: provider === "frankfurter" ? null : r(price - prev),
      changePct: provider === "frankfurter" ? null : Number(pct.toFixed(2)),
      currency: base.currency,
      unit: def.unit,
      time: provider === "frankfurter" ? undefined : now.toISOString(),
      series: provider === "frankfurter" ? undefined : provider === "stooq" ? series.slice(-2) : series,
      provider,
      note: noteParts.length ? noteParts.join("; ") : undefined,
    };
    return quote;
  });
  return { generatedAt: now.toISOString(), quotes };
}
