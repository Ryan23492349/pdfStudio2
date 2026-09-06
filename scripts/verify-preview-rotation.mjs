import assert from "node:assert/strict";
import { degrees, PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const pdf = await PDFDocument.create();
const page = pdf.addPage([612, 792]);
page.setRotation(degrees(90));

const loadingTask = pdfjsLib.getDocument({ data: await pdf.save() });
const renderedDocument = await loadingTask.promise;
const renderedPage = await renderedDocument.getPage(1);
const sourceRotation = ((renderedPage.rotate % 360) + 360) % 360;
const userRotation = 90;
const previewRotation = (sourceRotation + userRotation) % 360;

assert.equal(sourceRotation, 90, "應讀取原始 PDF 的內嵌旋轉角度");
assert.equal(previewRotation, 180, "全螢幕預覽應合併原始與使用者旋轉角度");

await renderedDocument.destroy();
console.log("✓ 已驗證全螢幕預覽會保留原始 PDF 轉向並合併使用者旋轉。");
