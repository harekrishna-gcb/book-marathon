import * as XLSX from 'xlsx';
import { today } from './format.js';

/** Downloads rows (array of plain objects) as .xlsx or .csv. */
export function downloadRows(rows, sheetName, campaign, type) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const base = (campaign || 'Book Marathon').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  XLSX.writeFile(wb, `${base}-${sheetName.toLowerCase()}-${today()}.${type}`, { bookType: type });
}

export const bookRows = (books) => books.map((b) => ({
  Title: b.title, Category: b.category, Price: b.price, Quantity: b.quantity_received, Sold: b.sold, Available: b.available,
}));

export const saleRows = (sales) => sales.map((s) => ({
  Date: s.sale_date, Book: s.book_title, Quantity: s.quantity, Price: s.price, Amount: s.amount,
  'Sold By': s.user_name, Type: s.user_type, Area: s.area,
}));

export const leaderboardRows = (rows) => rows.map((r) => ({
  Rank: r.rank, Name: r.name, Type: r.type, Books: r.books, Rupees: r.rupees,
}));
