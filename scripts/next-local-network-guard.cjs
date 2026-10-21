// Process-local guard for isolated QA, not an app/security configuration change.
const dns = require('node:dns');
const allowed = host => !host || ['localhost','127.0.0.1','::1','0.0.0.0'].includes(host);
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!allowed(host))throw Error('QA blocked external DNS');return lookup.call(this,host,...args)};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed(u.hostname))throw Error('QA blocked external fetch');return originalFetch.call(this,input,...args)};
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const v=Array.isArray(args[0])?args[0]:args;const o=v[0];const host=typeof o==='object'?o.host:typeof v[1]==='string'&&typeof o==='number'?v[1]:undefined;if(!allowed(host))throw Error('QA blocked external socket');return connect.apply(this,args)};
