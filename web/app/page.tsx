"use client";

import { useCallback, useRef, useState } from "react";

type Status = "idle" | "dragging" | "converting" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [recordTag, setRecordTag] = useState("row");
  const [message, setMessage] = useState<string>("");
  const fileRef = useRef<File | null>(null);

  const pickFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".xml")) {
      setStatus("error");
      setMessage("Please choose an .xml file.");
      return;
    }
    fileRef.current = file;
    setFileName(file.name);
    setStatus("idle");
    setMessage("");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) pickFile(file);
    },
    [pickFile]
  );

  const convert = useCallback(async () => {
    const file = fileRef.current;
    if (!file) {
      setStatus("error");
      setMessage("Drop or select an .xml file first.");
      return;
    }
    if (!recordTag.trim()) {
      setStatus("error");
      setMessage("Enter the record tag name.");
      return;
    }

    setStatus("converting");
    setMessage("Converting... this can take a while for large files.");

    try {
      const res = await fetch(`/api/convert?recordTag=${encodeURIComponent(recordTag.trim())}`, {
        method: "POST",
        body: file,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Conversion failed" }));
        setStatus("error");
        setMessage(body.error || "Conversion failed");
        return;
      }

      const rowCount = res.headers.get("X-Row-Count");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.xml$/i, "") + ".xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("done");
      setMessage(rowCount ? `Done — ${Number(rowCount).toLocaleString()} rows converted.` : "Done.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Conversion failed");
    }
  }, [recordTag]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="flex w-full max-w-lg flex-col gap-6 rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.1] dark:bg-zinc-900">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">XML to XLSX</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Drop a large XML file, pick the repeating record tag, get an Excel file back.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setStatus("dragging");
          }}
          onDragLeave={() => setStatus(fileName ? "idle" : "idle")}
          onDrop={onDrop}
          onClick={() => document.getElementById("file-input")?.click()}
          className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${
            status === "dragging"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
              : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
          }`}
        >
          <p className="px-4 text-sm text-zinc-700 dark:text-zinc-300">
            {fileName ? (
              <span className="font-medium">{fileName}</span>
            ) : (
              <>
                Drag & drop your .xml file here
                <br />
                <span className="text-zinc-400">or click to browse</span>
              </>
            )}
          </p>
          <input
            id="file-input"
            type="file"
            accept=".xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickFile(file);
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Record tag name
          </label>
          <input
            type="text"
            value={recordTag}
            onChange={(e) => setRecordTag(e.target.value)}
            placeholder="e.g. row, record, order"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <p className="mt-1 text-xs text-zinc-400">
            The XML element that repeats once per row, e.g. {"<row>"} in {"<rows><row>...</row></rows>"}.
          </p>
        </div>

        <button
          onClick={convert}
          disabled={status === "converting"}
          className="flex h-11 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {status === "converting" ? "Converting..." : "Convert"}
        </button>

        {message && (
          <p
            className={`text-sm ${
              status === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
