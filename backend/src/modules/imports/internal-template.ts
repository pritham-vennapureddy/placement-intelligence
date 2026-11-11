import ExcelJS from "exceljs";

const HEADER_FILL = "312E81";

const TABLES = [
  {
    name: "TA",
    description: "One row per applicant. Normalized mobile number is the unique candidate identity; Candidate ID and email are source data only.",
    headers: ["Candidate ID", "Full Name", "Email", "Mobile", "Product"],
  },
  {
    name: "Student Details",
    description: "Optional profile details. Include the same unique mobile number used in TA.",
    headers: [
      "Candidate ID", "Full Name", "Email", "Mobile", "Resume Link", "Gender", "Current City", "State",
      "College", "Degree", "Department", "Graduation Year", "Percentage",
    ],
  },
  ...(["RS", "SC", "AS", "SP"] as const).map((name) => ({
    name,
    description: `${name} shortlist decisions. Include one row per candidate whose decision should be recorded at this stage.`,
    headers: name === "SP"
      ? ["Mobile", "Selection_Basis", "Remarks"]
      : ["Candidate ID", "Full Name", "Email", "Mobile", "Decision", "Priority", "Technical Score", "Communication Score", "Rejection Reason", "Remarks"],
  })),
] as const;

const DECISIONS = ["Selected", "Rejected", "On hold", "No show", "Withdrawn", "Pending"];

function styleHeader(row: ExcelJS.Row): void {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

export async function buildInternalTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Placement Dashboard";
  workbook.subject = "Standard internal screening sheet";
  workbook.title = "Internal Screening Standard";
  workbook.created = new Date();

  const guide = workbook.addWorksheet("Read Me");
  guide.columns = [{ width: 28 }, { width: 100 }];
  guide.addRow(["STANDARD INTERNAL SCREENING WORKBOOK"]);
  guide.mergeCells("A1:B1");
  guide.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF312E81" } };
  guide.addRows([
    ["Purpose", "Use this workbook structure for every internal screening process. Keep the tab names and column headers unchanged so the dashboard can detect them automatically."],
    ["Tabs", "TA = all applicants; Student Details = optional profile details; RS = resume shortlist; SC = screening shortlist; AS = assignment shortlist; SP = final shortlist."],
    ["Header row", "Keep the field names in row 1. Do not add title rows, merged cells, blank rows above the headers, or rename the tabs."],
    ["Rows", "Use one candidate per row. Do not include example or instruction rows in the data tabs."],
    ["Candidate matching", "Use a unique mobile number consistently on TA, Student Details, and each shortlist tab. Candidate ID and email are ignored for identity matching."],
    ["Decisions", `Use only: ${DECISIONS.join(", ")}. A blank Decision on a populated row is treated as Pending.`],
    ["Priority", "Use P1, P2, or P3. Scores should be numeric. Keep rejection reasons and remarks in their dedicated columns."],
    ["SP selection basis", "SP is the final-shortlist tab: maintain Mobile, Selection_Basis, and Remarks. No UUID or manual stage column is needed."],
    ["Student Details", "This tab is optional. To enrich applicant profiles, include the candidate's unique mobile number and available student details."],
    ["Dates and mobile", "Use dates like YYYY-MM-DD. Format Mobile as plain text so leading zeroes and country codes are preserved."],
    ["Google Sheets", "Upload this Excel file to Google Drive, open it as Google Sheets, populate it, then share it with the dashboard service account as Viewer."],
    ["Import behavior", "The dashboard reads the shared sheet without changing it. Review detected tabs and import results before saving."],
  ]);
  guide.getColumn(1).font = { bold: true, color: { argb: "FF334155" } };
  guide.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 1) row.height = 36;
  });
  guide.views = [{ state: "frozen", ySplit: 1 }];

  for (const table of TABLES) {
    const sheet = workbook.addWorksheet(table.name);
    sheet.addRow([...table.headers]);
    styleHeader(sheet.getRow(1));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${columnName(table.headers.length)}1` };
    sheet.columns = table.headers.map((header) => ({
      header,
      width: header.includes("Reason") || header === "Remarks" ? 30 : header === "Full Name" ? 26 : 20,
    }));

    if (table.name === "RS" || table.name === "SC" || table.name === "AS") {
      const decisionColumn = table.headers.indexOf("Decision") + 1;
      const priorityColumn = table.headers.indexOf("Priority") + 1;
      for (let rowNumber = 2; rowNumber <= 5000; rowNumber++) {
        sheet.getCell(rowNumber, decisionColumn).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${DECISIONS.join(",")}"`],
        };
        sheet.getCell(rowNumber, priorityColumn).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ['"P1,P2,P3"'],
        };
      }
    }

    sheet.headerFooter.oddHeader = `&B${table.name} · Standard Internal Screening`;
    sheet.headerFooter.oddFooter = "&LPlacement Dashboard&CStandard Template";
    sheet.getCell("A1").note = table.description;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function columnName(column: number): string {
  let name = "";
  let value = column;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}
