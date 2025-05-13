document.addEventListener('DOMContentLoaded', function() {
  const loadingElement = document.getElementById('loading');
  const creditsElement = document.getElementById('credits');
  const creditsListElement = document.getElementById('creditsList');
  const totalAmountElement = document.getElementById('totalAmount');
  const errorElement = document.getElementById('error');
  const refreshButton = document.getElementById('refreshButton');
  const devModeElement = document.getElementById('devMode');
  const testModeToggle = document.getElementById('testModeToggle');
  const testFilePath = document.getElementById('testFilePath');
  const testModeIndicator = document.getElementById('testModeIndicator');
  
  let backgroundPage = null;
  let config = {
    USE_TEST_URL: false,
    TEST_URL: ''
  };

  // Get the URL from background script's configuration
  let creditsUrl = null; // Initialize as null, will be set by background page
  
  // Try to access the background script's configuration
  chrome.runtime.getBackgroundPage(function(bg) {
    if (bg) {
      backgroundPage = bg;
      if (backgroundPage.getCreditsUrl) {
        creditsUrl = backgroundPage.getCreditsUrl();
      }
      if (backgroundPage.CONFIG) {
        config = backgroundPage.CONFIG;
        testModeToggle.checked = config.USE_TEST_URL;
        testFilePath.textContent = config.TEST_URL;
        
        // Show/hide test mode indicator
        testModeIndicator.style.display = config.USE_TEST_URL ? 'block' : 'none';
      }
    }
  });

  // Developer mode activation (click title 5 times)
  let titleClickCount = 0;
  document.querySelector('h2').addEventListener('click', function() {
    titleClickCount++;
    if (titleClickCount >= 5) {
      devModeElement.style.display = 'block';
      titleClickCount = 0;
    }
  });
  
  // Test mode toggle handler
  testModeToggle.addEventListener('change', function() {
    if (backgroundPage && backgroundPage.CONFIG) {
      backgroundPage.CONFIG.USE_TEST_URL = this.checked;
      // Update the URL immediately
      creditsUrl = backgroundPage.getCreditsUrl();
      
      // Show/hide test mode indicator
      testModeIndicator.style.display = this.checked ? 'block' : 'none';
    }
  });

  function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  }

  function isExpiringSoon(expiryDate) {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 30; // Highlight if expiring within 30 days
  }

  function createCreditEntry(amount, expiryDate) {
    const entry = document.createElement('div');
    entry.className = 'credit-entry';
    
    const amountDiv = document.createElement('div');
    amountDiv.className = 'credits-amount';
    amountDiv.textContent = `$${amount}`;
    
    const expiryDiv = document.createElement('div');
    expiryDiv.className = 'expiry-date';
    if (isExpiringSoon(expiryDate)) {
      expiryDiv.classList.add('expiry-soon');
    }
    expiryDiv.textContent = `Expires: ${formatDate(expiryDate)}`;
    
    entry.appendChild(amountDiv);
    entry.appendChild(expiryDiv);
    
    return entry;
  }

  function displayCredits(entries, lastFetchedTime) {
    creditsListElement.innerHTML = '';
    if (!entries || entries.length === 0) {
      errorElement.textContent = 'No credits found.';
      loadingElement.style.display = 'none';
      creditsElement.style.display = 'none';
      errorElement.style.display = 'block';
      return;
    }
    // Sort entries by expiry date
    entries.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    // Calculate total
    const total = entries.reduce((sum, entry) => sum + parseFloat(entry.amount), 0);
    // Add each credit entry
    entries.forEach(entry => {
      const creditEntry = createCreditEntry(entry.amount, entry.expiryDate);
      creditsListElement.appendChild(creditEntry);
    });
    
    // Update total
    totalAmountElement.textContent = `$${total.toFixed(2)}`;
    
    // Remove any existing last refresh element
    const existingLastRefresh = document.querySelector('.last-refresh');
    if (existingLastRefresh) {
      existingLastRefresh.remove();
    }
    
    // Add last refreshed timestamp
    if (lastFetchedTime) {
      const lastRefreshDiv = document.createElement('div');
      lastRefreshDiv.className = 'last-refresh';
      
      const now = Date.now();
      const timeDiff = now - lastFetchedTime;
      const minutesAgo = Math.floor(timeDiff / (60 * 1000));
      
      if (minutesAgo < 1) {
        lastRefreshDiv.textContent = 'Just refreshed';
      } else if (minutesAgo === 1) {
        lastRefreshDiv.textContent = 'Refreshed 1 minute ago';
      } else {
        lastRefreshDiv.textContent = `Refreshed ${minutesAgo} minutes ago`;
      }
      
      creditsElement.appendChild(lastRefreshDiv);
    }
    
    // Show the credits container
    loadingElement.style.display = 'none';
    creditsElement.style.display = 'block';
    errorElement.style.display = 'none';
  }

  function displayCreditsFromStorage() {
    loadingElement.style.display = 'block';
    creditsElement.style.display = 'none';
    errorElement.style.display = 'none';
    
    chrome.storage.local.get(['credits', 'creditsLastFetched'], (data) => {
      if (data.credits) {
        displayCredits(data.credits, data.creditsLastFetched);
      } else {
        // No credits in storage, show error
        errorElement.textContent = 'No credits found. Click refresh to load credits.';
        loadingElement.style.display = 'none';
        creditsElement.style.display = 'none';
        errorElement.style.display = 'block';
      }
    });
  }

  // Display credits from storage when popup opens
  displayCreditsFromStorage();

  // Add click handler for refresh button
  refreshButton.addEventListener('click', function() {
    // Disable the button during refresh
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    
    console.log("Refresh button clicked, sending message to background page...");
    
    // First try a test message
    chrome.runtime.sendMessage({ action: "test" }, function(response) {
      console.log("Test message response:", response);
      
      // Now send the actual refresh request
      chrome.runtime.sendMessage({ action: "refresh" }, function(response) {
        console.log("Refresh response:", response);
        
        // Re-enable the button and update text
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh Credits";
        
        if (response && response.success) {
          // Update the displayed credits
          displayCreditsFromStorage();
        } else {
          // Show error
          const errorMsg = response && response.error ? response.error : "Unknown error";
          console.error("Error refreshing credits:", errorMsg);
          errorElement.textContent = "Error refreshing credits: " + errorMsg;
          errorElement.style.display = "block";
        }
      });
    });
  });
}); 