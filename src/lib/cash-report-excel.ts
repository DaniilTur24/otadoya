import ExcelJS from 'exceljs';
import { CashReportPharmacySection } from '@/lib/cash-report-builder';

const STATUS_LABELS: Record<string, string> = {
  pending: 'На проверке',
  approved: 'Подтверждена',
  rejected: 'Отклонена',
};

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const DAY_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const PERIOD_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
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

function statusesLabel(statuses: string[]): string {
  return statuses.map((s) => STATUS_LABELS[s] ?? s).join(' / ');
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
      { width: 38 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
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
      'Сотрудник(и)',
      'Статья расхода / комментарий',
      'Приход',
      'Расход',
      'Сальдо',
      'Статус',
    ]);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { bold: true };
      cell.border = THIN_BORDER;
    });

    for (const day of section.days) {
      let balance = day.cashRevenue;

      const revenueRow = sheet.addRow([
        formatDate(day.date),
        day.employeeNames.join(', '),
        'Выручка нал.',
        day.cashRevenue,
        '',
        balance,
        statusesLabel(day.statuses),
      ]);
      revenueRow.getCell(3).font = { color: { argb: 'FF64748B' } };
      revenueRow.getCell(4).numFmt = '#,##0';
      revenueRow.getCell(6).numFmt = '#,##0';
      revenueRow.eachCell({ includeEmpty: true }, (cell) => (cell.border = THIN_BORDER));

      for (const line of day.expenseLines) {
        if (line.affectsCash) balance -= line.amount;

        const label = [line.categoryLabel, line.recipientName ? `— ${line.recipientName}` : null, line.comment]
          .filter(Boolean)
          .join(' ');
        const lineRow = sheet.addRow(['', '', label, '', line.amount, balance, '']);
        lineRow.getCell(5).numFmt = '#,##0';
        lineRow.getCell(6).numFmt = '#,##0';

        if (!line.affectsCash) {
          const italicGray = { italic: true, color: { argb: 'FF94A3B8' } };
          lineRow.getCell(3).font = italicGray;
          lineRow.getCell(3).value = `${label} (не из кассы)`;
          lineRow.getCell(5).font = italicGray;
        }
        lineRow.eachCell({ includeEmpty: true }, (cell) => (cell.border = THIN_BORDER));
      }

      const dayTotalRow = sheet.addRow([
        `Итого за ${formatDate(day.date)}`,
        '',
        '',
        day.cashRevenue,
        day.cashExpensesTotal,
        day.cashNet,
        '',
      ]);
      dayTotalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = DAY_TOTAL_FILL;
        cell.font = { bold: true };
        cell.border = THIN_BORDER;
      });
      dayTotalRow.getCell(4).numFmt = '#,##0';
      dayTotalRow.getCell(5).numFmt = '#,##0';
      dayTotalRow.getCell(6).numFmt = '#,##0';
    }

    const periodTotalRow = sheet.addRow([
      'ИТОГО ЗА ПЕРИОД',
      '',
      '',
      section.totalCashRevenue,
      section.totalCashExpenses,
      section.totalCashNet,
      '',
    ]);
    periodTotalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = PERIOD_TOTAL_FILL;
      cell.font = { bold: true };
      cell.border = THIN_BORDER;
    });
    periodTotalRow.getCell(4).numFmt = '#,##0';
    periodTotalRow.getCell(5).numFmt = '#,##0';
    periodTotalRow.getCell(6).numFmt = '#,##0';
  }

  if (sections.length === 0) {
    const sheet = workbook.addWorksheet('Отчёт');
    sheet.addRow(['Нет записей за выбранный период/фильтр']);
  }

  return workbook;
}
