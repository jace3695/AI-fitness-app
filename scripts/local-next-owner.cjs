'use strict';
require('./next-local-network-guard.cjs');
const http=require('node:http');
const token=process.env.YEONI_LOCAL_QA_OWNER;
if(token){const emit=http.Server.prototype.emit;http.Server.prototype.emit=function(event,...args){if(event==='request'){const [request,response]=args;const port=request.socket.localPort;if(port===4317)response.setHeader('x-yeoni-local-qa-owner',token);}return emit.call(this,event,...args);};}
