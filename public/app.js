import { parseSocialUrl } from './links.js';

const $ = (id) => document.getElementById(id);
const form = $('download-form');
const urlInput = $('media-url');
const detectedLabel = $('detected-label');
const button = $('submit-button');
const messageArea = $('message-area');
const results = $('results');
const themeButton = $('theme-toggle');
let busy = false;

const prettyPlatform = { instagram: 'Instagram', facebook: 'Facebook' };
const prettyType = { reel: 'Reel', video: 'Video', profile: 'Profile picture', photo: 'Photo post' };

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function detect() {
  messageArea.hidden = true;
  const input = urlInput.value.trim();
  if (!input) {
    detectedLabel.className = 'detected-label';
    detectedLabel.replaceChildren(Object.assign(document.createElement('span'), { className: 'meta-dot' }), document.createTextNode(' Waiting for your link'));
    return null;
  }
  try {
    const parsed = parseSocialUrl(input);
    detectedLabel.className = `detected-label is-detected is-${parsed.platform}`;
    detectedLabel.replaceChildren(icon(parsed.platform === 'facebook' ? 'fb' : 'insta'),
      document.createTextNode(`${prettyPlatform[parsed.platform]} · ${prettyType[parsed.type]} detected`));
    return parsed;
  } catch {
    detectedLabel.className = 'detected-label is-unknown';
    detectedLabel.replaceChildren(icon('link'), document.createTextNode('Waiting for a supported URL'));
    return null;
  }
}

function showMessage(text) {
  messageArea.hidden = false;
  messageArea.replaceChildren(icon('x'), Object.assign(document.createElement('span'), { textContent: text }));
}

function setBusy(value) {
  busy = value;
  button.disabled = value;
  button.querySelector('span').textContent = value ? 'Finding media...' : 'Get media';
  button.querySelector('svg use').setAttribute('href', value ? '#i-loader' : '#i-arrow-up-right');
  button.classList.toggle('is-loading', value);
  urlInput.disabled = value;
}

function textEl(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
}

function formatSize(bytes) {
  return typeof bytes === 'number' ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;
}

function renderResult(data) {
  results.replaceChildren();
  const head = document.createElement('div');
  head.className = 'results-heading';
  const intro = document.createElement('div');
  intro.append(textEl('span', 'section-kicker', 'YOUR MEDIA IS READY'), textEl('h2', '', data.title || 'Download your media'));
  const badge = textEl('span', 'result-origin', `${prettyPlatform[data.platform] || 'Media'} · ${prettyType[data.type] || 'Post'}`);
  head.append(intro, badge);
  results.append(head);

  if (data.demo) {
    const demoNote = document.createElement('div');
    demoNote.className = 'result-demo-note';
    demoNote.append(icon('spark'), textEl('span', '', 'Sample preview and files only — this is not the content at your pasted URL.'));
    results.append(demoNote);
  }

  const grid = document.createElement('div');
  grid.className = 'result-grid';
  for (const [index, item] of data.items.entries()) {
    const card = document.createElement('article');
    card.className = 'result-card';
    const media = document.createElement('div');
    media.className = `result-media ${item.kind === 'video' ? 'video-media' : 'image-media'}`;
    const preview = document.createElement('img');
    preview.src = item.previewUrl;
    preview.alt = item.kind === 'video' ? 'Video thumbnail' : 'Photo preview';
    preview.loading = 'lazy';
    preview.addEventListener('error', () => {
      preview.hidden = true;
      media.classList.add('broken-preview');
      media.append(icon('image'));
    }, { once: true });
    media.append(preview);
    if (item.kind === 'video') {
      const play = document.createElement('span');
      play.className = 'result-play';
      play.append(icon('play'));
      media.append(play);
    }
    media.append(textEl('span', 'media-index', `${item.kind === 'video' ? 'VIDEO' : 'IMAGE'} ${index + 1}`));

    const details = document.createElement('div');
    details.className = 'result-details';
    details.append(textEl('span', 'result-small-label', 'READY TO DOWNLOAD'));
    details.append(textEl('h3', '', item.kind === 'video' ? 'Choose video quality' : 'Save original image'));
    details.append(textEl('p', '', item.kind === 'video'
      ? 'Select one of the available resolutions below.'
      : 'Download the best available image resolution.'));
    const downloads = document.createElement('div');
    downloads.className = 'download-options';
    for (const variant of item.variants) {
      const anchor = document.createElement('a');
      anchor.className = 'download-option';
      // Never interpolate provider HTML: only use same-origin tokenized routes.
      if (typeof variant.downloadUrl !== 'string' || !variant.downloadUrl.startsWith('/api/download/')) continue;
      anchor.href = variant.downloadUrl;
      anchor.append(icon('arrow-down'));
      const label = document.createElement('span');
      label.append(textEl('strong', '', variant.label || 'Download'));
      const size = formatSize(variant.sizeBytes);
      if (size) label.append(textEl('small', '', size));
      anchor.append(label, icon('arrow-up-right', 'option-arrow'));
      downloads.append(anchor);
    }
    if (!downloads.children.length) downloads.append(textEl('p', '', 'No download links available.'));
    details.append(downloads);
    card.append(media, details);
    grid.append(card);
  }
  results.append(grid);
  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  messageArea.hidden = true;
  results.hidden = true;
  let parsed;
  try { parsed = parseSocialUrl(urlInput.value); }
  catch (error) { showMessage(error.message); urlInput.focus(); return; }
  setBusy(true);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    let response;
    try {
      response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parsed.normalizedUrl }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to fetch this media.');
    if (!Array.isArray(data.items) || !data.items.length) throw new Error('No downloadable media was found.');
    renderResult(data);
  } catch (error) {
    showMessage(error.name === 'AbortError'
      ? 'The request took too long. Please try again.'
      : error.message || 'Something went wrong. Please try again.');
  } finally { setBusy(false); }
});

urlInput.addEventListener('input', detect);
$('paste-button').addEventListener('click', async () => {
  try {
    const link = await navigator.clipboard.readText();
    urlInput.value = link;
    detect();
    urlInput.focus();
  } catch {
    urlInput.focus();
    showMessage('Browser paste access is unavailable. Paste your link using Ctrl+V or the keyboard paste option.');
  }
});

const matchSystemTheme = window.matchMedia?.('(prefers-color-scheme: light)').matches;
if (matchSystemTheme) document.documentElement.dataset.theme = 'light';
function updateThemeButton() {
  const light = document.documentElement.dataset.theme === 'light';
  themeButton.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  themeButton.setAttribute('aria-pressed', String(light));
}
updateThemeButton();
themeButton.addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  updateThemeButton();
});

fetch('/api/config').then((response) => response.json()).then((data) => {
  if (data.demo) {
    $('demo-banner').hidden = false;
    $('demo-examples').hidden = false;
  }
}).catch(() => showMessage('Could not contact the local server. Refresh the page and try again.'));

document.querySelectorAll('[data-example]').forEach((sample) => {
  sample.addEventListener('click', () => {
    urlInput.value = sample.dataset.example;
    detect();
    urlInput.focus();
    document.getElementById('tool-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
