import type { CreateUserResult, UserRole } from '../models';

export type CsvEncoding = 'utf-8' | 'utf-16' | 'gbk';

export interface CsvFormatRequirement {
  columnCount: number;
}

export interface CsvUserImportEntry {
  lineNumber: number;
  name: string;
  englishName: string | null;
  role: UserRole;
  className: string | null;
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

export async function parseUserImportCsvBuffer(buffer: Uint8Array, requirement: CsvFormatRequirement): Promise<ParsedCsvUserImport> {
  const { encoding, text } = decodeCsvBuffer(buffer);
  return await parseUserImportCsvText(text, requirement, encoding);
}

export async function parseUserImportCsvText(
  text: string,
  requirement: CsvFormatRequirement,
  forcedEncoding: CsvEncoding = 'utf-8'
): Promise<ParsedCsvUserImport> {
  const rows = await parseCsvRows(text, requirement);
  const entries = rows.map(({ lineNumber, columns }) => {
    const name = columns[0] ?? '';
    const englishName = columns[1] ?? '';
    const role = columns[2] ?? '';
    const className = columns[3] ?? '';

    if (!name) {
      throw new Error(`第 ${lineNumber} 行姓名为空。`);
    }

    if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
      throw new Error(`第 ${lineNumber} 行角色无效，只能是 student/teacher/admin。`);
    }

    return {
      lineNumber,
      name,
      englishName: englishName || null,
      role: role as UserRole,
      className: className || null
    };
  });

  return {
    encoding: forcedEncoding,
    totalCount: entries.length,
    studentCount: entries.filter((entry) => entry.role === 'student').length,
    entries
  };
}

export async function createUserCredentialsCsv(users: CreateUserResult[]) {
  const headers = ['name', 'english_name', 'uid', 'role', 'password'];
  const lines = [headers.map(csvQuote).join(',')];

  for (const user of users) {
    lines.push([
      user.name,
      user.english_name ?? '',
      user.uid,
      user.role,
      user.password
    ].map(csvQuote).join(','));
  }

  return lines.join('\n') + '\n';
}

function csvQuote(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
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
  } catch {
  }

  try {
    return { encoding: 'gbk', text: decodeText(buffer, 'gb18030') };
  } catch {
  }

  throw new Error('无法识别 CSV 文件编码，仅支持 UTF-8、UTF-16 和 GBK。');
}

function decodeText(buffer: Uint8Array, encoding: string) {
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

  let expectedZeroCount = 0;
  let unexpectedZeroCount = 0;
  let pairs = 0;

  for (let index = 0; index < buffer.length; index += 2) {
    const first = buffer[index];
    const second = buffer[index + 1];
    pairs += 1;

    if (endianness === 'le') {
      if (second === 0) expectedZeroCount += 1;
      if (first === 0) unexpectedZeroCount += 1;
    } else {
      if (first === 0) expectedZeroCount += 1;
      if (second === 0) unexpectedZeroCount += 1;
    }
  }

  return expectedZeroCount / pairs > 0.3 && unexpectedZeroCount / pairs < 0.1;
}

function parseCsvRows(text: string, requirement: CsvFormatRequirement) {
  const rows: Array<{ lineNumber: number; columns: string[] }> = [];

  for (const columns of parseCsvText(text)) {
    const trimmed = columns.map((column) => column.trim());

    // ignoreEmpty: skip rows that are entirely blank (including trailing newline).
    if (trimmed.every((column) => column === '')) {
      continue;
    }

    const lineNumber = rows.length + 1;

    if (trimmed.length !== requirement.columnCount) {
      throw new Error(`第 ${lineNumber} 行格式无效，必须包含 ${requirement.columnCount} 列。`);
    }

    rows.push({ lineNumber, columns: trimmed });
  }

  if (rows.length === 0) {
    throw new Error('CSV 文件没有有效内容。');
  }

  return rows;
}

// Minimal RFC 4180 parser. Workers-compatible (no Node stream dependency).
// Handles quoted fields, "" escapes, and commas/newlines inside quotes.
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let hasContent = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      hasContent = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      hasContent = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      hasContent = false;
    } else {
      field += char;
      hasContent = true;
    }
  }

  if (inQuotes) {
    throw new Error('CSV 文件格式无效，存在未闭合的引号。');
  }

  if (hasContent || field !== '') {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
