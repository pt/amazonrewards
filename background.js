// Background service worker

// Configuration for testing
const CONFIG = {
  // Set to true to use test URL instead of Amazon URL
  USE_TEST_URL: false,
  // URL to use for testing (can be a local file:// URL)
  TEST_URL: 'file:///Users/pt/code/amazonrewards/test-data.html',
  // Amazon URL for production use - we'll try multiple URLs
  AMAZON_URL: 'https://www.amazon.com/norushcredits/gcpbal',
  // Alternative URLs to try
  ALTERNATE_URLS: [
    'https://www.amazon.com/norushcredits',
    'https://www.amazon.com/gp/css/gc/balance',
    'https://www.amazon.com/gp/css/account/balance',
    'https://www.amazon.com/cpe/yourpayments/wallet'
  ],
  // Threshold settings for badge colors (in days)
  THRESHOLDS: {
    WARNING: 15,  // Red
    CAUTION: 30   // Yellow
  }
};

// Make CONFIG accessible to popup
self.CONFIG = CONFIG;

// Function to get the appropriate URL based on configuration
function getCreditsUrl() {
  return CONFIG.USE_TEST_URL ? CONFIG.TEST_URL : CONFIG.AMAZON_URL;
}

// Make function available to popup
self.getCreditsUrl = getCreditsUrl;

// Add a simple test function
self.testFunction = function() {
  console.log("Test function called");
  return Promise.resolve("Test successful");
};

// We'll define refreshCredits after fetchCreditsAndStore is defined

async function fetchWithCookies(url) {
  try {
    console.log("Starting fetchWithCookies for URL:", url);
    
    // Get all cookies for amazon.com domain
    const amazonCookies = await chrome.cookies.getAll({ domain: '.amazon.com' });
    const wwwCookies = await chrome.cookies.getAll({ domain: 'www.amazon.com' });
    const cookies = [...amazonCookies, ...wwwCookies];
    
    console.log(`Found ${cookies.length} Amazon cookies`);
    
    // Important cookies to check if logged in
    const sessionCookie = cookies.find(c => c.name === 'session-id');
    const atCookie = cookies.find(c => c.name === 'at-main');
    
    if (!sessionCookie || !atCookie) {
      console.log("Missing essential Amazon cookies, authentication may fail");
    }
    
    // Format cookies for the header
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // Make the fetch request with cookies
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.amazon.com/',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'cache-control': 'max-age=0'
      },
      credentials: 'include',
      redirect: 'follow'
    });
    
    if (!response.ok) {
      console.log(`Response not OK: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const html = await response.text();
    console.log(`Received HTML content of length: ${html.length}`);
    
    // More thorough check of the content
    let validContent = true;
    
    // Check if we're logged in
    const hasSignIn = html.includes('Sign-In') || html.includes('sign-in');
    if (hasSignIn) {
      console.log("HTML contains sign-in references, probably not logged in");
      validContent = false;
    }
    
    // Check if page might be a no-rush credits page
    const maybeCreditsPage = 
      html.includes('rewards') || 
      html.includes('credits') || 
      html.includes('promotional') || 
      html.includes('digital balance') ||
      html.includes('balance') ||
      html.includes('promotional credit');
    
    if (!maybeCreditsPage) {
      console.log("HTML doesn't appear to be a credits page");
      validContent = false;
    }
    
    // Check for common Amazon headers/footers as a sanity check
    const seemsLikeAmazon = 
      html.includes('amazon') || 
      html.includes('Amazon') || 
      html.includes('nav-sprite');
    
    if (!seemsLikeAmazon) {
      console.log("HTML doesn't appear to be from Amazon");
      validContent = false;
    }
    
    if (!validContent) {
      return null;
    }
    
    // Save a sample of the HTML for debugging (first 300 chars)
    console.log("Sample of HTML content:", html.substring(0, 300));
    
    return html;
  } catch (error) {
    console.error("Error in fetchWithCookies:", error);
    return null;
  }
}

async function parseCreditsFromHTML(html) {
  try {
    // We'll use multiple regex patterns to catch different formats
    const entries = [];
    
    // Main patterns for credit detection
    const patterns = [
      // Original pattern - "$X.XX expires on Month Day, Year"
      /\$(\d+\.\d{2})\s+expires? on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi,
      
      // Alternative pattern - "Your $X.XX credit expires on Month Day, Year"
      /Your\s+\$(\d+\.\d{2})\s+credit\s+expires? on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi,
      
      // Pattern with different wording - "$X.XX promotional balance expires Month Day, Year"
      /\$(\d+\.\d{2})\s+promotional\s+balance\s+expires?\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi,
      
      // Pattern with "available until" - "$X.XX available until Month Day, Year"
      /\$(\d+\.\d{2})\s+available\s+until\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi
    ];
    
    console.log("Searching for credits with multiple patterns");
    
    // Try each pattern
    for (const pattern of patterns) {
      let match;
      // Reset the regex lastIndex
      pattern.lastIndex = 0;
      
      while ((match = pattern.exec(html)) !== null) {
        const amount = match[1];
        const dateStr = match[2];
        const date = new Date(dateStr);
        
        if (!isNaN(date)) {
          entries.push({
            amount: amount,
            expiryDate: date.toISOString(),
            text: match[0]
          });
          console.log(`Found credit: $${amount} expires on ${dateStr}`);
        }
      }
    }
    
    // Additional fallback: Look for structured data in the HTML
    // This might find credits in JSON or data attributes
    try {
      const jsonDataMatches = html.match(/\{[^{}]*"amount"\s*:\s*"?\$?(\d+\.\d{2})"?[^{}]*"expirationDate"\s*:\s*"([^"]*)"/gi);
      if (jsonDataMatches) {
        jsonDataMatches.forEach(match => {
          const amountMatch = match.match(/"amount"\s*:\s*"?\$?(\d+\.\d{2})"?/i);
          const dateMatch = match.match(/"expirationDate"\s*:\s*"([^"]*)"/i);
          
          if (amountMatch && dateMatch) {
            const amount = amountMatch[1];
            const dateStr = dateMatch[1];
            const date = new Date(dateStr);
            
            if (!isNaN(date)) {
              entries.push({
                amount: amount,
                expiryDate: date.toISOString(),
                text: `$${amount} expires on ${date.toLocaleDateString()}`
              });
              console.log(`Found credit from structured data: $${amount} expires on ${date.toLocaleDateString()}`);
            }
          }
        });
      }
    } catch (structuredDataError) {
      console.log("Error parsing structured data:", structuredDataError);
    }
    
    // Remove duplicates based on amount and expiry date
    const uniqueEntries = [];
    const seen = new Set();
    
    for (const entry of entries) {
      const key = `${entry.amount}-${entry.expiryDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEntries.push(entry);
      }
    }
    
    console.log(`Found ${uniqueEntries.length} unique credits`);
    return uniqueEntries;
  } catch (error) {
    console.error("Error parsing credits from HTML:", error);
    return [];
  }
}

async function fetchCreditsDirectly() {
  try {
    console.log("Attempting direct fetch with cookies");
    
    // Start with the main URL
    let html = await fetchWithCookies(getCreditsUrl());
    let entries = [];
    
    if (html) {
      // Parse credits from HTML
      entries = await parseCreditsFromHTML(html);
      
      if (entries.length > 0) {
        console.log("Direct fetch succeeded with", entries.length, "entries from main URL");
        return entries;
      } else {
        console.log("Direct fetch returned HTML but no credit entries were found on main URL");
      }
    } else {
      console.log("Direct fetch returned no HTML or invalid content from main URL");
    }
    
    // If main URL didn't work, try alternative URLs
    console.log("Trying alternative URLs...");
    for (const altUrl of CONFIG.ALTERNATE_URLS) {
      console.log("Trying alternative URL:", altUrl);
      html = await fetchWithCookies(altUrl);
      
      if (html) {
        const altEntries = await parseCreditsFromHTML(html);
        if (altEntries.length > 0) {
          console.log("Found", altEntries.length, "entries from alternative URL:", altUrl);
          entries.push(...altEntries);
        }
      }
    }
    
    // Remove duplicates
    const uniqueEntries = [];
    const seen = new Set();
    
    for (const entry of entries) {
      const key = `${entry.amount}-${entry.expiryDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEntries.push(entry);
      }
    }
    
    if (uniqueEntries.length > 0) {
      console.log("Direct fetch succeeded with", uniqueEntries.length, "total unique entries from all URLs");
      return uniqueEntries;
    }
    
    console.log("No credit entries found from any URLs");
    return null;
  } catch (error) {
    console.error("Error in direct fetch method:", error);
    return null;
  }
}

async function fetchCreditsWithTab() {
  return new Promise((resolve) => {
    // Create a background tab instead of a popup window
    chrome.tabs.create({
      url: getCreditsUrl(),
      active: false // This makes it a background tab
    }, async (tab) => {
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
          // Close the tab as quickly as possible
          chrome.tabs.remove(tab.id);
          const entries = results && results[0] && results[0].result ? results[0].result : [];
          resolve(entries);
        });
      }, 3000); // Wait 3 seconds for page to load properly
    });
  });
}

// New function to fetch credits using an iframe in an existing tab
async function fetchCreditsWithIframe(existingTabId = null) {
  return new Promise(async (resolve) => {
    try {
      // If no existing tab ID was provided, we need to get the current active tab
      let targetTabId = existingTabId;
      
      if (!targetTabId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
          console.log("No active tab found");
          resolve([]);
          return;
        }
        targetTabId = tabs[0].id;
      }
      
      console.log("Attempting to fetch credits using iframe in tab:", targetTabId);
      
      // Execute script to create and use a hidden iframe
      chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (creditsUrl) => {
          return new Promise((innerResolve) => {
            // Create a hidden iframe
            const iframe = document.createElement('iframe');
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            iframe.style.position = 'absolute';
            iframe.style.top = '-9999px';
            iframe.style.left = '-9999px';
            
            // Set up a handler for when the iframe loads
            iframe.onload = () => {
              try {
                // Try to access the iframe content, which might fail due to same-origin policy
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const pageText = iframeDoc.body.innerText || iframeDoc.body.textContent || '';
                const htmlContent = iframeDoc.body.innerHTML || '';
                
                // Define multiple regex patterns for different formats
                const patterns = [
                  // Original pattern - "$X.XX expires on Month Day, Year"
                  /\$(\d+\.\d{2})\s+expires? on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi,
                  
                  // Alternative pattern - "Your $X.XX credit expires on Month Day, Year"
                  /Your\s+\$(\d+\.\d{2})\s+credit\s+expires? on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi,
                  
                  // Pattern with different wording - "$X.XX promotional balance expires Month Day, Year"
                  /\$(\d+\.\d{2})\s+promotional\s+balance\s+expires?\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi,
                  
                  // Pattern with "available until" - "$X.XX available until Month Day, Year"
                  /\$(\d+\.\d{2})\s+available\s+until\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/gi
                ];
                
                // Parse the rewards data using multiple patterns
                const matches = [];
                
                // Try each pattern
                for (const pattern of patterns) {
                  let match;
                  // Reset the regex lastIndex
                  pattern.lastIndex = 0;
                  
                  const textToSearch = pageText + ' ' + htmlContent;
                  while ((match = pattern.exec(textToSearch)) !== null) {
                    const amount = match[1];
                    const dateStr = match[2];
                    const date = new Date(dateStr);
                    
                    if (!isNaN(date)) {
                      matches.push({
                        amount: amount,
                        expiryDate: date.toISOString(),
                        text: match[0]
                      });
                      console.log(`Found credit: $${amount} expires on ${dateStr}`);
                    }
                  }
                }
                
                // Additional lookup for structured data
                try {
                  const jsonDataMatches = htmlContent.match(/\{[^{}]*"amount"\s*:\s*"?\$?(\d+\.\d{2})"?[^{}]*"expirationDate"\s*:\s*"([^"]*)"/gi);
                  if (jsonDataMatches) {
                    jsonDataMatches.forEach(match => {
                      const amountMatch = match.match(/"amount"\s*:\s*"?\$?(\d+\.\d{2})"?/i);
                      const dateMatch = match.match(/"expirationDate"\s*:\s*"([^"]*)"/i);
                      
                      if (amountMatch && dateMatch) {
                        const amount = amountMatch[1];
                        const dateStr = dateMatch[1];
                        const date = new Date(dateStr);
                        
                        if (!isNaN(date)) {
                          matches.push({
                            amount: amount,
                            expiryDate: date.toISOString(),
                            text: `$${amount} expires on ${date.toLocaleDateString()}`
                          });
                        }
                      }
                    });
                  }
                } catch (structuredDataError) {
                  console.log("Error parsing structured data:", structuredDataError);
                }
                
                // Remove duplicates
                const uniqueMatches = [];
                const seen = new Set();
                
                for (const entry of matches) {
                  const key = `${entry.amount}-${entry.expiryDate}`;
                  if (!seen.has(key)) {
                    seen.add(key);
                    uniqueMatches.push(entry);
                  }
                }
                
                // Clean up the iframe
                setTimeout(() => {
                  if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                  }
                }, 100);
                
                innerResolve({ success: true, entries: uniqueMatches });
              } catch (error) {
                // If we can't access the iframe content, clean up and report failure
                console.log("Error accessing iframe content:", error);
                if (document.body.contains(iframe)) {
                  document.body.removeChild(iframe);
                }
                innerResolve({ success: false, error: error.toString() });
              }
            };
            
            // Set error handler
            iframe.onerror = (error) => {
              console.log("Iframe error event triggered:", error);
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
              }
              innerResolve({ success: false, error: "Iframe loading error" });
            };
            
            // Set the iframe source and add it to the page
            iframe.src = creditsUrl;
            document.body.appendChild(iframe);
            
            // Set a timeout in case the iframe never loads
            setTimeout(() => {
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
                innerResolve({ success: false, error: "Iframe load timeout" });
              }
            }, 15000); // Increased timeout to 15 seconds
          });
        },
        args: [getCreditsUrl()]
      }).then(results => {
        if (results && results[0] && results[0].result && results[0].result.success) {
          console.log("Iframe method succeeded with", results[0].result.entries.length, "entries");
          resolve(results[0].result.entries);
        } else {
          const errorMessage = results && results[0] && results[0].result ? results[0].result.error : "Unknown error";
          console.log("Iframe method failed:", errorMessage);
          resolve([]);
        }
      }).catch(error => {
        console.error("Error with iframe method:", error);
        resolve([]);
      });
    } catch (error) {
      console.error("Error setting up iframe method:", error);
      resolve([]);
    }
  });
}

// Function to update badge based on credits data
function updateBadge(entries) {
  console.log("Updating badge with entries:", entries);
  console.log("Current thresholds:", CONFIG.THRESHOLDS);
  
  // Update badge text (total amount)
  const total = entries.reduce((sum, entry) => sum + parseFloat(entry.amount), 0);
  let badgeText = '';
  if (total > 0) {
    const dollars = Math.floor(total);
    const cents = total - dollars;
    badgeText = cents >= 0.5 ? String(dollars + 1) : String(dollars);
  }
  chrome.action.setBadgeText({ text: "$" + badgeText });
  console.log("Badge text set to:", "$" + badgeText);
  
  // Badge color logic based on soonest expiration
  let badgeColor = '#4CAF50'; // Default green
  
  if (entries.length > 0) {
    // Find the soonest expiring credit
    const soonest = entries.reduce((min, entry) => {
      const d = new Date(entry.expiryDate);
      return (!min || d < min) ? d : min;
    }, null);
    
    if (soonest) {
      const nowDate = new Date();
      const days = Math.ceil((soonest - nowDate) / (1000 * 60 * 60 * 24));
      console.log("Days until soonest expiration:", days);
      
      // Apply threshold logic
      const warningThreshold = CONFIG.THRESHOLDS.WARNING;
      const cautionThreshold = CONFIG.THRESHOLDS.CAUTION;
      
      if (days < warningThreshold) {
        // Less than warning threshold (e.g., < 15 days) = RED
        badgeColor = '#D32F2F';
        console.log(`Badge color set to RED (days=${days} < warningThreshold=${warningThreshold})`);
      } else if (days < cautionThreshold) {
        // Less than caution threshold (e.g., < 30 days) = YELLOW
        badgeColor = '#FFD600';
        console.log(`Badge color set to YELLOW (warningThreshold=${warningThreshold} <= days=${days} < cautionThreshold=${cautionThreshold})`);
      } else {
        // Greater than or equal to caution threshold = GREEN
        badgeColor = '#4CAF50';
        console.log(`Badge color set to GREEN (days=${days} >= cautionThreshold=${cautionThreshold})`);
      }
    }
  }
  
  chrome.action.setBadgeBackgroundColor({ color: badgeColor });
}

// Expose updateBadge function to popup
self.updateBadge = updateBadge;

async function fetchCreditsAndStore(tabId = null) {
  try {
    // Try direct fetch first
    console.log("Starting credit fetch process...");
    let directEntries = await fetchCreditsDirectly();
    
    // Try iframe approach if we have a tab ID, regardless of direct fetch result
    let iframeEntries = [];
    if (tabId) {
      console.log("Will also try iframe method with tab ID:", tabId);
      iframeEntries = await fetchCreditsWithIframe(tabId);
    }
    
    // Combine and deduplicate entries from both methods
    let allEntries = [...(directEntries || []), ...(iframeEntries || [])];
    console.log(`Found ${directEntries?.length || 0} entries from direct fetch and ${iframeEntries?.length || 0} from iframe`);

    // Remove duplicates
    const uniqueEntries = [];
    const seen = new Set();
    
    for (const entry of allEntries) {
      const key = `${entry.amount}-${entry.expiryDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEntries.push(entry);
      }
    }
    
    console.log(`Combined and deduplicated to ${uniqueEntries.length} unique entries`);
    
    // If we have no entries and test mode is enabled, try tab approach
    if (uniqueEntries.length === 0 && CONFIG.USE_TEST_URL) {
      console.log("No entries found and test mode enabled, trying tab approach");
      const tabEntries = await fetchCreditsWithTab();
      uniqueEntries.push(...tabEntries);
    }
    
    // Store fetched entries
    const now = Date.now();
    chrome.storage.local.set({
      credits: uniqueEntries,
      creditsLastFetched: now,
      refreshRequested: false
    });
    
    // Update badge using the function
    updateBadge(uniqueEntries);
    
    return uniqueEntries;
  } catch (error) {
    console.error("Error in fetchCreditsAndStore:", error);
    // Clear the refresh request flag even on error
    chrome.storage.local.set({ refreshRequested: false });
    return [];
  }
}

// Now define refreshCredits after fetchCreditsAndStore is defined
self.refreshCredits = function(tabId = null) {
  console.log("Background refreshCredits function called with tabId:", tabId);
  return fetchCreditsAndStore(tabId);
};

// Expose fetchCreditsAndStore as a backup
self.fetchCreditsAndStore = fetchCreditsAndStore;

// Load saved threshold settings when extension starts
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['thresholds'], (data) => {
    if (data.thresholds) {
      CONFIG.THRESHOLDS = data.thresholds;
    } else {
      // Save default thresholds if none exist
      chrome.storage.local.set({ thresholds: CONFIG.THRESHOLDS });
    }
  });
  
  chrome.alarms.create('refreshCredits', { periodInMinutes: 1 });
  fetchCreditsAndStore();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshCredits') {
    fetchCreditsAndStore();
  }
});

// Update the message listener to accept the tabId parameter for refresh
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);
  
  if (message.action === "refresh") {
    console.log("Processing refresh request via message");
    
    // Execute refresh and respond when done
    fetchCreditsAndStore(message.tabId).then((entries) => {
      console.log("Refresh completed, sending response with", entries.length, "entries");
      sendResponse({ success: true, entries: entries });
    }).catch(error => {
      console.error("Error in refresh:", error);
      sendResponse({ success: false, error: error.toString() });
    });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  
  if (message.action === "test") {
    console.log("Received test message");
    sendResponse({ success: true, message: "Test successful" });
    return true;
  }
  
  if (message.action === "updateBadge") {
    console.log("Updating badge with new thresholds:", message.thresholds);
    
    // Update thresholds if provided
    if (message.thresholds) {
      CONFIG.THRESHOLDS = message.thresholds;
    }
    
    // Get the latest credits data
    chrome.storage.local.get(['credits'], (data) => {
      if (data.credits && data.credits.length > 0) {
        // Update the badge with current data and new thresholds
        updateBadge(data.credits);
        sendResponse({ success: true, message: "Badge updated" });
      } else {
        sendResponse({ success: false, message: "No credits data available" });
      }
    });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
}); 