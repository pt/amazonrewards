document.addEventListener('DOMContentLoaded', function() {
  const loadingElement = document.getElementById('loading');
  const creditsElement = document.getElementById('credits');
  const creditsListElement = document.getElementById('creditsList');
  const totalAmountElement = document.getElementById('totalAmount');
  const errorElement = document.getElementById('error');
  const refreshButton = document.getElementById('refreshButton');

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

  function displayCredits(entries) {
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
    // Show the credits container
    loadingElement.style.display = 'none';
    creditsElement.style.display = 'block';
    errorElement.style.display = 'none';
  }

  function fetchAndDisplayCredits(forceRefresh = false) {
    loadingElement.style.display = 'block';
    creditsElement.style.display = 'none';
    errorElement.style.display = 'none';
    chrome.storage.local.get(['credits', 'creditsLastFetched'], (data) => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      if (!forceRefresh && data.credits && data.creditsLastFetched && (now - data.creditsLastFetched < oneHour)) {
        // Use cached credits
        displayCredits(data.credits);
      } else {
        // Request background to refresh
        chrome.runtime.sendMessage('refreshCreditsNow', (entries) => {
          displayCredits(entries);
        });
      }
    });
  }

  // Fetch credits when popup opens
  fetchAndDisplayCredits();

  // Add click handler for refresh button
  refreshButton.addEventListener('click', function() {
    fetchAndDisplayCredits(true);
  });
}); 