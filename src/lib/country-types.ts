/**
 * Country data contract: indicator catalogue (World Bank + IMF WEO), series shapes,
 * and the API responses used by the Countries view.
 */

export type IndicatorGroup = "economy" | "energy" | "power" | "industry" | "trade" | "governance";

export type IndicatorSource = "wb" | "imf";

export interface IndicatorDef {
  id: string;
  /** World Bank indicator code, or IMF WEO datamapper code when source is "imf". */
  code: string;
  source: IndicatorSource;
  label: string;
  short: string;
  group: IndicatorGroup;
  unit: string;
  /** "pct" renders with one decimal and a % sign, "usd" abbreviates (k, M, B, T), "num" plain, "idx" two decimals. */
  fmt: "pct" | "usd" | "num" | "idx";
  /** Which direction is usually favourable for an investor or importer view; "none" when it depends. */
  better: "up" | "down" | "none";
  /** True when the IMF series carries forecast years beyond the current year. */
  forecast?: boolean;
  /** World Bank source id when the indicator lives outside source 2 (WGI is source 3). */
  wbSource?: number;
}

export const INDICATORS: IndicatorDef[] = [
  // ---------------------------------------------------------------- economy
  { id: "gdp", code: "NY.GDP.MKTP.CD", source: "wb", label: "GDP (current US$)", short: "GDP", group: "economy", unit: "US$", fmt: "usd", better: "up" },
  { id: "gdp_pc", code: "NY.GDP.PCAP.CD", source: "wb", label: "GDP per capita", short: "GDP/cap", group: "economy", unit: "US$", fmt: "usd", better: "up" },
  { id: "gdp_growth", code: "NGDP_RPCH", source: "imf", label: "Real GDP growth (IMF WEO)", short: "GDP growth", group: "economy", unit: "%", fmt: "pct", better: "up", forecast: true },
  { id: "inflation", code: "PCPIPCH", source: "imf", label: "Inflation, average CPI (IMF WEO)", short: "Inflation", group: "economy", unit: "%", fmt: "pct", better: "down", forecast: true },
  { id: "unemployment", code: "LUR", source: "imf", label: "Unemployment rate (IMF WEO)", short: "Unemploy.", group: "economy", unit: "%", fmt: "pct", better: "down", forecast: true },
  { id: "current_account", code: "BCA_NGDPD", source: "imf", label: "Current account balance (IMF WEO)", short: "Cur. acct", group: "economy", unit: "% GDP", fmt: "pct", better: "up", forecast: true },
  { id: "gov_debt", code: "GGXWDG_NGDP", source: "imf", label: "General government gross debt (IMF WEO)", short: "Gov debt", group: "economy", unit: "% GDP", fmt: "pct", better: "down", forecast: true },
  { id: "fdi", code: "BX.KLT.DINV.WD.GD.ZS", source: "wb", label: "FDI net inflows", short: "FDI", group: "economy", unit: "% GDP", fmt: "pct", better: "up" },
  { id: "capex", code: "NE.GDI.TOTL.ZS", source: "wb", label: "Gross capital formation", short: "Investment", group: "economy", unit: "% GDP", fmt: "pct", better: "up" },
  { id: "population", code: "SP.POP.TOTL", source: "wb", label: "Population", short: "Population", group: "economy", unit: "people", fmt: "num", better: "none" },

  // ---------------------------------------------------------------- energy
  { id: "energy_use_pc", code: "EG.USE.PCAP.KG.OE", source: "wb", label: "Energy use per capita", short: "Energy/cap", group: "energy", unit: "kg oe", fmt: "num", better: "none" },
  { id: "energy_imports", code: "EG.IMP.CONS.ZS", source: "wb", label: "Energy imports, net", short: "Energy imports", group: "energy", unit: "% of use", fmt: "pct", better: "down" },
  { id: "fossil_share", code: "EG.USE.COMM.FO.ZS", source: "wb", label: "Fossil fuel energy consumption", short: "Fossil share", group: "energy", unit: "% of total", fmt: "pct", better: "none" },
  { id: "renewable_share", code: "EG.FEC.RNEW.ZS", source: "wb", label: "Renewable energy consumption", short: "Renewables", group: "energy", unit: "% of final", fmt: "pct", better: "up" },
  { id: "energy_intensity", code: "EG.EGY.PRIM.PP.KD", source: "wb", label: "Energy intensity of GDP", short: "Intensity", group: "energy", unit: "MJ per $ PPP", fmt: "idx", better: "down" },
  { id: "oil_rents", code: "NY.GDP.PETR.RT.ZS", source: "wb", label: "Oil rents", short: "Oil rents", group: "energy", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "gas_rents", code: "NY.GDP.NGAS.RT.ZS", source: "wb", label: "Natural gas rents", short: "Gas rents", group: "energy", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "coal_rents", code: "NY.GDP.COAL.RT.ZS", source: "wb", label: "Coal rents", short: "Coal rents", group: "energy", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "fuel_exports", code: "TX.VAL.FUEL.ZS.UN", source: "wb", label: "Fuel exports", short: "Fuel exports", group: "energy", unit: "% merch. exports", fmt: "pct", better: "none" },
  { id: "fuel_imports", code: "TM.VAL.FUEL.ZS.UN", source: "wb", label: "Fuel imports", short: "Fuel imports", group: "energy", unit: "% merch. imports", fmt: "pct", better: "down" },
  { id: "co2_pc", code: "EN.GHG.CO2.PC.CE.AR5", source: "wb", label: "CO2 emissions per capita", short: "CO2/cap", group: "energy", unit: "t", fmt: "idx", better: "down" },

  // ---------------------------------------------------------------- power
  { id: "elec_use_pc", code: "EG.USE.ELEC.KH.PC", source: "wb", label: "Electric power consumption per capita", short: "kWh/cap", group: "power", unit: "kWh", fmt: "num", better: "none" },
  { id: "elec_access", code: "EG.ELC.ACCS.ZS", source: "wb", label: "Access to electricity", short: "Access", group: "power", unit: "% pop.", fmt: "pct", better: "up" },
  { id: "elec_renew", code: "EG.ELC.RNEW.ZS", source: "wb", label: "Renewable electricity output", short: "Renew. elec", group: "power", unit: "% of output", fmt: "pct", better: "up" },
  { id: "elec_nuclear", code: "EG.ELC.NUCL.ZS", source: "wb", label: "Electricity from nuclear", short: "Nuclear", group: "power", unit: "% of output", fmt: "pct", better: "none" },
  { id: "elec_coal", code: "EG.ELC.COAL.ZS", source: "wb", label: "Electricity from coal", short: "Coal", group: "power", unit: "% of output", fmt: "pct", better: "down" },
  { id: "elec_gas", code: "EG.ELC.NGAS.ZS", source: "wb", label: "Electricity from natural gas", short: "Gas", group: "power", unit: "% of output", fmt: "pct", better: "none" },
  { id: "elec_hydro", code: "EG.ELC.HYRO.ZS", source: "wb", label: "Electricity from hydro", short: "Hydro", group: "power", unit: "% of output", fmt: "pct", better: "none" },
  { id: "elec_losses", code: "EG.ELC.LOSS.ZS", source: "wb", label: "Transmission and distribution losses", short: "Grid losses", group: "power", unit: "% of output", fmt: "pct", better: "down" },

  // ---------------------------------------------------------------- industry
  { id: "industry_va", code: "NV.IND.TOTL.ZS", source: "wb", label: "Industry value added", short: "Industry", group: "industry", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "manuf_va", code: "NV.IND.MANF.ZS", source: "wb", label: "Manufacturing value added", short: "Manufacturing", group: "industry", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "manuf_growth", code: "NV.IND.MANF.KD.ZG", source: "wb", label: "Manufacturing value added growth", short: "Manuf. growth", group: "industry", unit: "%", fmt: "pct", better: "up" },
  { id: "manuf_exports", code: "TX.VAL.MANF.ZS.UN", source: "wb", label: "Manufactures exports", short: "Manuf. exports", group: "industry", unit: "% merch. exports", fmt: "pct", better: "none" },
  { id: "hightech_exports", code: "TX.VAL.TECH.ZS", source: "wb", label: "High-technology exports", short: "High-tech", group: "industry", unit: "% manuf. exports", fmt: "pct", better: "up" },
  { id: "metals_exports", code: "TX.VAL.MMTL.ZS.UN", source: "wb", label: "Ores and metals exports", short: "Metals exports", group: "industry", unit: "% merch. exports", fmt: "pct", better: "none" },
  { id: "mineral_rents", code: "NY.GDP.MINR.RT.ZS", source: "wb", label: "Mineral rents", short: "Mineral rents", group: "industry", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "rd", code: "GB.XPD.RSDV.GD.ZS", source: "wb", label: "R&D expenditure", short: "R&D", group: "industry", unit: "% GDP", fmt: "pct", better: "up" },

  // ---------------------------------------------------------------- trade
  { id: "trade", code: "NE.TRD.GNFS.ZS", source: "wb", label: "Trade (exports plus imports)", short: "Trade", group: "trade", unit: "% GDP", fmt: "pct", better: "none" },
  { id: "exports", code: "NE.EXP.GNFS.ZS", source: "wb", label: "Exports of goods and services", short: "Exports", group: "trade", unit: "% GDP", fmt: "pct", better: "up" },
  { id: "tariff", code: "TM.TAX.MRCH.WM.AR.ZS", source: "wb", label: "Tariff rate, applied, weighted mean", short: "Tariff", group: "trade", unit: "%", fmt: "idx", better: "down" },
  { id: "lpi", code: "LP.LPI.OVRL.XQ", source: "wb", label: "Logistics performance index", short: "Logistics", group: "trade", unit: "1 to 5", fmt: "idx", better: "up" },

  // ---------------------------------------------------------------- governance (WGI, -2.5 to 2.5)
  { id: "pol_stability", code: "PV.EST", source: "wb", label: "Political stability, no violence", short: "Stability", group: "governance", unit: "-2.5 to 2.5", fmt: "idx", better: "up", wbSource: 3 },
  { id: "rule_of_law", code: "RL.EST", source: "wb", label: "Rule of law", short: "Rule of law", group: "governance", unit: "-2.5 to 2.5", fmt: "idx", better: "up", wbSource: 3 },
  { id: "reg_quality", code: "RQ.EST", source: "wb", label: "Regulatory quality", short: "Regulation", group: "governance", unit: "-2.5 to 2.5", fmt: "idx", better: "up", wbSource: 3 },
  { id: "gov_effect", code: "GE.EST", source: "wb", label: "Government effectiveness", short: "Gov. effect.", group: "governance", unit: "-2.5 to 2.5", fmt: "idx", better: "up", wbSource: 3 },
  { id: "corruption", code: "CC.EST", source: "wb", label: "Control of corruption", short: "Corruption ctl", group: "governance", unit: "-2.5 to 2.5", fmt: "idx", better: "up", wbSource: 3 },
];

export const INDICATOR_BY_ID: Record<string, IndicatorDef> = Object.fromEntries(INDICATORS.map((d) => [d.id, d]));

export const GROUP_LABEL: Record<IndicatorGroup, string> = {
  economy: "Economy",
  energy: "Energy",
  power: "Power",
  industry: "Industry",
  trade: "Trade",
  governance: "Governance",
};

export interface SeriesPoint {
  year: number;
  value: number;
  /** True for IMF projections. */
  est?: boolean;
}

export interface IndicatorSeries {
  id: string;
  points: SeriesPoint[];
  /** Latest actual (non-estimate) point, if any. */
  latest?: SeriesPoint;
  /** Previous actual point before latest. */
  prev?: SeriesPoint;
  /** Same indicator for the world aggregate (World Bank "WLD"), latest year, when available. */
  world?: number;
}

export interface CountryProfile {
  iso2: string;
  iso3: string;
  name: string;
  region: string;
  incomeLevel: string;
  capital?: string;
  lat?: number;
  lng?: number;
}

export interface CountryData {
  generatedAt: string;
  profile: CountryProfile;
  series: Record<string, IndicatorSeries>;
  /** Indicator ids that failed to load or have no data. */
  missing: string[];
  mock?: boolean;
  sources: { wb: "ok" | "failed" | "skipped"; imf: "ok" | "failed" | "skipped" };
  /** Why a source failed, per source: "timeout after 12s", "HTTP 403", "fetch failed (ENOTFOUND)". */
  errors?: { wb?: string; imf?: string };
}

export interface ScreenerRow {
  iso2: string;
  iso3: string;
  name: string;
  region: string;
  value: number;
  year: number;
  /** Value 5 years earlier when available, for the change column. */
  prev5?: number;
}

export interface ScreenerData {
  generatedAt: string;
  indicator: string;
  rows: ScreenerRow[];
  mock?: boolean;
}
