#!/usr/bin/env python3
"""Extract Nakhon Si Thammarat tambon polygons from the HDX COD-AB shapefile.

Source: OCHA ROAP / Royal Thai Survey Department, Thailand administrative
boundaries (COD-AB), CC BY-IGO. https://data.humdata.org/dataset/cod-ab-tha

OSM has district polygons for this province and no admin_level=8 tambons.
This file is a build input. The app stores tambon names and, where a
government stay has no coordinate, the tambon reference point flagged ax:1.
"""

import json
import sys

import shapefile

PROVINCE = 'TH80'
TOL = 0.0002


def signed_area(ring):
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def perp_dist(point, start, end):
    px, py = point
    ax, ay = start
    bx, by = end
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    if t < 0:
        t = 0
    elif t > 1:
        t = 1
    qx = ax + t * dx
    qy = ay + t * dy
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5


def simplify(points, tol):
    if len(points) < 5:
        return points
    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        best_i = start
        best_d = -1.0
        for i in range(start + 1, end):
            dist = perp_dist(points[i], points[start], points[end])
            if dist > best_d:
                best_d = dist
                best_i = i
        if best_d > tol:
            keep[best_i] = True
            stack.append((start, best_i))
            stack.append((best_i, end))
    return [points[i] for i in range(len(points)) if keep[i]]


def clean_name(value):
    text = str(value or '').strip()
    for prefix in ('ตำบล', 'แขวง', 'อำเภอ', 'เขต'):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
    return text


def main():
    src = sys.argv[1]
    dest = sys.argv[2]
    reader = shapefile.Reader(src, encoding='utf-8')
    tambons = []
    for index, record in enumerate(reader.iterRecords()):
        row = record.as_dict()
        if row.get('adm1_pcode') != PROVINCE:
            continue
        shape = reader.shape(index)
        points = shape.points
        parts = list(shape.parts) + [len(points)]
        rings = []
        for part_i in range(len(parts) - 1):
            ring = [[round(points[j][0], 6), round(points[j][1], 6)] for j in range(parts[part_i], parts[part_i + 1])]
            if len(ring) < 4:
                continue
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            ring = simplify(ring, TOL)
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) >= 4:
                rings.append(ring)
        if not rings:
            continue
        rings.sort(key=lambda ring: abs(signed_area(ring)), reverse=True)
        winding = signed_area(rings[0])
        outers = []
        inners = []
        for ring in rings:
            if signed_area(ring) * winding >= 0:
                outers.append(ring)
            else:
                inners.append(ring)
        bbox = [min(pt[0] for ring in outers for pt in ring),
                min(pt[1] for ring in outers for pt in ring),
                max(pt[0] for ring in outers for pt in ring),
                max(pt[1] for ring in outers for pt in ring)]
        district = clean_name(row.get('adm2_name1') or row.get('adm2_name'))
        if district == 'นครศรีธรรมราช':
            district = 'เมืองนครศรีธรรมราช'
        name = clean_name(row.get('adm3_name1') or row.get('adm3_name'))
        english = str(row.get('adm3_name') or '')
        if english.endswith('Fang Tawan Tok'):
            name = 'ปากพนังฝั่งตะวันตก'
        elif english.endswith('Fang Tawan Ok'):
            name = 'ปากพนังฝั่งตะวันออก'
        tambons.append({
            'id': row.get('adm3_pcode'),
            'name': name,
            'district': district,
            'lat': round(float(row.get('center_lat')), 6),
            'lng': round(float(row.get('center_lon')), 6),
            'bbox': [round(n, 6) for n in bbox],
            'outers': outers,
            'inners': inners
        })
    tambons.sort(key=lambda item: (item['district'], item['name']))
    doc = {
        'license': 'CC-BY-IGO',
        'attribution': 'ขอบเขตตำบล: OCHA ROAP / Royal Thai Survey Department, HDX COD-AB (CC BY-IGO)',
        'source': 'https://data.humdata.org/dataset/cod-ab-tha',
        'province': 'นครศรีธรรมราช',
        'tambons': tambons
    }
    with open(dest, 'w', encoding='utf-8') as handle:
        json.dump(doc, handle, ensure_ascii=False, separators=(',', ':'))
    print('tambons', len(tambons), 'bytes', __import__('os').path.getsize(dest))


if __name__ == '__main__':
    main()
