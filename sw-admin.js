// Older admin.html registered /sw-admin.js. Current pages register /sw.js.
// Follow the same worker so a browser that still has this registration
// installs the network-first cache instead of staying on chauat-admin-v1.0.0.
importScripts('/sw.js');
