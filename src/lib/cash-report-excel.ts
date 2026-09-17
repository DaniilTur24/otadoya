import ExcelJS from 'exceljs';
import { CashReportPharmacySection } from '@/lib/cash-report-builder';

const STATUS_LABELS: Record<string, string> = {
  pending: 'На проверке',
  approved: 'Подтверждена',
  rejected: 'Отклонена',
};

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const PENDING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}.${m}.${y}`;
}

export interface CashReportMeta {
  from: string | null;
  to: string | null;
  statusFilter: string | null;
}

export async function buildCashReportWorkbook(
  sections: CashReportPharmacySection[],
  meta: CashReportMeta
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Otadoya';
  workbook.created = new Date();

  const periodLabel =
    meta.from && meta.to
      ? `${formatDate(meta.from)} – ${formatDate(meta.to)}`
      : meta.from
      ? `с ${formatDate(meta.from)}`
      : meta.to
      ? `по ${formatDate(meta.to)}`
      : 'весь период';
  const statusLabel = meta.statusFilter ? STATUS_LABELS[meta.statusFilter] ?? meta.statusFilter : 'Все статусы';

  for (const section of sections) {
    const sheetName = section.pharmacyName.slice(0, 31).replace(/[[\]*?/\\:]/g, ' ');
    const sheet = workbook.addWorksheet(sheetName || `Аптека ${section.pharmacyId}`);

    sheet.columns = [
      { width: 12 },
      { width: 22 },
      { width: 36 },
      { width: 14 },
      { width: 14 },
      { width: 16 },
      { width: 16 },
    ];

    sheet.mergeCells('A1:G1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `Касса: ${section.pharmacyName}`;
    titleCell.font = { bold: true, size: 14 };

    sheet.mergeCells('A2:G2');
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = `Период: ${periodLabel}   Статус: ${statusLabel}`;
    subtitleCell.font = { italic: true, color: { argb: 'FF64748B' } };

    sheet.addRow([]);

    const headerRow = sheet.addRow([
      'Дата',
      'Сотрудник',
      'Статья / комментарий',
      'Приход (нал)',
      'Расход',
      'Остаток (к сдаче)',
      'Статус',
    ]);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { bold: true };
      cell.border = THIN_BORDER;
    });

    for (const row of section.rows) {
      const isPending = row.status === 'pending';
      const firstRowIndex = sheet.rowCount + 1;

      const mainRow = sheet.addRow([
        formatDate(row.date),
        row.employeeName,
        row.expenseLines.length === 0 ? '—' : '',
        row.cashRevenue,
        '',
        '',
        STATUS_LABELS[row.status] ?? row.status,
      ]);
      mainRow.getCell(4).numFmt = '#,##0';

      const cashLines = row.expenseLines.filter((l) => l.affectsCash);
      for (const line of cashLines) {
        const label = [line.categoryLabel, line.recipientName ? `— ${line.recipientName}` : null, line.comment]
          .filter(Boolean)
          .join(' ');
        const lineRow = sheet.addRow(['', '', label, '', line.amount, '', '']);
        lineRow.getCell(5).numFmt = '#,##0';
      }

      const nonCashLines = row.expenseLines.filter((l) => !l.affectsCash);
      for (const line of nonCashLines) {
        const label = [line.categoryLabel, line.recipientName ? `— ${line.recipientName}` : null, line.comment, '(не из кассы)']
          .filter(Boolean)
          .join(' ');
        const lineRow = sheet.addRow(['', '', label, '', '', '', '']);
        lineRow.font = { italic: true, color: { argb: 'FF94A3B8' } };
      }

      const resultRow = sheet.addRow(['', '', '', '', '', row.cashNet, '']);
      resultRow.getCell(6).numFmt = '#,##0';
      resultRow.font = { bold: true };

      const lastRowIndex = sheet.rowCount;
      if (isPending) {
        for (let r = firstRowIndex; r <= lastRowIndex; r++) {
          sheet.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = PENDING_FILL;
          });
        }
      }
    }

    sheet.addRow([]);
    const totalRow = sheet.addRow([
      'ИТОГО ЗА ПЕРИОД',
      '',
      '',
      section.totalCashRevenue,
      section.totalCashExpenses,
      section.totalCashNet,
      '',
    ]);
    totalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = TOTAL_FILL;
      cell.border = THIN_BORDER;
    });
    totalRow.getCell(4).numFmt = '#,##0';
    totalRow.getCell(5).numFmt = '#,##0';
    totalRow.getCell(6).numFmt = '#,##0';
  }

  if (sections.length === 0) {
    const sheet = workbook.addWorksheet('Отчёт');
    sheet.addRow(['Нет записей за выбранный период/фильтр']);
  }

  return workbook;
}
