const MAX_FILE_BYTES = 50 * 1024 * 1024;
const fileInput = document.querySelector('#pdf-file');
const dropZone = document.querySelector('#drop-zone');
const fileSummary = document.querySelector('#file-summary');
const fileName = document.querySelector('#file-name');
const uploadTitle = document.querySelector('#upload-title');
const uploadSubtitle = document.querySelector('#upload-subtitle');
const layoutSelect = document.querySelector('#layout-select');
const previewButton = document.querySelector('#preview-button');
const statusMessage = document.querySelector('#status');
const recommendation = document.querySelector('#recommendation');
const recommendationText = document.querySelector('#recommendation-text');
const previewEmpty = document.querySelector('#preview-empty');
const previewFrame = document.querySelector('#preview-frame');
const preview = document.querySelector('#pdf-preview');
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

function setStatus(message, state = '') {
  statusMessage.textContent = message;
  statusMessage.dataset.state = state;
}

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  preview.removeAttribute('src');
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

async function analyzeFile(file) {
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
    const response = await fetch('/api/analyze', {
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
    for (const candidate of result.candidates) {
      const value = `${candidate.columns}x${candidate.rows}`;
      const isRecommended = value === suggested;
      const option = new Option(formatLayout(candidate, isRecommended).label, value, false, isRecommended);
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
    const response = await fetch(`/api/preview?columns=${columns}&rows=${rows}`, {
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
    preview.src = previewUrl;
    previewFrame.hidden = false;
    previewEmpty.hidden = true;
    previewFooter.hidden = false;
    paperTag.hidden = false;
    previewTitle.textContent = `${columns} × ${rows} layout`;
    const sheets = Number(response.headers.get('X-Paper-Sheets'));
    const blanks = Number(response.headers.get('X-Blank-Slots'));
    const outputPages = Number(response.headers.get('X-Output-Pages'));
    outputSummary.textContent = `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'} · ${outputPages} printed sides · ${blanks} ${blanks === 1 ? 'blank slot' : 'blank slots'}`;

    const baseName = selectedFile.name.replace(/\.pdf$/i, '') || 'pamphlet';
    downloadButton.href = previewUrl;
    downloadButton.download = `${baseName}-pamphlet.pdf`;
    setStatus('Preview ready. Check both sides, then download your PDF.', 'success');
  } catch (error) {
    if (error.name !== 'AbortError' && version === requestVersion) setStatus(error.message, 'error');
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
