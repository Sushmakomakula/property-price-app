// Free public parcel (property tax) services, one per state.
// Each returns official county / state records for a single property: values, owner, sale, building facts.
// All are public government services that allow browser access (CORS) and need no key.
(function () {
  const num = v => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
  const pos = v => { const n = num(v); return n && n > 0 ? n : null; };
  const txt = v => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
  const ymd = s => { s = txt(s); if (!/^\d{8}$/.test(s) || s === "00000000") return null; return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); };
  const yymmdd = s => { s = txt(s); if (!/^\d{6}$/.test(s)) return null; let y = +s.slice(0, 2); y += y > 50 ? 1900 : 2000; return new Date(y, +s.slice(2, 4) - 1, +s.slice(4, 6)); };
  const epoch = v => { const n = num(v); return n ? new Date(n) : null; };
  const iso = v => { const s = txt(v); if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };

  const P = {
    TX: {
      name: "Texas county appraisal districts (via Texas Geographic Information Office)",
      kind: "identify",
      url: "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer",
      addr: a => a.SITUS_ADDR, num: a => a.SITUS_NUM,
      map: a => ({
        address: txt(a.SITUS_ADDR), owner: txt(a.OWNER_NAME), county: txt(a.COUNTY),
        values: [["Market value", pos(a.MKT_VALUE)], ["Land value", pos(a.LAND_VALUE)], ["Building value", pos(a.IMP_VALUE)]],
        valueYear: txt(a.TAX_YEAR), source: txt(a.SOURCE),
        yearBuilt: pos(a.YEAR_BUILT), lotAcres: pos(a.LEGAL_AREA) || pos(a.GIS_AREA), legal: txt(a.LEGAL_DESC), id: txt(a.PROP_ID),
        noSale: "Texas law keeps sale prices private, so county records do not include them."
      })
    },
    MD: {
      name: "Maryland Department of Assessments and Taxation (via MD iMAP)",
      url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0",
      pointLayer: true,
      addr: a => a.ADDRESS, num: a => a.STRTNUM,
      map: a => ({
        address: [txt(a.ADDRESS), txt(a.CITY), txt(a.ZIPCODE)].filter(Boolean).join(", "),
        values: [["Full market value", pos(a.NFMTTLVL)], ["Land value", pos(a.NFMLNDVL)], ["Building value", pos(a.NFMIMPVL)]],
        valueYear: txt(a.LASTASSD).slice(0, 4),
        sale: { price: pos(a.CONSIDR1), date: ymd(a.TRADATE) },
        yearBuilt: pos(a.YEARBLT), livingArea: pos(a.SQFTSTRC), lotAcres: pos(a.ACRES), use: txt(a.DESCLU),
        style: txt(a.DESCSTYL), link: txt(a.SDATWEBADR), id: txt(a.ACCTID),
        mail: { street: txt(a.OWNADD1), city: txt(a.OWNCITY), state: txt(a.OWNSTATE), zip: txt(a.OWNERZIP) },
        ownerOccupied: txt(a.OOI) === "H" ? true : txt(a.OOI) === "N" ? false : null
      })
    },
    CT: {
      name: "Connecticut State Parcel Layer (town assessors, 2023 collection)",
      url: "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0",
      addr: a => a.Location,
      map: a => ({
        address: [txt(a.Location), txt(a.Town_Name)].filter(Boolean).join(", "), owner: [txt(a.Owner), txt(a.Co_Owner)].filter(Boolean).join(" & "),
        values: [["Appraised value", (pos(a.Appraised_Land) || 0) + (pos(a.Appraised_Building) || 0) + (pos(a.Appraised_Outbuilding) || 0) + (pos(a.Appraised_Extra_Feature) || 0) || null],
                 ["Assessed value (70% of appraised)", pos(a.Assessed_Total)], ["Land", pos(a.Appraised_Land)], ["Building", pos(a.Appraised_Building)]],
        valueYear: txt(a.Valuation_Year),
        sale: { price: pos(a.Sale_Price), date: epoch(a.Sale_Date) }, prior: { price: pos(a.Prior_Sale_Price), date: epoch(a.Prior_Sale_Date) },
        yearBuilt: pos(a.AYB), livingArea: pos(a.Living_Area), rooms: pos(a.Total_Rooms), beds: pos(a.Number_of_Bedroom),
        baths: pos(a.Number_of_Baths) ? pos(a.Number_of_Baths) + (pos(a.Number_of_Half_Baths) ? " full, " + pos(a.Number_of_Half_Baths) + " half" : "") : null,
        use: txt(a.State_Use_Description), condition: txt(a.Condition_Description), zoning: txt(a.Zone),
        mail: { street: txt(a.Mailing_Address), city: txt(a.Mailing_City), state: txt(a.Mailing_State), zip: "" }
      })
    },
    MA: {
      name: "Massachusetts property tax parcels (local assessors, via MassGIS)",
      url: "https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0",
      addr: a => a.SITE_ADDR, num: a => a.ADDR_NUM,
      map: a => ({
        address: [txt(a.SITE_ADDR), txt(a.CITY), txt(a.ZIP).slice(0, 5)].filter(Boolean).join(", "), owner: txt(a.OWNER1),
        values: [["Assessed value", pos(a.TOTAL_VAL)], ["Land", pos(a.LAND_VAL)], ["Building", pos(a.BLDG_VAL)], ["Other", pos(a.OTHER_VAL)]],
        valueYear: a.FY ? "FY " + a.FY : "",
        sale: { price: pos(a.LS_PRICE), date: ymd(a.LS_DATE) },
        yearBuilt: pos(a.YEAR_BUILT), livingArea: pos(a.RES_AREA) || pos(a.BLD_AREA), rooms: pos(a.NUM_ROOMS), lotAcres: pos(a.LOT_SIZE),
        use: txt(a.USE_DESC), style: txt(a.STYLE), zoning: txt(a.ZONING),
        mail: { street: txt(a.OWN_ADDR), city: txt(a.OWN_CITY), state: txt(a.OWN_STATE), zip: txt(a.OWN_ZIP) }
      })
    },
    NJ: {
      name: "New Jersey MOD-IV tax records (via NJ Office of GIS)",
      url: "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0",
      addr: a => a.PROP_LOC,
      map: a => ({
        address: [txt(a.PROP_LOC), txt(a.MUN_NAME)].filter(Boolean).join(", "), owner: txt(a.OWNER_NAME), county: txt(a.COUNTY),
        values: [["Assessed value", pos(a.NET_VALUE)], ["Land", pos(a.LAND_VAL)], ["Improvements", pos(a.IMPRVT_VAL)], ["Last year's property tax", pos(a.LAST_YR_TX)]],
        sale: { price: pos(a.SALE_PRICE), date: yymmdd(a.DEED_DATE) },
        yearBuilt: pos(a.YR_CONSTR), lotAcres: pos(a.CALC_ACRE), building: txt(a.BLDG_DESC), lotSize: txt(a.LAND_DESC),
        use: ({"1": "Vacant land", "2": "Residential", "3A": "Farm (house)", "3B": "Farmland", "4A": "Commercial", "4B": "Industrial", "4C": "Apartments", "15A": "Exempt (school)", "15B": "Exempt (school)", "15C": "Exempt (public)", "15D": "Exempt (church/charity)", "15E": "Exempt (cemetery)", "15F": "Exempt (other)"})[txt(a.PROP_CLASS)] || "",
        note: "New Jersey assessed values can be well below market value in towns that have not reassessed recently.",
        mail: { street: txt(a.ST_ADDRESS), city: txt(a.CITY_STATE).split(",")[0], state: ((txt(a.CITY_STATE).toUpperCase().match(/(?:,|\s)\s*([A-Z]{2})\.?$/) || [])[1]) || "", zip: txt(a.ZIP_CODE) }
      })
    },
    NC: {
      name: "North Carolina county parcels (via NC OneMap)",
      url: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1",
      addr: a => a.siteadd, num: a => a.saddno,
      map: a => ({
        address: [txt(a.siteadd), txt(a.scity), txt(a.szip)].filter(Boolean).join(", "), owner: [txt(a.ownname), txt(a.ownname2)].filter(Boolean).join(" & "), county: txt(a.cntyname),
        values: [[(txt(a.parvaltype) || "Total") + " value", pos(a.parval)], ["Land", pos(a.landval)], ["Improvements", pos(a.improvval)]],
        sale: { price: null, date: iso(a.saledatetx) || epoch(a.saledate) }, noPrice: true,
        noSale: "North Carolina's statewide parcel file has sale dates but not sale prices. The county buttons below lead to the deed and price.",
        yearBuilt: pos(a.structyear), lotAcres: pos(a.recareano) || pos(a.gisacres), use: txt(a.parusedsc2 || a.parusedesc), source: txt(a.sourceagnt),
        deed: txt(a.sourceref),
        mail: { street: txt(a.mailadd), city: txt(a.mcity).replace(/\s+[A-Z]{2}\s+[\d-]+$/, ""), state: txt(a.mstate) || (txt(a.mcity).match(/\s([A-Z]{2})\s+[\d-]+$/) || [])[1] || "", zip: txt(a.mzip) }
      })
    },
    WI: {
      name: "Wisconsin Statewide Parcels (local assessors, via State Cartographer's Office)",
      url: "https://services3.arcgis.com/n6uYoouQZW75n5WI/ArcGIS/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0",
      addr: a => a.SITEADRESS, num: a => a.ADDNUM,
      map: a => ({
        address: [txt(a.SITEADRESS), txt(a.PLACENAME), txt(a.ZIPCODE)].filter(Boolean).join(", "), owner: [txt(a.OWNERNME1), txt(a.OWNERNME2)].filter(Boolean).join(" & "), county: txt(a.CONAME),
        values: [["Estimated fair market value", pos(a.ESTFMKVALUE)], ["Assessed value", pos(a.CNTASSDVALUE)], ["Land", pos(a.LNDVALUE)], ["Improvements", pos(a.IMPVALUE)], ["Net property tax", pos(a.NETPRPTA)]],
        valueYear: txt(a.TAXROLLYEAR), lotAcres: pos(a.ASSDACRES) || pos(a.DEEDACRES) || pos(a.GISACRES),
        use: ({"1": "Residential", "2": "Commercial", "3": "Manufacturing", "4": "Agricultural", "5": "Undeveloped", "5M": "Agricultural forest", "6": "Productive forest", "7": "Other", "X1": "Exempt", "X2": "Exempt", "X3": "Exempt", "X4": "Exempt"})[txt(a.PROPCLASS).split(",")[0]] || "",
        noSale: "Wisconsin's statewide parcel file does not include sale prices.",
        mail: (() => { const m = txt(a.PSTLADRESS).match(/^(.*?),\s*(.*?)\s+([A-Z]{2})\s+([\d-]+)$/); return m ? { street: m[1], city: m[2], state: m[3], zip: m[4] } : { street: txt(a.PSTLADRESS), city: "", state: "", zip: "" }; })()
      })
    }
  };

  const houseNum = s => { const m = txt(s).match(/^(\d+)/); return m ? m[1] : null; };
  const STOP = new Set(["N","S","E","W","NE","NW","SE","SW","NORTH","SOUTH","EAST","WEST","ST","STREET","AVE","AVENUE","RD","ROAD","DR","DRIVE","LN","LANE","CT","COURT","BLVD","PL","PLACE","WAY","TER","CIR","HWY","PKWY","THE"]);
  // Main street-name words of an address, e.g. "2101 Glenwood Ave, Raleigh" -> ["GLENWOOD"]
  const streetWords = s => txt(s).split(",")[0].toUpperCase().replace(/^\d+[A-Z]?\s+/, "").split(/[^A-Z0-9]+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));

  async function queryLayer(p, lon, lat, buffer) {
    const q = new URLSearchParams({
      geometry: lon + "," + lat, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "*", returnGeometry: "false", f: "json"
    });
    if (buffer) { q.set("distance", String(buffer)); q.set("units", "esriSRUnit_Meter"); q.set("resultRecordCount", "300"); }
    const r = await fetch(p.url + "/query?" + q, { mode: "cors" });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "service error");
    return (d.features || []).map(f => f.attributes);
  }
  async function identify(p, lon, lat, metres) {
    const dLat = metres / 111000, dLon = metres / (111000 * Math.cos(lat * Math.PI / 180));
    const q = new URLSearchParams({
      geometry: lon + "," + lat, geometryType: "esriGeometryPoint", sr: "4326", layers: "all:0", tolerance: "1",
      mapExtent: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(","), imageDisplay: "2,2,96", returnGeometry: "false", f: "json"
    });
    const r = await fetch(p.url + "/identify?" + q, { mode: "cors" });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "service error");
    return (d.results || []).map(x => { const a = {}; for (const k in x.attributes) a[k.toUpperCase()] = x.attributes[k] === "Null" ? null : x.attributes[k]; return a; });
  }

  // Returns {provider, record, exact, count} or null when the state has no free service.
  async function lookupParcel(st, lon, lat, typedAddress) {
    const p = P[st]; if (!p) return null;
    lon = +lon; lat = +lat;
    const want = houseNum(typedAddress);
    const words = streetWords(typedAddress);
    const numOf = a => txt(p.num ? p.num(a) : "") || houseNum(p.addr(a));
    const sameStreet = a => { const w = new Set(streetWords(p.addr(a))); return !words.length || words.some(x => w.has(x)); };
    let near = [], here = [];
    if (p.kind === "identify") {
      here = await identify(p, lon, lat, 1);          // the parcel under the point
      near = await identify(p, lon, lat, 150);        // parcels within ~150 m
    } else {
      if (!p.pointLayer) here = await queryLayer(p, lon, lat, 0);
      near = await queryLayer(p, lon, lat, 150);
    }
    const all = [...here, ...near];
    let match = want ? (all.find(a => numOf(a) === want && sameStreet(a)) || null) : null;
    const exact = !!match;
    if (!match) match = here[0] || (p.pointLayer ? null : near[0]) || null;
    if (!match) return { provider: p, record: null, exact: false };
    const sameAddr = all.filter(a => txt(p.addr(a)) && txt(p.addr(a)) === txt(p.addr(match)));
    const uniq = new Set(sameAddr.map(a => JSON.stringify(a))).size;
    return { provider: p, record: p.map(match), exact, count: uniq };
  }

  window.PARCELS = { lookupParcel, states: Object.keys(P), providers: P };
})();
