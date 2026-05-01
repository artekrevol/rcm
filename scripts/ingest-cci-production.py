#!/usr/bin/env python3
"""Ingest CMS NCCI Q2 2026 Practitioner PTP .txt files into production PostgreSQL."""

import os, sys, zipfile, io
import psycopg2, psycopg2.extras
from datetime import datetime

PROD_URL = os.environ["PRODUCTION_DATABASE_URL"]
VERSION  = "2026Q2"
FILES    = [
    "attached_assets/ccioph-v320r0-f1_1777592939297.zip",
    "attached_assets/ccioph-v320r0-f2_1777592939297.zip",
    "attached_assets/ccioph-v320r0-f3_1777592939297.zip",
    "attached_assets/ccioph-v320r0-f4_1777592939296.zip",
]

def parse_date(raw):
    if not raw or raw.strip() in ("", "N/A", "*=no data"):
        return None
    raw = raw.strip()
    for fmt in ("%m/%d/%Y", "%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None

def ingest_txt(conn, txt_bytes, source_file):
    lines = txt_bytes.decode("utf-8", errors="replace").splitlines()

    # Skip the 5-row header block (copyright + title + col headers x3)
    # Find the first data row: starts with a CPT/HCPCS code (digit or letter-digit)
    data_start = 0
    for i, line in enumerate(lines):
        parts = [p.strip() for p in line.split("\t")]
        if len(parts) >= 2 and parts[0] and parts[0][0].isdigit():
            data_start = i
            break

    print(f"  Data starts at row {data_start} of {len(lines)} total rows")

    rows = []
    for line in lines[data_start:]:
        parts = [p.strip() for p in line.split("\t")]
        if len(parts) < 6:
            continue
        col1 = parts[0].replace(" ", "")
        col2 = parts[1].replace(" ", "").lstrip("*")  # strip * prefix
        if not col1 or not col2:
            continue

        eff_date  = parse_date(parts[3]) or datetime(1900, 1, 1).date()
        del_date  = parse_date(parts[4])
        modifier  = parts[5].split("=")[0].strip() if parts[5] else "9"
        rationale = parts[6].strip() if len(parts) > 6 else None

        rows.append((col1, col2, modifier, eff_date, del_date, rationale, VERSION, source_file))

    print(f"  Parsed {len(rows):,} data rows")

    inserted = updated = errors = 0
    BATCH = 2000
    cur = conn.cursor()
    for start in range(0, len(rows), BATCH):
        batch = rows[start:start + BATCH]
        try:
            psycopg2.extras.execute_values(
                cur,
                """INSERT INTO cci_edits
                     (column_1_code, column_2_code, modifier_indicator, effective_date,
                      deletion_date, ptp_edit_rationale, ncci_version, source_file)
                   VALUES %s
                   ON CONFLICT (column_1_code, column_2_code, effective_date, ncci_version)
                   DO UPDATE SET
                     modifier_indicator  = EXCLUDED.modifier_indicator,
                     deletion_date       = EXCLUDED.deletion_date,
                     ptp_edit_rationale  = EXCLUDED.ptp_edit_rationale,
                     source_file         = EXCLUDED.source_file,
                     ingested_at         = NOW()""",
                batch,
                template="(%s,%s,%s,%s,%s,%s,%s,%s)",
                page_size=BATCH,
            )
            conn.commit()
            inserted += len(batch)
        except Exception as e:
            conn.rollback()
            errors += len(batch)
            print(f"  Batch error at {start}: {e}")
        if start % 200000 < BATCH:
            print(f"  progress: {start:,} rows committed")

    cur.close()
    return inserted, errors

def main():
    conn = psycopg2.connect(PROD_URL)

    total_inserted = 0
    for i, zip_path in enumerate(FILES):
        print(f"\n=== File {i+1}/4: {zip_path} ===")
        with zipfile.ZipFile(zip_path) as z:
            txt_names = [n for n in z.namelist() if n.endswith(".txt")]
            print(f"  .txt files: {txt_names}")
            for name in txt_names:
                print(f"  Processing: {name}")
                txt_bytes = z.read(name)
                ins, err = ingest_txt(conn, txt_bytes, name)
                print(f"  Done: committed={ins:,} batch_errors={err}")
                total_inserted += ins

    print(f"\n{'='*50}")
    print(f"Total rows processed: {total_inserted:,}")

    print("\n=== VERIFICATION QUERY ===")
    cur = conn.cursor()
    cur.execute("""
        SELECT
          ncci_version,
          COUNT(*) AS total_edits,
          COUNT(*) FILTER (WHERE deletion_date IS NULL) AS active_edits,
          COUNT(*) FILTER (WHERE modifier_indicator = '0') AS hard_blocks,
          COUNT(*) FILTER (WHERE modifier_indicator = '1') AS soft_warnings,
          MIN(effective_date) AS oldest_effective,
          MAX(effective_date) AS newest_effective
        FROM cci_edits
        GROUP BY ncci_version
        ORDER BY ncci_version
    """)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    print(f"\n{'  '.join(f'{c:>20}' for c in cols)}")
    print("  " + "-" * (22 * len(cols)))
    for row in rows:
        print(f"{'  '.join(f'{str(v):>20}' for v in row)}")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
