/**
 * Created by vaney on 03/05/2016.
 */

var SecureServer = require('../src/SecureServer');

var server = new SecureServer(null, {
    lb: "http://lb-dev.luckyqr.io",
    avlZone : "eu-central-1a",
    edgeServerHostname: "edge.eu-central-1a-1.v1.beameio.net"
});

server.startServer(function (error, https) {
    if (error) {
        console.error('Test secure server start failed', error);
        return;
    }
    console.log('Test secure server start callback', https);
});