import { degrees, PDFDocument } from "pdf-lib";
import JSZip from "jszip";

const source = await PDFDocument.create();
for (let index = 0; index < 4; index += 1) source.addPage([200, 280]);
const sourceBytes = await source.save();
const editedPages = [
  { sourceIndex: 0, rotation: 0 },
  { sourceIndex: 1, rotation: 90 },
  { sourceIndex: 1, rotation: 0 },
  { sourceIndex: 2, rotation: 0 },
  { sourceIndex: 3, rotation: 270 },
];
const boundaries = [0, 2, 4, editedPages.length];
const input = await PDFDocument.load(sourceBytes);
const zip = new JSZip();

for (let index = 0; index < boundaries.length - 1; index += 1) {
  const segment = editedPages.slice(boundaries[index], boundaries[index + 1]);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(input, segment.map((page) => page.sourceIndex));
  copied.forEach((page, pageIndex) => {
    page.setRotation(degrees((page.getRotation().angle + segment[pageIndex].rotation) % 360));
    output.addPage(page);
  });
  zip.file(`edited_${String(index + 1).padStart(2, "0")}.pdf`, await output.save());
}

const archive = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
const fileNames = Object.keys(archive.files).filter((name) => name.endsWith(".pdf")).sort();
const rotations = [];
for (const fileName of fileNames) {
  const data = await archive.file(fileName).async("uint8array");
  const document = await PDFDocument.load(data);
  for (const page of document.getPages()) rotations.push(page.getRotation().angle);
}

if (fileNames.length !== 3 || rotations.join(",") !== "0,90,0,0,270") {
  throw new Error(`驗證失敗：檔案 ${fileNames.length} 份；旋轉 ${rotations.join(",")}`);
}
console.log(JSON.stringify({ files: fileNames, rotations, result: "頁面複製、旋轉及分段 ZIP 匯出驗證通過" }));
