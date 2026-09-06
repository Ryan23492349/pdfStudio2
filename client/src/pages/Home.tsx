/**
 * 藍圖工作台：所有狀態皆以工程尺規、頁間剪刀節點與可預見頁軌呈現；工程藍只用於精確的切點與主要操作。
 */
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  Eraser,
  FileText,
  Grid2X2,
  GripVertical,
  List,
  Loader2,
  Minus,
  Plus,
  RotateCw,
  Scissors,
  Search,
  Sparkles,
  TextCursorInput,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Fragment, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, useDialogComposition } from "@/components/ui/dialog";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const LOGO_URL = "/manus-storage/pdf-splitter-logo_e764a730.png";
const WORKSPACE_ART_URL = "/manus-storage/blueprint-workspace_7ab3ecdf.png";

type ToolButtonProps = {
  label: string;
  tooltip: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

type PdfPageItem = {
  id: string;
  sourceId: string;
  sourceIndex: number;
  sourceRotation: number;
  preview: string;
  rotation: number;
  textAnnotations: PdfTextAnnotation[];
};

type PdfSource = {
  id: string;
  file: File;
  bytes: Uint8Array;
};

type PdfTextFont = "sans" | "serif" | "mono";

type PdfTextAnnotation = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: PdfTextFont;
};

type TextAnnotationDragState = {
  annotationId: string;
  pointerId: number;
  grabOffsetX: number;
  grabOffsetY: number;
  elementHeight: number;
};

type DeletedTextAnnotation = {
  pageId: string;
  annotation: PdfTextAnnotation;
  index: number;
};

type PdfJsPageForTextPlacement = {
  getViewport: (options: { scale: number; rotation: number }) => {
    width: number;
    height: number;
    convertToPdfPoint: (x: number, y: number) => number[];
  };
};

type PdfTextFontBundle = Record<PdfTextFont, PDFFont> & { cjk: PDFFont };

const PREVIEW_ZOOM_MIN = 0.5;
const PREVIEW_ZOOM_MAX = 2.5;
const PREVIEW_ZOOM_STEP = 0.25;
const DEFAULT_TEXT_CONTENT = "輸入文字";
const DEFAULT_TEXT_FONT_SIZE = 18;
const PDF_CJK_FONT_URL = "/manus-storage/pdf-studio-cjk_7e82ee53.ttf";
let cjkFontBytesPromise: Promise<ArrayBuffer> | null = null;

const TEXT_FONT_OPTIONS: Array<{ value: PdfTextFont; label: string; cssFamily: string }> = [
  { value: "sans", label: "無襯線", cssFamily: '"Helvetica Neue", Arial, sans-serif' },
  { value: "serif", label: "襯線", cssFamily: 'Georgia, "Times New Roman", serif' },
  { value: "mono", label: "等寬", cssFamily: '"SFMono-Regular", Consolas, monospace' },
];

const createPageId = () => (
  globalThis.crypto?.randomUUID?.() ?? `page-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);

const getTextFontCssFamily = (fontFamily: PdfTextFont) => (
  TEXT_FONT_OPTIONS.find((option) => option.value === fontFamily)?.cssFamily ?? TEXT_FONT_OPTIONS[0].cssFamily
);

const getCjkFontBytes = () => {
  if (!cjkFontBytesPromise) {
    cjkFontBytesPromise = fetch(PDF_CJK_FONT_URL).then(async (response) => {
      if (!response.ok) throw new Error("無法載入 PDF 中文字型");
      return response.arrayBuffer();
    });
  }
  return cjkFontBytesPromise;
};

const embedTextFonts = async (document: PDFDocument): Promise<PdfTextFontBundle> => {
  document.registerFontkit(fontkit);
  const cjk = await document.embedFont(await getCjkFontBytes(), { subset: true });
  return {
    sans: await document.embedFont(StandardFonts.Helvetica),
    serif: await document.embedFont(StandardFonts.TimesRoman),
    mono: await document.embedFont(StandardFonts.Courier),
    cjk,
  };
};

function drawTextAnnotations(
  targetPage: PDFPage,
  sourcePage: PdfJsPageForTextPlacement,
  annotations: PdfTextAnnotation[],
  rotation: number,
  fonts: PdfTextFontBundle,
) {
  if (annotations.length === 0) return;
  const viewport = sourcePage.getViewport({ scale: 1, rotation });

  annotations.forEach((annotation) => {
    const [x = 0, y = 0] = viewport.convertToPdfPoint(annotation.x * viewport.width, annotation.y * viewport.height);
    const text = annotation.text || DEFAULT_TEXT_CONTENT;
    const font = /[^\u0000-\u00ff]/.test(text) ? fonts.cjk : fonts[annotation.fontFamily];
    const lineHeight = annotation.fontSize * 1.25;
    text.split(/\r?\n/).forEach((line, lineIndex) => {
      targetPage.drawText(line || " ", {
        x,
        y: y - annotation.fontSize - lineIndex * lineHeight,
        size: annotation.fontSize,
        font,
        color: rgb(0.09, 0.13, 0.2),
        lineHeight,
      });
    });
  });
}

function ToolButton({ label, tooltip, icon, active, disabled, onClick }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            className={`tool-button ${active ? "tool-button-active" : ""}`}
            disabled={disabled}
            onClick={onClick}
            aria-pressed={active}
            aria-label={tooltip}
          >
            {icon}
            <span>{label}</span>
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="font-[Manrope] text-[11px] font-semibold tracking-[0.01em]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function PageQuickAction({ tooltip, icon, onClick, disabled, danger }: { tooltip: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button type="button" draggable={false} className={`page-quick-action ${danger ? "page-quick-action-danger" : ""}`} aria-label={tooltip} onClick={onClick} disabled={disabled}>
            {icon}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={7} className="font-[Manrope] text-[11px] font-semibold">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function PreviewControlButton({ label, icon, onClick, active, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button type="button" className={`preview-control-button ${active ? "preview-control-button-active" : ""}`} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
            {icon}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="font-[Manrope] text-[11px] font-semibold">{label}</TooltipContent>
    </Tooltip>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InlineEditableTextAnnotation({ annotation, style, editorRef, formatControlsRef, onFinish, onDelete }: {
  annotation: PdfTextAnnotation;
  style: React.CSSProperties;
  editorRef: React.RefObject<HTMLDivElement | null>;
  formatControlsRef: React.RefObject<HTMLDivElement | null>;
  onFinish: (value?: string) => void;
  onDelete: () => void;
}) {
  const { setComposing, markCompositionEnd, justEndedComposing } = useDialogComposition();
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    const placeCaretAtEnd = () => {
      const element = editorRef.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(element, element.childNodes.length);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    placeCaretAtEnd();
    const animationFrame = window.requestAnimationFrame(placeCaretAtEnd);
    const timer = window.setTimeout(placeCaretAtEnd, 0);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
    };
  }, [editorRef]);

  return (
    <div
      ref={editorRef}
      className="text-annotation text-annotation-editing text-annotation-selected"
      style={style}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="直接編輯已放置的文字"
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget as Node | null;
        if (nextFocus && formatControlsRef.current?.contains(nextFocus)) return;
        onFinish(event.currentTarget.innerText ?? "");
      }}
      onCompositionStart={() => { setIsComposing(true); setComposing(true); }}
      onCompositionEnd={() => {
        markCompositionEnd();
        window.setTimeout(() => { setIsComposing(false); setComposing(false); }, 100);
      }}
      onKeyDown={(event) => {
        const composing = event.nativeEvent.isComposing || isComposing || justEndedComposing();
        if (event.key === "Enter" && !event.shiftKey && !composing) {
          event.preventDefault();
          onFinish(event.currentTarget.innerText ?? "");
        }
        if (event.key === "Escape" && !composing) {
          event.preventDefault();
          onFinish();
        }
        if (event.key === "Delete" && !composing) {
          event.preventDefault();
          onDelete();
        }
      }}
    >
      {annotation.text || DEFAULT_TEXT_CONTENT}
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const inlineTextElementRef = useRef<HTMLDivElement>(null);
  const inlineTextFormatControlsRef = useRef<HTMLDivElement>(null);
  const textAnnotationLayerRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pdfSources, setPdfSources] = useState<PdfSource[]>([]);
  const [pages, setPages] = useState<PdfPageItem[]>([]);
  const [splitPoints, setSplitPoints] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "order">("grid");
  const [previewedPageId, setPreviewedPageId] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [selectedTextAnnotationId, setSelectedTextAnnotationId] = useState<string | null>(null);
  const [inlineTextAnnotationId, setInlineTextAnnotationId] = useState<string | null>(null);
  const [draggingTextAnnotation, setDraggingTextAnnotation] = useState<TextAnnotationDragState | null>(null);
  const [lastDeletedTextAnnotation, setLastDeletedTextAnnotation] = useState<DeletedTextAnnotation | null>(null);
  const [textFontFamily, setTextFontFamily] = useState<PdfTextFont>("sans");
  const [textFontSize, setTextFontSize] = useState(DEFAULT_TEXT_FONT_SIZE);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);

  const pageCount = pages.length;
  const previewedPage = pages.find((page) => page.id === previewedPageId) ?? null;
  const previewedPageNumber = previewedPage ? pages.findIndex((page) => page.id === previewedPage.id) + 1 : 0;
  const previewSource = previewedPage ? pdfSources.find((source) => source.id === previewedPage.sourceId) ?? null : null;
  const previewDocumentFile = useMemo(() => previewSource ? { data: previewSource.bytes.slice() } : null, [previewSource]);
  const previewPercent = Math.round(previewZoom * 100);

  useEffect(() => {
    if (!previewedPageId) return;
    const animationFrame = window.requestAnimationFrame(() => previewViewportRef.current?.scrollTo({ left: 0, top: 0 }));
    return () => window.cancelAnimationFrame(animationFrame);
  }, [previewedPageId]);

  useEffect(() => {
    if (!lastDeletedTextAnnotation || inlineTextAnnotationId || previewedPageId !== lastDeletedTextAnnotation.pageId) return;
    const handleUndoDelete = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      const deleted = lastDeletedTextAnnotation;
      setPages((current) => current.map((page) => {
        if (page.id !== deleted.pageId || page.textAnnotations.some((annotation) => annotation.id === deleted.annotation.id)) return page;
        const textAnnotations = [...page.textAnnotations];
        textAnnotations.splice(Math.min(deleted.index, textAnnotations.length), 0, deleted.annotation);
        return { ...page, textAnnotations };
      }));
      setSelectedTextAnnotationId(deleted.annotation.id);
      setLastDeletedTextAnnotation(null);
      toast.success("已復原刪除的文字。", { description: "文字已回到原本的位置。" });
    };
    window.addEventListener("keydown", handleUndoDelete);
    return () => window.removeEventListener("keydown", handleUndoDelete);
  }, [inlineTextAnnotationId, lastDeletedTextAnnotation, previewedPageId]);

  const openPagePreview = (pageId: string) => {
    setPreviewZoom(1);
    setPreviewLoadError(false);
    setIsPreviewLoading(true);
    setPreviewedPageId(pageId);
  };

  const adjustPreviewZoom = (amount: number) => {
    setPreviewZoom((current) => Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Number((current + amount).toFixed(2)))));
    setIsPreviewLoading(true);
  };

  const updateSelectedTextAnnotation = (changes: Partial<Pick<PdfTextAnnotation, "text" | "fontFamily" | "fontSize">>) => {
    if (!previewedPageId || !selectedTextAnnotationId) return;
    setPages((current) => current.map((page) => (
      page.id === previewedPageId
        ? { ...page, textAnnotations: page.textAnnotations.map((annotation) => annotation.id === selectedTextAnnotationId ? { ...annotation, ...changes } : annotation) }
        : page
    )));
  };

  const handleTextFontChange = (value: PdfTextFont) => {
    setTextFontFamily(value);
    updateSelectedTextAnnotation({ fontFamily: value });
  };

  const handleTextFontSizeChange = (value: number) => {
    const nextValue = Math.min(72, Math.max(8, Number.isFinite(value) ? value : DEFAULT_TEXT_FONT_SIZE));
    setTextFontSize(nextValue);
    updateSelectedTextAnnotation({ fontSize: nextValue });
  };

  const addTextAnnotation = () => {
    if (!isTextEditing || !previewedPageId) return;
    const annotation: PdfTextAnnotation = {
      id: createPageId(),
      text: DEFAULT_TEXT_CONTENT,
      x: 0.5,
      y: 0.5,
      fontFamily: textFontFamily,
      fontSize: textFontSize,
    };
    setPages((current) => current.map((page) => page.id === previewedPageId ? { ...page, textAnnotations: [...page.textAnnotations, annotation] } : page));
    setSelectedTextAnnotationId(annotation.id);
    setInlineTextAnnotationId(annotation.id);
  };

  const selectTextAnnotation = (annotation: PdfTextAnnotation) => {
    setSelectedTextAnnotationId(annotation.id);
    setTextFontFamily(annotation.fontFamily);
    setTextFontSize(annotation.fontSize);
  };

  const beginInlineTextEdit = (annotation: PdfTextAnnotation) => {
    selectTextAnnotation(annotation);
    setInlineTextAnnotationId(annotation.id);
  };

  const finishInlineTextEdit = (value?: string) => {
    if (value !== undefined) {
      const nextValue = value.trim() || DEFAULT_TEXT_CONTENT;
      updateSelectedTextAnnotation({ text: nextValue });
    }
    setInlineTextAnnotationId(null);
  };

  const updateTextAnnotationPosition = (annotationId: string, x: number, y: number) => {
    if (!previewedPageId) return;
    setPages((current) => current.map((page) => (
      page.id === previewedPageId
        ? { ...page, textAnnotations: page.textAnnotations.map((annotation) => annotation.id === annotationId ? { ...annotation, x, y } : annotation) }
        : page
    )));
  };

  const startTextAnnotationDrag = (event: ReactPointerEvent<HTMLButtonElement>, annotation: PdfTextAnnotation) => {
    if (!isTextEditing || event.button !== 0 || inlineTextAnnotationId === annotation.id) return;
    const layerBounds = textAnnotationLayerRef.current?.getBoundingClientRect();
    const textBounds = event.currentTarget.getBoundingClientRect();
    if (!layerBounds || layerBounds.width === 0 || layerBounds.height === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectTextAnnotation(annotation);
    setDraggingTextAnnotation({
      annotationId: annotation.id,
      pointerId: event.pointerId,
      grabOffsetX: event.clientX - textBounds.left,
      grabOffsetY: event.clientY - textBounds.top,
      elementHeight: textBounds.height,
    });
  };

  const moveTextAnnotation = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingTextAnnotation || event.pointerId !== draggingTextAnnotation.pointerId) return;
    const layerBounds = textAnnotationLayerRef.current?.getBoundingClientRect();
    if (!layerBounds || layerBounds.width === 0 || layerBounds.height === 0) return;
    event.preventDefault();
    const x = Math.min(0.96, Math.max(0.02, (event.clientX - layerBounds.left - draggingTextAnnotation.grabOffsetX) / layerBounds.width));
    const y = Math.min(0.98, Math.max(0.04, (event.clientY - layerBounds.top - draggingTextAnnotation.grabOffsetY + draggingTextAnnotation.elementHeight) / layerBounds.height));
    updateTextAnnotationPosition(draggingTextAnnotation.annotationId, x, y);
  };

  const finishTextAnnotationDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingTextAnnotation || event.pointerId !== draggingTextAnnotation.pointerId) return;
    event.preventDefault();
    setDraggingTextAnnotation(null);
  };

  const deleteSelectedTextAnnotation = () => {
    if (!previewedPageId || !selectedTextAnnotationId || inlineTextAnnotationId !== selectedTextAnnotationId) return;
    const deletedIndex = previewedPage?.textAnnotations.findIndex((annotation) => annotation.id === selectedTextAnnotationId) ?? -1;
    const deletedAnnotation = deletedIndex >= 0 ? previewedPage?.textAnnotations[deletedIndex] : null;
    if (!deletedAnnotation) return;
    setLastDeletedTextAnnotation({ pageId: previewedPageId, annotation: deletedAnnotation, index: deletedIndex });
    setPages((current) => current.map((page) => (
      page.id === previewedPageId
        ? { ...page, textAnnotations: page.textAnnotations.filter((annotation) => annotation.id !== selectedTextAnnotationId) }
        : page
    )));
    setSelectedTextAnnotationId(null);
    setInlineTextAnnotationId(null);
    toast.message("文字已刪除。", { description: "按 Ctrl/Cmd+Z 可復原。" });
  };

  const clearFile = () => {
    setFile(null);
    setPdfSources([]);
    setPages([]);
    setSplitPoints([]);
    setPreviewedPageId(null);
    setIsTextEditing(false);
    setSelectedTextAnnotationId(null);
    setInlineTextAnnotationId(null);
    setLastDeletedTextAnnotation(null);
    if (inputRef.current) inputRef.current.value = "";
    if (importInputRef.current) importInputRef.current.value = "";
  };

  const loadPdf = useCallback(async (selectedFile: File, mode: "replace" | "append" = "replace") => {
    const isPdf = selectedFile.type === "application/pdf" || selectedFile.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("請選擇 PDF 檔案。", { description: "此工作台目前只支援 .pdf 格式。" });
      return;
    }

    setIsLoading(true);
    if (mode === "replace") setPages([]);

    try {
      const sourceBytes = new Uint8Array(await selectedFile.arrayBuffer());
      const loadingTask = pdfjsLib.getDocument({ data: sourceBytes.slice() });
      const pdf = await loadingTask.promise;
      const sourceId = createPageId();

      const previews: PdfPageItem[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 0.48 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) continue;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        previews.push({
          id: createPageId(),
          sourceId,
          sourceIndex: pageNumber - 1,
          sourceRotation: ((page.rotate % 360) + 360) % 360,
          preview: canvas.toDataURL("image/jpeg", 0.78),
          rotation: 0,
          textAnnotations: [],
        });
      }

      const source: PdfSource = { id: sourceId, file: selectedFile, bytes: sourceBytes };
      setFile((current) => mode === "append" ? current ?? selectedFile : selectedFile);
      setPdfSources((current) => mode === "append" ? [...current, source] : [source]);
      setSplitPoints([]);
      setPages((current) => mode === "append" ? [...current, ...previews] : previews);
      setViewMode("grid");
      toast.success(mode === "append" ? "PDF 已加入工作區。" : "PDF 已載入工作台。", { description: mode === "append" ? `已追加 ${previews.length} 張頁面，並清除原有切點。` : `已建立 ${previews.length} 張頁面縮圖。` });
    } catch (error) {
      console.error(error);
      toast.error("無法讀取這份 PDF。", { description: "請確認檔案沒有損毀或受到密碼保護。" });
      if (mode === "replace") clearFile();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) void loadPdf(selectedFile);
  };

  const onImportInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length > 0) {
      void (async () => {
        for (const selectedFile of selectedFiles) {
          await loadPdf(selectedFile, "append");
        }
      })();
    }
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const selectedFile = event.dataTransfer.files?.[0];
    if (selectedFile) void loadPdf(selectedFile);
  };

  const splitPdf = async () => {
    const selectedSplitPoints = splitPoints;
    const selectedPages = pages;
    if (!file || pdfSources.length === 0 || pageCount < 2 || selectedSplitPoints.length === 0) {
      toast.error("請先選擇分割位置。", { description: "請點選兩頁之間的剪刀圖示，設定 PDF 的切點。" });
      return;
    }
    setIsSplitting(true);
    try {
      const sourceDocuments = new Map(await Promise.all(pdfSources.map(async (source) => [source.id, await PDFDocument.load(source.bytes)] as const)));
      const sourceRenderDocuments = new Map(await Promise.all(pdfSources.map(async (source) => [source.id, await pdfjsLib.getDocument({ data: source.bytes.slice() }).promise] as const)));
      const baseName = file.name.replace(/\.pdf$/i, "") || "split-document";
      const zip = new JSZip();
      const boundaries = [0, ...selectedSplitPoints, pageCount];

      for (let index = 0; index < boundaries.length - 1; index += 1) {
        const startPage = boundaries[index];
        const endPage = boundaries[index + 1];
        const segmentPdf = await PDFDocument.create();
        const textFonts = await embedTextFonts(segmentPdf);
        const segmentItems = selectedPages.slice(startPage, endPage);
        for (const pageItem of segmentItems) {
          const source = sourceDocuments.get(pageItem.sourceId);
          if (!source) throw new Error("找不到頁面來源");
          const [page] = await segmentPdf.copyPages(source, [pageItem.sourceIndex]);
          const rotation = (page.getRotation().angle + pageItem.rotation) % 360;
          page.setRotation(degrees(rotation));
          const sourceRenderDocument = sourceRenderDocuments.get(pageItem.sourceId);
          if (sourceRenderDocument) {
            const sourceRenderPage = await sourceRenderDocument.getPage(pageItem.sourceIndex + 1);
            drawTextAnnotations(page, sourceRenderPage, pageItem.textAnnotations, rotation, textFonts);
          }
          segmentPdf.addPage(page);
        }

        const segmentNumber = String(index + 1).padStart(2, "0");
        const fileName = `${baseName}_${segmentNumber}_第${startPage + 1}-${endPage}頁.pdf`;
        zip.file(fileName, await segmentPdf.save());
      }

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = `${baseName}_分拆結果.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(zipUrl), 800);

      toast.success("ZIP 壓縮檔已準備完成。", { description: `壓縮檔內包含 ${selectedSplitPoints.length + 1} 份分拆後的 PDF，下載將由瀏覽器自動開始。` });
    } catch (error) {
      console.error(error);
          toast.error("拆分時發生問題。", { description: "請重新嘗試，或改用另一份 PDF。" });
    } finally {
      setIsSplitting(false);
    }
  };

  const exportPdf = async () => {
    if (!file || pdfSources.length === 0 || pageCount === 0) return;
    setIsExporting(true);
    try {
      const sourceDocuments = new Map(await Promise.all(pdfSources.map(async (source) => [source.id, await PDFDocument.load(source.bytes)] as const)));
      const sourceRenderDocuments = new Map(await Promise.all(pdfSources.map(async (source) => [source.id, await pdfjsLib.getDocument({ data: source.bytes.slice() }).promise] as const)));
      const exportedPdf = await PDFDocument.create();
      const textFonts = await embedTextFonts(exportedPdf);
      for (const pageItem of pages) {
        const source = sourceDocuments.get(pageItem.sourceId);
        if (!source) throw new Error("找不到頁面來源");
        const [page] = await exportedPdf.copyPages(source, [pageItem.sourceIndex]);
        const rotation = (page.getRotation().angle + pageItem.rotation) % 360;
        page.setRotation(degrees(rotation));
        const sourceRenderDocument = sourceRenderDocuments.get(pageItem.sourceId);
        if (sourceRenderDocument) {
          const sourceRenderPage = await sourceRenderDocument.getPage(pageItem.sourceIndex + 1);
          drawTextAnnotations(page, sourceRenderPage, pageItem.textAnnotations, rotation, textFonts);
        }
        exportedPdf.addPage(page);
      }

      const baseName = file.name.replace(/\.pdf$/i, "") || "pdf-studio-document";
      const fileUrl = URL.createObjectURL(new Blob([await exportedPdf.save()], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `${baseName}_已編輯.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 800);
      toast.success("PDF 已匯出。", { description: "目前頁序與所有頁面編輯已寫入下載檔案。" });
    } catch (error) {
      console.error(error);
      toast.error("匯出時發生問題。", { description: "請重新嘗試匯出目前文件。" });
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSplitPoint = (pageNumber: number) => {
    setSplitPoints((current) => (
      current.includes(pageNumber)
        ? current.filter((point) => point !== pageNumber)
        : [...current, pageNumber].sort((first, second) => first - second)
    ));
  };

  const clearSplitPoints = () => {
    if (splitPoints.length === 0) return;
    setSplitPoints([]);
    toast.success("已清除所有分割點。", { description: "你可以重新選擇一個或多個頁面之間的剪刀節點。" });
  };

  const rotatePage = (pageId: string) => {
    setPages((current) => current.map((page) => (
      page.id === pageId ? { ...page, rotation: (page.rotation + 90) % 360 } : page
    )));
  };

  const duplicatePage = (pageIndex: number) => {
    const copiedPage = pages[pageIndex];
    if (!copiedPage) return;
    setPages((current) => {
      const nextPages = [...current];
      nextPages.splice(pageIndex + 1, 0, { ...copiedPage, id: createPageId(), textAnnotations: copiedPage.textAnnotations.map((annotation) => ({ ...annotation, id: createPageId() })) });
      return nextPages;
    });
    setSplitPoints((current) => current.map((point) => (point >= pageIndex + 1 ? point + 1 : point)));
    toast.success("已複製頁面。", { description: "複本已插入於原始頁面的下一頁。" });
  };

  const addBlankPage = (pageIndex: number) => {
    setPages((current) => {
      const nextPages = [...current];
      // 取得前一頁的資訊來建立空白頁（使用相同的 sourceId 和 rotation）
      const prevPage = pages[pageIndex];
      // 建立純白色頁面 (RGB 255, 255, 255)
      const whitePageSvg = `
        <svg width="200" height="283" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#FFFFFF" stroke="#CCCCCC" stroke-width="1"/>
        </svg>
      `;
      const svgDataUri = 'data:image/svg+xml;base64,' + btoa(whitePageSvg);
      
      const blankPage: PdfPageItem = {
        id: createPageId(),
        sourceId: prevPage?.sourceId ?? "",
        sourceIndex: prevPage?.sourceIndex ?? 0,
        sourceRotation: prevPage?.sourceRotation ?? 0,
        preview: svgDataUri,
        rotation: 0,
        textAnnotations: [],
      };
      // 插入空白頁到「前一頁」
      nextPages.splice(pageIndex, 0, blankPage);
      return nextPages;
    });
    setSplitPoints((current) => current.map((point) => (point >= pageIndex ? point + 1 : point)));
    toast.success("已新增空白頁面。", { description: "空白頁已插入於目前頁面的前一頁。" });
  };

  const deletePage = (pageIndex: number) => {
    const deletedPage = pages[pageIndex];
    if (!deletedPage) return;
    if (pages.length === 1) {
      setPages([]);
      setSplitPoints([]);
      setPreviewedPageId(null);
      toast.success("已清空工作區。", { description: "你可以使用匯入按鈕繼續加入更多 PDF。" });
      return;
    }
    setPages((current) => current.filter((page) => page.id !== deletedPage.id));
    setSplitPoints((current) => current
      .filter((point) => point !== pageIndex + 1)
      .map((point) => (point > pageIndex + 1 ? point - 1 : point)));
    if (previewedPageId === deletedPage.id) setPreviewedPageId(null);
    toast.success("已刪除頁面。", { description: "相關切點已自動調整。" });
  };

  const reorderPages = (sourceId: string, targetId: string, position: "before" | "after") => {
    if (sourceId === targetId) return;
    const sourceIndex = pages.findIndex((page) => page.id === sourceId);
    const targetIndex = pages.findIndex((page) => page.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextPages = [...pages];
    const [movedPage] = nextPages.splice(sourceIndex, 1);
    let insertionIndex = targetIndex + (position === "after" ? 1 : 0);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    nextPages.splice(insertionIndex, 0, movedPage);
    setPages(nextPages);
    setSplitPoints((current) => current.filter((point) => point > 0 && point < nextPages.length));
    toast.success("頁面順序已更新。", { description: `已將第 ${sourceIndex + 1} 頁移至第 ${insertionIndex + 1} 頁。` });
  };

  const handlePageDragStart = (event: DragEvent<HTMLDivElement>, pageId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", pageId);
    setDraggedPageId(pageId);
  };

  const handlePageDragOver = (event: DragEvent<HTMLDivElement>, pageId: string) => {
    event.preventDefault();
    if (!draggedPageId || draggedPageId === pageId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ id: pageId, position });
  };

  const handlePageDrop = (event: DragEvent<HTMLDivElement>, pageId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedPageId;
    if (sourceId && dropTarget?.id === pageId) reorderPages(sourceId, pageId, dropTarget.position);
    setDraggedPageId(null);
    setDropTarget(null);
  };

  const hasFile = Boolean(file && pdfSources.length > 0 && pageCount > 0);
  const hasWorkspace = Boolean(file);
  const importedDocumentCount = pdfSources.length;
  const totalSourceSize = pdfSources.reduce((total, source) => total + source.file.size, 0);
  const outputFileCount = splitPoints.length + 1;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-mark" src={LOGO_URL} alt="PDF Studio" />
          <div>
            <p className="brand-name">PDF Studio</p>
            <p className="brand-kicker">本機文件工作台</p>
          </div>
        </div>

        <div className="topbar-workflow" aria-label="文件處理流程">
          <span className={!hasWorkspace ? "topbar-flow-active" : ""}><b>01</b>匯入</span>
          <i aria-hidden="true" />
          <span className={hasWorkspace ? "topbar-flow-active" : ""}><b>02</b>編排</span>
          <i aria-hidden="true" />
          <span><b>03</b>輸出</span>
        </div>

        {hasWorkspace && (
          <nav className="toolbar" aria-label="PDF 操作工具">
            <ToolButton label={isSplitting ? "正在壓縮" : `分拆（${outputFileCount} 份）`} tooltip="依照已選切點輸出 ZIP 壓縮檔" icon={isSplitting ? <Loader2 className="animate-spin" size={17} /> : <Scissors size={17} strokeWidth={2.2} />} active={splitPoints.length > 0} disabled={isSplitting || splitPoints.length === 0} onClick={() => void splitPdf()} />
            <ToolButton label="清除切點" tooltip="清除所有已選分割點" icon={<Eraser size={17} strokeWidth={2.1} />} disabled={splitPoints.length === 0 || isSplitting} onClick={clearSplitPoints} />
            <ToolButton label={isLoading ? "正在匯入" : "匯入"} tooltip="加入另一份 PDF 並追加其頁面" icon={isLoading ? <Loader2 className="animate-spin" size={17} /> : <UploadCloud size={17} strokeWidth={2.1} />} disabled={isLoading || isSplitting || isExporting} onClick={() => importInputRef.current?.click()} />
            <ToolButton label={isExporting ? "正在匯出" : "匯出"} tooltip="匯出目前頁序與編輯結果" icon={isExporting ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} strokeWidth={2.1} />} disabled={!hasFile || isExporting || isSplitting || isLoading} onClick={() => void exportPdf()} />
          </nav>
        )}

        <div className="topbar-meta">
          {hasWorkspace && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="icon-button" type="button" aria-label="關閉目前文件並返回上載畫面" onClick={clearFile}>
                  <X size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className="font-[Manrope] text-[11px] font-semibold tracking-[0.01em]">關閉目前文件</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={onInputChange} className="sr-only" />
      <input ref={importInputRef} type="file" accept="application/pdf,.pdf" multiple onChange={onImportInputChange} className="sr-only" />

      {!hasWorkspace && !isLoading && (
        <main className="upload-stage">
          <section className="upload-copy">
            <div className="eyebrow"><Sparkles size={15} /> 文件流程 / 01 READY</div>
            <h1>下一步：<br /><em>匯入 PDF。</em></h1>
            <p>匯入後，所有頁面會配置到文件軌道；依序排列頁面、選取頁間切縫，最後輸出單一 PDF 或分拆 ZIP。</p>
            <div className="upload-points">
              <span><b>01</b><Check size={15} /><strong>匯入 PDF</strong><small>載入頁面至工作軌道</small></span>
              <span><b>02</b><Check size={15} /><strong>排列並選取切點</strong><small>直接拖曳頁面，於頁間設定切縫</small></span>
              <span><b>03</b><Check size={15} /><strong>輸出本機結果</strong><small>下載單一 PDF 或分拆 ZIP</small></span>
            </div>
          </section>

          <button
            className={`dropzone ${isDragging ? "dropzone-dragging" : ""}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <img className="blueprint-art" src={WORKSPACE_ART_URL} alt="" />
            <div className="upload-ruler" aria-hidden="true"><span>00</span><i /><span>01</span><i /><span>02</span><i /><span>03</span><i /><span>04</span></div>
            <div className="upload-track-label" aria-hidden="true"><span>頁面工作軌道</span><strong>第 02 頁後切分</strong></div>
            <div className="upload-track-preview" aria-hidden="true">
              <div className="upload-ghost-page"><span>01</span><i /></div>
              <div className="upload-cut-seam"><span><Scissors size={13} /></span><small>CUT</small></div>
              <div className="upload-ghost-page"><span>02</span><i /></div>
              <div className="upload-cut-seam upload-cut-seam-active"><span><Scissors size={13} /></span><small>SELECT</small></div>
              <div className="upload-ghost-page"><span>03</span><i /></div>
            </div>
            <div className="dropzone-content">
              <span className="upload-icon"><UploadCloud size={28} /></span>
              <strong>拖放 PDF 到工作軌道</strong>
              <span>或按一下選取檔案並開始編排</span>
              <span className="dropzone-note">本機處理 · 支援多份 PDF · 無須上傳</span>
            </div>
          </button>
        </main>
      )}

      {isLoading && !hasWorkspace && (
        <main className="loading-stage" aria-live="polite">
          <div className="loading-card">
            <Loader2 className="loading-spinner" size={30} />
            <h1>正在建立頁面工作軌道</h1>
            <p>PDF 正在瀏覽器內解析並產生縮圖，這可能需要片刻。</p>
          </div>
        </main>
      )}

      {hasWorkspace && file && (
        <main className="workspace">
          <section className="workspace-context">
            <div className="file-summary">
              <span className="file-icon"><FileText size={21} /></span>
              <div>
                <div className="file-name-row"><h1>{importedDocumentCount > 1 ? `${file.name} + ${importedDocumentCount - 1} 份 PDF` : file.name}</h1><span className="file-badge">PDF</span></div>
                <p>{pageCount === 0 ? `尚未加入頁面 · ${formatFileSize(totalSourceSize)}` : `${pageCount} 頁 · ${formatFileSize(totalSourceSize)} · ${importedDocumentCount > 1 ? `已合併 ${importedDocumentCount} 份文件 · ` : ""}${pageCount === 1 ? "單頁 PDF 已可直接匯出" : splitPoints.length > 0 ? `已選 ${splitPoints.length} 個切點，將輸出 ${outputFileCount} 份 PDF` : "點選兩頁之間的剪刀，設定一個或多個切點"}`}</p>
              </div>
            </div>
            <div className="view-controls" aria-label="檢視模式">
              <Tooltip><TooltipTrigger asChild><button type="button" className={`view-control ${viewMode === "order" ? "view-control-active" : ""}`} aria-label="頁面排序檢視" aria-pressed={viewMode === "order"} onClick={() => setViewMode("order")}><List size={18} /></button></TooltipTrigger><TooltipContent side="bottom" sideOffset={8} className="font-[Manrope] text-[11px] font-semibold">頁面排序檢視</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><button type="button" className={`view-control ${viewMode === "grid" ? "view-control-active" : ""}`} aria-label="縮圖檢視" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}><Grid2X2 size={18} /></button></TooltipTrigger><TooltipContent side="bottom" sideOffset={8} className="font-[Manrope] text-[11px] font-semibold">縮圖檢視</TooltipContent></Tooltip>
            </div>
          </section>

          <section className="document-frame" aria-label="PDF 頁面縮圖及分割節點">
            {pageCount === 0 ? (
              <div className="empty-workspace">
                <UploadCloud size={25} />
                <strong>工作區目前沒有頁面</strong>
                <span>請使用 header 的匯入按鈕加入一份或多份 PDF。</span>
              </div>
            ) : viewMode === "grid" ? (
              <div className="document-rail">
                {pages.map((page, index) => {
                  const pageNumber = index + 1;
                  const isSplitPoint = splitPoints.includes(pageNumber);
                  return (
                    <div
                      className={`page-flow ${draggedPageId === page.id ? "page-flow-dragging" : ""} ${dropTarget?.id === page.id && draggedPageId !== page.id ? `page-flow-drop-${dropTarget.position}` : ""}`}
                      key={page.id}
                      draggable
                      onDragStart={(event) => handlePageDragStart(event, page.id)}
                      onDragOver={(event) => handlePageDragOver(event, page.id)}
                      onDrop={(event) => handlePageDrop(event, page.id)}
                      onDragEnd={() => { setDraggedPageId(null); setDropTarget(null); }}
                    >
                      <article className="page-card">
                        <div className="page-topline"><span className="page-topline-label"><GripVertical className="page-drag-handle" size={13} /><span>PAGE {String(pageNumber).padStart(2, "0")}</span></span><span className="page-dot" /></div>
                        <div className="page-card-hover-tools" aria-label={`第 ${pageNumber} 頁操作`}>
                          <PageQuickAction tooltip="放大預覽" icon={<Search size={17} />} onClick={() => openPagePreview(page.id)} />
                          <PageQuickAction tooltip="向右旋轉 90°" icon={<RotateCw size={17} />} onClick={() => rotatePage(page.id)} />
                          <PageQuickAction tooltip="複製此頁" icon={<Copy size={16} />} onClick={() => duplicatePage(index)} />
                          <PageQuickAction tooltip="新增空白頁" icon={<Plus size={16} />} onClick={() => addBlankPage(index)} />
                          <PageQuickAction tooltip="刪除此頁" icon={<Trash2 size={17} />} onClick={() => deletePage(index)} danger />
                        </div>
                        <div className="page-image-wrap"><img src={page.preview} alt={`第 ${pageNumber} 頁縮圖`} style={{ transform: `rotate(${page.rotation}deg)` }} /></div>
                        <div className="page-caption"><span>第 {pageNumber} 頁</span><span>PDF</span></div>
                      </article>
                      {pageNumber < pageCount && (
                        <button type="button" className={`split-node ${isSplitPoint ? "split-node-active" : ""}`} onClick={() => toggleSplitPoint(pageNumber)} aria-label={isSplitPoint ? `取消第 ${pageNumber} 頁後的分割點` : `在第 ${pageNumber} 頁後分割`} aria-pressed={isSplitPoint}>
                          {isSplitPoint && <span className="split-callout">第 {pageNumber} 頁後</span>}
                          <span className="scissor-pin"><Scissors size={16} /></span>
                          <span className="split-node-text">切點</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ol className="order-view" aria-label="PDF 頁面排序">
                {pages.map((page, index) => {
                  const pageNumber = index + 1;
                  const isSplitPoint = splitPoints.includes(pageNumber);
                  return (
                    <Fragment key={page.id}>
                      <li className="order-item">
                        <span className="order-index">{String(pageNumber).padStart(2, "0")}</span>
                        <img className="order-thumbnail" src={page.preview} alt={`第 ${pageNumber} 頁縮圖`} style={{ transform: `rotate(${page.rotation}deg)` }} />
                        <div className="order-details"><strong>第 {pageNumber} 頁</strong><span>原始頁序 #{pageNumber}</span></div>
                        {pageNumber === pageCount && <span className="order-end">文件結尾</span>}
                      </li>
                      {pageNumber < pageCount && (
                        <li className="order-gap">
                          <button type="button" className={`order-scissor-node ${isSplitPoint ? "order-scissor-node-active" : ""}`} onClick={() => toggleSplitPoint(pageNumber)} aria-label={isSplitPoint ? `取消第 ${pageNumber} 頁後的分割點` : `在第 ${pageNumber} 頁後分割`} aria-pressed={isSplitPoint}>
                            {isSplitPoint && <span className="order-split-callout">第 {pageNumber} 頁後</span>}
                            <Scissors size={15} />
                          </button>
                        </li>
                      )}
                    </Fragment>
                  );
                })}
              </ol>
            )}
          </section>
        </main>
      )}

      <Dialog open={previewedPage !== null} onOpenChange={(open) => {
        if (!open) {
          setPreviewedPageId(null);
          setIsTextEditing(false);
          setSelectedTextAnnotationId(null);
          setInlineTextAnnotationId(null);
        }
      }}>
        {previewedPage && (
          <DialogContent fullscreen className="page-preview-dialog page-preview-fullscreen">
            <DialogHeader className="page-preview-header pr-14">
              <DialogTitle className="font-[Manrope] text-[18px] font-extrabold tracking-[-0.03em]">第 {previewedPageNumber} 頁預覽</DialogTitle>
              <DialogDescription>全螢幕預覽目前頁面；關閉後可返回 PDF 工作區繼續編輯。</DialogDescription>
              <div className="preview-controls" role="toolbar" aria-label="預覽縮放控制">
                <div className="preview-control-group">
                  <PreviewControlButton label={isTextEditing ? "結束文字編輯" : "文字編輯"} icon={<TextCursorInput size={16} />} active={isTextEditing} onClick={() => { setIsTextEditing((current) => !current); setSelectedTextAnnotationId(null); setInlineTextAnnotationId(null); setDraggingTextAnnotation(null); }} />
                  <PreviewControlButton label="縮小" icon={<Minus size={17} />} disabled={previewZoom <= PREVIEW_ZOOM_MIN} onClick={() => adjustPreviewZoom(-PREVIEW_ZOOM_STEP)} />
                  <span className="preview-zoom-value" aria-label={`目前縮放 ${previewPercent}%`}>{previewPercent}%</span>
                  <PreviewControlButton label="放大" icon={<Plus size={17} />} disabled={previewZoom >= PREVIEW_ZOOM_MAX} onClick={() => adjustPreviewZoom(PREVIEW_ZOOM_STEP)} />
                </div>
              </div>
              {isTextEditing && (
                <div className="preview-text-editor" aria-label="文字編輯設定">
                  <span className="preview-edit-hint">按「+」新增「輸入文字」 · 拖曳移動 · 雙點文字編輯 · Shift+Enter 換行 · 修改中按 Delete 刪除</span>
                  {inlineTextAnnotationId && <div ref={inlineTextFormatControlsRef} className="inline-text-format-controls">
                    <label className="preview-text-field"><span>字型</span><select value={textFontFamily} onChange={(event) => handleTextFontChange(event.target.value as PdfTextFont)} aria-label="字型">
                      {TEXT_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select></label>
                    <label className="preview-text-field preview-text-size"><span>字級</span><input type="number" min="8" max="72" value={textFontSize} onChange={(event) => handleTextFontSizeChange(Number(event.target.value))} aria-label="字級" /></label>
                  </div>}
                  <button type="button" className="preview-text-add" onClick={addTextAnnotation} aria-label="新增文字至頁面中央"><Plus size={14} /><span>新增文字</span></button>
                </div>
              )}
            </DialogHeader>
            <div ref={previewViewportRef} className="page-preview-canvas react-pdf-preview" aria-busy={isPreviewLoading} aria-label="可捲動的完整 PDF 頁面預覽" tabIndex={0}>
              {previewDocumentFile && (
                <Document
                  file={previewDocumentFile}
                  loading={<div className="preview-render-status"><Loader2 className="animate-spin" size={19} /><span>正在載入原始 PDF 頁面</span></div>}
                  error={<div className="preview-render-status preview-render-status-error">無法載入這一頁，請關閉後再試。</div>}
                  onLoadError={(error) => { console.error(error); setPreviewLoadError(true); setIsPreviewLoading(false); }}
                >
                  <div className={`page-edit-stage ${isTextEditing ? "page-edit-stage-editing" : ""}`}>
                    <Page
                      pageNumber={previewedPage.sourceIndex + 1}
                      rotate={(previewedPage.sourceRotation + previewedPage.rotation) % 360}
                      scale={Number.isFinite(previewZoom) && previewZoom > 0 ? previewZoom : 1}
                      devicePixelRatio={Math.min(globalThis.devicePixelRatio || 1, 2)}
                      renderAnnotationLayer
                      renderTextLayer
                      loading={<div className="preview-render-status"><Loader2 className="animate-spin" size={19} /><span>正在以向量品質繪製頁面</span></div>}
                      error={<div className="preview-render-status preview-render-status-error">此頁無法完成渲染。</div>}
                      onRenderSuccess={() => setIsPreviewLoading(false)}
                      onRenderError={(error) => { console.error(error); setPreviewLoadError(true); setIsPreviewLoading(false); }}
                    />
                    <div ref={textAnnotationLayerRef} className="text-annotation-layer" onPointerMove={moveTextAnnotation} onPointerUp={finishTextAnnotationDrag} onPointerCancel={finishTextAnnotationDrag}>
                      {previewedPage.textAnnotations.map((annotation) => {
                        const annotationStyle = { left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, fontSize: `${annotation.fontSize * previewZoom}px`, fontFamily: getTextFontCssFamily(annotation.fontFamily) };
                        const isInlineEditing = inlineTextAnnotationId === annotation.id;
                        return isInlineEditing ? (
                          <InlineEditableTextAnnotation
                            key={annotation.id}
                            annotation={annotation}
                            style={annotationStyle}
                            editorRef={inlineTextElementRef}
                            formatControlsRef={inlineTextFormatControlsRef}
                            onFinish={finishInlineTextEdit}
                            onDelete={deleteSelectedTextAnnotation}
                          />
                        ) : (
                          <button
                            key={annotation.id}
                            type="button"
                            className={`text-annotation ${selectedTextAnnotationId === annotation.id ? "text-annotation-selected" : ""} ${draggingTextAnnotation?.annotationId === annotation.id ? "text-annotation-dragging" : ""}`}
                            style={annotationStyle}
                            onPointerDown={(event) => startTextAnnotationDrag(event, annotation)}
                            onDoubleClick={(event) => { if (!isTextEditing) return; event.stopPropagation(); beginInlineTextEdit(annotation); }}
                            aria-label={`編輯文字：${annotation.text || DEFAULT_TEXT_CONTENT}；可拖曳移動，雙重點擊可直接修改`}
                          >
                            {annotation.text || DEFAULT_TEXT_CONTENT}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </Document>
              )}
              {previewLoadError && <div className="preview-render-status preview-render-status-error">高解析預覽載入失敗，請關閉後再試。</div>}
            </div>
          </DialogContent>
        )}
      </Dialog>

    </div>
  );
}
