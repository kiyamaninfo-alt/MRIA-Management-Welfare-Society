/**
 * MRIA Management Welfare Association
 * Treasury Statement Export Engine (CSV RFC 4180 & Printable PDF Report)
 */

/**
 * Escapes a cell according to RFC 4180 standards.
 */
function escapeCsvCell(cell) {
  if (cell === null || cell === undefined) return '""';
  const str = String(cell);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Formats a currency number in LKR format.
 */
function formatLkr(amount) {
  const num = Number(amount || 0);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Exports Treasury Statement data to CSV (RFC 4180).
 *
 * @param {Object} statementData - Output from get_treasury_statement RPC
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
export function exportTreasuryStatementToCsv(statementData, startDate, endDate) {
  if (!statementData) {
    throw new Error("No statement data available for export.");
  }

  const lines = [];

  // Header information
  lines.push(["MRIA කළමනාකාර සුබසාධක සංගමය - Treasury Ledger Statement"].map(escapeCsvCell).join(","));
  lines.push([`Statement Period: ${startDate} to ${endDate}`].map(escapeCsvCell).join(","));
  lines.push([`Generated At: ${new Date().toLocaleString()}`].map(escapeCsvCell).join(","));
  lines.push([]);

  // Account Summaries (Opening, Period Change, Closing)
  lines.push(["Account Summary", "Account Key", "Opening Balance (LKR)", "Inflow (LKR)", "Outflow (LKR)", "Net Change (LKR)", "Closing Balance (LKR)"].map(escapeCsvCell).join(","));

  const summaries = statementData.account_summaries || [];
  let totalOpening = 0;
  let totalInflow = 0;
  let totalOutflow = 0;
  let totalClosing = 0;

  for (const s of summaries) {
    const opening = Number(s.opening_balance || 0);
    const inflow = Number(s.period_inflow || 0);
    const outflow = Number(s.period_outflow || 0);
    const net = Number(s.net_change || (inflow - outflow));
    const closing = Number(s.closing_balance || 0);

    totalOpening += opening;
    totalInflow += inflow;
    totalOutflow += outflow;
    totalClosing += closing;

    lines.push([
      s.account_name || s.account_id,
      s.account_id,
      formatLkr(opening),
      formatLkr(inflow),
      formatLkr(outflow),
      formatLkr(net),
      formatLkr(closing),
    ].map(escapeCsvCell).join(","));
  }

  lines.push([
    "TOTAL ALL ACCOUNTS",
    "TOTAL",
    formatLkr(totalOpening),
    formatLkr(totalInflow),
    formatLkr(totalOutflow),
    formatLkr(totalInflow - totalOutflow),
    formatLkr(totalClosing),
  ].map(escapeCsvCell).join(","));

  lines.push([]);
  lines.push(["Detailed Transactions"].map(escapeCsvCell).join(","));
  lines.push(["Date", "Account", "Type", "Category", "Amount (LKR)", "Reference", "Description", "Performed By"].map(escapeCsvCell).join(","));

  const transactions = statementData.transactions || [];
  for (const tx of transactions) {
    const txDate = tx.transacted_at ? new Date(tx.transacted_at).toLocaleDateString() : "";
    lines.push([
      txDate,
      tx.account_name || tx.account_id || "",
      tx.transaction_type || "",
      tx.category || "",
      formatLkr(tx.amount),
      tx.reference_number || "",
      tx.description || "",
      tx.performer_name || tx.performer_email || "",
    ].map(escapeCsvCell).join(","));
  }

  const csvContent = "\uFEFF" + lines.join("\r\n"); // Add BOM for Excel UTF-8 compatibility
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `MRIA_Treasury_Statement_${startDate}_to_${endDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates and opens a high-fidelity CSS-paged printable PDF view.
 *
 * @param {Object} statementData - Output from get_treasury_statement RPC
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
export function printTreasuryStatementPdf(statementData, startDate, endDate) {
  if (!statementData) {
    throw new Error("No statement data available for print.");
  }

  const summaries = statementData.account_summaries || [];
  const transactions = statementData.transactions || [];

  let totalOpening = 0;
  let totalInflow = 0;
  let totalOutflow = 0;
  let totalClosing = 0;

  for (const s of summaries) {
    totalOpening += Number(s.opening_balance || 0);
    totalInflow += Number(s.period_inflow || 0);
    totalOutflow += Number(s.period_outflow || 0);
    totalClosing += Number(s.closing_balance || 0);
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow popups to generate the printable statement.");
    return;
  }

  const summaryRowsHtml = summaries.map((s) => `
    <tr>
      <td style="padding: 6px 10px; border: 1px solid #cbd5e1; font-weight: 500;">${s.account_name || s.account_id}</td>
      <td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: right;">${formatLkr(s.opening_balance)}</td>
      <td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: right; color: #166534;">+${formatLkr(s.period_inflow)}</td>
      <td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: right; color: #b91c1c;">-${formatLkr(s.period_outflow)}</td>
      <td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${formatLkr(s.closing_balance)}</td>
    </tr>
  `).join("");

  const txRowsHtml = transactions.map((tx, idx) => `
    <tr style="background: ${idx % 2 === 0 ? "#f8fafc" : "#ffffff"};">
      <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px;">${tx.transacted_at ? new Date(tx.transacted_at).toLocaleDateString() : ""}</td>
      <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px;">${tx.account_name || tx.account_id}</td>
      <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px; text-transform: capitalize;">${tx.transaction_type}</td>
      <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px; text-align: right; font-weight: bold; color: ${tx.transaction_type === "inflow" ? "#166534" : "#b91c1c"};">
        ${tx.transaction_type === "inflow" ? "+" : "-"}${formatLkr(tx.amount)}
      </td>
      <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px;">${tx.reference_number || "-"}</td>
      <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px;">${tx.description || "-"}</td>
    </tr>
  `).join("");

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>MRIA Treasury Statement (${startDate} to ${endDate})</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 15mm 12mm 15mm 12mm;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #0f172a;
          margin: 0;
          padding: 20px;
          background: #fff;
          font-size: 12px;
        }
        .header {
          border-bottom: 2px solid #1e3a8a;
          padding-bottom: 12px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .title {
          font-size: 18px;
          font-weight: bold;
          color: #1e3a8a;
          margin: 0 0 4px 0;
        }
        .subtitle {
          font-size: 13px;
          color: #475569;
          margin: 0 0 4px 0;
        }
        .meta {
          font-size: 11px;
          color: #64748b;
        }
        h3 {
          font-size: 13px;
          margin: 16px 0 8px 0;
          color: #1e293b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 16px;
        }
        th {
          background: #f1f5f9;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          font-size: 11px;
          font-weight: 600;
          color: #334155;
          text-align: left;
        }
        .footer-signatures {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }
        .sig-box {
          width: 200px;
          border-top: 1px dashed #64748b;
          text-align: center;
          padding-top: 6px;
          font-size: 11px;
          color: #475569;
        }
        @media print {
          body { padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 15px; padding: 10px; background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
        <span><strong>Treasury Statement Preview:</strong> Click print to save as PDF or send to printer.</span>
        <button onclick="window.print()" style="background: #1e3a8a; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Print / Save as PDF</button>
      </div>

      <div class="header">
        <div>
          <div class="title">MRIA කළමනාකාර සුබසාධක සංගමය</div>
          <div class="subtitle">MRIA Management Welfare Association — Treasury Ledger Statement</div>
          <div class="meta">Mattala Rajapaksa International Airport, Sri Lanka</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: bold; font-size: 13px;">Period: ${startDate} to ${endDate}</div>
          <div class="meta">Generated: ${new Date().toLocaleDateString()}</div>
        </div>
      </div>

      <h3>Asset Accounts Summary</h3>
      <table>
        <thead>
          <tr>
            <th>Asset Account</th>
            <th style="text-align: right;">Opening Balance</th>
            <th style="text-align: right;">Period Inflows</th>
            <th style="text-align: right;">Period Outflows</th>
            <th style="text-align: right;">Closing Balance</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRowsHtml}
          <tr style="background: #e2e8f0; font-weight: bold;">
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1;">TOTAL LIQUID ASSETS</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right;">LKR ${formatLkr(totalOpening)}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; color: #166534;">+${formatLkr(totalInflow)}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; color: #b91c1c;">-${formatLkr(totalOutflow)}</td>
            <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right;">LKR ${formatLkr(totalClosing)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Transactions Journal</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 75px;">Date</th>
            <th>Account</th>
            <th>Type</th>
            <th style="text-align: right;">Amount</th>
            <th>Ref / Receipt</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${txRowsHtml.length > 0 ? txRowsHtml : '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #64748b; border: 1px solid #cbd5e1;">No transactions recorded for this period.</td></tr>'}
        </tbody>
      </table>

      <div class="footer-signatures">
        <div class="sig-box">
          <strong>භාණ්ඩාගාරික / Treasurer</strong><br>
          Certified True & Correct
        </div>
        <div class="sig-box">
          <strong>ලේකම් / Secretary</strong><br>
          Verified with Records
        </div>
        <div class="sig-box">
          <strong>සභාපති / President</strong><br>
          Approved & Endorsed
        </div>
      </div>

      <div style="margin-top: 30px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px;">
        © MRIA කළමනාකාර සුබසාධක සංගමය — Official Financial Record System Generated
      </div>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
