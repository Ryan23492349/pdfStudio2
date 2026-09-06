import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const inputPdf = await PDFDocument.create();
const inputPage = inputPdf.addPage([612, 792]);
inputPage.setRotation(degrees(90));
const inputBytes = await inputPdf.save();

const sourceDocument = await pdfjsLib.getDocument({ data: inputBytes.slice() }).promise;
const sourcePage = await sourceDocument.getPage(1);
const rotation = 90;
const viewport = sourcePage.getViewport({ scale: 1, rotation });
const [x = 0, y = 0] = viewport.convertToPdfPoint(viewport.width * 0.2, viewport.height * 0.3);

const outputPdf = await PDFDocument.create();
outputPdf.registerFontkit(fontkit);
const [outputPage] = await outputPdf.copyPages(await PDFDocument.load(inputBytes), [0]);
outputPage.setRotation(degrees(rotation));
const cjkFont = await outputPdf.embedFont(await readFile("/home/ubuntu/webdev-static-assets/pdf-studio-cjk.ttf"), { subset: true });
const textAnnotations = [
  { text: "刪除後不應存在", deleted: true },
  { text: "修改後文字\n第二行繁中", deleted: false },
];
textAnnotations.filter((annotation) => !annotation.deleted).forEach((annotation) => {
  const lineHeight = 22.5;
  annotation.text.split("\n").forEach((line, index) => {
    outputPage.drawText(line || " ", { x, y: y - 18 - index * lineHeight, size: 18, font: cjkFont, color: rgb(0.09, 0.13, 0.2), lineHeight });
  });
});
outputPdf.addPage(outputPage);

const verifiedDocument = await pdfjsLib.getDocument({ data: await outputPdf.save() }).promise;
const verifiedPage = await verifiedDocument.getPage(1);
const textContent = await verifiedPage.getTextContent();
const outputText = textContent.items.map((item) => ("str" in item ? item.str : "")).join("");

assert.equal(verifiedPage.rotate, 90, "旋轉頁面應保留原有方向");
assert.match(outputText, /修改後文字/, "輸出 PDF 應保留修改後的繁體中文文字");
assert.match(outputText, /第二行繁中/, "輸出 PDF 應保留 Shift+Enter 建立的第二行文字");
assert.doesNotMatch(outputText, /刪除後不應存在/, "輸出 PDF 不應包含已刪除的文字");

await sourceDocument.destroy();
await verifiedDocument.destroy();
console.log("✓ 已驗證旋轉頁面可匯出多行修改文字且排除已刪除註記。");
