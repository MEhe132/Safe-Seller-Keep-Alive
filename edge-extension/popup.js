const DEFAULT_URLS = [
  'https://www.g2g.com/offers/list',
  'https://www.u7buy.com/member/chat'
];

let cachedState = {
  isRunning: false,
  nextRunTime: null
};

function getFormValues() {
  const urlsText = document.getElementById('urlsInput').value;
  const urls = urlsText
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);

  const minSec = Math.max(5, parseInt(document.getElementById('minSecInput').value, 10) || 600);
  const maxSec = Math.max(minSec, parseInt(document.getElementById('maxSecInput').value, 10) || 1000);
  const maxHours = Math.max(0, parseFloat(document.getElementById('maxHoursInput').value) || 0);

  return { urls, minSec, maxSec, maxHours };
}

function updatePresetHighlight(minSec, maxSec) {
  const btnSafe = document.getElementById('btnSafePreset');
  const btnTest = document.getElementById('btnTestPreset');

  btnSafe.className = 'btn-preset';
  btnTest.className = 'btn-preset';

  if (Number(minSec) === 600 && Number(maxSec) === 1000) {
    btnSafe.className = 'btn-preset active-safe';
  } else if (Number(minSec) === 10 && Number(maxSec) === 15) {
    btnTest.className = 'btn-preset active-test';
  }
}

function renderLogs(logs = []) {
  const logBox = document.getElementById('logBox');
  logBox.textContent = '';

  if (logs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'log-entry';
    empty.textContent = 'No activity yet. Click "⚡ Test 1 Refresh Now" or "▶ Start Auto".';
    logBox.appendChild(empty);
    return;
  }

  for (const item of logs) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = item;
    logBox.appendChild(div);
  }
}

function updateCountdownDisplay() {
  const countdownEl = document.getElementById('countdownText');
  if (!cachedState.isRunning || !cachedState.nextRunTime) {
    countdownEl.textContent = 'Not scheduled';
    return;
  }

  const remainingSec = Math.max(0, Math.ceil((cachedState.nextRunTime - Date.now()) / 1000));
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  countdownEl.textContent = mins > 0 ? `${mins}m ${secs}s (${remainingSec}s)` : `${remainingSec}s`;
}

async function refreshUIFromStorage(populateInputs = false) {
  try {
    const data = await chrome.storage.local.get({
      isRunning: false,
      minSec: 600,
      maxSec: 1000,
      maxHours: 8,
      urls: DEFAULT_URLS,
      nextRunTime: null,
      refreshCount: 0,
      pauseReason: '',
      logs: []
    });

    // Automatically upgrade legacy 300/600 stored settings to 600/1000
    if (data.minSec === 300 && data.maxSec === 600) {
      data.minSec = 600;
      data.maxSec = 1000;
      await chrome.storage.local.set({ minSec: 600, maxSec: 1000 });
    }

    cachedState.isRunning = data.isRunning;
    cachedState.nextRunTime = data.nextRunTime;

    if (populateInputs) {
      document.getElementById('urlsInput').value = (data.urls || DEFAULT_URLS).join('\n');
      document.getElementById('minSecInput').value = data.minSec;
      document.getElementById('maxSecInput').value = data.maxSec;
      document.getElementById('maxHoursInput').value = data.maxHours;
    }

    updatePresetHighlight(
      document.getElementById('minSecInput').value,
      document.getElementById('maxSecInput').value
    );

    const badge = document.getElementById('stateBadge');
    const btnToggle = document.getElementById('btnToggle');
    const warningBanner = document.getElementById('warningBanner');

    if (data.pauseReason) {
      warningBanner.style.display = 'block';
      warningBanner.textContent = `⚠️ ${data.pauseReason}`;
      badge.textContent = 'AUTO-PAUSED';
      badge.className = 'badge paused';
    } else {
      warningBanner.style.display = 'none';
      if (data.isRunning) {
        badge.textContent = 'RUNNING';
        badge.className = 'badge running';
      } else {
        badge.textContent = 'STOPPED';
        badge.className = 'badge';
      }
    }

    if (data.isRunning) {
      btnToggle.textContent = '⏹ Stop Auto';
      btnToggle.className = 'primary btn-stop';
    } else {
      btnToggle.textContent = '▶ Start Auto';
      btnToggle.className = 'primary btn-start';
    }

    document.getElementById('cycleCount').textContent = String(data.refreshCount || 0);
    updateCountdownDisplay();
    renderLogs(data.logs || []);
  } catch (err) {
    console.error('Failed to load UI state:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await refreshUIFromStorage(true);

  setInterval(updateCountdownDisplay, 1000);

  chrome.storage.onChanged.addListener(async () => {
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnTestPreset').addEventListener('click', async () => {
    document.getElementById('minSecInput').value = 10;
    document.getElementById('maxSecInput').value = 15;
    updatePresetHighlight(10, 15);
    await chrome.runtime.sendMessage({
      type: 'SET_PRESET',
      payload: { minSec: 10, maxSec: 15, label: 'Quick Test Mode' }
    });
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnSafePreset').addEventListener('click', async () => {
    document.getElementById('minSecInput').value = 600;
    document.getElementById('maxSecInput').value = 1000;
    updatePresetHighlight(600, 1000);
    await chrome.runtime.sendMessage({
      type: 'SET_PRESET',
      payload: { minSec: 600, maxSec: 1000, label: 'Safe Mode' }
    });
    await refreshUIFromStorage(false);
  });

  document.getElementById('minSecInput').addEventListener('input', () => {
    updatePresetHighlight(
      document.getElementById('minSecInput').value,
      document.getElementById('maxSecInput').value
    );
  });

  document.getElementById('maxSecInput').addEventListener('input', () => {
    updatePresetHighlight(
      document.getElementById('minSecInput').value,
      document.getElementById('maxSecInput').value
    );
  });

  document.getElementById('btnToggle').addEventListener('click', async () => {
    const payload = getFormValues();
    if (cachedState.isRunning) {
      await chrome.runtime.sendMessage({ type: 'STOP' });
    } else {
      await chrome.runtime.sendMessage({ type: 'START', payload });
    }
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnTestNow').addEventListener('click', async () => {
    const payload = getFormValues();
    await chrome.runtime.sendMessage({ type: 'TEST_NOW', payload });
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnClearLogs').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    await refreshUIFromStorage(false);
  });
});
