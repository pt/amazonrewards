// Background service worker

const AMAZON_CREDITS_URL = 'https://www.amazon.com/norushcredits';

async function fetchCreditsAndStore() {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: AMAZON_CREDITS_URL, active: false }, async (tab) => {
      // Wait for the page to load and execute script to get credits
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const pageText = document.body.innerText || document.body.textContent || '';
          const rewardRegex = /\$(\d+\.\d{2})\s+expires? on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi;
          const matches = [];
          let match;
          while ((match = rewardRegex.exec(pageText)) !== null) {
            const date = new Date(match[2]);
            if (!isNaN(date)) {
              matches.push({
                amount: match[1],
                expiryDate: date.toISOString(),
                text: match[0]
              });
            }
          }
          return matches;
        }
      }, async (results) => {
        await chrome.tabs.remove(tab.id);
        const entries = results && results[0] && results[0].result ? results[0].result : [];
        const now = Date.now();
        chrome.storage.local.set({
          credits: entries,
          creditsLastFetched: now
        }, () => resolve(entries));
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refreshCredits', { periodInMinutes: 60 });
  fetchCreditsAndStore();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshCredits') {
    fetchCreditsAndStore();
  }
});

// Allow popup.js to request a manual refresh
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === 'refreshCreditsNow') {
    fetchCreditsAndStore().then((entries) => sendResponse(entries));
    return true; // Keep the message channel open for async response
  }
}); 