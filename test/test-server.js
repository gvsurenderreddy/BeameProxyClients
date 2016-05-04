/**
 * Created by vaney on 04/05/2016.
 */

var Server = require('../src/Server');

var server = new Server(null, {
    lb: "http://lb-lucky.luckyqr.io"
});

server.startServer(function (error, http) {
    if (error) {
        console.error('Test  server start failed', error);
        return;
    }
    console.log('Test  server start callback', http);
});