import type { UserRole } from '../models';

export type CsvEncoding = 'utf-8' | 'utf-16' | 'gbk';

export interface CsvFormatRequirement {
  columnCount: number;
}

export interface CsvUserImportEntry {
  lineNumber: number;
  name: string;
  role: UserRole;
  teacher_uid: string;
}

export interface ParsedCsvUserImport {
  encoding: CsvEncoding;
  totalCount: number;
  studentCount: number;
  entries: CsvUserImportEntry[];
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16_LE_BOM = [0xff, 0xfe] as const;
const UTF16_BE_BOM = [0xfe, 0xff] as const;

export function parseUserImportCsvBuffer(buffer: Uint8Array, requirement: CsvFormatRequirement): ParsedCsvUserImport {
  const { encoding, text } = decodeCsvBuffer(buffer);
  return parseUserImportCsvText(text, requirement, encoding);
}

export function parseUserImportCsvText(
  text: string,
  requirement: CsvFormatRequirement,
  forcedEncoding: CsvEncoding = 'utf-8'
): ParsedCsvUserImport {
  const rows = parseCsvRows(text, requirement);
  const entries = rows.map(({ columns, lineNumber }) => {
    const name = columns[0].trim();
    const role = columns[1].trim();
    const teacher_uid = columns[2].trim();

    if (!name) {
      throw new Error(`第 ${lineNumber} 行姓名为空。`);
    }

    if (role !== 'student' && role !== 'teacher' && role !== 'admin') {
      throw new Error(`第 ${lineNumber} 行角色无效，只能是 student/teacher/admin。`);
    }

    if (role !== 'student' && teacher_uid) {
      throw new Error(`第 ${lineNumber} 行错误：非学生该列（管理老师 UID）必须留空。`);
    }

    return {
      lineNumber,
      name,
      role: role as UserRole,
      teacher_uid
    };
  });

  return {
    encoding: forcedEncoding,
    totalCount: entries.length,
    studentCount: entries.filter((entry) => entry.role === 'student').length,
    entries
  };
}

function decodeCsvBuffer(buffer: Uint8Array): { encoding: CsvEncoding; text: string } {
  if (buffer.length === 0) {
    throw new Error('CSV 文件不能为空。');
  }

  if (startsWithBytes(buffer, UTF8_BOM)) {
    return { encoding: 'utf-8', text: decodeText(buffer.subarray(UTF8_BOM.length), 'utf-8') };
  }

  if (startsWithBytes(buffer, UTF16_LE_BOM)) {
    return { encoding: 'utf-16', text: decodeText(buffer.subarray(UTF16_LE_BOM.length), 'utf-16le') };
  }

  if (startsWithBytes(buffer, UTF16_BE_BOM)) {
    return { encoding: 'utf-16', text: decodeText(buffer.subarray(UTF16_BE_BOM.length), 'utf-16be') };
  }

  if (looksLikeUtf16(buffer, 'le')) {
    return { encoding: 'utf-16', text: decodeText(buffer, 'utf-16le') };
  }

  if (looksLikeUtf16(buffer, 'be')) {
    return { encoding: 'utf-16', text: decodeText(buffer, 'utf-16be') };
  }

  try {
    return { encoding: 'utf-8', text: decodeText(buffer, 'utf-8') };
  } catch { }

  try {
    return { encoding: 'gbk', text: decodeText(buffer, 'gb18030') };
  } catch { }

  throw new Error('无法识别 CSV 文件编码，仅支持 UTF-8、UTF-16 和 GBK。');
}

function decodeText(buffer: Uint8Array, encoding: string): string {
  const text = new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');

  if (!text.trim()) {
    throw new Error('CSV 文件没有有效内容。');
  }

  if (text.includes('\u0000')) {
    throw new Error('CSV 文件内容异常，无法解析。');
  }

  return text;
}

function startsWithBytes(buffer: Uint8Array, expected: readonly number[]) {
  return expected.every((byte, index) => buffer[index] === byte);
}

function looksLikeUtf16(buffer: Uint8Array, endianness: 'le' | 'be') {
  if (buffer.length < 4 || buffer.length % 2 !== 0) {
    return false;
  }

  let zeroOnExpectedSide = 0;
  let zeroOnUnexpectedSide = 0;
  let pairs = 0;

  for (let index = 0; index < buffer.length; index += 2) {
    const first = buffer[index];
    const second = buffer[index + 1];
    pairs += 1;

    if (endianness === 'le') {
      if (second === 0) zeroOnExpectedSide += 1;
      if (first === 0) zeroOnUnexpectedSide += 1;
    } else {
      if (first === 0) zeroOnExpectedSide += 1;
      if (second === 0) zeroOnUnexpectedSide += 1;
    }
  }

  return zeroOnExpectedSide / pairs > 0.3 && zeroOnUnexpectedSide / pairs < 0.1;
}

function parseCsvRows(text: string, requirement: CsvFormatRequirement) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const rows: Array<{ lineNumber: number; columns: string[] }> = [];
  let currentField = '';
  let currentRow: string[] = [];
  let inQuotes = false;
  let lineNumber = 1;
  let rowStartLineNumber = 1;

  const pushRow = () => {
    currentRow.push(currentField);
    const trimmedColumns = currentRow.map((column) => column.trim());
    const isBlankRow = trimmedColumns.every((column) => column.length === 0);

    if (!isBlankRow) {
      if (trimmedColumns.length !== requirement.columnCount) {
        throw new Error(`第 ${rowStartLineNumber} 行格式无效，必须包含 ${requirement.columnCount} 列。`);
      }

      rows.push({
        lineNumber: rowStartLineNumber,
        columns: trimmedColumns
      });
    }

    currentField = '';
    currentRow = [];
    rowStartLineNumber = lineNumber;
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === '"') {
      const next = normalized[index + 1];
      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      pushRow();
      lineNumber += 1;
      rowStartLineNumber = lineNumber;
      continue;
    }

    currentField += char;
  }

  if (inQuotes) {
    throw new Error('CSV 文件格式无效，存在未闭合的引号。');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    pushRow();
  }

  if (rows.length === 0) {
    throw new Error('CSV 文件没有有效内容。');
  }

  return rows;
}
