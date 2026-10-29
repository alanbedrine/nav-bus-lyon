import { isMobileOrTablet } from './guard.js';

if (isMobileOrTablet()) {
  import('./main.js');
} else {
  document.body.classList.add('desktop-blocked');
  document.getElementById('desktop').hidden = false;
}
