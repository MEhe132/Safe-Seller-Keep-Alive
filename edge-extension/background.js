const ALARM_NAME = 'safe-keepalive-alarm';

const DEFAULT_STATE = {
  isRunning: false,
  minSec: 600,
  maxSec: 1000,
  maxHours: 8,
  urls: [
    'https://www.g2g.com/offers/list',
    'https://www.u7buy.com/member/chat'
  ],
  startedAt: null,
  nextRunTime: null,
  refreshCount: 0,
  statusText: 'Stopped',
  pauseReason: '',
  logs: []
};

function getRandomInt(min, max) {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function getTimeString() {
  return new Date().toLocaleTimeString();
}

async function appendLog(message) {
  try {
    const { logs = [] } = await chrome.storage.local.get('logs');
    const updated = [`[${getTimeString()}] ${message}`, ...logs].slice(0, 30);
    await chrome.storage.local.set({ logs: updated });
  } catch (err) {
    console.error('Failed to append log:', err);
  }
}

function isSecurityOrLogoutScreen(tab, targetUrl) {
  const title = (tab.title || '').toLowerCase();
  const currentUrl = (tab.url || '').toLowerCase();
  const desiredUrl = (targetUrl || '').toLowerCase();

  const challengeKeywords = [
    'just a moment',
    'attention required',
    'cloudflare',
    'verify you are human',
    'access denied',
    'security check',
    'ddos-guard'
  ];

  for (const kw of challengeKeywords) {
    if (title.includes(kw)) {
      return `Security/Cloudflare check detected ("${tab.title}")`;
    }
  }

  const isTargetLogin = desiredUrl.includes('login') || desiredUrl.includes('signin');
  const isCurrentLogin =
    currentUrl.includes('/login') ||
    currentUrl.includes('/sign-in') ||
    currentUrl.includes('/signin') ||
    currentUrl.includes('passport.');

  if (!isTargetLogin && isCurrentLogin) {
    return `Session logged out (redirected to ${tab.url})`;
  }

  return null;
}

async function updateBadge(state, isWarning = false) {
  try {
    if (isWarning) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#DC2626' });
    } else if (state) {
      await chrome.action.setBadgeText({ text: 'ON' });
      await chrome.action.setBadgeBackgroundColor({ color: '#16A34A' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('Failed to update badge:', err);
  }
}

async function stopRunner(reason = 'Stopped by user', isWarning = false) {
  try {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.storage.local.set({
      isRunning: false,
      nextRunTime: null,
      statusText: reason,
      pauseReason: isWarning ? reason : ''
    });
    await updateBadge(false, isWarning);
    await appendLog(reason);
  } catch (err) {
    console.error('Error stopping runner:', err);
  }
}

async function scheduleNextAlarm() {
  try {
    const data = await chrome.storage.local.get(DEFAULT_STATE);
    if (!data.isRunning) return;

    if (data.maxHours > 0 && data.startedAt) {
      const elapsedHours = (Date.now() - data.startedAt) / (1000 * 60 * 60);
      if (elapsedHours >= data.maxHours) {
        await stopRunner(`Auto-stopped after ${data.maxHours}h limit (human sleep safeguard)`, false);
        return;
      }
    }

    const delaySec = getRandomInt(data.minSec, data.maxSec);
    const nextRunTime = Date.now() + delaySec * 1000;

    await chrome.alarms.create(ALARM_NAME, { when: nextRunTime });
    await chrome.storage.local.set({
      nextRunTime,
      statusText: `Running (Next in ${delaySec}s)`
    });
    await appendLog(`Next refresh scheduled in ${delaySec}s (range ${data.minSec}s–${data.maxSec}s)`);
  } catch (err) {
    console.error('Error scheduling alarm:', err);
  }
}

function getBaseDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}

async function executeRefreshCycle(isManualTest = false) {
  try {
    const data = await chrome.storage.local.get(DEFAULT_STATE);
    const validUrls = (data.urls || [])
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http://') || u.startsWith('https://'));

    if (validUrls.length === 0) {
      await stopRunner('Stopped: No valid URLs configured', true);
      return { ok: false, error: 'No valid URLs configured' };
    }

    const urlsByDomain = {};
    for (const urlStr of validUrls) {
      try {
        const parsed = new URL(urlStr);
        const baseDomain = getBaseDomain(parsed.hostname);
        if (!urlsByDomain[baseDomain]) {
          urlsByDomain[baseDomain] = [];
        }
        urlsByDomain[baseDomain].push(urlStr);
      } catch {
        // Ignore malformed URL
      }
    }

    const allTabs = await chrome.tabs.query({});
    let refreshedDomains = 0;

    for (const [baseDomain, domainUrls] of Object.entries(urlsByDomain)) {
      const pickedUrl = domainUrls[getRandomInt(0, domainUrls.length - 1)];

      const matchingTabs = allTabs.filter((t) => {
        if (!t.url) return false;
        try {
          const tabHost = new URL(t.url).hostname;
          return getBaseDomain(tabHost) === baseDomain;
        } catch {
          return false;
        }
      });

      if (matchingTabs.length > 0) {
        const targetTab = matchingTabs[0];

        const dangerReason = isSecurityOrLogoutScreen(targetTab, pickedUrl);
        if (dangerReason) {
          await stopRunner(`Auto-Paused (${baseDomain}): ${dangerReason}`, true);
          return { ok: false, error: dangerReason };
        }

        if (targetTab.url === pickedUrl) {
          await chrome.tabs.reload(targetTab.id);
          await appendLog(`Reloaded ${baseDomain} tab (#${targetTab.id})`);
        } else {
          await chrome.tabs.update(targetTab.id, { url: pickedUrl });
          await appendLog(`Updated ${baseDomain} tab (#${targetTab.id}) -> ${pickedUrl}`);
        }
        refreshedDomains++;
      } else {
        const createdTab = await chrome.tabs.create({
          url: pickedUrl,
          active: false,
          pinned: true
        });
        await appendLog(`Opened initial background tab (#${createdTab.id}) for ${baseDomain}`);
        refreshedDomains++;
      }
    }

    const newCount = (data.refreshCount || 0) + 1;
    await chrome.storage.local.set({ refreshCount: newCount });

    if (!isManualTest && data.isRunning) {
      await scheduleNextAlarm();
    }

    return { ok: true, refreshedDomains };
  } catch (err) {
    console.error('Error during refresh cycle:', err);
    await appendLog(`Error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Force-update old 300-600 storage values to 600-1000 on install OR reload
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason === 'install') {
      await chrome.storage.local.set(DEFAULT_STATE);
      await appendLog('Extension installed (600s–1000s default).');
    } else {
      const current = await chrome.storage.local.get(DEFAULT_STATE);
      if (current.minSec === 300 && current.maxSec === 600) {
        await chrome.storage.local.set({ minSec: 600, maxSec: 1000 });
        await appendLog('Updated timer default to 600s–1000s.');
      }
    }
  } catch (err) {
    console.error('onInstalled error:', err);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name !== ALARM_NAME) return;
    const { isRunning } = await chrome.storage.local.get('isRunning');
    if (!isRunning) return;
    await executeRefreshCycle(false);
  } catch (err) {
    console.error('onAlarm error:', err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'START') {
        const { minSec, maxSec, maxHours, urls } = message.payload;
        await chrome.storage.local.set({
          isRunning: true,
          minSec,
          maxSec,
          maxHours,
          urls,
          startedAt: Date.now(),
          pauseReason: ''
        });
        await updateBadge(true, false);
        await appendLog(`Started Auto Mode (Interval: ${minSec}s–${maxSec}s)`);
        const res = await executeRefreshCycle(false);
        sendResponse(res);
      } else if (message.type === 'STOP') {
        await stopRunner('Stopped by user', false);
        sendResponse({ ok: true });
      } else if (message.type === 'SET_PRESET') {
        const { minSec, maxSec, label } = message.payload;
        const { isRunning } = await chrome.storage.local.get('isRunning');
        await chrome.storage.local.set({ minSec, maxSec });
        await appendLog(`Switched preset: ${label} (${minSec}s–${maxSec}s)`);
        if (isRunning) {
          await scheduleNextAlarm();
        }
        sendResponse({ ok: true });
      } else if (message.type === 'TEST_NOW') {
        const { minSec, maxSec, maxHours, urls } = message.payload;
        await chrome.storage.local.set({ minSec, maxSec, maxHours, urls });
        await appendLog('Manual test refresh triggered');
        const res = await executeRefreshCycle(true);
        sendResponse(res);
      } else if (message.type === 'CLEAR_LOGS') {
        await chrome.storage.local.set({ logs: [], refreshCount: 0 });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('onMessage error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});
