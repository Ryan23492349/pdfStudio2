import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

const source = await PDFDocument.create();
[120, 180, 240, 300].forEach((width) => source.addPage([width, 400]));
const sourceBytes = await source.save();

const pages = [
  { sourceIndex: 0 },
  { sourceIndex: 1 },
  { sourceIndex: 2 },
  { sourceIndex: 3 },
];
const [firstPage] = pages.splice(0, 1);
pages.splice(3, 0, firstPage);
const splitPoints = [2];
const boundaries = [0, ...splitPoints, pages.length];
const input = await PDFDocument.load(sourceBytes);
const zip = new JSZip();

for (let index = 0; index < boundaries.length - 1; index += 1) {
  const segment = pages.slice(boundaries[index], boundaries[index + 1]);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(input, segment.map((page) => page.sourceIndex));
  copied.forEach((page) => output.addPage(page));
  zip.file(`reordered_${index + 1}.pdf`, await output.save());
}

const archive = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
const fileNames = Object.keys(archive.files).filter((name) => name.endsWith(".pdf")).sort();
const widths = [];
for (const fileName of fileNames) {
  const bytes = await archive.file(fileName).async("uint8array");
  const document = await PDFDocument.load(bytes);
  document.getPages().forEach((page) => widths.push(page.getWidth()));
}

if (fileNames.length !== 2 || widths.join(",") !== "180,240,300,120") {
  throw new Error(`重排序驗證失敗：${fileNames.length} 份；頁寬順序 ${widths.join(",")}`);
}
console.log(JSON.stringify({ files: fileNames, widths, result: "拖曳重排後的切點與 ZIP 頁序驗證通過" }));
