// Full official property record for any US address from PropertyLayer (county assessor + recorder data).
// The user's own API key is stored only on their device. PropertyLayer does not accept calls from web pages
// on other sites (CORS), so requests go either through the Android app's native networking, or through
// the user's own connector URL (see workers/propertylayer-proxy.js).
(function () {
  const API = "https://api.propertylayer.com";
  const store = {
    get: k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
  };
  const isNative = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const key = () => store.get("plKey");
  const proxy = () => store.get("plProxy").replace(/\/+$/, "");
  const ready = () => (isNative() && !!key()) || !!proxy();

  async function call(path) {
    let url, headers = { Accept: "application/json" };
    if (isNative()) {
      if (!key()) throw new Error("Add your PropertyLayer key in the app first.");
      url = API + path; headers.Authorization = "Bearer " + key();
    } else if (proxy()) {
      url = proxy() + path;
      if (key()) headers["X-PL-Key"] = key();   // only used by a connector that has no key of its own
    } else {
      throw new Error("On the website, full records need your connector. Use the Android app, or set up the connector.");
    }
    const r = await fetch(url, { headers });
    let body = null; try { body = await r.json(); } catch (e) {}
    if (!r.ok) {
      const msg = { 401: "PropertyLayer did not accept the key. Check it in Settings.", 403: "Your PropertyLayer account has no active plan.",
                    404: "PropertyLayer could not find that address on the map.", 422: "Add the city and state, or a ZIP code, to the address.",
                    429: "You've used this month's free PropertyLayer lookups. They reset on the 1st." }[r.status];
      throw new Error(msg || (body && body.detail) || ("PropertyLayer error " + r.status));
    }
    return body;
  }

  const lookup = addr => call("/properties/address?address=" + encodeURIComponent(addr));
  const usage = () => call("/properties/usage");

  // ---------- render one PropertyView ----------
  const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $m = v => (v === null || v === undefined || v === "" || isNaN(+v) || +v === 0) ? null : "$" + Math.round(+v).toLocaleString("en-US");
  const n = v => (v === null || v === undefined || v === "") ? null : (+v).toLocaleString("en-US");
  const d = s => { if (!s) return null; const x = new Date(s); return isNaN(x) ? String(s) : x.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); };
  const yes = b => b === true ? "Yes" : b === false ? "No" : null;
  const kv = rows => rows.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== "").map(r => `<div><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join("");
  const block = (title, inner) => inner ? `<div><div class="eyebrow" style="margin:10px 0 6px">${esc(title)}</div>${inner}</div>` : "";

  function render(p) {
    const s = p.situs_address || {}, o = p.ownership || {}, v = p.valuation_current || {}, b = p.building_summary || {}, l = p.land || {}, t = p.taxes || {};
    const mail = o.mailing_address || {};
    const mailTxt = typeof mail === "string" ? mail : [mail.line1 || mail.raw, mail.line2, [mail.city, mail.state, mail.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const owners = (o.owners || []).map(x => x.name).filter(Boolean);
    const head = v.market_total || v.total_value || v.appraised_total || v.full_cash_value || v.assessed_total;
    const headLabel = v.market_total ? "Market value" : v.total_value ? "Total value" : v.appraised_total ? "Appraised value" : v.full_cash_value ? "Full cash value" : "Assessed value";
    const bills = (t.bills || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0));
    const bill = bills[0] || {};
    const sales = (p.transfers || []).slice().sort((a, b) => String(b.sale_date || b.recording_date || "").localeCompare(String(a.sale_date || a.recording_date || "")));
    const vals = (p.valuations || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0));
    const addr = s.raw || [s.line1, s.city, s.state, s.zip].filter(Boolean).join(", ");
    return `<div class="eyebrow" style="margin-bottom:6px">Full county record · PropertyLayer${p.county ? " · " + esc(p.county) + " County, " + esc(p.state || "") : ""}</div>
      ${addr ? `<div style="font-weight:600;margin-bottom:6px">${esc(addr)}</div>` : ""}
      ${p.unit_records_count ? `<div class="warn" style="margin-bottom:8px">This address is a building with ${p.unit_records_count} unit records. Add the unit number (for example "Apt 4B") to see one unit.</div>` : ""}
      ${head ? `<div class="price num">${$m(head)}</div><div class="muted" style="font-size:.85rem;margin-bottom:8px">${headLabel}${v.year ? " · " + v.year : ""}</div>` : ""}
      <div class="kv">${kv([
        ["Owner", owners.length ? owners.join(" & ") : o.owner_name], ["Owner mailing address", mailTxt || null], ["Owner lives there", yes(o.owner_occupied)],
        ["Assessed value", $m(v.assessed_total)], ["Market value", $m(v.market_total)], ["Land value", $m(v.market_land || v.land_value || v.assessed_land)],
        ["Building value", $m(v.market_improvements || v.improvement_value || v.assessed_improvements)], ["Taxable value", $m(v.taxable_total)], ["Exemptions", $m(v.exemption_amount)],
        ["Property tax", bill.total_tax || bill.net_tax ? `${$m(bill.total_tax || bill.net_tax)}${bill.year ? " (" + bill.year + ")" : ""}` : null],
        ["Taxes delinquent", t.is_delinquent ? "YES – unpaid taxes" : (t.is_delinquent === false ? "No" : null)],
        ["Bedrooms", b.bedrooms], ["Bathrooms", b.baths_total_calc || (b.baths_full ? b.baths_full + (b.baths_half ? " full, " + b.baths_half + " half" : "") : null)],
        ["Living area", b.living_area_sqft ? n(b.living_area_sqft) + " sq ft" : null], ["Year built", b.year_built], ["Stories", b.stories], ["Buildings", b.buildings_count > 1 ? b.buildings_count : null],
        ["Lot", l.acres ? (+l.acres).toFixed(2) + " acres" + (l.lot_sqft ? " (" + n(l.lot_sqft) + " sq ft)" : "") : (l.lot_sqft ? n(l.lot_sqft) + " sq ft" : null)],
        ["Property use", (p.classification && (p.classification.land_use_description || p.classification.property_type || p.classification.land_use)) || null],
        ["Zoning", (p.classification && p.classification.zoning) || null], ["Flood zone", p.fema_flood_zone || null]
      ])}</div>
      ${block("Sales and transfers", sales.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th class="r">Price</th><th>Buyer</th><th>Seller</th><th>Type</th></tr></thead><tbody>${sales.slice(0, 12).map(x =>
        `<tr><td>${esc(d(x.sale_date || x.recording_date) || "")}</td><td class="r">${esc($m(x.price) || "—")}</td><td style="white-space:normal">${esc(x.buyer || "")}</td><td style="white-space:normal">${esc(x.seller || "")}</td><td class="muted">${esc([x.instrument_type, x.is_arms_length === true ? "market sale" : x.is_nominal ? "nominal" : null].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table></div>` : "")}
      ${block("Value history", vals.length > 1 ? `<div class="tbl"><table><thead><tr><th>Year</th><th class="r">Assessed</th><th class="r">Market</th><th class="r">Taxable</th></tr></thead><tbody>${vals.slice(0, 8).map(x =>
        `<tr><td>${esc(x.year || "")}</td><td class="r">${esc($m(x.assessed_total) || "—")}</td><td class="r">${esc($m(x.market_total || x.total_value) || "—")}</td><td class="r">${esc($m(x.taxable_total) || "—")}</td></tr>`).join("")}</tbody></table></div>` : "")}
      ${block("Tax bills", bills.length > 1 ? `<div class="tbl"><table><thead><tr><th>Year</th><th class="r">Total tax</th><th class="r">Paid</th><th class="r">Due</th><th>Status</th></tr></thead><tbody>${bills.slice(0, 6).map(x =>
        `<tr><td>${esc(x.year || "")}</td><td class="r">${esc($m(x.total_tax || x.net_tax) || "—")}</td><td class="r">${esc($m(x.amount_paid) || "—")}</td><td class="r">${esc($m(x.amount_due) || "—")}</td><td>${esc(x.payment_status || "")}</td></tr>`).join("")}</tbody></table></div>` : "")}
      <div class="hint" style="margin-top:8px">Source: county assessor and recorder records via PropertyLayer. Each lookup uses 1 of your monthly PropertyLayer credits.</div>`;
  }

  window.PL = { ready, lookup, usage, render, isNative, key, proxy, store };
})();
