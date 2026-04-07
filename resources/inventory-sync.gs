/**
 * J&C Creations — Google Apps Script Inventory Sync
 * ─────────────────────────────────────────────────
 * SETUP INSTRUCTIONS (one-time):
 *
 * 1. Open your Google Sheet that tracks inventory.
 * 2. Click Extensions > Apps Script.
 * 3. Delete any existing code and paste ALL of this file in.
 * 4. At the top, fill in SHEET_NAME and the column letters that match your sheet.
 * 5. Click Deploy > New Deployment > Web App.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Click Deploy, copy the Web App URL.
 * 7. In your website's script.js, set:
 *      const INVENTORY_SHEET_URL = 'PASTE_URL_HERE';
 * 8. Save & push to GitHub. Done!
 *
 * HOW IT WORKS:
 * - Your site calls this script on page load to get live inventory counts.
 * - When a customer submits an order, the site calls this script again to
 *   automatically decrement quantities.
 * - You can still use the admin page to make manual adjustments.
 */

// ── CONFIGURATION — edit these to match YOUR sheet ───────────────────────────

const SHEET_NAME = 'Inventory';   // Tab name in your Google Sheet

// Column letters in your sheet (change to match your layout):
const COL_PRODUCT_NAME = 'A';   // Column with product names
const COL_QUANTITY     = 'B';   // Column with quantity/stock numbers
// Optional — add a "Product ID" column if you have one, otherwise we match by name
const COL_PRODUCT_ID   = '';    // Leave '' to match by name instead of ID

// ─────────────────────────────────────────────────────────────────────────────

function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function colToIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - 65; // A=0, B=1, etc.
}

/**
 * GET — returns inventory as JSON: { "Product Name": quantity, ... }
 * The website fetches this on page load.
 */
function doGet(e) {
  try {
    const sheet = getSheet();
    const data  = sheet.getDataRange().getValues();

    const nameCol = colToIndex(COL_PRODUCT_NAME);
    const qtyCol  = colToIndex(COL_QUANTITY);
    const idCol   = COL_PRODUCT_ID ? colToIndex(COL_PRODUCT_ID) : -1;

    const inventory = {};
    // Skip row 0 (header row)
    for (let i = 1; i < data.length; i++) {
      const row  = data[i];
      const name = String(row[nameCol] || '').trim();
      const qty  = parseInt(row[qtyCol]) || 0;
      const id   = idCol >= 0 ? String(row[idCol] || '').trim() : null;

      if (!name) continue;

      // Store by both ID and name for maximum matching flexibility
      if (id) inventory[id] = qty;
      inventory[name] = qty;
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, inventory }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST — decrements quantities when an order is placed.
 * Body: { items: [{ name: "Product Name", id: "product-id", quantity: 2 }, ...] }
 */
function doPost(e) {
  try {
    const body  = JSON.parse(e.postData.contents);
    const items = body.items || [];

    if (items.length === 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, message: 'No items to update' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getSheet();
    const data  = sheet.getDataRange().getValues();

    const nameCol = colToIndex(COL_PRODUCT_NAME);
    const qtyCol  = colToIndex(COL_QUANTITY);
    const idCol   = COL_PRODUCT_ID ? colToIndex(COL_PRODUCT_ID) : -1;

    const updated = [];

    items.forEach(item => {
      const orderQty  = parseInt(item.quantity) || 1;
      const matchName = String(item.name || '').trim().toLowerCase();
      const matchId   = String(item.id   || '').trim().toLowerCase();

      for (let i = 1; i < data.length; i++) {
        const rowName = String(data[i][nameCol] || '').trim().toLowerCase();
        const rowId   = idCol >= 0 ? String(data[i][idCol] || '').trim().toLowerCase() : '';

        const isMatch = (rowId && rowId === matchId) || rowName === matchName;
        if (!isMatch) continue;

        const currentQty = parseInt(data[i][qtyCol]) || 0;
        const newQty     = Math.max(0, currentQty - orderQty);

        // Update the cell (row index +1 because Sheets is 1-indexed, +1 for header)
        sheet.getRange(i + 1, qtyCol + 1).setValue(newQty);
        data[i][qtyCol] = newQty; // keep local data in sync

        updated.push({ name: item.name, from: currentQty, to: newQty });
        break;
      }
    });

    // Optional: send yourself an email notification
    // MailApp.sendEmail('your@email.com', 'New J&C Creations Order', JSON.stringify(body, null, 2));

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, updated }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
