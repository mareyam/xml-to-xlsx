#!/usr/bin/env python3
"""Drag-and-drop desktop app: XML -> XLSX converter.

Install once:
    pip install lxml openpyxl tkinterdnd2

Run:
    python xml_to_xlsx_gui.py

Drag an .xml file onto the window (or click Browse), set the record tag
name (the repeating element, e.g. "row" or "record"), and click Convert.
Output .xlsx is saved next to the input file. Handles multi-GB files by
streaming, so memory stays low.
"""
import os
import threading
import traceback
import tkinter as tk
from tkinter import filedialog, messagebox

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    HAS_DND = True
except ImportError:
    HAS_DND = False

from lxml import etree
from openpyxl import Workbook

MAX_ROWS = 1_048_576 - 1


def iter_records(xml_path, record_tag):
    context = etree.iterparse(xml_path, events=("end",), tag=record_tag)
    for _, elem in context:
        row = {child.tag: (child.text or "") for child in elem}
        yield row
        elem.clear()
        while elem.getprevious() is not None:
            del elem.getparent()[0]


def convert(xml_path, record_tag, status_cb):
    output_xlsx = os.path.splitext(xml_path)[0] + ".xlsx"
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Sheet1")
    columns = None
    row_count = 0
    total = 0
    sheet_idx = 1

    for row in iter_records(xml_path, record_tag):
        if columns is None:
            columns = list(row.keys())
            if not columns:
                raise ValueError(f"No child elements found under <{record_tag}>; check the record tag.")
            ws.append(columns)
        ws.append([row.get(c, "") for c in columns])
        row_count += 1
        total += 1

        if row_count >= MAX_ROWS:
            sheet_idx += 1
            ws = wb.create_sheet(f"Sheet{sheet_idx}")
            ws.append(columns)
            row_count = 0

        if total % 5000 == 0:
            status_cb(f"Converting... {total:,} rows processed")

    if columns is None:
        raise ValueError(f"No elements matching <{record_tag}> found in the file.")

    wb.save(output_xlsx)
    return output_xlsx, total


class App:
    def __init__(self, root):
        self.root = root
        root.title("XML to XLSX Converter")
        root.geometry("480x320")

        self.path_var = tk.StringVar(value="No file selected")
        self.tag_var = tk.StringVar(value="row")
        self.status_var = tk.StringVar(value="Ready")

        drop_frame = tk.Frame(root, bg="#eef", height=120, relief="ridge", bd=2)
        drop_frame.pack(fill="x", padx=15, pady=15)
        drop_label = tk.Label(
            drop_frame,
            text="Drag & drop .xml file here\n(or click Browse below)",
            bg="#eef", font=("Arial", 12), justify="center",
        )
        drop_label.pack(expand=True, fill="both")

        if HAS_DND:
            drop_frame.drop_target_register(DND_FILES)
            drop_frame.dnd_bind("<<Drop>>", self.on_drop)
            drop_label.drop_target_register(DND_FILES)
            drop_label.dnd_bind("<<Drop>>", self.on_drop)
        else:
            drop_label.config(text="Drag & drop unavailable\n(tkinterdnd2 not installed) — use Browse below")

        tk.Button(root, text="Browse...", command=self.browse).pack(pady=(0, 10))
        tk.Label(root, textvariable=self.path_var, wraplength=440, fg="#333").pack()

        tag_frame = tk.Frame(root)
        tag_frame.pack(pady=10)
        tk.Label(tag_frame, text="Record tag name:").pack(side="left")
        tk.Entry(tag_frame, textvariable=self.tag_var, width=20).pack(side="left", padx=5)

        tk.Button(root, text="Convert", command=self.start_convert, bg="#4a7", fg="white").pack(pady=10)
        tk.Label(root, textvariable=self.status_var, fg="#555").pack(pady=5)

        self.xml_path = None

    def on_drop(self, event):
        path = event.data.strip("{}")
        self.set_path(path)

    def browse(self):
        path = filedialog.askopenfilename(filetypes=[("XML files", "*.xml"), ("All files", "*.*")])
        if path:
            self.set_path(path)

    def set_path(self, path):
        if not path.lower().endswith(".xml"):
            messagebox.showerror("Invalid file", "Please select an .xml file.")
            return
        self.xml_path = path
        self.path_var.set(path)
        self.status_var.set("Ready to convert")

    def start_convert(self):
        if not self.xml_path:
            messagebox.showerror("No file", "Select or drop an .xml file first.")
            return
        tag = self.tag_var.get().strip()
        if not tag:
            messagebox.showerror("Missing tag", "Enter the record tag name.")
            return
        self.status_var.set("Converting...")
        threading.Thread(target=self.run_convert, args=(self.xml_path, tag), daemon=True).start()

    def run_convert(self, path, tag):
        try:
            output, total = convert(path, tag, lambda msg: self.root.after(0, self.status_var.set, msg))
            self.root.after(0, self.status_var.set, f"Done: {total:,} rows -> {output}")
            self.root.after(0, messagebox.showinfo, "Done", f"Saved {total:,} rows to:\n{output}")
        except Exception as e:
            traceback.print_exc()
            self.root.after(0, self.status_var.set, "Error")
            self.root.after(0, messagebox.showerror, "Conversion failed", str(e))


def main():
    root = TkinterDnD.Tk() if HAS_DND else tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
