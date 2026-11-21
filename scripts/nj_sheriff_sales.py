"""Collect upcoming New Jersey sheriff (foreclosure) sales from the counties' official
listing site (salesweb.civilview.com) and write them to www/data/nj_sheriff_sales.json.

Runs daily on GitHub Actions. Polite: one request at a time with a short pause."""
import html, json, re, sys, time, urllib.request, urllib.parse, http.cookiejar, datetime, os

BASE = "https://salesweb.civilview.com"
COUNTIES = {25: "Atlantic", 7: "Bergen", 3: "Burlington", 1: "Camden", 52: "Cape May", 6: "Cumberland", 2: "Essex",
            19: "Gloucester", 10: "Hudson", 32: "Hunterdon", 73: "Middlesex", 8: "Monmouth", 9: "Morris", 85: "Ocean",
            17: "Passaic", 20: "Salem", 15: "Union"}
PAUSE = float(os.environ.get("PAUSE", "0.6"))
LIMIT = int(os.environ.get("LIMIT", "0"))  # for testing: max listings per county

def opener():
    cj = http.cookiejar.CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    o.addheaders = [("User-Agent", "Mozilla/5.0 (property-price-app; daily public listing refresh)")]
    return o

def get(o, url, tries=3):
    for i in range(tries):
        try:
            with o.open(url, timeout=60) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(3 * (i + 1))

def text(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    s = html.unescape(re.sub(r"<[^>]+>", "\n", s))
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\s*\n\s*", "\n", s)).strip()

def cells(row):
    return [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]

MONEY = r"\$\s?([\d,]+(?:\.\d{2})?)"
def money(v):
    try: return round(float(v.replace(",", "")))
    except: return None

def parse_detail(t):
    """Pull structured fields from a detail page's text."""
    d = {}
    # Labelled fields ("Label:\nvalue") that some counties show in a table
    for label, key in [("Approx. Judgment", "judgment"), ("Approx Judgment", "judgment"), ("Upset Price", "upset"),
                       ("Approx. Upset", "upset"), ("Good Faith Upset", "upset"), ("Minimum Bid", "upset"),
                       ("Attorney Phone", "attorney_phone"), ("Attorney", "attorney"), ("Parcel Number", "parcel"),
                       ]:
        m = re.search(r"(?mi)^" + re.escape(label) + r"\*?:?\s*\n([^\n]+)", t)
        if m and key not in d: d[key] = m.group(1).strip()
    for key in ("judgment", "upset"):
        if key in d:
            mm = re.search(r"[\d,]+(?:\.\d{2})?", d[key]); d[key] = money(mm.group(0)) if mm else None
    # Free-text amounts in the legal notice
    if not d.get("upset"):
        m = re.search(r"UPSET[^$]{0,120}?" + MONEY, t, re.I)
        if m: d["upset"] = money(m.group(1))
    if not d.get("judgment"):
        m = re.search(r"JUDGMENT[^$]{0,120}?" + MONEY, t, re.I)
        if m: d["judgment"] = money(m.group(1))
    m = re.search(r"OCCUPANCY:?\s*([A-Z /-]{4,30}?)[.\n]", t, re.I)
    if m: d["occupancy"] = m.group(1).strip().title()
    m = re.search(r"Block\s*:?\s*([\w.-]+)", t, re.I); b = m.group(1) if m else None
    m = re.search(r"Lot\s*:?\s*([\w.-]+)", t, re.I); l = m.group(1) if m else None
    if b and l: d["block_lot"] = f"Block {b}, Lot {l}"
    m = re.search(r"APPROXIMATE DIMENSIONS:?\s*((?:[^.\n]|\.(?=\d)){3,60})", t, re.I)
    if m: d["dimensions"] = m.group(1).strip()
    # Status history: pairs of "status / date" after "[Collapse All]"; the last pair is the current status.
    h = t.split("[Collapse All]", 1)
    if len(h) > 1:
        lines = [x for x in h[1].split("\n") if x.strip()]
        pairs = []
        for i in range(0, len(lines) - 1, 2):
            if re.match(r"\d{1,2}/\d{1,2}/\d{4}$", lines[i + 1].strip()): pairs.append((lines[i].strip(), lines[i + 1].strip()))
            else: break
        if pairs:
            d["status"] = pairs[-1][0]
            d["adjournments"] = sum(1 for p in pairs if p[0].lower().startswith("adjourn"))
            d["first_scheduled"] = pairs[0][1]
    return d

# ---- Official NJ tax records (NJ Office of GIS, MOD-IV) ----
PARCELS = "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query"
FIELDS = "PROP_LOC,MUN_NAME,COUNTY,NET_VALUE,LAND_VAL,IMPRVT_VAL,LAST_YR_TX,SALE_PRICE,DEED_DATE,YR_CONSTR,CALC_ACRE,BLDG_DESC,LAND_DESC,PROP_CLASS,ST_ADDRESS,CITY_STATE"
CLASS = {"1": "Vacant land", "2": "Residential (1-4 family)", "3A": "Farm (house)", "3B": "Farmland", "4A": "Commercial", "4B": "Industrial", "4C": "Apartments (5+ units)"}

def query(where, fields=FIELDS, n=20, extra=None):
    params = {"where": where, "outFields": fields, "returnGeometry": "false", "f": "json", "resultRecordCount": str(n)}
    params.update(extra or {})
    q = urllib.parse.urlencode(params)
    for i in range(3):
        try:
            with urllib.request.urlopen(PARCELS + "?" + q, timeout=120) as r:
                return [f["attributes"] for f in json.loads(r.read().decode()).get("features", [])]
        except Exception:
            if i == 2: return []
            time.sleep(2 * (i + 1))

# Official NJ municipality names (564, from the state tax file) plus common spellings, longest first,
# for splitting "STREET TOWN NJ ZIP" and for matching the tax record. Entries: (spelling, MUN_NAME or None).
TOWNS = []
SUFFIX = r"(?:TOWNSHIP|TWNSHP|TWP|BOROUGH|BORO|CITY|TOWN|VILLAGE)"
def load_towns():
    seen = {}
    for a in query("1=1", "MUN_NAME,COUNTY", 2000, {"returnDistinctValues": "true"}):
        mun = a.get("MUN_NAME")
        if not mun: continue
        base = re.sub(r"\s+" + SUFFIX + r"$", "", mun)
        variants = {mun, base}
        for v in list(variants):
            variants |= {v.replace("MT ", "MOUNT "), v.replace(" RIV ", " RIVER ").replace(" RIV", " RIVER")}
        for v in list(variants):
            for suf in ("TOWNSHIP", "TWP", "BOROUGH", "BORO", "CITY"):
                variants.add(v + " " + suf)
        for v in variants:
            seen.setdefault(v, set()).add(mun)
    out = [(v, next(iter(ms)) if len(ms) == 1 else None) for v, ms in seen.items()]
    # Postal place names (e.g. Sicklerville) that are not municipalities.
    try:
        z = json.load(open(os.path.join(os.path.dirname(__file__), "..", "www", "data", "zips.json")))
        for r in z:
            if r[1].endswith(", nj"):
                n = r[1].rsplit(", ", 1)[0].upper()
                if n not in seen: out.append((n, None))
    except Exception:
        pass
    TOWNS[:] = sorted(out, key=lambda t: len(t[0]), reverse=True)

def split_address(a):
    """'27 ROBBINWOOD TERRACE LINDEN NJ 07036' -> ('27 Robbinwood Terrace', 'Linden', '07036', 'LINDEN CITY')"""
    if not TOWNS: load_towns()
    a = re.sub(r"\s+", " ", a).strip().upper().replace(".", "")
    m = re.search(r"^(.*?)[ ,]*\bNJ\b,?\s*(\d{5})?", a)
    before, z = (m.group(1), m.group(2) or "") if m else (a, "")
    before = before.strip(" ,")
    town, mun = "", None
    for t, official in TOWNS:
        if before.endswith(" " + t) or before.endswith("," + t):
            town, mun = t, official; before = before[: -len(t)].strip(" ,"); break
    street = re.sub(r"\s+(A/?K/?A|AKA)\s.*$", "", before).strip(" ,")
    return street.title(), re.sub(r"\s+" + SUFFIX + r"$", "", town).title(), z, mun

def county_sales(cid, name):
    o = opener()
    page = get(o, f"{BASE}/Sales/SalesSearch?countyId={cid}")
    tabs = [m.start() for m in re.finditer("<table", page)]
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", page[tabs[1]:] if len(tabs) > 1 else page, re.S)
    head = None; out = []
    for r in rows:
        c = cells(r)
        if head is None:
            if "Address" in c or "Sales Date" in c: head = c
            continue
        link = re.search(r'href="(/Sales/SaleDetails\?PropertyId=\d+)"', r)
        if not link or len(c) < len(head): continue
        rec = {h: v for h, v in zip(head, c) if h}
        out.append((rec, link.group(1)))
    if LIMIT: out = out[:LIMIT]
    res = []
    for rec, href in out:
        time.sleep(PAUSE)
        try: det = parse_detail(text(get(o, BASE + href)))
        except Exception as e: det = {"error": str(e)[:80]}
        addr = rec.get("Address", "")
        street, town, z, mun = split_address(addr)
        res.append({
            "county": name, "sheriff_no": rec.get("Sheriff #") or rec.get("Sheriff Number"),
            "sale_date": rec.get("Sales Date") or rec.get("Sale Date"), "address": addr, "street": street, "town": town, "zip": z, "municipality": mun,
            "plaintiff": rec.get("Plaintiff"), "defendant": rec.get("Defendant"),
            "status": det.get("status"), "adjournments": det.get("adjournments"), "first_scheduled": det.get("first_scheduled"), "upset": det.get("upset"), "judgment": det.get("judgment"),
            "occupancy": det.get("occupancy"), "block_lot": det.get("block_lot"), "dimensions": det.get("dimensions"),
            "attorney": det.get("attorney"), "attorney_phone": det.get("attorney_phone"),
            "list_url": f"{BASE}/Sales/SalesSearch?countyId={cid}"})
    return res

ORD = {"FIRST": "1ST", "SECOND": "2ND", "THIRD": "3RD", "FOURTH": "4TH", "FIFTH": "5TH", "SIXTH": "6TH"}
DIRS = {"N", "S", "E", "W", "NORTH", "SOUTH", "EAST", "WEST"}
TYPES = {"STREET": "ST", "ST": "ST", "AVENUE": "AVE", "AVE": "AVE", "AV": "AVE", "ROAD": "RD", "RD": "RD", "PLACE": "PL", "PL": "PL",
         "DRIVE": "DR", "DR": "DR", "LANE": "LN", "LN": "LN", "LA": "LN", "COURT": "CT", "CT": "CT", "TERRACE": "TER", "TER": "TER", "TERR": "TER",
         "BOULEVARD": "BLVD", "BLVD": "BLVD", "PARKWAY": "PKWY", "PKWY": "PKWY", "CIRCLE": "CIR", "CIR": "CIR", "WAY": "WAY", "HIGHWAY": "HWY", "HWY": "HWY"}
def street_key(st):
    """'447 S. 17th Street' -> ('447', '17TH'); the house number and the first street-name word."""
    w = re.sub(r"[.,#]", " ", (st or "").upper()).split()
    if not w or not re.match(r"^\d+[A-Z]?(-\d+[A-Z]?)?$", w[0]): return None
    rest = [ORD.get(x, x) for x in w[1:] if x not in DIRS]
    return (w[0].split("-")[0], rest[0]) if rest else None
def street_type(st):
    w = re.sub(r"[.,#-]", " ", (st or "").upper()).split()
    for x in w[2:]:
        if x in ("APT", "UNIT", "STE", "SUITE"): break
        if x in TYPES: return TYPES[x]
    return None
def unit_of(st):
    m = re.search(r"\b(?:APT|UNIT|STE|SUITE|#)\s*-?\s*([A-Z0-9-]+)", (st or "").upper().replace("-APT", " APT"))
    return m.group(1) if m else None

def tax_record(street, town, county, mun=None):
    k = street_key(street)
    if not k: return None
    num, word = k
    sq = lambda x: x.replace("'", "''")
    like = f"PROP_LOC LIKE '{num} %{sq(word)}%'"
    want_type, want_unit = street_type(street), unit_of(street)
    def good(a):   # same number, same street name, same street type and unit when both are given
        p = a.get("PROP_LOC")
        if street_key(p) != (num, word): return False
        t = street_type(p)
        if want_type and t and t != want_type: return False
        u = unit_of(p)
        if want_unit and u and u != want_unit: return False
        return True
    fs = []
    if mun:
        fs = [a for a in query(f"MUN_NAME='{sq(mun)}' AND {like}") if good(a)]
    elif town and county:
        fs = [a for a in query(f"MUN_NAME LIKE '{sq(town.upper())}%' AND COUNTY='{sq(county.upper())}' AND {like}") if good(a)]
    if not fs and county and not mun:
        # Postal names like Sicklerville: search the county, accept only one exact match.
        cands = [a for a in query(f"COUNTY='{sq(county.upper())}' AND {like}") if good(a)]
        if len({(a.get("PROP_LOC") or "") + (a.get("MUN_NAME") or "") for a in cands}) == 1: fs = cands
    if not fs: return None
    a = fs[0]
    dd = str(a.get("DEED_DATE") or "")
    sale_date = None
    if re.fullmatch(r"\d{6}", dd):
        y = int(dd[:2]); y += 1900 if y > 50 else 2000
        sale_date = f"{y}-{dd[2:4]}-{dd[4:6]}"
    mail = ", ".join(x for x in [(a.get("ST_ADDRESS") or "").strip(), (a.get("CITY_STATE") or "").strip()] if x)
    return {"assessed": a.get("NET_VALUE") or None, "land": a.get("LAND_VAL") or None, "building": a.get("IMPRVT_VAL") or None,
            "tax": round(a["LAST_YR_TX"]) if a.get("LAST_YR_TX") else None,
            "last_sale_price": a.get("SALE_PRICE") if (a.get("SALE_PRICE") or 0) >= 1000 else None, "last_sale_date": sale_date,
            "year_built": a.get("YR_CONSTR") or None, "acres": round(a["CALC_ACRE"], 3) if a.get("CALC_ACRE") else None,
            "building_desc": a.get("BLDG_DESC"), "lot_size": a.get("LAND_DESC"), "type": CLASS.get(str(a.get("PROP_CLASS") or ""), str(a.get("PROP_CLASS") or "")),
            "owner_mail": mail or None, "tax_address": f"{a.get('PROP_LOC')}, {a.get('MUN_NAME')}"}

def main(path):
    from concurrent.futures import ThreadPoolExecutor
    allrows, report = [], {}
    only = os.environ.get("COUNTIES")
    todo = [(cid, name) for cid, name in COUNTIES.items() if not only or name in only.split(",")]
    def run(item):
        cid, name = item
        try: return name, county_sales(cid, name), None
        except Exception as e: return name, [], "error: " + str(e)[:80]
    # A few counties at a time; each county still makes one request at a time.
    with ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", "4"))) as ex:
        for name, rows, err in ex.map(run, todo):
            allrows += rows; report[name] = err or len(rows)
            print(name, report[name], flush=True)
    allrows.sort(key=lambda r: (r["county"], r.get("sale_date") or ""))
    # Attach the official tax record to every listing.
    def add(r):
        try: r["tax_record"] = tax_record(r.get("street"), r.get("town"), r.get("county"), r.get("municipality"))
        except Exception: r["tax_record"] = None
        t = r["tax_record"]
        r["bid_pct_of_assessed"] = round(r["upset"] / t["assessed"], 3) if t and t.get("assessed") and r.get("upset") else None
        return r
    if os.environ.get("NO_TAX") != "1":
        with ThreadPoolExecutor(max_workers=4) as ex: list(ex.map(add, allrows))
        print("tax records matched", sum(1 for r in allrows if r.get("tax_record")), "of", len(allrows), flush=True)
    data = {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "source": BASE, "counties": report, "sales": allrows}
    with open(path, "w") as f: json.dump(data, f, separators=(",", ":"))
    print("total", len(allrows))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "www/data/nj_sheriff_sales.json")
