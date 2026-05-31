let currentTheme = 'dark';
let rendered = false;

// Set initial theme class on body
document.body.classList.add('theme-dark');

// Initialize Mermaid with standard parameters
mermaid.initialize({ startOnLoad: false, theme: currentTheme, securityLevel: 'loose', suppressErrorRendering: true });

function changeTheme() {
  currentTheme = document.getElementById('themeSelect').value;
  
  // Remove all theme classes first
  document.body.classList.remove('theme-dark', 'theme-default', 'theme-forest', 'theme-neutral', 'theme-base');
  
  // Add selected theme class
  document.body.classList.add('theme-' + currentTheme);

  mermaid.initialize({ startOnLoad: false, theme: currentTheme, securityLevel: 'loose', suppressErrorRendering: true });
  if (rendered) renderDiagram();
  saveState();
}

function handleTab(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + 2;
  }
  if (e.ctrlKey && e.key === 'Enter') renderDiagram();
}

async function renderDiagram() {
  const code = document.getElementById('codeEditor').value.trim();
  const output = document.getElementById('mermaid-output');

  if (!code) {
    output.innerHTML = `<div class="placeholder"><div class="icon">⬡</div><p>Nothing to render</p></div>`;
    setStatus('idle', 'Empty input');
    return;
  }

  // Dynamically prepend frontmatter configuration to override theme cached settings
  let codeWithTheme = code;
  if (!code.startsWith('---')) {
    codeWithTheme = `---\nconfig:\n  theme: ${currentTheme}\n---\n${code}`;
  } else {
    // If it already has frontmatter, inject theme config into it
    if (!code.includes('theme:')) {
      codeWithTheme = code.replace('---\n', `---\nconfig:\n  theme: ${currentTheme}\n`);
    }
  }

  try {
    const id = 'mermaid-' + Date.now();
    const { svg } = await mermaid.render(id, codeWithTheme);
    output.innerHTML = svg;
    rendered = true;
    resetZoom(); // Reset zoom state on new render
    document.getElementById('exportDropdownBtn').disabled = false;
    document.getElementById('previewTag').textContent = 'rendered';
    setStatus('ok', 'Diagram rendered successfully');
    document.getElementById('errorBanner').style.display = 'none'; // Hide error banner
    saveState();
  } catch (err) {
    // Show error banner and display compiler error message dynamically
    const banner = document.getElementById('errorBanner');
    const bannerText = document.getElementById('errorBannerText');
    bannerText.textContent = `⚠ Syntax Error: ${err.message.substring(0, 120)}`;
    banner.style.display = 'flex';

    rendered = false;
    document.getElementById('exportDropdownBtn').disabled = true;
    document.getElementById('previewTag').textContent = 'error';
    setStatus('err', 'Syntax error in diagram');
  }
}

function exportSVG() {
  const svg = document.querySelector('#mermaid-output svg');
  if (!svg) return;
  const svgData = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // Retrieve custom filename and sanitize it
  const filenameInput = document.getElementById('filenameInput').value.trim();
  const filename = filenameInput ? filenameInput.replace(/[\/\\?%*:|"<>]/g, '') : 'diagram';

  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.svg';
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ SVG exported!');
}

function exportPNG() {
  const svg = document.querySelector('#mermaid-output svg');
  if (!svg) return;

  // Get actual dimensions
  const viewBox = svg.viewBox && svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const width = (viewBox && viewBox.width) || rect.width || svg.clientWidth || 800;
  const height = (viewBox && viewBox.height) || rect.height || svg.clientHeight || 600;

  // Clone SVG to modify size attributes locally
  const svgClone = svg.cloneNode(true);
  svgClone.setAttribute('width', width);
  svgClone.setAttribute('height', height);
  svgClone.style.width = width + 'px';
  svgClone.style.height = height + 'px';

  // Critical fix: Remove any external style links/imports inside SVG to prevent canvas tainting
  const styles = svgClone.querySelectorAll('style');
  styles.forEach(style => {
    // If the style element imports external fonts, strip the @import statement
    let content = style.innerHTML;
    if (content.includes('@import')) {
      content = content.replace(/@import\s+url\([^)]+\);?/gi, '');
      style.innerHTML = content;
    }
  });

  const svgData = new XMLSerializer().serializeToString(svgClone);
  
  // Use Base64 Data URL instead of Blob URL to circumvent local file protocol (file://) canvas tainting
  let dataUrl;
  try {
    const base64 = btoa(unescape(encodeURIComponent(svgData)));
    dataUrl = 'data:image/svg+xml;base64,' + base64;
  } catch (err) {
    console.error('Base64 serialization failed, falling back to Blob:', err);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    dataUrl = URL.createObjectURL(svgBlob);
  }

  const img = new Image();
  img.onload = function () {
    const scale = 3; // 3x scale for high resolution print
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');

    // Fill with solid white background (otherwise it exports transparent/black)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    // Clean up if it was a Blob URL
    if (dataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(dataUrl);
    }

    try {
      // Retrieve custom filename and sanitize it
      const filenameInput = document.getElementById('filenameInput').value.trim();
      const filename = filenameInput ? filenameInput.replace(/[\/\\?%*:|"<>]/g, '') : 'diagram';

      const a = document.createElement('a');
      a.download = filename + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      showToast('✓ PNG exported (3x resolution)!');
    } catch (err) {
      console.error('Canvas export failed:', err);
      // Fallback hint to user if canvas is tainted by browser local file policy
      showToast('✕ Security restriction: Run editor via web server, or use SVG instead.', 'err');
    }
  };

  img.onerror = function (err) {
    console.error('Image rendering failed:', err);
    showToast('✕ PNG export failed: image load error', 'err');
  };

  img.src = dataUrl;
}

function clearEditor() {
  document.getElementById('codeEditor').value = '';
  document.getElementById('filenameInput').value = ''; // Clear filename input
  document.getElementById('mermaid-output').innerHTML = `
    <div class="placeholder">
      <div class="icon">⬡</div>
      <p>Your diagram will appear here</p>
      <small>Press ▶ Render or Ctrl+Enter</small>
    </div>`;
  rendered = false;
  document.getElementById('exportDropdownBtn').disabled = true;
  document.getElementById('previewTag').textContent = 'ready';
  setStatus('idle', 'Cleared');
  document.getElementById('errorBanner').style.display = 'none'; // Hide error banner on clear
  resetZoom(); // Reset zoom state on clear
  saveState(); // Save state on clear
}

function setStatus(type, msg) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.className = 'status-dot ' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : '');
  text.textContent = msg;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// --- ZOOM & PAN FUNCTIONALITY ---
let zoomScale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;

function applyTransform() {
  const container = document.getElementById('mermaid-output');
  if (container) {
    container.style.transformOrigin = 'center center';
    container.style.transition = 'transform 0.1s ease-out';
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  }
}

function zoomIn() {
  if (!rendered) return;
  zoomScale = Math.min(zoomScale + 0.15, 5);
  applyTransform();
}

// --- TEMPLATES LIBRARY ---
function loadTemplate() {
  const template = document.getElementById('templateSelect').value;
  if (!template) return;
  
  const templates = {
    flowchart: `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Success]
    B -->|No| D[End]`,
    
    sequence: `sequenceDiagram
    autonumber
    Alice->>Bob: Hello Bob, how are you?
    alt is good
        Bob-->>Alice: I am good thanks!
    else is bad
        Bob-->>Alice: Not so good
    end`,
    
    state: `stateDiagram-v2
    [*] --> Idle
    Idle --> Moving : Action
    Moving --> Idle : Stop
    Moving --> [*] : Shutdown`,
    
    class: `classDiagram
    class Animal {
        +String name
        +isMammal() bool
    }
    class Duck {
        +String swimSpeed
        +quack()
    }
    Animal <|-- Duck`,
    
    gantt: `gantt
    title A Gantt Chart
    dateFormat YYYY-MM-DD
    section Section
    A task :a1, 2026-05-01, 30d
    Another task :after a1, 20d`
  };
  
  const code = templates[template];
  if (code) {
    document.getElementById('codeEditor').value = code;
    renderDiagram();
    // Reset dropdown selection
    document.getElementById('templateSelect').value = '';
  }
}

// --- STATE AUTO-SAVE & AUTO-RECOVERY ---
function saveState() {
  const code = document.getElementById('codeEditor').value;
  const filename = document.getElementById('filenameInput').value;
  const theme = document.getElementById('themeSelect').value;
  const autoRender = document.getElementById('autoRenderToggle').checked;
  
  localStorage.setItem('mermaid_editor_code', code);
  localStorage.setItem('mermaid_editor_filename', filename);
  localStorage.setItem('mermaid_editor_theme', theme);
  localStorage.setItem('mermaid_editor_autorender', autoRender);
}

function loadSavedState() {
  const code = localStorage.getItem('mermaid_editor_code');
  const filename = localStorage.getItem('mermaid_editor_filename');
  const theme = localStorage.getItem('mermaid_editor_theme');
  const autoRender = localStorage.getItem('mermaid_editor_autorender');
  
  if (code !== null) {
    document.getElementById('codeEditor').value = code;
  }
  if (filename !== null) {
    document.getElementById('filenameInput').value = filename;
  }
  if (theme !== null) {
    document.getElementById('themeSelect').value = theme;
    currentTheme = theme;
    
    // Clear and apply body theme class
    document.body.className = '';
    document.body.classList.add('theme-' + theme);
    mermaid.initialize({ startOnLoad: false, theme: theme, securityLevel: 'loose', suppressErrorRendering: true });
  }
  if (autoRender !== null) {
    document.getElementById('autoRenderToggle').checked = autoRender === 'true';
  }
  
  if (document.getElementById('codeEditor').value.trim()) {
    renderDiagram();
  }
}

// --- CLIPBOARD ACTIONS ---
function copyCode() {
  const code = document.getElementById('codeEditor').value;
  if (!code) {
    showToast('✕ No code to copy', 'error');
    return;
  }
  navigator.clipboard.writeText(code).then(() => {
    showToast('✓ Code copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy code:', err);
    showToast('✕ Copy failed', 'error');
  });
}

function copySVG() {
  const svg = document.querySelector('#mermaid-output svg');
  if (!svg) {
    showToast('✕ No SVG to copy', 'error');
    return;
  }
  const svgData = new XMLSerializer().serializeToString(svg);
  navigator.clipboard.writeText(svgData).then(() => {
    showToast('✓ SVG code copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy SVG:', err);
    showToast('✕ Copy failed', 'error');
  });
}

function zoomOut() {
  if (!rendered) return;
  zoomScale = Math.max(zoomScale - 0.15, 0.15);
  applyTransform();
}

function resetZoom() {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  applyTransform();
}

// Attach Event Listeners for Panning and Scrolling
const previewArea = document.querySelector('.preview-area');

// Wheel Event for Zooming
previewArea.addEventListener('wheel', (e) => {
  if (!rendered) return;
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
  const newScale = zoomScale * zoomFactor;
  if (newScale >= 0.15 && newScale <= 5) {
    zoomScale = newScale;
    applyTransform();
  }
}, { passive: false });

// Mouse Events for Panning
previewArea.addEventListener('mousedown', (e) => {
  if (!rendered) return;
  if (e.target.closest('.zoom-controls') || e.target.closest('.copy-controls') || e.target.closest('button')) return;
  
  isPanning = true;
  previewArea.classList.add('grabbing');
  startX = e.clientX - panX;
  startY = e.clientY - panY;
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    previewArea.classList.remove('grabbing');
  }
});

// --- INITIALIZE STARTUP LISTENERS ---
let autoRenderTimer;
document.getElementById('codeEditor').addEventListener('input', () => {
  saveState();
  const isAuto = document.getElementById('autoRenderToggle').checked;
  if (isAuto) {
    clearTimeout(autoRenderTimer);
    autoRenderTimer = setTimeout(() => {
      renderDiagram();
    }, 600);
  }
});

document.getElementById('filenameInput').addEventListener('input', saveState);
document.getElementById('autoRenderToggle').addEventListener('change', saveState);

// Load state when page boots
loadSavedState();

function dismissError() {
  document.getElementById('errorBanner').style.display = 'none';
}

// --- EXPORT DROPDOWN MENU HANDLERS ---
function toggleExportMenu(e) {
  if (e) {
    e.stopPropagation();
  }
  const menu = document.getElementById('exportMenu');
  if (menu) {
    menu.classList.toggle('show');
  }
}

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
  const menu = document.getElementById('exportMenu');
  if (menu && menu.classList.contains('show')) {
    if (!e.target.closest('.dropdown')) {
      menu.classList.remove('show');
    }
  }
});

// --- MOBILE CONTROLS MENU TOGGLE ---
function toggleMobileControls() {
  const groups = document.querySelector('.header-groups');
  const btn = document.getElementById('mobileControlsBtn');
  if (groups) {
    const isShowing = groups.classList.toggle('show');
    if (btn) {
      btn.textContent = isShowing ? '✕ Close' : '⚙ Menu';
      btn.className = isShowing ? 'btn btn-mobile-toggle btn-clear' : 'btn btn-ghost btn-mobile-toggle';
    }
  }
}
