/* main.js
   Entry point (ES module): import chart to register subscribers, then initialize map.
   Ensures event listeners are registered before interactions/data load.
*/
import './chart.js';
import { init as initMap } from './map.js';
import { dispatcher } from './shared.js';
import { showLoading, hideLoading } from './loading.js';

// Initialize map asynchronously
initMap().catch(err => {
    console.error('Failed to initialize map:', err);
    hideLoading();
});

function setupPanelTabs() {
   const tabButtons = Array.from(document.querySelectorAll('.panel-tab'));
   if (!tabButtons.length) {
      return;
   }
   const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

   const activateTab = (target) => {
      // Show loading animation during tab switch
      showLoading('Loading tab...');
      
      tabButtons.forEach(button => {
         button.classList.toggle('active', button.dataset.target === target);
      });
      tabPanels.forEach(panel => {
         const panelTarget = panel.id.replace(/^tab-/, '');
         panel.classList.toggle('active', panelTarget === target);
      });
      
      // Notify that tab has changed
      dispatcher.call("tabChanged", null, target);
      
      // If switching to overall, redraw the combo chart to ensure correct dimensions
      // Wait 350ms for CSS transitions and layout to complete
      if (target === 'overall') {
         setTimeout(() => {
            try {
               window.redrawComboChart?.();
            } catch (e) {
               // silently fail if function doesn't exist
            }
            // Hide loading after chart is redrawn
            hideLoading();
         }, 400);
      } else {
         // Hide loading for other tabs after layout completes
         setTimeout(() => hideLoading(), 400);
      }
   };

   tabButtons.forEach(button => {
      button.addEventListener('click', () => {
         activateTab(button.dataset.target);
      });
   });
}

document.addEventListener('DOMContentLoaded', setupPanelTabs);
