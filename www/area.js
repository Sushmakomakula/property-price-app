// "All properties in an area": every parcel in a ZIP code or town from the free state services,
// shown as a sortable table and downloadable as an Excel file.
(function () {
  const MAX = 25000; // keep phones responsive and downloads a sensible size
  const up = s => String(s || "").trim().toUpperCase().replace(/'/g, "''");
  // How each state's service can be filtered to one area.
  const AREA = {
    MD: { zip: z => `ZIPCODE='${z}'`, town: t => `CITY='${up(t)}'`, oid: "OBJECTID",
          fields: "OWNADD1,OWNCITY,OWNSTATE,OWNERZIP,OOI,ADDRESS,CITY,ZIPCODE,NFMTTLVL,NFMLNDVL,NFMIMPVL,LASTASSD,CONSIDR1,TRADATE,YEARBLT,SQFTSTRC,ACRES,DESCLU,DESCSTYL,SDATWEBADR,ACCTID,STRTNUM" },
    CT: { zipAsTown: true, town: t => `Town_Name='${up(t)}'`, oid: "OBJECTID", fields: "*" },
    MA: { zip: (z, t) => t ? `CITY='${up(t)}' AND ZIP LIKE '${z}%'` : `ZIP LIKE '${z}%'`, town: t => `CITY='${up(t)}'`, oid: "OBJECTID",
          fields: "OWN_ADDR,OWN_CITY,OWN_STATE,OWN_ZIP,SITE_ADDR,ADDR_NUM,CITY,ZIP,OWNER1,TOTAL_VAL,LAND_VAL,BLDG_VAL,OTHER_VAL,FY,LS_PRICE,LS_DATE,YEAR_BUILT,RES_AREA,BLD_AREA,NUM_ROOMS,LOT_SIZE,USE_DESC,STYLE,ZONING" },
    NJ: { zip: (z, t) => t ? `MUN_NAME LIKE '${up(t)}%'` : `ZIP5='${z}'`, zipLabel: (z, t) => t ? `${t} (town of ZIP ${z})` : null, town: t => `MUN_NAME LIKE '${up(t)}%'`, oid: "OBJECTID",
          fields: "ST_ADDRESS,CITY_STATE,PROP_CLASS,PROP_LOC,MUN_NAME,ZIP5,ZIP_CODE,OWNER_NAME,COUNTY,NET_VALUE,LAND_VAL,IMPRVT_VAL,LAST_YR_TX,SALE_PRICE,DEED_DATE,YR_CONSTR,CALC_ACRE,BLDG_DESC,LAND_DESC" },
    NC: { zipRadius: 1500, town: t => `scity='${up(t)}'`, oid: "objectid",
          fields: "mailadd,mcity,mstate,mzip,siteadd,saddno,scity,szip,ownname,ownname2,cntyname,parval,parvaltype,landval,improvval,saledatetx,saledate,structyear,recareano,gisacres,parusedsc2,parusedesc,sourceagnt,sourceref" },
    WI: { zip: z => `ZIPCODE='${z}'`, town: t => `PLACENAME LIKE '%${up(t)}%'`, oid: "OBJECTID",
          fields: "PSTLADRESS,PROPCLASS,SITEADRESS,ADDNUM,PLACENAME,ZIPCODE,OWNERNME1,OWNERNME2,CONAME,ESTFMKVALUE,CNTASSDVALUE,LNDVALUE,IMPVALUE,NETPRPTA,TAXROLLYEAR,ASSDACRES,DEEDACRES,GISACRES" }
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
    if (area.zip && cfg.zip) { filter.where = cfg.zip(area.zip, area.zipTown); label = (cfg.zipLabel && cfg.zipLabel(area.zip, area.zipTown)) || "ZIP " + area.zip; }
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

  // Spreadsheet columns, in the same order as the app's table. type: text | money | date | int | num
  const COLS = [
    ["Address", "text", 38], ["Owner", "text", 34], ["Lead reasons", "text", 34], ["Owner mailing address", "text", 40], ["Years owned", "int", 11],
    ["Value", "money", 15], ["Value type", "text", 24],
    ["Last sale price", "money", 15], ["Last sale date", "date", 14], ["Year built", "int", 11], ["Living area (sq ft)", "int", 14],
    ["Bedrooms", "int", 10], ["Bathrooms", "text", 12], ["Rooms", "int", 8], ["Lot (acres)", "num", 11],
    ["Land value", "money", 14], ["Building value", "money", 15], ["Assessed value", "money", 15],
    ["Previous sale price", "money", 15], ["Previous sale date", "date", 14],
    ["Property type", "text", 24], ["Style / building", "text", 24], ["Condition", "text", 12], ["Zoning", "text", 10],
    ["County", "text", 14], ["Valuation year", "text", 12], ["Parcel / account ID", "text", 20], ["Official record link", "text", 30]
  ];
  // A calendar date that Excel shows on the right day whatever the viewer's time zone.
  const xDate = d => {
    if (!d || isNaN(d)) return null;
    const utc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
    return utc ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
               : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  };
  // Flatten a mapped record into spreadsheet columns (numbers stay numbers, dates stay dates).
  function toRow(r) {
    const v = Object.fromEntries((r.values || []).filter(x => x[1]).map(x => [x[0], x[1]]));
    const first = (r.values || []).find(x => x[1]);
    const n = x => (x === null || x === undefined || x === "" ? null : +x);
    return {
      "Address": r.address || null, "Owner": r.owner || null,
      "Lead reasons": r._lead && r._lead.reasons.length ? r._lead.reasons.join("; ") : null,
      "Owner mailing address": r.mail && r.mail.street ? [r.mail.street, r.mail.city, [r.mail.state, r.mail.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
      "Years owned": r._lead && r._lead.years != null ? r._lead.years : null,
      "Value": first ? first[1] : null, "Value type": first ? first[0] : null,
      "Last sale price": r.sale && r.sale.price ? r.sale.price : null, "Last sale date": r.sale ? xDate(r.sale.date) : null,
      "Year built": n(r.yearBuilt), "Living area (sq ft)": n(r.livingArea), "Bedrooms": n(r.beds), "Bathrooms": r.baths ? String(r.baths) : null,
      "Rooms": n(r.rooms), "Lot (acres)": r.lotAcres ? +(+r.lotAcres).toFixed(3) : null,
      "Land value": v["Land"] || v["Land value"] || null, "Building value": v["Building"] || v["Building value"] || v["Improvements"] || v["Buildings"] || null,
      "Assessed value": v["Assessed value"] || v["Assessed value (70% of appraised)"] || null,
      "Previous sale price": r.prior && r.prior.price ? r.prior.price : null, "Previous sale date": r.prior ? xDate(r.prior.date) : null,
      "Property type": r.use || null, "Style / building": r.style || r.building || null, "Condition": r.condition || null, "Zoning": r.zoning || null,
      "County": r.county || null, "Valuation year": r.valueYear || null, "Parcel / account ID": r.id || null, "Official record link": r.link || null
    };
  }

  window.AREA = { fetchArea, toRow, COLS, states: Object.keys(AREA), MAX };
})();
