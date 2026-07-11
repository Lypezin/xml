function styleDataRow(row, isCancelled, dataRow) {
  row.height = 20;
  const zebra = dataRow % 2 === 0;
  const fillArgb = isCancelled ? 'FFFEE2E2' : (zebra ? 'FFF8FAFC' : 'FFFFFFFF');
  const fontColor = isCancelled ? 'FF991B1B' : 'FF0F172A';

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      strikethrough: isCancelled,
      color: { argb: fontColor }
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fillArgb }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: [1, 2, 4, 5, 6, 7, 9, 14].includes(colNumber) ? 'center' : 'left',
      wrapText: colNumber === 12
    };
  });

  const valorCell = row.getCell('valor');
  valorCell.numFmt = 'R$ #,##0.00';
  valorCell.alignment = { horizontal: 'right', vertical: 'middle' };

  const statusCell = row.getCell('status');
  if (isCancelled) {
    statusCell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      strikethrough: true,
      color: { argb: 'FFB91C1C' }
    };
  } else {
    statusCell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: { argb: 'FF047857' }
    };
  }
}

module.exports = { styleDataRow };
