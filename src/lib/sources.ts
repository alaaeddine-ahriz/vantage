import type { Source } from "./types";

/**
 * Curated live sources. Every entry is a public RSS/Atom feed or a Google News
 * search feed. Feeds that go dark show up red in the Source health panel; prune
 * or replace them here.
 */
const gnews = (q: string, hl = "en-US", gl = "US", ceid = "US:en") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

export const SOURCES: Source[] = [
  // ---------------------------------------------------------------- Global wires
  { id: "bbc-business", name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", region: "global", lang: "en", lane: "markets" },
  { id: "bbc-world", name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", region: "global", lang: "en", lane: "policy" },
  { id: "cnbc-energy", name: "CNBC Energy", url: "https://www.cnbc.com/id/19836768/device/rss/rss.html", region: "americas", lang: "en", lane: "oilgas" },
  { id: "cnbc-world", name: "CNBC World", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html", region: "global", lang: "en", lane: "markets" },
  { id: "wsj-markets", name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", region: "americas", lang: "en", lane: "markets" },
  { id: "wsj-world", name: "WSJ World", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", region: "global", lang: "en", lane: "policy" },
  { id: "wsj-business", name: "WSJ Business", url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml", region: "americas", lang: "en", lane: "industry" },
  { id: "nyt-energy", name: "NYT Energy & Environment", url: "https://rss.nytimes.com/services/xml/rss/nyt/EnergyEnvironment.xml", region: "americas", lang: "en", lane: "renewables" },
  { id: "nyt-business", name: "NYT Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", region: "americas", lang: "en", lane: "markets" },
  { id: "guardian-energy", name: "Guardian Energy", url: "https://www.theguardian.com/environment/energy/rss", region: "europe", lang: "en", lane: "power" },
  { id: "guardian-business", name: "Guardian Business", url: "https://www.theguardian.com/uk/business/rss", region: "europe", lang: "en", lane: "markets" },
  { id: "ft-energy", name: "FT Energy", url: "https://www.ft.com/energy?format=rss", region: "europe", lang: "en", lane: "oilgas" },
  { id: "ft-commodities", name: "FT Commodities", url: "https://www.ft.com/commodities?format=rss", region: "europe", lang: "en", lane: "markets" },
  { id: "ft-industrials", name: "FT Industrials", url: "https://www.ft.com/industrials?format=rss", region: "europe", lang: "en", lane: "industry" },
  { id: "aljazeera", name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", region: "mena", lang: "en", lane: "policy" },
  { id: "france24-en", name: "France 24 (EN)", url: "https://www.france24.com/en/rss", region: "global", lang: "en", lane: "policy" },
  { id: "dw-business", name: "DW Business", url: "https://rss.dw.com/rdf/rss-en-bus", region: "europe", lang: "en", lane: "industry" },
  { id: "politico-eu-energy", name: "Politico EU Energy", url: "https://www.politico.eu/section/energy/feed/", region: "europe", lang: "en", lane: "policy" },
  { id: "euractiv-energy", name: "Euractiv Energy", url: "https://www.euractiv.com/sections/energy-environment/feed/", region: "europe", lang: "en", lane: "policy" },

  // ---------------------------------------------------------------- Energy trade press
  { id: "oilprice", name: "OilPrice.com", url: "https://oilprice.com/rss/main", region: "global", lang: "en", lane: "oilgas" },
  { id: "rigzone", name: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", region: "global", lang: "en", lane: "oilgas" },
  { id: "energyvoice", name: "Energy Voice", url: "https://www.energyvoice.com/feed/", region: "europe", lang: "en", lane: "oilgas" },
  { id: "worldoil", name: "World Oil", url: "https://www.worldoil.com/rss?feed=news", region: "global", lang: "en", lane: "oilgas" },
  { id: "upstream", name: "Upstream", url: "https://www.upstreamonline.com/rss", region: "global", lang: "en", lane: "oilgas" },
  { id: "offshore-energy", name: "Offshore Energy", url: "https://www.offshore-energy.biz/feed/", region: "europe", lang: "en", lane: "oilgas" },
  { id: "ngi", name: "Natural Gas Intelligence", url: "https://www.naturalgasintel.com/feed/", region: "americas", lang: "en", lane: "oilgas" },
  { id: "eia-tie", name: "EIA Today in Energy", url: "https://www.eia.gov/rss/todayinenergy.xml", region: "americas", lang: "en", lane: "oilgas" },
  { id: "utilitydive", name: "Utility Dive", url: "https://www.utilitydive.com/feeds/news/", region: "americas", lang: "en", lane: "power" },
  { id: "power-eng", name: "Power Engineering", url: "https://www.power-eng.com/feed/", region: "americas", lang: "en", lane: "power" },
  { id: "power-tech", name: "Power Technology", url: "https://www.power-technology.com/feed/", region: "global", lang: "en", lane: "power" },
  { id: "wnn", name: "World Nuclear News", url: "https://www.world-nuclear-news.org/rss", region: "global", lang: "en", lane: "power" },
  { id: "pv-magazine", name: "PV Magazine", url: "https://www.pv-magazine.com/feed/", region: "global", lang: "en", lane: "renewables" },
  { id: "renews", name: "reNEWS", url: "https://renews.biz/feed/", region: "europe", lang: "en", lane: "renewables" },
  { id: "recharge", name: "Recharge", url: "https://www.rechargenews.com/rss", region: "global", lang: "en", lane: "renewables" },
  { id: "offshorewind", name: "offshoreWIND.biz", url: "https://www.offshorewind.biz/feed/", region: "europe", lang: "en", lane: "renewables" },
  { id: "hydrogeninsight", name: "Hydrogen Insight", url: "https://www.hydrogeninsight.com/rss", region: "global", lang: "en", lane: "renewables" },
  { id: "ess-news", name: "Energy-Storage.news", url: "https://www.energy-storage.news/feed/", region: "global", lang: "en", lane: "renewables" },
  { id: "carbonbrief", name: "Carbon Brief", url: "https://www.carbonbrief.org/feed/", region: "europe", lang: "en", lane: "renewables" },
  { id: "energymonitor", name: "Energy Monitor", url: "https://www.energymonitor.ai/feed/", region: "global", lang: "en", lane: "renewables" },
  { id: "electrek", name: "Electrek", url: "https://electrek.co/feed/", region: "americas", lang: "en", lane: "renewables" },
  { id: "cleantechnica", name: "CleanTechnica", url: "https://cleantechnica.com/feed/", region: "americas", lang: "en", lane: "renewables" },

  // ---------------------------------------------------------------- Industry & materials
  { id: "mining-com", name: "Mining.com", url: "https://www.mining.com/feed/", region: "global", lang: "en", lane: "industry" },
  { id: "gmk", name: "GMK Center (steel)", url: "https://gmk.center/en/feed/", region: "europe", lang: "en", lane: "industry" },
  { id: "themanufacturer", name: "The Manufacturer", url: "https://www.themanufacturer.com/feed/", region: "europe", lang: "en", lane: "industry" },
  { id: "manufacturingdive", name: "Manufacturing Dive", url: "https://www.manufacturingdive.com/feeds/news/", region: "americas", lang: "en", lane: "industry" },
  { id: "supplychaindive", name: "Supply Chain Dive", url: "https://www.supplychaindive.com/feeds/news/", region: "americas", lang: "en", lane: "industry" },
  { id: "automotivedive", name: "Automotive Dive", url: "https://www.automotivedive.com/feeds/news/", region: "americas", lang: "en", lane: "industry" },
  { id: "just-auto", name: "Just Auto", url: "https://www.just-auto.com/feed/", region: "europe", lang: "en", lane: "industry" },
  { id: "gcaptain", name: "gCaptain (shipping)", url: "https://gcaptain.com/feed/", region: "global", lang: "en", lane: "industry" },
  { id: "splash247", name: "Splash247 (shipping)", url: "https://splash247.com/feed/", region: "asia", lang: "en", lane: "industry" },
  { id: "tradewinds", name: "TradeWinds", url: "https://www.tradewindsnews.com/rss", region: "global", lang: "en", lane: "industry" },

  // ---------------------------------------------------------------- Asia
  { id: "nikkei", name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar", region: "asia", lang: "en", lane: "industry" },
  { id: "scmp-business", name: "SCMP Business", url: "https://www.scmp.com/rss/92/feed", region: "asia", lang: "en", lane: "markets" },
  { id: "et-energy", name: "Economic Times Energy", url: "https://economictimes.indiatimes.com/industry/energy/rssfeeds/13358361.cms", region: "asia", lang: "en", lane: "power" },
  { id: "et-industry", name: "Economic Times Industry", url: "https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms", region: "asia", lang: "en", lane: "industry" },

  // ---------------------------------------------------------------- Middle East & North Africa
  { id: "arabnews-business", name: "Arab News Business", url: "https://www.arabnews.com/cat/4/rss.xml", region: "mena", lang: "en", lane: "markets" },
  { id: "aa-energy", name: "Anadolu Energy", url: "https://www.aa.com.tr/en/rss/default?cat=energy", region: "mena", lang: "en", lane: "oilgas" },
  { id: "al-monitor", name: "Al-Monitor", url: "https://www.al-monitor.com/rss", region: "mena", lang: "en", lane: "policy" },
  { id: "mee", name: "Middle East Eye", url: "https://www.middleeasteye.net/rss", region: "mena", lang: "en", lane: "policy" },
  { id: "egyptoilgas", name: "Egypt Oil & Gas", url: "https://egyptoil-gas.com/feed/", region: "mena", lang: "en", lane: "oilgas" },
  { id: "mwn", name: "Morocco World News", url: "https://www.moroccoworldnews.com/feed", region: "africa", lang: "en", lane: "policy" },
  { id: "attaqa", name: "Attaqa (الطاقة)", url: "https://attaqa.net/feed/", region: "mena", lang: "ar", lane: "oilgas" },
  { id: "tsa", name: "TSA Algérie", url: "https://www.tsa-algerie.com/feed/", region: "africa", lang: "fr", lane: "policy" },
  { id: "medias24", name: "Médias24", url: "https://medias24.com/feed/", region: "africa", lang: "fr", lane: "markets" },

  // ---------------------------------------------------------------- France (FR)
  { id: "lesechos-industrie", name: "Les Echos Industrie", url: "https://services.lesechos.fr/rss/les-echos-industrie-services.xml", region: "france", lang: "fr", lane: "industry" },
  { id: "lesechos-economie", name: "Les Echos Économie", url: "https://services.lesechos.fr/rss/les-echos-economie.xml", region: "france", lang: "fr", lane: "markets" },
  { id: "lesechos-marches", name: "Les Echos Finance-Marchés", url: "https://services.lesechos.fr/rss/les-echos-finance-marches.xml", region: "france", lang: "fr", lane: "markets" },
  { id: "lesechos-monde", name: "Les Echos Monde", url: "https://services.lesechos.fr/rss/les-echos-monde.xml", region: "france", lang: "fr", lane: "policy" },
  { id: "lemonde-energies", name: "Le Monde Énergies", url: "https://www.lemonde.fr/energies/rss_full.xml", region: "france", lang: "fr", lane: "power" },
  { id: "lemonde-economie", name: "Le Monde Économie", url: "https://www.lemonde.fr/economie/rss_full.xml", region: "france", lang: "fr", lane: "markets" },
  { id: "lemonde-international", name: "Le Monde International", url: "https://www.lemonde.fr/international/rss_full.xml", region: "france", lang: "fr", lane: "policy" },
  { id: "figaro-eco", name: "Le Figaro Économie", url: "https://www.lefigaro.fr/rss/figaro_economie.xml", region: "france", lang: "fr", lane: "markets" },
  { id: "bfm-eco", name: "BFM Business", url: "https://www.bfmtv.com/rss/economie/", region: "france", lang: "fr", lane: "markets" },
  { id: "rfi-eco", name: "RFI Économie", url: "https://www.rfi.fr/fr/economie/rss", region: "france", lang: "fr", lane: "policy" },
  { id: "france24-fr", name: "France 24 (FR)", url: "https://www.france24.com/fr/rss", region: "france", lang: "fr", lane: "policy" },
  { id: "challenges", name: "Challenges", url: "https://www.challenges.fr/rss.xml", region: "france", lang: "fr", lane: "industry" },
  { id: "capital", name: "Capital", url: "https://www.capital.fr/rss", region: "france", lang: "fr", lane: "markets" },
  { id: "cde", name: "Connaissance des Énergies", url: "https://www.connaissancedesenergies.org/rss.xml", region: "france", lang: "fr", lane: "power" },
  { id: "revolution-energetique", name: "Révolution Énergétique", url: "https://www.revolution-energetique.com/feed/", region: "france", lang: "fr", lane: "renewables" },
  { id: "lenergeek", name: "L'Énergeek", url: "https://lenergeek.com/feed/", region: "france", lang: "fr", lane: "power" },
  { id: "lemondedelenergie", name: "Le Monde de l'Énergie", url: "https://www.lemondedelenergie.com/feed/", region: "france", lang: "fr", lane: "power" },

  // ---------------------------------------------------------------- Google News topic wires (keyless, live)
  { id: "gn-opec", name: "Wire: OPEC / oil prices", url: gnews('OPEC OR "oil prices" OR Brent'), region: "global", lang: "en", lane: "oilgas", kind: "gnews" },
  { id: "gn-lng", name: "Wire: LNG / natural gas", url: gnews('LNG OR "natural gas" OR TTF'), region: "global", lang: "en", lane: "oilgas", kind: "gnews" },
  { id: "gn-grid", name: "Wire: power grid / electricity", url: gnews('"power grid" OR "electricity prices" OR "nuclear power"'), region: "global", lang: "en", lane: "power", kind: "gnews" },
  { id: "gn-transition", name: "Wire: energy transition", url: gnews('"offshore wind" OR "solar" OR hydrogen OR "battery storage"'), region: "global", lang: "en", lane: "renewables", kind: "gnews" },
  { id: "gn-metals", name: "Wire: steel / metals / tariffs", url: gnews('steel OR aluminium OR copper tariffs OR "critical minerals"'), region: "global", lang: "en", lane: "industry", kind: "gnews" },
  { id: "gn-reuters-energy", name: "Wire: Reuters energy", url: gnews("site:reuters.com energy"), region: "global", lang: "en", lane: "oilgas", kind: "gnews" },
  { id: "gn-bloomberg-energy", name: "Wire: Bloomberg energy", url: gnews("site:bloomberg.com energy"), region: "global", lang: "en", lane: "markets", kind: "gnews" },
  { id: "gn-fr-energie", name: "Fil: énergie & industrie (FR)", url: gnews("énergie OR industrie OR électricité OR pétrole", "fr", "FR", "FR:fr"), region: "france", lang: "fr", lane: "industry", kind: "gnews" },
];

export const SOURCE_BY_ID: Record<string, Source> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s]),
);

/** Number of parallel serverless invocations the client fans out to. */
export const FEED_BATCHES = 4;

export function sourcesForBatch(batch: number, of: number): Source[] {
  return SOURCES.filter((_, i) => i % of === batch);
}
