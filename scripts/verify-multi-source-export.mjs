import { degrees, PDFDocument } from "pdf-lib";

async function createDocument(pageSizes) {
  const document = await PDFDocument.create();
  pageSizes.forEach((size) => document.addPage(size));
  return document.save();
}

const firstSourceBytes = await createDocument([[200, 280], [220, 300]]);
const secondSourceBytes = await createDocument([[240, 320], [260, 340]]);
const sourceDocuments = new Map([
  ["first", await PDFDocument.load(firstSourceBytes)],
  ["second", await PDFDocument.load(secondSourceBytes)],
]);
const workspacePages = [
  { sourceId: "first", sourceIndex: 1, rotation: 90 },
  { sourceId: "second", sourceIndex: 0, rotation: 0 },
  { sourceId: "first", sourceIndex: 0, rotation: 270 },
  { sourceId: "second", sourceIndex: 1, rotation: 0 },
];
const exported = await PDFDocument.create();

for (const pageItem of workspacePages) {
  const source = sourceDocuments.get(pageItem.sourceId);
  const [page] = await exported.copyPages(source, [pageItem.sourceIndex]);
  page.setRotation(degrees((page.getRotation().angle + pageItem.rotation) % 360));
  exported.addPage(page);
}

const result = await PDFDocument.load(await exported.save());
const pages = result.getPages();
const sizes = pages.map((page) => page.getMediaBox());
const rotations = pages.map((page) => page.getRotation().angle);
const expectedSizes = ["220x300", "240x320", "200x280", "260x340"];
const receivedSizes = sizes.map((size) => `${size.width}x${size.height}`);

if (receivedSizes.join(",") !== expectedSizes.join(",") || rotations.join(",") !== "90,0,270,0") {
  throw new Error(`驗證失敗：尺寸 ${receivedSizes.join(",")}；旋轉 ${rotations.join(",")}`);
}

console.log(JSON.stringify({ receivedSizes, rotations, result: "多來源匯入後的重排與匯出驗證通過" }));
