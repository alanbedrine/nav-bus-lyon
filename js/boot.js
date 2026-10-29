import { isMobileOrTablet } from './guard.js';
import { isDemo } from './demo.js';

if (isMobileOrTablet() || isDemo()) {
  if (isDemo()) document.body.classList.add('demo');
  import('./main.js');
} else {
  document.body.classList.add('desktop-blocked');
  document.getElementById('desktop').hidden = false;
}
