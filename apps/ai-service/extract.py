"""Plain-text extraction for uploaded documents. Images are sent to the model directly, not here."""
import csv
import html
import io
import re
import zipfile

MAX_CHARS = 30_000


def extract(name: str, raw: bytes) -> str:
    n = name.lower()
    if n.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((p.extract_text() or "") for p in reader.pages[:80])
    elif n.endswith(".docx"):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
        xml = re.sub(r"</w:p>", "\n", xml)
        text = html.unescape(re.sub(r"<[^>]+>", "", xml))
    elif n.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        lines: list[str] = []
        for ws in wb.worksheets[:5]:
            lines.append(f"## Sheet: {ws.title}")
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= 300:
                    break
                lines.append(",".join("" if v is None else str(v) for v in row))
        text = "\n".join(lines)
    elif n.endswith(".csv"):
        text = raw.decode("utf-8", "replace")
        rows = list(csv.reader(io.StringIO(text)))[:300]
        text = "\n".join(",".join(r) for r in rows)
    elif n.endswith((".txt", ".md")):
        text = raw.decode("utf-8", "replace")
    else:
        raise ValueError("unsupported document type")
    return text.strip()[:MAX_CHARS]
