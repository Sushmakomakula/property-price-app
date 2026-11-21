"""Collect upcoming New Jersey sheriff (foreclosure) sales from the counties' official
listing site (salesweb.civilview.com) and write them to www/data/nj_sheriff_sales.json.

Runs daily on GitHub Actions. Polite: one request at a time with a short pause."""
import html, json, re, sys, time, urllib.request, http.cookiejar, datetime, os

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

# Official NJ municipality / town names, longest first, for splitting "STREET TOWN NJ ZIP".
TOWNS = []
def load_towns():
    try:
        z = json.load(open(os.path.join(os.path.dirname(__file__), "..", "www", "data", "zips.json")))
        names = {r[1].rsplit(", ", 1)[0].upper() for r in z if r[1].endswith(", nj")}
    except Exception:
        names = set()
    names |= {"EAST ORANGE", "WEST ORANGE", "SOUTH ORANGE", "ORANGE", "NEWARK", "JERSEY CITY", "PATERSON", "ELIZABETH", "TRENTON", "CAMDEN"}
    TOWNS[:] = sorted(names, key=len, reverse=True)

def split_address(a):
    if not TOWNS: load_towns()
    a = re.sub(r"\s+", " ", a).strip().upper()
    m = re.search(r"^(.*?)[ ,]*\bN\.?J\.?\b,?\s*(\d{5})?", a)
    before, z = (m.group(1), m.group(2) or "") if m else (a, "")
    before = before.strip(" ,")
    town = ""
    for t in TOWNS:
        if before.endswith(" " + t) or before.endswith("," + t):
            town = t; before = before[: -len(t)].strip(" ,"); break
    street = re.sub(r"\s+(A/?K/?A|AKA)\s.*$", "", before).strip(" ,")
    return street.title(), town.title(), z

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
        street, town, z = split_address(addr)
        res.append({
            "county": name, "sheriff_no": rec.get("Sheriff #") or rec.get("Sheriff Number"),
            "sale_date": rec.get("Sales Date") or rec.get("Sale Date"), "address": addr, "street": street, "town": town, "zip": z,
            "plaintiff": rec.get("Plaintiff"), "defendant": rec.get("Defendant"),
            "status": det.get("status"), "adjournments": det.get("adjournments"), "first_scheduled": det.get("first_scheduled"), "upset": det.get("upset"), "judgment": det.get("judgment"),
            "occupancy": det.get("occupancy"), "block_lot": det.get("block_lot"), "dimensions": det.get("dimensions"),
            "attorney": det.get("attorney"), "attorney_phone": det.get("attorney_phone"),
            "list_url": f"{BASE}/Sales/SalesSearch?countyId={cid}"})
    return res

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
    data = {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "source": BASE, "counties": report, "sales": allrows}
    with open(path, "w") as f: json.dump(data, f, separators=(",", ":"))
    print("total", len(allrows))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "www/data/nj_sheriff_sales.json")
