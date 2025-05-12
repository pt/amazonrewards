// Background service worker

const AMAZON_CREDITS_URL = 'https://www.amazon.com/norushcredits';

async function fetchWithCookies(url) {
  try {
    // Get all cookies for amazon.com domain
    const amazonCookies = await chrome.cookies.getAll({ domain: '.amazon.com' });
    const wwwCookies = await chrome.cookies.getAll({ domain: 'www.amazon.com' });
    const cookies = [...amazonCookies, ...wwwCookies];
    
    // Important cookies to check if logged in
    const sessionCookie = cookies.find(c => c.name === 'session-id');
    const atCookie = cookies.find(c => c.name === 'at-main');
    
    if (!sessionCookie || !atCookie) {
      return null;
    }
    
    // Format cookies for the header
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // Make the fetch request with cookies
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.amazon.com/',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin'
      },
      credentials: 'include'
    });
    
    if (!response.ok) {
      return null;
    }
    
    const html = await response.text();
    
    // Quick check if we got a useful page
    const loggedIn = !html.includes('Sign-In') && !html.includes('sign-in');
    const hasCreditsContent = html.includes('rewards') || html.includes('credits');
    
    if (!loggedIn || !hasCreditsContent) {
      return null;
    }
    
    return html;
  } catch (error) {
    return null;
  }
}

async function parseCreditsFromHTML(html) {
  try {
    // Create a parser
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Convert to text for regex matching
    const pageText = doc.body.innerText || doc.body.textContent || '';
    
    // Find all credit entries
    const rewardRegex = /\$(\d+\.\d{2})\s+expires? on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi;
    const entries = [];
    let match;
    
    while ((match = rewardRegex.exec(pageText)) !== null) {
      const date = new Date(match[2]);
      if (!isNaN(date)) {
        entries.push({
          amount: match[1],
          expiryDate: date.toISOString(),
          text: match[0]
        });
      }
    }
    
    return entries;
  } catch (error) {
    return [];
  }
}

async function fetchCreditsDirectly() {
  try {
    // Try direct fetch with cookies first
    const html = await fetchWithCookies(AMAZON_CREDITS_URL);
    
    if (!html) {
      return null; // Fall back to tab approach
    }
    
    // Parse credits from HTML
    const entries = await parseCreditsFromHTML(html);
    
    if (entries.length === 0) {
      return null; // Fall back to tab approach
    }
    
    return entries;
  } catch (error) {
    return null; // Fall back to tab approach
  }
}

async function fetchCreditsWithTab() {
  return new Promise((resolve) => {
    // Create tab with as little visibility as possible
    chrome.windows.create({
      url: AMAZON_CREDITS_URL,
      type: 'popup',
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      focused: false
    }, async (window) => {
      const tab = window.tabs[0];
      
      // Allow time for the page to load
      setTimeout(() => {
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
          // Close the window as quickly as possible
          chrome.windows.remove(window.id);
          const entries = results && results[0] && results[0].result ? results[0].result : [];
          resolve(entries);
        });
      }, 3000); // Wait 3 seconds for page to load properly
    });
  });
}

async function fetchCreditsAndStore() {
  try {
    // Try direct fetch first
    let entries = await fetchCreditsDirectly();
    
    // If direct fetch fails, fall back to tab approach
    if (!entries || entries.length === 0) {
      entries = await fetchCreditsWithTab();
    }
    
    // Store fetched entries
    const now = Date.now();
    chrome.storage.local.set({
      credits: entries,
      creditsLastFetched: now
    });
    
    // Update badge
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
    
    return entries;
  } catch (error) {
    return [];
  }
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === 'refreshCreditsNow') {
    fetchCreditsAndStore().then((entries) => sendResponse(entries));
    return true;
  }
}); 