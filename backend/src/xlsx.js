
const encoder = new TextEncoder();
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function u16(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function concat(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
function xmlText(value) { const chars = Array.from(String(value ?? "")).filter(ch => { const cp = ch.codePointAt(0); return cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff); }).slice(0, 32767).join(""); return chars.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function columnName(number) { let n = number, name = ""; while (n > 0) { n--; name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26); } return name; }
function zipStored(files) {
  const localParts = [], centralParts = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name), data = encoder.encode(text), crc = crc32(data);
    const local = concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0x0021),u32(crc),u32(data.length),u32(data.length),u16(nameBytes.length),u16(0),nameBytes,data]);
    const central = concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0x0021),u32(crc),u32(data.length),u32(data.length),u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameBytes]);
    localParts.push(local); centralParts.push(central); offset += local.length;
  }
  const centralDirectory = concat(centralParts), localData = concat(localParts);
  const end = concat([u32(0x06054b50),u16(0),u16(0),u16(centralParts.length),u16(centralParts.length),u32(centralDirectory.length),u32(localData.length),u16(0)]);
  return concat([localData,centralDirectory,end]);
}
export function buildXlsxWorkbook(headers, rows) {
  if (!Array.isArray(headers) || !headers.length || headers.length > 64) throw new TypeError("invalid_xlsx_headers");
  if (!Array.isArray(rows) || rows.length > 5000) throw new TypeError("invalid_xlsx_rows");
  const values = [headers,...rows], width = headers.length;
  const rowXml = values.map((row,rowIndex) => { const cells = headers.map((_,colIndex) => { const reference = columnName(colIndex+1)+(rowIndex+1); const value = xmlText(Array.isArray(row)?row[colIndex]:""); return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`; }).join(""); return `<row r="${rowIndex+1}">${cells}</row>`; }).join("");
  const columns = headers.map((_,i)=>`<col min="${i+1}" max="${i+1}" width="18" customWidth="1"/>`).join("");
  const lastColumn = columnName(width), lastRow = values.length;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="报名名单" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`
  };
  return zipStored(files);
}
