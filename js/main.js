/* main.js
   Entry point (ES module): import chart to register subscribers, then initialize map.
   Ensures event listeners are registered before interactions/data load.
*/
import './chart.js';
import { init as initMap } from './map.js';

initMap();
