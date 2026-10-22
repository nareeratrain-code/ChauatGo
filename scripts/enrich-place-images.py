#!/usr/bin/env python3
"""Best-effort place image enrichment for ChauatGo.

Sources are intentionally conservative:
- OpenStreetMap image= URLs, only after exact/near-exact name + coordinate matching.
- Wikimedia Commons files referenced by wikimedia_commons=, with API metadata.

The script never invents a photo for a place. It writes local assets and an
attribution manifest so the web app can keep source/license information.
"""
from __future__ import annotations

import ast
import json
import math
import mimetypes
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "locations-data.js"
IMAGE_DIR = ROOT / "images" / "places"
MANIFEST = ROOT / "data" / "place-image-attribution.json"
UA = "ChauatGo-place-image-enricher/1.0 (+https://github.com/nareeratrain-code/ChauatGo)"
BBOX = (7.84, 99.84, 8.13, 100.16)  # south, west, north, east around Cha-uat


def fold(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).lower()
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\u0E00-\u0E7F]+", "", text, flags=re.UNICODE)
    for prefix in ("ร้านอาหาร", "ร้านกาแฟ", "ร้านค้า", "ร้าน", "คาเฟ่", "โรงแรม", "รีสอร์ท"):
        p = re.sub(r"[^\w\u0E00-\u0E7F]+", "", prefix.lower(), flags=re.UNICODE)
        if p and text.startswith(p) and len(text) > len(p) + 2:
            text = text[len(p):]
            break
    return text


def distance_m(a_lat, a_lon, b_lat, b_lon):
    r = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(h)))


def request_json(url, params=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def load_rows():
    text = DATA.read_text(encoding="utf-8")
    rows = []
    line_matches = []
    for match in re.finditer(r"^(\s*)(\[[^\n]+\]),?\s*$", text, re.M):
        try:
            value = ast.literal_eval(match.group(2))
        except (SyntaxError, ValueError):
            continue
        if isinstance(value, list) and len(value) >= 7 and isinstance(value[0], str):
            rows.append(value)
            line_matches.append(match)
    if not rows:
        raise RuntimeError("No place rows found in locations-data.js")
    return text, rows, line_matches


def fetch_osm_candidates():
    s, w, n, e = BBOX
    bbox = f"{s},{w},{n},{e}"
    query = (
        "[out:json][timeout:180];("
        f'nwr["name"]["image"]({bbox});'
        f'nwr["name"]["wikimedia_commons"]({bbox});'
        ");out tags center;"
    )
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
    ]
    last = None
    for endpoint in endpoints:
        try:
            req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=220) as response:
                return json.loads(response.read().decode("utf-8")).get("elements", [])
        except Exception as exc:
            last = exc
            print("OSM endpoint failed:", endpoint, exc, file=sys.stderr)
    print("Overpass unavailable; falling back to OSM API map tiles", file=sys.stderr)
    return fetch_osm_map_tiles()


def fetch_osm_map_tiles():
    """Fetch small OSM API map boxes; the API rejects large boxes."""
    south, west, north, east = BBOX
    step = 0.06
    elements = []
    seen = set()
    lat = south
    while lat < north:
        lon = west
        while lon < east:
            box_n = min(lat + step, north)
            box_e = min(lon + step, east)
            url = "https://api.openstreetmap.org/api/0.6/map?" + urllib.parse.urlencode({
                "bbox": f"{lon:.6f},{lat:.6f},{box_e:.6f},{box_n:.6f}"
            })
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/xml"})
                with urllib.request.urlopen(req, timeout=150) as response:
                    root = ET.fromstring(response.read())
                nodes = {}
                for node in root.findall("node"):
                    nodes[node.attrib["id"]] = (float(node.attrib["lat"]), float(node.attrib["lon"]))
                    tags = {t.attrib["k"]: t.attrib.get("v", "") for t in node.findall("tag")}
                    if tags.get("name") and (tags.get("image") or tags.get("wikimedia_commons")):
                        key = ("node", node.attrib["id"])
                        if key not in seen:
                            elements.append({"type": "node", "id": int(node.attrib["id"]), "lat": nodes[node.attrib["id"]][0], "lon": nodes[node.attrib["id"]][1], "tags": tags})
                            seen.add(key)
                for way in root.findall("way"):
                    tags = {t.attrib["k"]: t.attrib.get("v", "") for t in way.findall("tag")}
                    if not tags.get("name") or not (tags.get("image") or tags.get("wikimedia_commons")):
                        continue
                    points = [nodes[nd.attrib["ref"]] for nd in way.findall("nd") if nd.attrib["ref"] in nodes]
                    if not points:
                        continue
                    key = ("way", way.attrib["id"])
                    if key not in seen:
                        elements.append({"type": "way", "id": int(way.attrib["id"]), "center": {"lat": sum(p[0] for p in points) / len(points), "lon": sum(p[1] for p in points) / len(points)}, "tags": tags})
                        seen.add(key)
                print(f"OSM tile {lat:.2f},{lon:.2f}: {len(elements)} candidates", file=sys.stderr)
            except Exception as exc:
                print("OSM map tile failed:", url, exc, file=sys.stderr)
            lon += step
        lat += step
    return elements


def element_point(element):
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def best_matches(rows, elements):
    indexed = []
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name:th") or tags.get("name") or tags.get("brand") or ""
        point = element_point(el)
        if not name or not point:
            continue
        indexed.append((fold(name), float(point[0]), float(point[1]), tags, el))
    matches = {}
    for idx, row in enumerate(rows):
        name, lat, lon = row[0], float(row[1]), float(row[2])
        key = fold(name)
        candidates = []
        for osm_key, o_lat, o_lon, tags, el in indexed:
            if not key or not osm_key:
                continue
            if not (key == osm_key or key in osm_key or osm_key in key):
                continue
            dist = distance_m(lat, lon, o_lat, o_lon)
            if dist <= 300:
                candidates.append((dist, -len(osm_key), tags, el, o_lat, o_lon))
        if candidates:
            candidates.sort(key=lambda x: (x[0], x[1]))
            matches[idx] = candidates[0]
    return matches


def safe_slug(name, idx):
    slug = re.sub(r"[^0-9A-Za-zก-๙]+", "-", name.lower()).strip("-")
    return (slug[:80] or f"place-{idx}") + f"-{idx}"


def download(url, out_path):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=60) as response:
        ctype = (response.headers.get_content_type() or "").lower()
        data = response.read()
    if not ctype.startswith("image/"):
        return None
    if len(data) < 2048 or len(data) > 12 * 1024 * 1024:
        return None
    ext = mimetypes.guess_extension(ctype) or ".jpg"
    if ext == ".jpe": ext = ".jpg"
    final = out_path.with_suffix(ext)
    final.write_bytes(data)
    return final


def commons_info(value):
    title = value.strip()
    if not title.lower().startswith("file:"):
        title = "File:" + title
    payload = request_json("https://commons.wikimedia.org/w/api.php", {
        "action": "query", "format": "json", "redirects": 1,
        "titles": title, "prop": "imageinfo", "iiprop": "url|extmetadata",
        "iiurlwidth": 1200,
    })
    pages = payload.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {})
    info = (page.get("imageinfo") or [{}])[0]
    return page, info


def main():
    dry_run = "--dry-run" in sys.argv
    text, rows, line_matches = load_rows()
    print("สถานที่ทั้งหมด:", len(rows))
    elements = fetch_osm_candidates()
    print("OSM candidates with image metadata:", len(elements))
    matches = best_matches(rows, elements)
    print("จับคู่ชื่อ+พิกัดได้:", len(matches))
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    try:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        manifest = {}
    added = 0
    skipped = 0
    for idx, candidate in matches.items():
        row = rows[idx]
        dist, _neg_len, tags, element, o_lat, o_lon = candidate
        if str(row[5] or "").startswith("images/") and Path(ROOT / row[5]).exists():
            continue
        source_type = None
        source_url = None
        license_name = None
        local = None
        commons = tags.get("wikimedia_commons")
        if commons:
            try:
                page, info = commons_info(commons)
                source_url = info.get("descriptionurl") or info.get("url")
                thumb = info.get("thumburl") or info.get("url")
                if thumb:
                    local = download(thumb, IMAGE_DIR / safe_slug(row[0], idx))
                source_type = "Wikimedia Commons"
                ext = info.get("extmetadata") or {}
                license_name = (ext.get("LicenseShortName") or {}).get("value")
            except Exception as exc:
                print("Commons failed:", row[0], exc, file=sys.stderr)
        if local is None and tags.get("image", "").startswith(("http://", "https://")):
            source_url = tags["image"]
            try:
                local = download(source_url, IMAGE_DIR / safe_slug(row[0], idx))
                source_type = "OpenStreetMap image tag"
                license_name = "License not declared by OSM tag"
            except Exception as exc:
                print("image URL failed:", row[0], exc, file=sys.stderr)
        if local is None:
            skipped += 1
            continue
        rel = local.relative_to(ROOT).as_posix()
        rows[idx][5] = rel
        manifest[str(idx)] = {
            "place": row[0], "localPath": rel, "sourceType": source_type,
            "sourceUrl": source_url, "license": license_name,
            "matchedDistanceMeters": round(dist, 1),
            "osmElement": f"{element.get('type')}:{element.get('id')}",
            "attribution": "Wikimedia Commons / OpenStreetMap metadata",
        }
        added += 1
        print("added", row[0], "->", rel, f"({dist:.0f}m)")
        time.sleep(0.15)
    if dry_run:
        print("DRY RUN; no data file changes")
        return
    changed = {idx for idx in matches if str(rows[idx][5] or "").startswith("images/places/")}
    if changed:
        chunks = []
        cursor = 0
        for idx, match in enumerate(line_matches):
            chunks.append(text[cursor:match.start()])
            if idx in changed:
                chunks.append(match.group(1) + json.dumps(rows[idx], ensure_ascii=False, separators=(",", ":")) + ",")
            else:
                chunks.append(match.group(0))
            cursor = match.end()
        chunks.append(text[cursor:])
        DATA.write_text("".join(chunks), encoding="utf-8")
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("เพิ่มรูปใหม่:", added)
    print("จับคู่ได้แต่ดาวน์โหลดไม่ได้/ไม่มี URL รูป:", skipped)
    print("manifest:", MANIFEST)


if __name__ == "__main__":
    main()
