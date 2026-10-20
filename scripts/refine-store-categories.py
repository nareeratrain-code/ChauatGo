#!/usr/bin/env python3
"""Refine high-confidence entries currently classified as generic stores.

Usage:
  python3 scripts/refine-store-categories.py        # preview changes
  python3 scripts/refine-store-categories.py --apply

Only rows whose current category is `s` are changed. Ambiguous names remain
in the generic store category for manual review.
"""
from __future__ import annotations

import argparse
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "locations-data.js"

# Specific, high-confidence rules. Order matters: the first match wins.
RULES = [
    ("c", "ร้านสะดวกซื้อ/ของชำ", [
        r"ของชำ", r"ร้านชำ", r"ขายของชำ", r"ร้านธงฟ้า", r"ซุปเปอร์(?!ไอที)",
    ]),
    ("r", "ร้านอาหาร", [
        r"กินเส้นเย็นตาโฟ", r"ยำเลย", r"สถานีตำแซ่บ", r"โรตีชะอวด", r"ฟรายส์ชิค",
    ]),
    ("f", "คาเฟ่", [
        r"Juicy ice", r"Momocha", r"ร้านจิบแฟแลพาน",
    ]),
    ("u", "ยานยนต์/อะไหล่", [
        r"อะไหล่ยนต์", r"อะไหล่ซิ่ง", r"คาร์แคร์", r"รถยก", r"รับอัดสายไฮดรอลิค",
        r"รถยนต์", r"มอเตอร์", r"มอไซค์", r"แบตเตอรี่", r"แม็กซิ่ง", r"พันธุ์ยาง",
        r"แทรกเตอร์", r"กลการ", r"ออโต้", r"โมโตรถ", r"ปะยาง",
    ]),
    ("a", "เกษตร/พันธุ์ไม้", [
        r"การเกษตร", r"เกษตรภัณฑ์", r"เกษตรรุ่ง", r"เกษตรรุ่งเรือง", r"ฟาร์ม",
        r"พันธุ์ไม้", r"สหกรณ์การเกษตร", r"โรงสี", r"อาหารสัตว์", r"ปุ๋ย",
        r"แคคตัส", r"มังคุด", r"สวนยาง", r"ไร่",
    ]),
    ("d", "วัสดุก่อสร้าง/ฮาร์ดแวร์", [
        r"วัสดุก่อสร้าง", r"ค้าเหล็ก", r"ค้าไม้", r"เคหะภัณฑ์", r"คอนกรีต",
        r"โรงอิฐ", r"การไฟฟ้า", r"เครื่องมือช่าง", r"ค้าวัสดุ", r"โฮมซัพพลาย",
    ]),
    ("n", "ไอที/มือถือ/อิเล็กทรอนิกส์", [
        r"คอมพิวเตอร์", r"ปริ้นเตอร์", r"อิเล็กทรอนิกส์", r"เทเลคอม", r"มือถือ",
        r"โมบาย", r"ไอที", r"เครื่องใช้ไฟฟ้า", r"เครื่องเสียง", r"ดาวเทียม",
    ]),
    ("j", "แฟชั่น/ความงาม", [
        r"เสื้อผ้า", r"รองเท้า", r"กระเป๋า", r"การแว่น", r"แว่นตา", r"แว่นบิวตี้",
        r"เสริมสวย", r"บิวตี้", r"ห้างทอง", r"รับหลอมทอง", r"ร้านสัก", r"Tattoo",
        r"Barber", r"ตัดผม", r"ต่อผม",
    ]),
    ("z", "บริการ/ซ่อม", [
        r"การพิมพ์", r"โรงพิมพ์", r"ซักผ้า", r"ซักอบ", r"ซักรีด", r"ซักแห้ง",
        r"ซ่อมนาฬิกา", r"กรอบรูป", r"รับอัด", r"ล้างแอร์", r"แอร์และ",
        r"แอร์ ?แอนด์เซอร์วิส", r"Express", r"Kerry", r"Drop point", r"กุญแจ",
        r"ช่างเอี้ยงโมบาย",
    ]),
]
COMPILED_RULES = [(code, label, [re.compile(p, re.I) for p in patterns]) for code, label, patterns in RULES]
ROW_RE = re.compile(r'^(\s*\["([^"]+)"\s*,[^\n]*?,")([a-z])(",.*)$')


def classify(name: str) -> tuple[str, str] | None:
    for code, label, patterns in COMPILED_RULES:
        if any(pattern.search(name) for pattern in patterns):
            return code, label
    return None


def scan(text: str):
    changes = []
    output = []
    for line in text.splitlines(True):
        match = ROW_RE.match(line) if line.lstrip().startswith("[") else None
        if match and match.group(3) == "s":
            result = classify(match.group(2))
            if result:
                code, label = result
                output.append(line[:match.start(3)] + code + line[match.end(3):])
                changes.append((match.group(2), "s", code, label))
                continue
        output.append(line)
    return "".join(output), changes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write changes to locations-data.js")
    args = parser.parse_args()
    original = DATA_PATH.read_text(encoding="utf-8")
    updated, changes = scan(original)
    counts = Counter(label for _, _, _, label in changes)
    print(f"candidate rows: {len(changes)}")
    for label, count in counts.items():
        print(f"  {label}: {count}")
    if args.apply:
        DATA_PATH.write_text(updated, encoding="utf-8")
        print(f"updated: {DATA_PATH}")
    else:
        for name, old, new, label in changes:
            print(f"  {old}->{new} | {label} | {name}")
        print("dry-run only; use --apply to write changes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
