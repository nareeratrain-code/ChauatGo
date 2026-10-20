#!/usr/bin/env python3
"""Rebuild data/chauat-places.json from OpenStreetMap (ODbL).

Finds อำเภอชะอวด (admin_level 6) in จังหวัดนครศรีธรรมราช, keeps
admin_level 8 tambons whose boundary sits inside that district, and
collects named POIs. Coordinates come only from Overpass. When a tambon
has no อบต./เทศบาล office in OSM, the tambon interior center is stored
and flagged k=centroid — it is not an office.

Usage:
  python3 scripts/build-chauat-places.py
  python3 scripts/build-chauat-places.py --cache /tmp/chauat-osm-cache
"""

import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ENDPOINTS = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
UA = "ChauatGo/3.9 (ODbL place dataset; https://github.com/nareeratrain-code/ChauatGo)"
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "chauat-places.json")

CAT_LABELS = {
    "w": "วัด",
    "e": "สถานศึกษา",
    "o": "ราชการ",
    "l": "สาธารณสุข",
    "i": "ตำรวจ",
    "r": "ร้านอาหาร",
    "f": "คาเฟ่",
    "q": "ร้านขายยา/คลินิก",
    "c": "สะดวกซื้อ",
    "m": "ตลาด",
    "s": "ร้านค้า",
    "h": "ที่พัก",
    "t": "ท่องเที่ยว",
    "v": "จุดถ่ายรูป",
    "k": "แคมป์ปิ้ง",
    "g": "ปั๊มน้ำมัน",
    "b": "ธนาคาร",
    "p": "ไปรษณีย์",
    "y": "ชุมชน",
    "x": "อื่นๆ",
}


def overpass(query, cache_path=None):
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    headers = {"User-Agent": UA, "Accept": "application/json"}
    last = "no attempt"
    for url in ENDPOINTS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=200) as resp:
                    body = resp.read()
                parsed = json.loads(body.decode("utf-8"))
                remark = str(parsed.get("remark") or "")
                if "error" in remark.lower() or "runtime error" in remark.lower():
                    last = remark
                    time.sleep(5 * (attempt + 1))
                    continue
                if cache_path:
                    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                    with open(cache_path, "w", encoding="utf-8") as fh:
                        json.dump(parsed, fh, ensure_ascii=False)
                return parsed
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
                last = exc
                time.sleep(5 * (attempt + 1))
        print("endpoint failed:", url, last, file=sys.stderr)
    raise SystemExit("Overpass failed: %s" % last)


def close_enough(a, b):
    return abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6


def closed(line):
    return len(line) >= 4 and close_enough(line[0], line[-1])


def stitch(lines):
    unused = [list(line) for line in lines if len(line) >= 2]
    rings = []
    while unused:
        ring = unused.pop(0)
        progressed = True
        while progressed and not closed(ring):
            progressed = False
            for i, line in enumerate(unused):
                if close_enough(ring[-1], line[0]):
                    ring.extend(line[1:])
                elif close_enough(ring[-1], line[-1]):
                    ring.extend(list(reversed(line))[1:])
                elif close_enough(ring[0], line[-1]):
                    ring = line[:-1] + ring
                elif close_enough(ring[0], line[0]):
                    ring = list(reversed(line))[1:] + ring
                else:
                    continue
                unused.pop(i)
                progressed = True
                break
        if len(ring) >= 3 and not closed(ring):
            ring = ring + [ring[0]]
        if closed(ring):
            rings.append(ring)
    return rings


def relation_rings(element):
    outers, inners = [], []
    for member in element.get("members") or []:
        if member.get("type") != "way":
            continue
        geom = member.get("geometry") or []
        pts = [(p["lon"], p["lat"]) for p in geom if "lon" in p and "lat" in p]
        if len(pts) < 2:
            continue
        if member.get("role") == "inner":
            inners.append(pts)
        else:
            outers.append(pts)
    return stitch(outers), stitch(inners)


def pip(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def contains(lon, lat, outers, inners):
    if not any(pip(lon, lat, ring) for ring in outers):
        return False
    if any(pip(lon, lat, ring) for ring in inners):
        return False
    return True


def shoelace(ring):
    area = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    area *= 0.5
    if abs(area) < 1e-14:
        xs = [p[0] for p in ring[:-1]]
        ys = [p[1] for p in ring[:-1]]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    return cx / (6 * area), cy / (6 * area), abs(area)


def interior_point(outers, inners):
    ring = max(outers, key=lambda item: abs(shoelace(item)[2]))
    cx, cy, _area = shoelace(ring)
    if contains(cx, cy, outers, inners):
        return cx, cy
    xs = [p[0] for p in ring[:-1]]
    ys = [p[1] for p in ring[:-1]]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    best = None
    best_d = None
    for i in range(1, 16):
        for j in range(1, 16):
            x = minx + (maxx - minx) * i / 16
            y = miny + (maxy - miny) * j / 16
            if not contains(x, y, outers, inners):
                continue
            dist = (x - cx) ** 2 + (y - cy) ** 2
            if best_d is None or dist < best_d:
                best = (x, y)
                best_d = dist
    if best:
        return best
    for i in range(0, len(ring) - 2, 2):
        x = (ring[i][0] + ring[i + 1][0] + ring[i + 2][0]) / 3
        y = (ring[i][1] + ring[i + 1][1] + ring[i + 2][1]) / 3
        if contains(x, y, outers, inners):
            return x, y
    return cx, cy


def sample_inside(outers, district):
    pts = []
    for ring in outers:
        step = max(1, len(ring) // 60)
        pts.extend(ring[::step])
    if not pts:
        return 0.0
    hit = 0
    for lon, lat in pts:
        if contains(lon, lat, district[0], district[1]):
            hit += 1
    return hit / float(len(pts))


def element_point(element):
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def thai_name(tags):
    official = (tags.get("official_name") or "").strip()
    if any(token in official for token in ("เทศบาล", "อบต", "องค์การบริหาร")):
        return official
    return (tags.get("name:th") or tags.get("name") or tags.get("brand") or tags.get("operator") or "").strip()


def norm_admin(text):
    value = (text or "").replace(" ", "").replace(".", "").replace("ฯ", "")
    for token in (
        "องค์การบริหารส่วนตำบล",
        "องค์การบริหารส่วน",
        "เทศบาลนคร",
        "เทศบาลเมือง",
        "เทศบาลตำบล",
        "ที่ว่าการอำเภอ",
        "ที่ทำการ",
        "สำนักงาน",
        "อบต",
        "ตำบล",
        "อำเภอ",
    ):
        value = value.replace(token, "")
    return value


def is_local_gov_office(tags, name):
    # A place=* node names the municipality. It is not the office building.
    if tags.get("place") in ("town", "municipality", "village", "hamlet", "suburb", "city"):
        return False
    if any(token in name for token in ("อบต", "เทศบาล", "องค์การบริหาร")):
        return True
    if tags.get("amenity") == "townhall" and "ที่ว่าการอำเภอ" not in name:
        return True
    return False


# Published tambon names for อำเภอชะอวด. Names only — never turned into coordinates.
# Source: อำเภอชะอวด (chauat.cdd.go.th) and the Thai Wikipedia article for the district.
REFERENCE_TAMBONS = [
    "ชะอวด",
    "ท่าเสม็ด",
    "ท่าประจะ",
    "เคร็ง",
    "วังอ่าง",
    "บ้านตูล",
    "ขอนหาด",
    "เกาะขันธ์",
    "ควนหนองหงษ์",
    "เขาพระทอง",
    "นางหลง",
]


def classify(tags, name):
    amenity = tags.get("amenity") or ""
    shop = tags.get("shop") or ""
    tourism = tags.get("tourism") or ""
    office = tags.get("office") or ""
    healthcare = tags.get("healthcare") or ""
    leisure = tags.get("leisure") or ""
    historic = tags.get("historic") or ""
    natural = tags.get("natural") or ""
    brand = (tags.get("brand") or "") + " " + name
    low = brand.lower()

    if tags.get("boundary") == "administrative" and not amenity and not office and not shop:
        return None
    if tags.get("highway") and not any(tags.get(key) for key in ("amenity", "shop", "tourism", "office", "healthcare", "historic", "leisure", "building")):
        return None

    if amenity == "police" or "สถานีตำรวจ" in name or "ป้อมตำรวจ" in name:
        return "i"
    if amenity in ("hospital", "clinic", "doctors", "pharmacy", "dentist") or healthcare or any(
        token in name for token in ("รพ.สต", "โรงพยาบาลส่งเสริม", "สถานีอนามัย", "โรงพยาบาล", "ศูนย์สุขภาพ", "สาธารณสุข")
    ):
        if amenity == "hospital" or any(token in name for token in ("รพ.สต", "โรงพยาบาลส่งเสริม", "สถานีอนามัย", "โรงพยาบาล", "ศูนย์สุขภาพ", "สาธารณสุข")):
            return "l"
        return "q"
    if amenity in ("school", "kindergarten", "college", "university") or tags.get("building") == "school" or name.startswith("โรงเรียน") or name.startswith("ศูนย์พัฒนาเด็ก"):
        return "e"
    if amenity == "place_of_worship" or tags.get("building") == "temple" or name.startswith("วัด") or name.startswith("สำนักสงฆ์"):
        return "w"
    if amenity == "fuel" or "ปั๊ม" in name:
        return "g"
    if amenity in ("bank", "atm") or "ธนาคาร" in name:
        return "b"
    if amenity == "marketplace" or "ตลาด" in name:
        return "m"
    if name.strip().lower() == "sod station":
        return "f"
    if name == "ร้านเจริญ":
        return "r"
    if amenity == "cafe" or shop in ("coffee", "tea") or "คาเฟ่" in name or "กาแฟ" in name:
        return "f"
    if amenity in ("restaurant", "fast_food", "food_court") or shop == "food":
        return "r"
    if tourism in ("camp_site", "caravan_site") or any(token in name for token in ("แคมป์", "กางเต็นท์", "ลานกาง")):
        return "k"
    if tourism in ("hotel", "guest_house", "hostel", "motel", "apartment", "resort", "chalet") or any(
        token in name for token in ("โรงแรม", "รีสอร์ท", "ที่พัก", "โฮมสเตย์")
    ):
        return "h"
    if tourism == "viewpoint" or any(token in name for token in ("จุดชม", "จุดถ่าย", "เช็คอิน", "เช็ค อิน", "จุดเช็ค", "จุดเช็ก")):
        return "v"
    if any(token in name for token in ("อบต", "เทศบาล", "องค์การบริหาร")) or office in ("government", "administrative") or amenity == "townhall" or "ที่ว่าการ" in name:
        return "o"
    if amenity == "post_office" or "ไปรษณีย์" in name:
        return "p"
    if shop == "convenience" or "7-eleven" in low or "7 eleven" in low or "เซเว่น" in name:
        return "c"
    if tourism in ("attraction", "museum", "gallery", "artwork", "picnic_site", "theme_park", "zoo") or leisure in (
        "park",
        "nature_reserve",
        "garden",
        "stadium",
    ) or historic or natural in ("peak", "beach", "spring", "waterfall", "cave_entrance") or tags.get("man_made") in ("tower", "lighthouse"):
        return "t"
    if shop:
        return "s"
    if amenity in ("community_centre", "library", "fire_station", "bus_station", "ferry_terminal"):
        return "y" if amenity == "community_centre" else "o"
    if tags.get("railway") in ("station", "halt") or tags.get("building") == "train_station" or name.startswith("สถานีรถไฟ") or name.startswith("สถานีรถ"):
        return "x"
    if tags.get("place") in ("town", "village", "hamlet", "suburb", "municipality"):
        return "y"
    return None


def round5(value):
    return round(float(value), 5)


HOUSE_BUILDINGS = {
    "house", "residential", "detached", "semidetached_house",
    "terrace", "bungalow", "static_caravan", "cabin", "farm",
}
PUBLIC_KEYS = ("amenity", "shop", "tourism", "office", "healthcare", "historic", "leisure")
NAME_PREFIXES = ("ร้านอาหาร", "ร้านกาแฟ", "ร้านค้า", "ร้าน", "วัด", "คาเฟ่", "โรงแรม", "รีสอร์ท", "รีสอร์ต")
# บ้านนางหลง is a village, so bare "บ้านนาง" only counts when a space follows the title.
PERSONAL_NAME = re.compile(
    r"^บ้าน(นาย|นางสาว|คุณ|ของ|ด\.?ช\.?|ด\.?ญ\.?|เด็กชาย|เด็กหญิง|แม่|พ่อ|ลุง|ป้า|น้า|อา|ยาย|ตา|ปู่|ย่า|พี่|น้อง)"
)


def is_closed(tags):
    if (tags.get("shop") or "") == "vacant" or (tags.get("amenity") or "") == "vacant" or (tags.get("office") or "") == "vacant":
        return True
    hours = (tags.get("opening_hours") or "").strip().lower()
    if hours in ("closed", "off"):
        return True
    if tags.get("disused") or tags.get("abandoned"):
        return True
    for key in tags:
        if key.startswith("disused:") or key.startswith("abandoned:") or key.startswith("was:"):
            return True
    end = (tags.get("end_date") or "").strip()
    match = re.match(r"(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?", end)
    if match:
        year = int(match.group(1))
        if match.group(2) is None:
            month, day = 12, 31
        elif match.group(3) is None:
            month, day = int(match.group(2)), 28
        else:
            month, day = int(match.group(2)), int(match.group(3))
        if (year, month, day) < (2026, 10, 15):
            return True
    return False


def is_private_home(tags, name):
    # Villages and hamlets stay. A house name is not a หมู่บ้าน unless the tag says so.
    if tags.get("place") in ("village", "hamlet", "town", "municipality", "suburb", "city"):
        return False
    compact = re.sub(r"\s+", "", name or "")
    spaced = re.sub(r"\s+", " ", (name or "").strip())
    if PERSONAL_NAME.match(compact) or re.match(r"^บ้านนาง(\s|$)", spaced):
        return True
    building = tags.get("building") or ""
    if building in HOUSE_BUILDINGS and not any(tags.get(key) for key in PUBLIC_KEYS):
        return True
    return False


def fold_name(value):
    if not value:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[\s\.\-_'’\"/]+", "", text)
    return text


def strip_one_prefix(folded):
    for prefix in NAME_PREFIXES:
        token = fold_name(prefix)
        if folded.startswith(token) and len(folded) > len(token) + 1:
            return folded[len(token):]
    return folded


def name_variants(tags, name):
    found = []
    for value in (name, tags.get("name"), tags.get("name:th"), tags.get("name:en"), tags.get("brand"), tags.get("official_name")):
        folded = fold_name(value)
        if not folded:
            continue
        found.append(folded)
        stripped = strip_one_prefix(folded)
        if stripped and stripped != folded:
            found.append(stripped)
    return found


def names_match(left, right):
    for item in left:
        if item and item in right and len(item) >= 2:
            return True
    return False


def distance_m(lat1, lon1, lat2, lon2):
    radius = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    arc = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(arc)))


def tag_score(tags):
    score = len(tags)
    if tags.get("name:th"):
        score += 5
    if tags.get("amenity") not in (None, "", "yes"):
        score += 4
    if tags.get("shop") not in (None, "", "yes"):
        score += 4
    if tags.get("tourism"):
        score += 3
    if tags.get("brand"):
        score += 2
    if tags.get("phone") or tags.get("contact:phone"):
        score += 2
    if tags.get("website") or tags.get("contact:website"):
        score += 1
    if tags.get("opening_hours"):
        score += 1
    if tags.get("wikidata") or tags.get("wikipedia"):
        score += 2
    return score


def dedupe_places(places):
    ranked = sorted(places, key=lambda item: (-item["_score"], item["n"], item["i"]))
    kept = []
    removed = []
    for place in ranked:
        twin = None
        for other in kept:
            if place["c"] != other["c"]:
                continue
            if distance_m(place["lat"], place["lng"], other["lat"], other["lng"]) > 150:
                continue
            if names_match(place["_variants"], other["_variants"]):
                twin = other
                break
        if twin:
            removed.append(place["n"] + " ~ " + twin["n"])
            continue
        kept.append(place)
    return kept, removed


def main():
    parser = argparse.ArgumentParser(description="Build the Cha-uat OSM place dataset")
    parser.add_argument("--cache", help="Directory for raw Overpass responses")
    parser.add_argument("--out", default=OUT_PATH)
    args = parser.parse_args()

    def cached(name):
        if not args.cache:
            return None
        return os.path.join(args.cache, name)

    print("finding district...", file=sys.stderr)
    district_meta = overpass(
        '[out:json][timeout:60];'
        'rel["boundary"="administrative"]["admin_level"="6"]["name"="อำเภอชะอวด"];'
        "out tags bb;",
        cached("district-meta.json"),
    )
    districts = [
        el for el in district_meta.get("elements") or []
        if (el.get("tags") or {}).get("name:en") in (None, "Cha-uat District", "Cha-uat")
        or (el.get("tags") or {}).get("name") == "อำเภอชะอวด"
    ]
    if not districts:
        raise SystemExit("อำเภอชะอวด relation not found")
    district_el = districts[0]
    district_id = district_el["id"]
    bounds = district_el.get("bounds") or {}
    pad = 0.002
    south = bounds["minlat"] - pad
    west = bounds["minlon"] - pad
    north = bounds["maxlat"] + pad
    east = bounds["maxlon"] + pad
    bbox = "(%.7f,%.7f,%.7f,%.7f)" % (south, west, north, east)
    print("district", district_id, bbox, file=sys.stderr)

    print("downloading district geometry...", file=sys.stderr)
    district_geom = overpass(
        "[out:json][timeout:180];rel(%d);out geom;" % district_id,
        cached("district-geom.json"),
    )
    district_rel = next(el for el in district_geom["elements"] if el["id"] == district_id)
    district_rings = relation_rings(district_rel)
    if not district_rings[0]:
        raise SystemExit("district geometry has no outer ring")

    print("downloading tambon geometries...", file=sys.stderr)
    tambon_raw = overpass(
        '[out:json][timeout:180];'
        'rel["boundary"="administrative"]["admin_level"="8"]%s;'
        "out geom;" % bbox,
        cached("tambons.json"),
    )
    tambons = []
    for el in tambon_raw.get("elements") or []:
        tags = el.get("tags") or {}
        if tags.get("boundary") != "administrative" or tags.get("admin_level") != "8":
            continue
        name = (tags.get("name:th") or tags.get("name") or "").strip()
        name = name.replace("ตำบล", "").strip() or name
        outers, inners = relation_rings(el)
        if not outers:
            continue
        coverage = sample_inside(outers, district_rings)
        lon, lat = interior_point(outers, inners)
        inside = contains(lon, lat, district_rings[0], district_rings[1])
        if coverage < 0.55 and not inside:
            continue
        tambons.append({
            "id": el["id"],
            "name": name,
            "outers": outers,
            "inners": inners,
            "lon": lon,
            "lat": lat,
            "coverage": coverage,
        })
    tambons.sort(key=lambda item: item["name"])
    print("tambon boundaries", len(tambons), file=sys.stderr)

    poi_queries = [
        (
            "poi-services.json",
            "[out:json][timeout:180];("
            'nwr["amenity"~"^(place_of_worship|school|kindergarten|college|university|townhall|cafe|restaurant|fast_food|food_court|hospital|clinic|doctors|pharmacy|dentist|police|marketplace|fuel|bank|atm|post_office|community_centre|library|fire_station|bus_station|ferry_terminal)$"]["name"]%(b)s;'
            'nwr["amenity"~"^(place_of_worship|school|kindergarten|college|university|townhall|hospital|clinic|police|marketplace|fuel|bank)$"]["name:th"]%(b)s;'
            'nwr["office"~"^(government|administrative)$"]["name"]%(b)s;'
            'nwr["healthcare"]["name"]%(b)s;'
            'nwr["building"~"^(temple|school|hospital|civic|government)$"]["name"]%(b)s;'
            'nwr["shop"]["name"]%(b)s;'
            'nwr["shop"="convenience"]["brand"]%(b)s;'
            'nwr["amenity"="fuel"]["brand"]%(b)s;'
            ") ; out tags center;"
        ),
        (
            "poi-tourism.json",
            "[out:json][timeout:180];("
            'nwr["tourism"]["name"]%(b)s;'
            'nwr["historic"]["name"]%(b)s;'
            'nwr["natural"~"^(peak|beach|spring|waterfall|cave_entrance)$"]["name"]%(b)s;'
            'nwr["man_made"~"^(tower|lighthouse)$"]["name"]%(b)s;'
            'nwr["leisure"~"^(park|nature_reserve|garden|stadium)$"]["name"]%(b)s;'
            'nwr["name"~"อบต|เทศบาล|องค์การบริหาร|ที่ว่าการ|โรงพยาบาลส่งเสริม|รพ\\.สต|สถานีตำรวจ|เซเว่น|7-Eleven|7-eleven|ท่าเสม็ด|เคร็ง|วังอ่าง|ขอนหาด|เกาะขันธ์|เขาพระทอง|นางหลง|บ้านตูล|ควนหนองหง"]%(b)s;'
            'node["place"~"^(town|municipality|village|hamlet|suburb)$"]["name"]%(b)s;'
            'nwr["name"~"^วัด|^สำนักสงฆ์|^ตลาด|^โรงพยาบาล|^สถานีตำรวจ|^ธนาคาร"]%(b)s;'
            'nwr["religion"="buddhist"]["name"]%(b)s;'
            ") ; out tags center;"
        ),
        (
            "poi-homes.json",
            "[out:json][timeout:90];("
            'nwr["building"~"^(house|residential|detached|semidetached_house|terrace|bungalow)$"]["name"]%(b)s;'
            'nwr["name"~"^บ้าน(นาย|นาง|คุณ)"]%(b)s;'
            'nwr["shop"="vacant"]%(b)s;'
            'nwr["amenity"="vacant"]%(b)s;'
            'nwr["opening_hours"~"^(closed|off)$",i]["name"]%(b)s;'
            'nwr[~"^(disused|abandoned|was):"~"."]["name"]%(b)s;'
            'nwr["end_date"]["name"]%(b)s;'
            ") ; out tags center;"
        ),
    ]
    seen = {}
    for filename, query in poi_queries:
        print("downloading", filename, "...", file=sys.stderr)
        payload = overpass(query % {"b": bbox}, cached(filename))
        for el in payload.get("elements") or []:
            seen[(el.get("type"), el.get("id"))] = el
        time.sleep(2)

    places = []
    skipped_outside = 0
    removed_closed = []
    removed_homes = []
    for (typ, oid), el in seen.items():
        tags = el.get("tags") or {}
        name = thai_name(tags)
        if not name or len(name) < 2:
            continue
        point = element_point(el)
        if not point:
            continue
        lat, lon = point
        if not contains(lon, lat, district_rings[0], district_rings[1]):
            skipped_outside += 1
            continue
        if is_closed(tags):
            removed_closed.append(name)
            continue
        if is_private_home(tags, name):
            removed_homes.append(name)
            continue
        cat = classify(tags, name)
        if not cat:
            continue
        tambon = ""
        for item in tambons:
            if contains(lon, lat, item["outers"], item["inners"]):
                tambon = item["name"]
                break
        sub = (tags.get("addr:subdistrict") or "").replace("ตำบล", "").strip()
        if sub:
            tambon = sub
        elif is_local_gov_office(tags, name):
            tambon = norm_admin(name) or tambon
        elif tags.get("place") in ("town", "municipality") and any(token in name for token in ("เทศบาล", "อบต", "องค์การบริหาร")):
            tambon = norm_admin(name) or tambon
        kind = ""
        if is_local_gov_office(tags, name):
            kind = "office"
        elif tags.get("place") in ("town", "municipality") and any(token in name for token in ("เทศบาล", "อบต", "องค์การบริหาร")):
            kind = "muni"
        elif sub:
            kind = "addr"
        prefix = {"node": "n", "way": "w", "relation": "r"}.get(typ, "x")
        places.append({
            "n": name,
            "c": cat,
            "lat": round5(lat),
            "lng": round5(lon),
            "t": tambon,
            "i": "%s%s" % (prefix, oid),
            "_office": kind == "office",
            "_kind": kind,
            "_tags": tags,
            "_score": tag_score(tags),
            "_variants": name_variants(tags, name),
        })

    places, removed_dupes = dedupe_places(places)

    def office_covers_name(tambon_name):
        key = norm_admin(tambon_name)
        if not key:
            return False
        for place in places:
            if not place.get("_office"):
                continue
            office_key = norm_admin(place["n"])
            if key == office_key or key in office_key:
                return True
        return False

    missing = []
    for tambon in tambons:
        if office_covers_name(tambon["name"]):
            continue
        missing.append(tambon["name"])
        places.append({
            "n": "ตำบล" + tambon["name"],
            "c": "o",
            "lat": round5(tambon["lat"]),
            "lng": round5(tambon["lon"]),
            "t": tambon["name"],
            "i": "tambon-%s" % tambon["id"],
            "k": "centroid",
            "_office": False,
        })

    discovered = []
    for tambon in tambons:
        discovered.append({
            "n": tambon["name"],
            "lat": round5(tambon["lat"]),
            "lng": round5(tambon["lon"]),
            "i": tambon["id"],
            "src": "boundary",
        })
    seen_names = {item["n"] for item in discovered}
    for place in places:
        if place.get("_kind") not in ("office", "muni"):
            continue
        key = norm_admin(place["t"] or place["n"])
        if not key or key in seen_names:
            continue
        discovered.append({
            "n": key,
            "lat": place["lat"],
            "lng": place["lng"],
            "i": place["i"],
            "src": "office" if place.get("_office") else "place",
        })
        seen_names.add(key)
    for place in places:
        key = (place.get("t") or "").strip()
        if key and key not in seen_names:
            discovered.append({"n": key, "src": "addr"})
            seen_names.add(key)
    for name in REFERENCE_TAMBONS:
        if not office_covers_name(name):
            missing.append(name)
        if name not in seen_names:
            discovered.append({"n": name, "src": "unmapped"})
            seen_names.add(name)

    missing = list(dict.fromkeys(missing))
    missing_boundaries = [name for name in REFERENCE_TAMBONS if name not in {item["name"] for item in tambons}]

    clean = []
    for place in places:
        item = {
            "n": place["n"],
            "c": place["c"],
            "lat": place["lat"],
            "lng": place["lng"],
            "i": place["i"],
        }
        if place.get("t"):
            item["t"] = place["t"]
        if place.get("k"):
            item["k"] = place["k"]
        clean.append(item)
    clean.sort(key=lambda item: (item.get("t") or "", item["c"], item["n"], item["i"]))

    by_cat = {}
    by_tambon = {}
    for place in clean:
        by_cat[place["c"]] = by_cat.get(place["c"], 0) + 1
        label = place.get("t") or "(ไม่ทราบตำบล)"
        by_tambon[label] = by_tambon.get(label, 0) + 1

    payload = {
        "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "area": "อำเภอชะอวด จังหวัดนครศรีธรรมราช",
        "generated": "2026-10-15",
        "osmRelation": district_id,
        "note": "Place coordinates are OpenStreetMap only. k=centroid is the interior center of an OSM tambon boundary when that tambon has no อบต./เทศบาล office. This extract has no admin_level=8 tambon polygons in the district, so no centroid was invented. missingOffices lists published tambon names with no office building in OSM. missingBoundaries lists published tambon names with no OSM subdistrict polygon.",
        "tambons": discovered,
        "missingOffices": missing,
        "missingBoundaries": missing_boundaries,
        "removed": {
            "closed": len(removed_closed),
            "privateHomes": len(removed_homes),
            "duplicates": len(removed_dupes),
        },
        "places": clean,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.write("\n")

    print("FILE", args.out)
    print("BYTES", os.path.getsize(args.out))
    print("PLACES", len(clean))
    print("OUTSIDE_SKIPPED", skipped_outside)
    print("REMOVED_CLOSED", len(removed_closed))
    for name in removed_closed:
        print("  closed", name)
    print("REMOVED_HOMES", len(removed_homes))
    for name in removed_homes:
        print("  home", name)
    print("REMOVED_DUPES", len(removed_dupes))
    for name in removed_dupes:
        print("  dupe", name)
    print("TAMBON_BOUNDARIES", ", ".join(item["name"] for item in tambons) or "(none)")
    print("TAMBONS_FOUND", ", ".join(item["n"] for item in discovered) or "(none)")
    print("MISSING_BOUNDARIES", ", ".join(missing_boundaries) if missing_boundaries else "(none)")
    print("MISSING_OFFICES", ", ".join(missing) if missing else "(none)")
    print("BY_CATEGORY")
    for code, count in sorted(by_cat.items(), key=lambda item: (-item[1], item[0])):
        print("  %s %s %d" % (code, CAT_LABELS.get(code, code), count))
    print("BY_TAMBON")
    for name, count in sorted(by_tambon.items(), key=lambda item: (-item[1], item[0])):
        print("  %s %d" % (name, count))
    print("OFFICES")
    for place in clean:
        if place["c"] == "o":
            print("  ", place.get("t") or "-", place["n"], place.get("k") or "office", place["lat"], place["lng"])


if __name__ == "__main__":
    main()
