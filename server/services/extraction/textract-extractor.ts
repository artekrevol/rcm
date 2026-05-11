import {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  AnalyzeDocumentCommand,
  type Block,
} from "@aws-sdk/client-textract";

function getClient(): TextractClient {
  return new TextractClient({ region: process.env.AWS_REGION });
}

function getBucket(): string {
  const b = process.env.S3_BUCKET_NAME?.trim();
  if (!b) throw new Error("S3_BUCKET_NAME env var not set");
  return b;
}

export interface TextractAnalysisResult {
  blocks: Block[];
  keyValuePairs: Map<string, { value: string; confidence: number }>;
  tables: TextractTable[];
  lines: TextractLine[];
}

export interface TextractTable {
  rows: TextractCell[][];
}

export interface TextractCell {
  rowIndex: number;
  columnIndex: number;
  text: string;
  confidence: number;
}

export interface TextractLine {
  text: string;
  confidence: number;
  page: number;
  top: number;
  left: number;
}

// ─── Async API (multi-page VA referrals) ─────────────────────────────────────

export async function startVaReferralExtraction(s3Key: string): Promise<string> {
  const client = getClient();

  const resp = await client.send(
    new StartDocumentAnalysisCommand({
      DocumentLocation: {
        S3Object: { Bucket: getBucket(), Name: s3Key },
      },
      FeatureTypes: ["FORMS", "TABLES"],
    })
  );

  if (!resp.JobId) throw new Error("Textract StartDocumentAnalysis returned no JobId");
  return resp.JobId;
}

export async function pollVaReferralExtraction(
  jobId: string
): Promise<TextractAnalysisResult | "IN_PROGRESS"> {
  const client = getClient();
  const allBlocks: Block[] = [];
  let nextToken: string | undefined;

  const firstResp = await client.send(
    new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken })
  );

  const status = firstResp.JobStatus;
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "FAILED") {
    throw new Error(
      `Textract job failed: ${firstResp.StatusMessage ?? "no message"}`
    );
  }

  allBlocks.push(...(firstResp.Blocks ?? []));
  nextToken = firstResp.NextToken;

  while (nextToken) {
    const pageResp = await client.send(
      new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken })
    );
    allBlocks.push(...(pageResp.Blocks ?? []));
    nextToken = pageResp.NextToken;
  }

  return parseBlocks(allBlocks);
}

// ─── Sync API (single-page QB invoices) ──────────────────────────────────────

export async function extractQbInvoice(
  pdfBytes: Buffer
): Promise<TextractAnalysisResult> {
  const client = getClient();

  const resp = await client.send(
    new AnalyzeDocumentCommand({
      Document: { Bytes: pdfBytes },
      FeatureTypes: ["FORMS", "TABLES"],
    })
  );

  return parseBlocks(resp.Blocks ?? []);
}

// ─── Block parser ─────────────────────────────────────────────────────────────

export function parseBlocks(blocks: Block[]): TextractAnalysisResult {
  const blockMap = new Map<string, Block>();
  for (const b of blocks) {
    if (b.Id) blockMap.set(b.Id, b);
  }

  // Build key→value map from KEY_VALUE_SET blocks
  const keyValuePairs = new Map<string, { value: string; confidence: number }>();
  const keyBlocks = blocks.filter(
    (b) => b.BlockType === "KEY_VALUE_SET" && b.EntityTypes?.includes("KEY")
  );

  for (const keyBlock of keyBlocks) {
    const keyText = extractTextFromBlock(keyBlock, blockMap).trim();
    if (!keyText) continue;

    const valueBlockId = keyBlock.Relationships?.find(
      (r) => r.Type === "VALUE"
    )?.Ids?.[0];

    if (!valueBlockId) continue;
    const valueBlock = blockMap.get(valueBlockId);
    if (!valueBlock) continue;

    const valueText = extractTextFromBlock(valueBlock, blockMap).trim();
    const confidence =
      ((keyBlock.Confidence ?? 100) + (valueBlock.Confidence ?? 100)) / 200;

    const normalizedKey = keyText.toLowerCase().replace(/[:\s]+$/g, "").trim();
    keyValuePairs.set(normalizedKey, { value: valueText, confidence });
  }

  // Build tables from TABLE / CELL blocks
  const tableBlocks = blocks.filter((b) => b.BlockType === "TABLE");
  const tables: TextractTable[] = [];

  for (const tableBlock of tableBlocks) {
    const cellIds =
      tableBlock.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];

    const cells: TextractCell[] = [];
    for (const cellId of cellIds) {
      const cellBlock = blockMap.get(cellId);
      if (!cellBlock || cellBlock.BlockType !== "CELL") continue;

      const text = extractTextFromBlock(cellBlock, blockMap).trim();
      cells.push({
        rowIndex: cellBlock.RowIndex ?? 0,
        columnIndex: cellBlock.ColumnIndex ?? 0,
        text,
        confidence: cellBlock.Confidence ? cellBlock.Confidence / 100 : 1,
      });
    }

    // Group into rows
    const maxRow = Math.max(...cells.map((c) => c.rowIndex), 0);
    const rows: TextractCell[][] = [];
    for (let r = 1; r <= maxRow; r++) {
      const rowCells = cells
        .filter((c) => c.rowIndex === r)
        .sort((a, b) => a.columnIndex - b.columnIndex);
      if (rowCells.length) rows.push(rowCells);
    }

    tables.push({ rows });
  }

  // Collect LINE blocks
  const lines: TextractLine[] = blocks
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => ({
      text: b.Text ?? "",
      confidence: b.Confidence ? b.Confidence / 100 : 1,
      page: b.Page ?? 1,
      top: b.Geometry?.BoundingBox?.Top ?? 0,
      left: b.Geometry?.BoundingBox?.Left ?? 0,
    }));

  return { blocks, keyValuePairs, tables, lines };
}

function extractTextFromBlock(block: Block, blockMap: Map<string, Block>): string {
  const childIds =
    block.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];

  const words: string[] = [];
  for (const id of childIds) {
    const child = blockMap.get(id);
    if (child?.BlockType === "WORD" && child.Text) {
      words.push(child.Text);
    }
  }
  return words.join(" ");
}
