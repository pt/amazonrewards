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
        }, () => {
          // Set badge with rounded dollar amount
          const total = entries.reduce((sum, entry) => sum + parseFloat(entry.amount), 0);
          let badgeText = '';
          if (total > 0) {
            const dollars = Math.floor(total);
            const cents = total - dollars;
            badgeText = cents >= 0.5 ? String(dollars + 1) : String(dollars);
          }
          chrome.action.setBadgeText({ text: "$" + badgeText });

          // Badge color logic based on soonest expiration
          let badgeColor = '#4CAF50'; // Default green
          if (entries.length > 0) {
            const soonest = entries.reduce((min, entry) => {
              const d = new Date(entry.expiryDate);
              return (!min || d < min) ? d : min;
            }, null);
            if (soonest) {
              const nowDate = new Date();
              const days = Math.ceil((soonest - nowDate) / (1000 * 60 * 60 * 24));
              if (days < 15) {
                badgeColor = '#D32F2F'; // Red
              } else if (days < 31) {
                badgeColor = '#FFD600'; // Yellow
              } else {
                badgeColor = '#4CAF50'; // Green
              }
            }
          }
          chrome.action.setBadgeBackgroundColor({ color: badgeColor });
          resolve(entries);
        });
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