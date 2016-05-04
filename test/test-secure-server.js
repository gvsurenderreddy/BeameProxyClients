/**
 * Created by vaney on 03/05/2016.
 */

var SecureServer = require('../src/SecureServer');

var server = new SecureServer(null, {
    provApiEndpoint: 'https://prov-staging.beame.io',
    lb: "http://lb-lucky.luckyqr.io",
    avlZone : "eu-central-1a"
});

server.startServer(function (error, https) {
    if (error) {
        console.error('Test secure server start failed', error);
        return;
    }
    console.log('Test secure server start callback', https);
});