import { getDocument, GlobalWorkerOptions } from '/vendor/pdfjs/pdf.min.mjs';

GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const fileInput = document.querySelector('#pdf-file');
const dropZone = document.querySelector('#drop-zone');
const fileSummary = document.querySelector('#file-summary');
const fileName = document.querySelector('#file-name');
const uploadTitle = document.querySelector('#upload-title');
const uploadSubtitle = document.querySelector('#upload-subtitle');
const layoutSelect = document.querySelector('#layout-select');
const orientationSelect = document.querySelector('#orientation-select');
const previewButton = document.querySelector('#preview-button');
const statusMessage = document.querySelector('#status');
const recommendation = document.querySelector('#recommendation');
const recommendationText = document.querySelector('#recommendation-text');
const previewEmpty = document.querySelector('#preview-empty');
const previewFrame = document.querySelector('#preview-frame');
const previewPages = document.querySelector('#preview-pages');
const previewTitle = document.querySelector('#preview-title');
const previewFooter = document.querySelector('#preview-footer');
const outputSummary = document.querySelector('#output-summary');
const downloadButton = document.querySelector('#download-button');
const paperTag = document.querySelector('#paper-tag');

let selectedFile = null;
let analysis = null;
let previewUrl = null;
let activeController = null;
let requestVersion = 0;
let previewDocument = null;
let thumbnailObserver = null;
let mainRender = null;
let selectedPageVersion = 0;

function setStatus(message, state = '') {
  statusMessage.textContent = message;
  statusMessage.dataset.state = state;
}

function clearPreview() {
  selectedPageVersion += 1;
  mainRender?.cancel();
  mainRender = null;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  if (previewDocument) {
    previewDocument.destroy();
    previewDocument = null;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  previewFrame.replaceChildren();
  previewPages.replaceChildren();
  previewPages.hidden = true;
  previewFrame.hidden = true;
  previewEmpty.hidden = false;
  previewFooter.hidden = true;
  paperTag.hidden = true;
  previewTitle.textContent = 'A fresh sheet, ready when you are.';
}

function resetSelection() {
  requestVersion += 1;
  activeController?.abort();
  activeController = null;
  selectedFile = null;
  analysis = null;
  fileInput.value = '';
  fileSummary.hidden = true;
  dropZone.hidden = false;
  layoutSelect.disabled = true;
  layoutSelect.replaceChildren(new Option('Upload a PDF to see layouts', ''));
  previewButton.disabled = true;
  recommendation.hidden = true;
  clearPreview();
  setStatus('Choose a PDF to get started.');
}

function formatLayout(candidate, isRecommended) {
  const capacity = candidate.columns * candidate.rows;
  const sheetText = candidate.sheets === 1 ? '1 sheet' : `${candidate.sheets} sheets`;
  const imageSize = `${candidate.image_width_mm} × ${candidate.image_height_mm} mm`;
  const label = `${candidate.columns} columns × ${candidate.rows} rows · ${capacity} per side`;
  const marker = isRecommended ? ' · recommended' : '';
  return { label: `${label} — ${sheetText}, ${imageSize}${marker}`, imageSize };
}

async function analyzeFile(file, preferredLayout = '') {
  const version = ++requestVersion;
  activeController?.abort();
  activeController = new AbortController();
  const controller = activeController;

  selectedFile = file;
  analysis = null;
  clearPreview();
  fileName.textContent = file.name;
  uploadTitle.textContent = 'PDF selected';
  uploadSubtitle.textContent = 'Choose a layout below to continue.';
  fileSummary.hidden = false;
  dropZone.hidden = true;
  layoutSelect.disabled = true;
  previewButton.disabled = true;
  recommendation.hidden = true;

  if (!file.name.toLowerCase().endsWith('.pdf') || file.size === 0) {
    setStatus('Choose a non-empty PDF file.', 'error');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus('PDF files must be 50 MB or smaller.', 'error');
    return;
  }

  setStatus('Checking page size and finding a good layout…', 'working');
  try {
    const response = await fetch(`/api/analyze?orientation=${orientationSelect.value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The PDF could not be analyzed.');
    if (version !== requestVersion) return;

    analysis = result;
    const suggested = `${result.recommended.columns}x${result.recommended.rows}`;
    layoutSelect.replaceChildren();
    for (const candidate of result.candidates) {
      const value = `${candidate.columns}x${candidate.rows}`;
      const isRecommended = value === suggested;
      const option = new Option(formatLayout(candidate, isRecommended).label, value, false,
        value === (preferredLayout || suggested));
      layoutSelect.add(option);
    }
    layoutSelect.disabled = false;
    previewButton.disabled = false;
    recommendation.hidden = false;
    recommendationText.textContent = `Suggested for ${result.page_width_mm} × ${result.page_height_mm} mm pages and ${result.page_count} originals`;
    setStatus(`${result.page_count} pages · ${result.page_width_mm} × ${result.page_height_mm} mm original page`, 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (version === requestVersion) setStatus(error.message, 'error');
  }
}

async function renderPage(pdf, number, canvas, width, version, selection = null) {
  try {
    const page = await pdf.getPage(number);
    if (version !== requestVersion || pdf !== previewDocument ||
        (selection !== null && selection !== selectedPageVersion)) return;
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    if (selection !== null) mainRender = task;
    await task.promise;
  } catch (error) {
    if (version === requestVersion && pdf === previewDocument && error.name !== 'RenderingCancelledException') {
      setStatus(`Could not render preview page ${number}: ${error.message}`, 'error');
    }
  }
}

function selectPage(number, version) {
  const pdf = previewDocument;
  if (!pdf || version !== requestVersion) return;
  selectedPageVersion += 1;
  mainRender?.cancel();
  mainRender = null;
  const canvas = document.createElement('canvas');
  canvas.id = 'pdf-preview';
  canvas.setAttribute('aria-label', `Printed side ${number} of ${pdf.numPages}`);
  previewFrame.replaceChildren(canvas);
  for (const button of previewPages.children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.page) === number));
  }
  renderPage(pdf, number, canvas, 900, version, selectedPageVersion);
}

function showPages(pdf, version) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      renderPage(pdf, Number(entry.target.dataset.page), entry.target.querySelector('canvas'), 144, version);
    }
  }, { root: previewPages, rootMargin: '100px' });
  thumbnailObserver = observer;

  for (let number = 1; number <= pdf.numPages; number += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'page-thumbnail';
    button.dataset.page = number;
    button.setAttribute('aria-label', `Show printed side ${number}`);
    button.setAttribute('aria-pressed', 'false');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `Side ${number}`;
    button.append(canvas, label);
    button.addEventListener('click', () => selectPage(number, version));
    previewPages.append(button);
    observer.observe(button);
  }
  previewPages.hidden = false;
  selectPage(1, version);
}

async function makePreview() {
  if (!selectedFile || !analysis) return;

  const [columns, rows] = layoutSelect.value.split('x').map(Number);
  const version = ++requestVersion;
  activeController?.abort();
  activeController = new AbortController();
  const controller = activeController;
  previewButton.disabled = true;
  setStatus('Arranging pages and building your preview…', 'working');

  try {
    const response = await fetch(`/api/preview?columns=${columns}&rows=${rows}&orientation=${orientationSelect.value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: selectedFile,
      signal: controller.signal
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'The preview could not be created.');
    }
    const blob = await response.blob();
    if (version !== requestVersion) return;

    clearPreview();
    previewUrl = URL.createObjectURL(blob);
    const pdf = await getDocument({
      data: await blob.arrayBuffer(),
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/'
    }).promise;
    if (version !== requestVersion) {
      await pdf.destroy();
      return;
    }
    previewDocument = pdf;
    previewFrame.hidden = false;
    previewEmpty.hidden = true;
    previewFooter.hidden = false;
    paperTag.hidden = false;
    paperTag.textContent = `A4 · ${orientationSelect.value.toUpperCase()}`;
    previewTitle.textContent = `${columns} × ${rows} layout`;
    showPages(pdf, version);
    const sheets = Number(response.headers.get('X-Paper-Sheets'));
    const blanks = Number(response.headers.get('X-Blank-Slots'));
    const outputPages = Number(response.headers.get('X-Output-Pages'));
    outputSummary.textContent = `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'} · ${outputPages} printed sides · ${blanks} ${blanks === 1 ? 'blank slot' : 'blank slots'}`;

    const baseName = selectedFile.name.replace(/\.pdf$/i, '') || 'pamphlet';
    downloadButton.href = previewUrl;
    downloadButton.download = `${baseName}-pamphlet.pdf`;
    setStatus('Preview ready. Check each side, then download your PDF.', 'success');
  } catch (error) {
    if (error.name !== 'AbortError' && version === requestVersion) {
      clearPreview();
      setStatus(error.message, 'error');
    }
  } finally {
    if (version === requestVersion) previewButton.disabled = false;
  }
}

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  if (file) analyzeFile(file);
});

document.querySelector('#remove-file').addEventListener('click', resetSelection);
layoutSelect.addEventListener('change', () => {
  requestVersion += 1;
  activeController?.abort();
  previewButton.disabled = false;
  clearPreview();
  if (selectedFile && analysis) setStatus('Layout changed. Make a new preview to see it.', 'success');
});
orientationSelect.addEventListener('change', () => {
  if (selectedFile) analyzeFile(selectedFile, layoutSelect.value);
});
previewButton.addEventListener('click', makePreview);

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
}
dropZone.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  if (file) analyzeFile(file);
});
window.addEventListener('beforeunload', () => {
  activeController?.abort();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
