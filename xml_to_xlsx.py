#!/usr/bin/env python3
"""Stream a large XML file into an XLSX workbook without loading it all into memory.

Usage:
    python xml_to_xlsx.py input.xml output.xlsx --record-tag row

Assumes the XML is a flat list of repeating "record" elements (e.g. <rows><row><a>1</a><b>2</b></row>...).
Columns are taken from the union of child tag names, in first-seen order.

Excel caps a sheet at 1,048,576 rows. If your data exceeds that, pass --split
to write additional sheets (Sheet1, Sheet2, ...) automatically.
"""
import argparse
from lxml import etree
from openpyxl import Workbook

MAX_ROWS = 1_048_576 - 1  # minus header


def iter_records(xml_path, record_tag):
    context = etree.iterparse(xml_path, events=("end",), tag=record_tag)
    for _, elem in context:
        row = {child.tag: (child.text or "") for child in elem}
        yield row
        elem.clear()
        while elem.getprevious() is not None:
            del elem.getparent()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_xml")
    ap.add_argument("output_xlsx")
    ap.add_argument("--record-tag", required=True, help="tag name of each repeating record element")
    ap.add_argument("--split", action="store_true", help="split into multiple sheets if row limit exceeded")
    args = ap.parse_args()

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Sheet1")
    columns = None
    row_count = 0
    sheet_idx = 1

    for row in iter_records(args.input_xml, args.record_tag):
        if columns is None:
            columns = list(row.keys())
            ws.append(columns)
        ws.append([row.get(c, "") for c in columns])
        row_count += 1

        if row_count >= MAX_ROWS:
            if not args.split:
                print(f"Row limit {MAX_ROWS} reached; stopping. Use --split to continue in a new sheet.")
                break
            sheet_idx += 1
            ws = wb.create_sheet(f"Sheet{sheet_idx}")
            ws.append(columns)
            row_count = 0

    wb.save(args.output_xlsx)
    print(f"Done: wrote {args.output_xlsx}")


if __name__ == "__main__":
    main()
