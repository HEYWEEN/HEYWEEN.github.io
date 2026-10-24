---
layout: null
permalink: /assets/js/data/swconf.js
sitemap: false
---
/* Legacy configuration URL retained while the former worker retires.
 * The replacement /sw.min.js does not import or create an offline cache.
 */
const swconf = {
  purge: true,
  resources: [],
  interceptor: { paths: [], urlPrefixes: [] }
};
