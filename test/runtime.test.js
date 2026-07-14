const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const app = require('../server');

test('ExcelJS creates a valid workbook with the secured uuid override', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('NFS-e');
  sheet.addRow(['NSU', 'Valor']);
  sheet.addRow([123, 42.5]);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 1000);
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString('hex'), '504b');
});

test('certificate upload rejects unsupported extensions before parsing', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const form = new FormData();
  form.append('pfx', new Blob(['not a certificate']), 'payload.txt');
  form.append('passphrase', 'secret');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/upload-certificate`, {
    method: 'POST',
    body: form
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

test('certificate upload rejects files larger than 5 MB', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const form = new FormData();
  form.append('pfx', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]), 'large.pfx');
  form.append('passphrase', 'secret');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/upload-certificate`, {
    method: 'POST',
    body: form
  });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.match(body.error, /5 MB/);
});
