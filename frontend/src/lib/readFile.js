/**
 * Reads the first sheet of a CSV/XLS/XLSX file into row objects.
 * CSV is read as plain text so "05/11/2026" is not mis-read as 11 May;
 * Excel date cells come back as Date objects (cellDates).
 */
export async function readSpreadsheetFile(file) {
  const XLSX = await import('xlsx'); // loaded only when a file is picked
  return new Promise((resolve, reject) => {
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const rd = new FileReader();
    rd.onerror = () => reject(new Error('Could not read that file.'));
    rd.onload = (e) => {
      try {
        const wb = isCsv
          ? XLSX.read(e.target.result, { type: 'string', raw: true })
          : XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('no sheet');
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }));
      } catch {
        reject(new Error('Could not read that file. Is it a CSV or Excel file?'));
      }
    };
    if (isCsv) rd.readAsText(file); else rd.readAsArrayBuffer(file);
  });
}
