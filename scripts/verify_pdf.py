#!/usr/bin/env python3
"""Verify that a captured PDF is readable and matches a requested DOI/title."""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path


def _normal(text: str) -> str:
    return "".join(ch.casefold() for ch in text if ch.isalnum())


def _read_first_page(path: Path) -> tuple[int, str]:
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        return len(reader.pages), (reader.pages[0].extract_text() or "") if reader.pages else ""
    except Exception:
        import pdfplumber

        with pdfplumber.open(str(path)) as pdf:
            return len(pdf.pages), (pdf.pages[0].extract_text() or "") if pdf.pages else ""


def verify(path: Path, doi: str = "", title: str = "") -> dict:
    result = {"file": str(path), "status": "invalid", "pages": 0, "matched_by": None}
    if not path.is_file() or path.stat().st_size < 5:
        result["reason"] = "file_missing_or_too_small"
        return result
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            result["reason"] = "missing_pdf_header"
            return result
    try:
        pages, text = _read_first_page(path)
    except Exception as exc:
        result.update(status="unverified", reason=f"pdf_parser_failed: {type(exc).__name__}")
        return result
    result["pages"] = pages
    if pages < 1:
        result["reason"] = "zero_pages"
        return result
    compact_text = _normal(text)
    doi_norm = _normal(re.sub(r"^https?://(dx\.)?doi\.org/", "", doi.strip(), flags=re.I))
    title_norm = _normal(title)
    if doi_norm and doi_norm in compact_text:
        result.update(status="verified", matched_by="doi")
    elif len(title_norm) >= 20 and title_norm in compact_text:
        result.update(status="verified", matched_by="title")
    else:
        result.update(status="unverified", reason="first_page_does_not_match_target")
    return result


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--doi", default="")
    parser.add_argument("--title", default="")
    args = parser.parse_args()
    result = verify(Path(args.pdf), doi=args.doi, title=args.title)
    print(json.dumps(result, ensure_ascii=False))
    return {"verified": 0, "unverified": 2, "invalid": 1}[result["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
