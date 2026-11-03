import { NextRequest } from "next/server";
import { mkdtemp, rm } from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { tmpdir } from "os";
import path from "path";
import sax from "sax";
import ExcelJS from "exceljs";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const recordTag = req.nextUrl.searchParams.get("recordTag")?.trim();
  if (!recordTag) {
    return new Response(JSON.stringify({ error: "Missing recordTag" }), { status: 400 });
  }
  if (!req.body) {
    return new Response(JSON.stringify({ error: "No file body" }), { status: 400 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "xml2xlsx-"));
  const xmlPath = path.join(dir, "input.xml");
  const xlsxPath = path.join(dir, "output.xlsx");

  try {
    // Stream the uploaded body straight to disk.
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(xmlPath);
      const reader = req.body!.getReader();
      out.on("error", reject);
      out.on("finish", resolve);

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!out.write(Buffer.from(value))) {
              await new Promise<void>((r) => out.once("drain", () => r()));
            }
          }
          out.end();
        } catch (e) {
          reject(e);
        }
      })();
    });

    // Stream-parse the XML and stream-write the XLSX so memory stays flat
    // regardless of file size.
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: xlsxPath, useStyles: false });
    let sheet = workbook.addWorksheet("Sheet1");
    const MAX_ROWS = 1_048_576 - 1;
    let sheetIdx = 1;
    let rowsInSheet = 0;
    let columns: string[] | null = null;
    let total = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(xmlPath);
      const parser = sax.createStream(true, { trim: false });

      let depth = 0;
      let recordDepth = -1;
      let currentRecord: Record<string, string> | null = null;
      let currentTag: string | null = null;
      let currentText = "";

      parser.on("opentag", (node) => {
        depth++;
        if (node.name === recordTag && recordDepth === -1) {
          recordDepth = depth;
          currentRecord = {};
        } else if (recordDepth !== -1 && depth === recordDepth + 1) {
          currentTag = node.name;
          currentText = "";
        }
      });

      parser.on("text", (text) => {
        if (currentTag) currentText += text;
      });
      parser.on("cdata", (text) => {
        if (currentTag) currentText += text;
      });

      parser.on("closetag", (name) => {
        if (recordDepth !== -1 && depth === recordDepth + 1 && name === currentTag) {
          if (currentRecord) currentRecord[currentTag] = currentText;
          currentTag = null;
          currentText = "";
        } else if (name === recordTag && depth === recordDepth) {
          if (currentRecord) {
            if (columns === null) {
              columns = Object.keys(currentRecord);
              sheet.addRow(columns).commit();
            }
            sheet.addRow(columns.map((c) => currentRecord![c] ?? "")).commit();
            total++;
            rowsInSheet++;
            if (rowsInSheet >= MAX_ROWS) {
              sheet.commit();
              sheetIdx++;
              sheet = workbook.addWorksheet(`Sheet${sheetIdx}`);
              sheet.addRow(columns).commit();
              rowsInSheet = 0;
            }
          }
          currentRecord = null;
          recordDepth = -1;
        }
        depth--;
      });

      parser.on("error", (err) => reject(err));
      parser.on("end", () => resolve());

      stream.pipe(parser);
      stream.on("error", reject);
    });

    if (columns === null) {
      await rm(dir, { recursive: true, force: true });
      return new Response(
        JSON.stringify({ error: `No elements matching <${recordTag}> found in the file.` }),
        { status: 400 }
      );
    }

    sheet.commit();
    await workbook.commit();

    const nodeStream = createReadStream(xlsxPath);
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk as Buffer));
        nodeStream.on("end", async () => {
          controller.close();
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        });
        nodeStream.on("error", async (err) => {
          controller.error(err);
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        });
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="output.xlsx"`,
        "X-Row-Count": String(total),
      },
    });
  } catch (err: unknown) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const message = err instanceof Error ? err.message : "Conversion failed";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
