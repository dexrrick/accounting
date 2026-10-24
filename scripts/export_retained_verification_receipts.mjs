import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerificationReceiptExporter } from './verification_receipt_exporter.mjs';

const MAX_LOG_LINE_BYTES = 2_048;
const MAX_TOTAL_LOG_BYTES = 32_768;
const SAFE_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function safeCaseId(value) {
  return typeof value === 'string' && SAFE_CASE_ID.test(value) ? value : 'INVALID_CASE_ID_OMITTED';
}

function createBoundedLogWriter({ stdout, stderr }) {
  let writtenBytes = 0;
  return (channel, event) => {
    const line = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > MAX_LOG_LINE_BYTES || writtenBytes + bytes > MAX_TOTAL_LOG_BYTES) return false;
    writtenBytes += bytes;
    try {
      return (channel === 'stderr' ? stderr : stdout)(line);
    } catch {
      return false;
    }
  };
}

function parseArgs(args) {
  const parsed = { receipts: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output' || argument === '--run-id' || argument === '--planned-cases' || argument === '--receipts') {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${argument}.`);
      const key = argument.slice(2).replaceAll('-', '');
      if (key === 'receipts') parsed.receipts.push(value);
      else parsed[key] = value;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option ${argument}.`);
    } else {
      parsed.receipts.push(argument);
    }
  }
  if (!parsed.output || !parsed.runid || !parsed.plannedcases || parsed.receipts.length === 0) {
    throw new Error('Usage: node scripts/export_retained_verification_receipts.mjs --output <local-directory> --run-id <id> --planned-cases <id,id,...> [--receipts <file>] <receipt.json>...');
  }
  parsed.runId = parsed.runid;
  parsed.plannedCaseIds = parsed.plannedcases.split(',').map(id => id.trim());
  return parsed;
}

export async function exportRetainedReceipts(args = process.argv.slice(2), writers = {}) {
  const parsed = parseArgs(args);
  const writeEvent = createBoundedLogWriter({
    stdout: writers.stdout || (line => process.stdout.write(line)),
    stderr: writers.stderr || (line => process.stderr.write(line))
  });
  const exporter = await createVerificationReceiptExporter({
    outputDirectory: path.resolve(parsed.output),
    runId: parsed.runId,
    plannedCaseIds: parsed.plannedCaseIds,
    stdout: line => writeEvent('stdout', JSON.parse(line))
  });
  let failed = false;
  for (const inputPath of parsed.receipts) {
    let caseId = path.basename(inputPath, path.extname(inputPath));
    try {
      const receipt = JSON.parse(await readFile(path.resolve(inputPath), 'utf8'));
      if (typeof receipt?.id === 'string') caseId = receipt.id;
      await exporter.exportReceipt(receipt);
    } catch {
      failed = true;
      try { await exporter.recordExportFailure(caseId, 'RETAINED_RECEIPT_IMPORT_FAILED'); } catch {}
      writeEvent('stderr', { event: 'CASE_EXPORT_FAILED', caseId: safeCaseId(caseId), code: 'RETAINED_RECEIPT_IMPORT_FAILED' });
    }
  }
  const manifest = await exporter.finish();
  return { runDirectory: exporter.runDirectory, status: manifest.status, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportRetainedReceipts().then(result => {
    if (result.status !== 'COMPLETE' || result.failed) process.exitCode = 1;
  }).catch(() => {
    process.exitCode = 1;
  });
}
