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
  const statusLabel = meta.statusFilter ? STATUS_LABELS[meta.statusFilter] ?? meta.statusFilter : 'Подтверждённые';

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
      'Остаток',
      'Статус',
    ]);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { bold: true };
      cell.border = THIN_BORDER;
    });

    for (const day of section.days) {
      // Остаток переносится со вчера и живёт сквозь весь период — как на странице выручки.
      // Без месяца старта у аптеки остатка нет, и колонка остаётся пустой.
      const hasBalance = day.balance != null;
      let balance = day.balance ? day.balance.openingBalance : 0;

      if (day.balance) {
        const openingRow = sheet.addRow([
          formatDate(day.date),
          '',
          'Остаток с прошлого дня',
          '',
          '',
          balance,
          '',
        ]);
        openingRow.getCell(3).font = { italic: true, color: { argb: 'FF64748B' } };
        openingRow.getCell(6).numFmt = '#,##0';
        openingRow.eachCell({ includeEmpty: true }, (cell) => (cell.border = THIN_BORDER));
      }

      balance += day.cashRevenue;

      const revenueRow = sheet.addRow([
        day.balance ? '' : formatDate(day.date),
        day.employeeNames.join(', '),
        'Выручка нал.',
        day.cashRevenue,
        '',
        hasBalance ? balance : '',
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
        const lineRow = sheet.addRow(['', '', label, '', line.amount, hasBalance ? balance : '', '']);
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

      if (day.balance && day.balance.deposit !== 0) {
        balance -= day.balance.deposit;
        const depositRow = sheet.addRow(['', '', 'Сдано в банк', '', day.balance.deposit, balance, '']);
        depositRow.getCell(3).font = { bold: true };
        depositRow.getCell(5).numFmt = '#,##0';
        depositRow.getCell(6).numFmt = '#,##0';
        depositRow.eachCell({ includeEmpty: true }, (cell) => (cell.border = THIN_BORDER));
      }

      const dayTotalRow = sheet.addRow([
        `Итого за ${formatDate(day.date)}`,
        '',
        '',
        day.cashRevenue,
        day.cashExpensesTotal + (day.balance?.deposit ?? 0),
        // Дни до месяца старта остатка не имеют — там колонка пустая, как и на экране.
        day.balance ? day.balance.closingBalance : '',
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

    const lastWithBalance = [...section.days].reverse().find((d) => d.balance);
    const totalDeposits = section.days.reduce((sum, d) => sum + (d.balance?.deposit ?? 0), 0);

    const periodTotalRow = sheet.addRow([
      'ИТОГО ЗА ПЕРИОД',
      '',
      '',
      section.totalCashRevenue,
      section.totalCashExpenses + totalDeposits,
      lastWithBalance ? lastWithBalance.balance!.closingBalance : section.totalCashNet,
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
