
from __future__ import annotations
import json, re, time
from urllib.parse import urljoin, urlparse, unquote
import requests
from bs4 import BeautifulSoup

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "BathroomReport location updater (https://bathroomreport.app; contact via site)"
})

def get(url: str, delay: float = 0.25) -> requests.Response:
    time.sleep(delay)
    r = SESSION.get(url, timeout=40)
    r.raise_for_status()
    return r

def soup(url: str, delay: float = 0.25) -> BeautifulSoup:
    return BeautifulSoup(get(url, delay).text, "html.parser")

def slug(value: str) -> str:
    value = value.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")

def parse_jsonld(page: BeautifulSoup):
    out = []
    for tag in page.select('script[type="application/ld+json"]'):
        try:
            value = json.loads(tag.get_text(strip=True))
        except Exception:
            continue
        if isinstance(value, list):
            out.extend(value)
        elif isinstance(value, dict) and isinstance(value.get("@graph"), list):
            out.extend(value["@graph"])
        else:
            out.append(value)
    return out

def first_local_business(page: BeautifulSoup):
    for obj in parse_jsonld(page):
        types = obj.get("@type", []) if isinstance(obj, dict) else []
        if isinstance(types, str):
            types = [types]
        if any(t in {"LocalBusiness","ConvenienceStore","GasStation","Store"} for t in types):
            return obj
    return {}

def coord_from_page(page: BeautifulSoup):
    obj = first_local_business(page)
    geo = obj.get("geo", {}) if isinstance(obj, dict) else {}
    try:
        lat = float(geo.get("latitude"))
        lng = float(geo.get("longitude"))
        return lat, lng
    except Exception:
        pass

    patterns = [
        re.compile(r'[?&](?:q|destination|daddr|ll)=(-?\d+(?:\.\d+)?)[,%2C]+(-?\d+(?:\.\d+)?)', re.I),
        re.compile(r'/maps/place/(-?\d+(?:\.\d+)?)[,%2C]+(-?\d+(?:\.\d+)?)', re.I),
        re.compile(r'center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)', re.I),
        re.compile(r'"latitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?[^{}]{0,200}"longitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?', re.I),
    ]
    html = str(page)
    for p in patterns:
        m = p.search(unquote(html))
        if m:
            return float(m.group(1)), float(m.group(2))
    return None, None

def geocode(address: str, delay: float = 1.05):
    # OpenStreetMap Nominatim policy asks for a descriptive User-Agent and low request rate.
    time.sleep(delay)
    try:
        r = SESSION.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "jsonv2", "limit": 1, "countrycodes": "us"},
            timeout=40,
        )
        r.raise_for_status()
        rows = r.json()
        if rows:
            return float(rows[0]["lat"]), float(rows[0]["lon"])
    except Exception:
        pass
    return None, None

def address_from_jsonld(page: BeautifulSoup):
    obj = first_local_business(page)
    a = obj.get("address", {}) if isinstance(obj, dict) else {}
    if not isinstance(a, dict):
        return None
    street = str(a.get("streetAddress", "")).strip()
    city = str(a.get("addressLocality", "")).strip()
    state = str(a.get("addressRegion", "")).strip()
    postal = str(a.get("postalCode", "")).strip()
    if street and city and state:
        return {
            "street": street,
            "city": city,
            "state": state,
            "postal": postal,
            "full": f"{street}, {city}, {state} {postal}".strip(),
        }
    return None

def normalize_clock(text: str):
    text = text.strip().upper().replace(" ", "")
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(AM|PM)", text)
    if not m:
        return None
    h, minute, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    if ap == "AM":
        h = 0 if h == 12 else h
    else:
        h = h if h == 12 else h + 12
    return h * 100 + minute

def normalize_hours(page: BeautifulSoup):
    obj = first_local_business(page)
    raw = obj.get("openingHours") if isinstance(obj, dict) else None
    if isinstance(raw, str):
        raw = [raw]
    if isinstance(raw, list) and raw:
        ranges = []
        for item in raw:
            m = re.search(r'(\d{2}:\d{2})-(\d{2}:\d{2})', item)
            if m:
                o = int(m.group(1).replace(":", ""))
                c = int(m.group(2).replace(":", ""))
                ranges.append((o, c))
        if ranges and len(set(ranges)) == 1:
            o, c = ranges[0]
            if o == 0 and c in {0, 2359}:
                return "24"
            return f"{o:04d}-{2400 if c == 2359 else c:04d}"

    text = " ".join(page.stripped_strings)
    if re.search(r'\b24 hours\b', text, re.I):
        return "24"
    pairs = re.findall(r'(\d{1,2}:\d{2}\s*[AP]M)\s*(?:to|[-–—])\s*(\d{1,2}:\d{2}\s*[AP]M)', text, re.I)
    converted = []
    for a, b in pairs:
        aa, bb = normalize_clock(a), normalize_clock(b)
        if aa is not None and bb is not None:
            converted.append((aa, bb))
    if converted and len(set(converted)) == 1:
        o, c = converted[0]
        return f"{o:04d}-{2400 if c == 2359 else c:04d}"
    return ""

import argparse, json
from pathlib import Path

BASE = "https://www.cumberlandfarms.com"
DIRECTORY = f"{BASE}/stores-directory/"
STATES = ["CT","FL","MA","ME","NH","NY","RI","VT"]
STORE_RE = re.compile(
    r'^https?://(?:www\.)?cumberlandfarms\.com/stores-directory/'
    r'(?P<state>[a-z]{2})/(?P<city>[^/]+)/(?P<street>[^/]+)/(?P<num>\d+)/?$',
    re.I
)

def directory_links(page, prefix):
    return sorted({
        urljoin(BASE, a["href"]).split("#")[0].rstrip("/") + "/"
        for a in page.select("a[href]")
        if urljoin(BASE, a["href"]).startswith(prefix)
    })

def discover(states, delay):
    stores = set()
    for state in states:
        state_url = f"{DIRECTORY}{state.lower()}/"
        state_page = soup(state_url, delay)
        city_links = directory_links(state_page, state_url)
        for city_url in city_links:
            try:
                city_page = soup(city_url, delay)
            except Exception:
                continue
            for u in directory_links(city_page, city_url):
                if STORE_RE.match(u):
                    stores.add(u)
    return sorted(stores)

def parse_store(url, delay, geocode_missing):
    page = soup(url, delay)
    m = STORE_RE.match(url)
    state, city_slug, street_slug, num = (
        m.group("state").upper(), m.group("city"), m.group("street"), m.group("num")
    )
    addr = address_from_jsonld(page)
    text = " ".join(page.stripped_strings)
    if not addr:
        mm = re.search(
            r'(\d+\s+.+?)\s+Store No\.\s*\d+\s+([A-Za-z .\'-]+),\s*([A-Z]{2})\s*,?\s*(\d{5})',
            text, re.I
        )
        if mm:
            street, city, st, postal = mm.group(1).strip(), mm.group(2).strip().title(), mm.group(3).upper(), mm.group(4)
        else:
            street = street_slug.replace("-", " ").title()
            city = city_slug.replace("-", " ").title()
            postal_match = re.search(rf'{re.escape(city)}\s*,?\s*{state}\s*,?\s*(\d{{5}})', text, re.I)
            postal = postal_match.group(1) if postal_match else ""
            st = state
        addr = {
            "street": street, "city": city, "state": st, "postal": postal,
            "full": f"{street}, {city}, {st} {postal}".strip()
        }

    lat, lng = coord_from_page(page)
    if (lat is None or lng is None) and geocode_missing:
        lat, lng = geocode(addr["full"])

    road = re.sub(r'^\d+\s+', '', addr["street"]).title()
    return {
        "n": f"{road}, {addr['city']}",
        "lat": lat,
        "lng": lng,
        "addr": addr["full"],
        "id": num,
        "chain": "cumberlandFarms",
        "hrs": normalize_hours(page),
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--states", nargs="+", choices=STATES, default=STATES)
    p.add_argument("--output", default="cumberland-farms-locations.js")
    p.add_argument("--delay", type=float, default=0.25)
    p.add_argument("--no-geocode", action="store_true")
    args = p.parse_args()

    urls = discover(args.states, args.delay)
    rows, failures = [], []
    for i, url in enumerate(urls, 1):
        try:
            row = parse_store(url, args.delay, not args.no_geocode)
            rows.append(row)
            print(f"{i}/{len(urls)} {row['addr']}")
        except Exception as e:
            failures.append({"url": url, "error": str(e)})
            print(f"{i}/{len(urls)} ERROR {url}: {e}")

    rows.sort(key=lambda x: (x["addr"], x["id"]))
    Path(args.output).write_text(
        "window.cumberlandFarmsLocations = " + json.dumps(rows, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8"
    )
    report = {
        "states": args.states,
        "official_pages_found": len(urls),
        "locations_written": len(rows),
        "missing_coordinates": [r for r in rows if r["lat"] is None or r["lng"] is None],
        "failures": failures,
    }
    Path("cumberland-farms-pull-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: len(v) if isinstance(v, list) else v for k,v in report.items()}, indent=2))

if __name__ == "__main__":
    main()
