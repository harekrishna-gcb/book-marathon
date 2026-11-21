import * as api from './api.js';
import { chunk } from './parse.js';

export const UPLOAD_CHUNK = 500; // Apps Script runs are limited to 6 minutes; 500 rows per request stays far below that

/**
 * Sends rows in chunks, one request at a time. Calls onChunk(data) after each.
 * On failure throws the error with `savedUpTo` = last file row that was saved (or null).
 */
export async function runChunks(action, rows, onProgress, onChunk) {
  const parts = chunk(rows, UPLOAD_CHUNK);
  for (let i = 0; i < parts.length; i++) {
    onProgress(`Saving ${parts.length > 1 ? `part ${i + 1} of ${parts.length} ` : ''}(${parts[i].length} rows)… please keep this page open.`);
    try {
      onChunk(await api.call(action, { rows: parts[i] }));
    } catch (e) {
      e.savedUpTo = i ? parts[i - 1][parts[i - 1].length - 1].row : null;
      throw e;
    }
  }
}

export function stopMessage(e) {
  return e.message + (e.savedUpTo
    ? ` Rows up to file row ${e.savedUpTo} were saved; fix the problem and upload the remaining rows.`
    : ' Nothing was saved.');
}
