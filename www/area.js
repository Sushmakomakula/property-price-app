// "All properties in an area": every parcel in a ZIP code or town from the free state services,
// shown as a sortable table and downloadable as an Excel file.
(function () {
  const MAX = 25000; // keep phones responsive and downloads a sensible size
  const up = s => String(s || "").trim().toUpperCase().replace(/'/g, "''");
  // How each state's service can be filtered to one area.
  const AREA = {
    MD: { zip: z => `ZIPCODE='${z}'`, town: t => `CITY='${up(t)}'`, oid: "OBJECTID",
          fields: "ADDRESS,CITY,ZIPCODE,NFMTTLVL,NFMLNDVL,NFMIMPVL,LASTASSD,CONSIDR1,TRADATE,YEARBLT,SQFTSTRC,ACRES,DESCLU,DESCSTYL,SDATWEBADR,ACCTID,STRTNUM" },
    CT: { zipAsTown: true, town: t => `Town_Name='${up(t)}'`, oid: "OBJECTID", fields: "*" },
    MA: { zip: (z, t) => t ? `CITY='${up(t)}' AND ZIP LIKE '${z}%'` : `ZIP LIKE '${z}%'`, town: t => `CITY='${up(t)}'`, oid: "OBJECTID",
          fields: "SITE_ADDR,ADDR_NUM,CITY,ZIP,OWNER1,TOTAL_VAL,LAND_VAL,BLDG_VAL,OTHER_VAL,FY,LS_PRICE,LS_DATE,YEAR_BUILT,RES_AREA,BLD_AREA,NUM_ROOMS,LOT_SIZE,USE_DESC,STYLE,ZONING" },
    NJ: { zip: z => `ZIP5='${z}'`, town: t => `MUN_NAME LIKE '${up(t)}%'`, oid: "OBJECTID",
          fields: "PROP_LOC,MUN_NAME,ZIP5,ZIP_CODE,OWNER_NAME,COUNTY,NET_VALUE,LAND_VAL,IMPRVT_VAL,LAST_YR_TX,SALE_PRICE,DEED_DATE,YR_CONSTR,CALC_ACRE,BLDG_DESC,LAND_DESC" },
    NC: { zipRadius: 1500, town: t => `scity='${up(t)}'`, oid: "objectid",
          fields: "siteadd,saddno,scity,szip,ownname,ownname2,cntyname,parval,parvaltype,landval,improvval,saledatetx,saledate,structyear,recareano,gisacres,parusedsc2,parusedesc,sourceagnt,sourceref" },
    WI: { zip: z => `ZIPCODE='${z}'`, town: t => `PLACENAME LIKE '%${up(t)}%'`, oid: "OBJECTID",
          fields: "SITEADRESS,ADDNUM,PLACENAME,ZIPCODE,OWNERNME1,OWNERNME2,CONAME,ESTFMKVALUE,CNTASSDVALUE,LNDVALUE,IMPVALUE,NETPRPTA,TAXROLLYEAR,ASSDACRES,DEEDACRES,GISACRES" }
  };

  async function call(url, params) {
    const body = new URLSearchParams(params);
    const r = await fetch(url + "/query", { method: "POST", body, mode: "cors" });
    const d = await r.json();
    if (d.error) { console.error("query failed", url, body.toString(), JSON.stringify(d.error)); throw new Error(d.error.message || "service error"); }
    return d;
  }
  // Public services sometimes fail under load; try again up to twice with a short pause.
  async function callRetry(url, params) {
    for (let attempt = 0; ; attempt++) {
      try { return await call(url, params); }
      catch (e) { if (attempt >= 2) throw e; await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
    }
  }

  // area ={st, zip?, town?, lat?, lon?}; onProgress(loaded, total)
  async function fetchArea(area, onProgress, signal) {
    const cfg = AREA[area.st], p = window.PARCELS.providers[area.st];
    if (!cfg || !p) return null;
    const base = { outFields: cfg.fields, returnGeometry: "false", f: "json" };
    let filter = {}, label = "";
    if (area.zip && cfg.zip) { filter.where = cfg.zip(area.zip, area.zipTown); label = "ZIP " + area.zip; }
    else if (area.zip && cfg.zipRadius && area.lat) {
      filter = { where: "1=1", geometry: area.lon + "," + area.lat, geometryType: "esriGeometryPoint", inSR: "4326",
                 spatialRel: "esriSpatialRelIntersects", distance: String(cfg.zipRadius), units: "esriSRUnit_Meter" };
      label = `within ${cfg.zipRadius / 1000} km of the center of ZIP ${area.zip}`;
    } else if (area.town) { filter.where = cfg.town(area.town); label = area.town; }
    else if (area.zip && cfg.zipAsTown && area.zipTown) { filter.where = cfg.town(area.zipTown); label = area.zipTown + " (town of ZIP " + area.zip + ")"; }
    else return { error: "This state's records can't be searched that way. Try a town name instead." };

    // 1) Get the ID of every matching property (one fast request), 2) fetch records by ID in batches.
    const idRes = await callRetry(p.url, { ...filter, returnIdsOnly: "true", f: "json" });
    const ids = (idRes.objectIds || []).sort((a, b) => a - b);
    const total = ids.length, want = Math.min(total, MAX);
    const batch = 500, rows = [];
    onProgress && onProgress(0, want);
    for (let i = 0; i < want; i += batch) {
      if (signal && signal.aborted) throw new Error("cancelled");
      const chunk = ids.slice(i, Math.min(i + batch, want));
      const d = await callRetry(p.url, { ...base, objectIds: chunk.join(",") });
      for (const f of d.features || []) rows.push(p.map(f.attributes));
      onProgress && onProgress(rows.length, want);
    }
    return { rows, total, capped: total > MAX, label, provider: p };
  }

  // Flatten a mapped record into spreadsheet columns.
  function toRow(r) {
    const v = Object.fromEntries((r.values || []).filter(x => x[1]).map(x => [x[0], x[1]]));
    const first = (r.values || []).find(x => x[1]);
    const d = x => (x && !isNaN(x) ? x.toISOString().slice(0, 10) : "");
    return {
      "Address": r.address || "", "Owner": r.owner || "",
      "Value": first ? first[1] : "", "Value type": first ? first[0] : "",
      "Land value": v["Land"] || v["Land value"] || "", "Building value": v["Building"] || v["Building value"] || v["Improvements"] || v["Buildings"] || "",
      "Assessed value": v["Assessed value"] || v["Assessed value (70% of appraised)"] || "",
      "Last sale price": r.sale && r.sale.price ? r.sale.price : "", "Last sale date": r.sale ? d(r.sale.date) : "",
      "Previous sale price": r.prior && r.prior.price ? r.prior.price : "", "Previous sale date": r.prior ? d(r.prior.date) : "",
      "Year built": r.yearBuilt || "", "Living area (sq ft)": r.livingArea || "", "Bedrooms": r.beds || "", "Bathrooms": r.baths || "",
      "Rooms": r.rooms || "", "Lot (acres)": r.lotAcres ? +(+r.lotAcres).toFixed(3) : "", "Property type": r.use || "",
      "Style / building": r.style || r.building || "", "Condition": r.condition || "", "Zoning": r.zoning || "",
      "County": r.county || "", "Valuation year": r.valueYear || "", "Parcel / account ID": r.id || "", "Official record link": r.link || ""
    };
  }

  window.AREA = { fetchArea, toRow, states: Object.keys(AREA), MAX };
})();
