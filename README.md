# Amazon Rewards Chrome Extension

A Chrome extension for managing Amazon Rewards.

## Setup Instructions

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select this directory
5. The extension should now be installed and visible in your Chrome toolbar

## Development

- `manifest.json`: Contains the extension configuration
- `popup.html`: The popup interface that appears when clicking the extension icon
- `popup.js`: JavaScript for the popup interface
- `background.js`: Background service worker for the extension
- `icons/`: Directory containing extension icons

## Testing

1. Make changes to the code
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension card
4. Test your changes

## Note

This is a basic scaffold for the Chrome extension. Additional functionality will be added as needed. 