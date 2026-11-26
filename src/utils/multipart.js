import { HttpError, readRawBody } from './http.js';

/**
 * Parse multipart/form-data requests without external packages (for FR6 note/file uploads).
 */
export async function parseMultipartForm(req, maxBytes) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new HttpError(400, 'Expected multipart/form-data with boundary.');
  }
  const boundary = match[1] || match[2];
  const raw = await readRawBody(req, maxBytes);

  const boundaryBuf = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};

  let start = raw.indexOf(boundaryBuf);
  if (start === -1) {
    throw new HttpError(400, 'Malformed multipart payload.');
  }

  while (start !== -1) {
    const partStart = start + boundaryBuf.length;
    // Check closing boundary "--"
    if (raw.slice(partStart, partStart + 2).toString() === '--') break;

    // Skip leading CRLF
    const headerStart = raw.slice(partStart, partStart + 2).toString() === '\r\n'
      ? partStart + 2
      : partStart;

    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headersText = raw.slice(headerStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextBoundary = raw.indexOf(boundaryBuf, bodyStart);
    if (nextBoundary === -1) break;

    // Strip trailing CRLF before next boundary
    let bodyEnd = nextBoundary;
    if (bodyEnd - 2 >= bodyStart && raw[bodyEnd - 2] === 13 && raw[bodyEnd - 1] === 10) {
      bodyEnd -= 2;
    }
    const content = raw.slice(bodyStart, bodyEnd);

    const dispMatch = headersText.match(/Content-Disposition:\s*form-data;\s*([^\r\n]+)/i);
    if (dispMatch) {
      const params = dispMatch[1];
      const nameMatch = params.match(/name="([^"]+)"/i);
      const fileMatch = params.match(/filename="([^"]*)"/i);
      const typeMatch = headersText.match(/Content-Type:\s*([^\r\n]+)/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (fileMatch && fileMatch[1]) {
          files[fieldName] = {
            originalName: fileMatch[1],
            mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            buffer: content,
            size: content.length,
          };
        } else if (!fileMatch) {
          fields[fieldName] = content.toString('utf8');
        }
      }
    }

    start = nextBoundary;
  }

  return { fields, files };
}
