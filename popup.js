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

  async function fetchCredits() {
    try {
      // Show loading state
      loadingElement.style.display = 'block';
      creditsElement.style.display = 'none';
      errorElement.style.display = 'none';

      // Create a new tab to fetch the credits
      const tab = await chrome.tabs.create({
        url: 'https://www.amazon.com/norushcredits',
        active: false
      });

      // Wait for the page to load and execute script to get credits
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Log the first 1000 characters of the page text for debugging
          const pageText = document.body.innerText || document.body.textContent || '';
          console.log('PAGE TEXT SAMPLE:', pageText.slice(0, 1000));

          // Flexible regex: $X.XX expires on/expires on MMM DD, YYYY (case-insensitive)
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

          return {
            entries: matches,
            isLoggedIn: !document.querySelector('#nav-link-accountList')?.textContent.includes('Sign in'),
            debugSample: pageText.slice(0, 1000)
          };
        }
      });

      // Close the tab we created
      await chrome.tabs.remove(tab.id);

      // Process the results
      const result = results[0].result;
      console.log('Script result:', result);
      
      if (result.entries && result.entries.length > 0) {
        // Clear previous entries
        creditsListElement.innerHTML = '';
        
        // Sort entries by expiry date
        result.entries.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
        
        // Calculate total
        const total = result.entries.reduce((sum, entry) => sum + parseFloat(entry.amount), 0);
        
        // Add each credit entry
        result.entries.forEach(entry => {
          const creditEntry = createCreditEntry(entry.amount, entry.expiryDate);
          creditsListElement.appendChild(creditEntry);
        });
        
        // Update total
        totalAmountElement.textContent = `$${total.toFixed(2)}`;
        
        // Show the credits container
        loadingElement.style.display = 'none';
        creditsElement.style.display = 'block';
        errorElement.style.display = 'none';
      } else {
        // Show appropriate error message
        let errorMessage = 'Unable to load credits. ';
        if (!result.isLoggedIn) {
          errorMessage += 'Please sign in to Amazon first.';
        } else {
          errorMessage += 'No credits found on the page.';
        }
        errorElement.textContent = errorMessage;
        loadingElement.style.display = 'none';
        creditsElement.style.display = 'none';
        errorElement.style.display = 'block';
        // Log debug sample for troubleshooting
        console.log('DEBUG PAGE TEXT SAMPLE:', result.debugSample);
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
      errorElement.textContent = `Error: ${error.message}`;
      loadingElement.style.display = 'none';
      creditsElement.style.display = 'none';
      errorElement.style.display = 'block';
    }
  }

  // Fetch credits when popup opens
  fetchCredits();

  // Add click handler for refresh button
  refreshButton.addEventListener('click', fetchCredits);
}); 