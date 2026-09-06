import { degrees, PDFDocument } from "pdf-lib";

const source = await PDFDocument.create();
source.addPage([240, 360]);
const sourceBytes = await source.save();
const input = await PDFDocument.load(sourceBytes);
const exported = await PDFDocument.create();
const [page] = await exported.copyPages(input, [0]);
page.setRotation(degrees(90));
exported.addPage(page);

const output = await PDFDocument.load(await exported.save());
if (output.getPageCount() !== 1 || output.getPage(0).getRotation().angle !== 90) {
  throw new Error("單頁匯出驗證失敗：未保留頁數或旋轉角度。");
}
console.log(JSON.stringify({ pages: output.getPageCount(), rotation: output.getPage(0).getRotation().angle, result: "單頁 PDF 匯出驗證通過" }));
