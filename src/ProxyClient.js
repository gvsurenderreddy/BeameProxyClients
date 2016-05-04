/**
 * Created by vaney on 03/05/2016.
 */

var _ = require('underscore');
var net = require('net');
var uuid = require('node-uuid');
var io = require('socket.io-client');

var ProxyUtils = require('beame-utils').ProxyUtils;
var proxyUtils = new ProxyUtils();

/**
 * @typedef {Object} ProxyClientOptions
 * @property {Function} [onConnect]
 * @property {Function} [onLocalServerCreated]
 */

/**
 * @param {String} hostname
 * @param {String} endpoint
 * @param {String} targetHost
 * @param {Number} targetPort
 * @param {ProxyClientOptions} options
 * @constructor
 * @class
 */
function ProxyClient(hostname, endpoint, targetHost, targetPort, options) {

    /** @member {Boolean} */
    this.connected = false;

    /** @member {Object} */
    this.clientSockets = {};

    /** @member {String} */
    this.endpoint = endpoint;

    /** @member {String} */
    this.hostname = hostname;

    /** @member {String} */
    this.targetHost = targetHost;

    /** @member {Number} */
    this.targetPort = targetPort;

    console.info("ProxyClient connecting to " + this.endpoint);

    /**
     * Connect to ProxyServer
     */
    this.socketio = io.connect(this.endpoint +'/control', {'force new connection': true});

    this.socketio.on('connect',  _.bind(function () {
        if(this.connected) {
            return;
        }
        console.info("ProxyClient connected:{hostname, endpoint, targetHost, targetPort}", this.hostname, this.endpoint, this.targetHost, this.targetPort);
        this.connected = true;
        proxyUtils.emitMessage(this.socketio, 'register_server', proxyUtils.formatMessage(null, {hostname: this.hostname}));

        options && options.onConnect && options.onConnect();

    }, this));

    this.socketio.on('error', _.bind(function (err) {
        console.log("Could not connect to proxy server", err);
    }, this));

    this.socketio.on('create_connection', _.bind(function (data) {
        this.createLocalServerConnection.call(this, data, options && options.onLocalServerCreated);
    }, this));


    this.socketio.on('data', _.bind(function(data) {
        var socketId = data.socketId;
        var socket = this.clientSockets[socketId];
        if(socket) {
            socket.id = socketId;
            //check if connected
            process.nextTick(function () {
                socket.write(data.payload);
            });

        }
    },this));

    this.socketio.on('socket_error', _.bind(function(data) {
        this.deleteSocket(data.socketId);
    }, this));

    this.socketio.on('_end', _.bind(function(data) {
        console.log("***************Killing the socket ");
        if(!data || !data.socketId) {
            return;
        }

        this.deleteSocket(data.socketId);
    }, this));

    this.socketio.on('disconnect', _.bind(function() {
        this.connected = false;
        _.each(this.clientSockets, function(socket) {
            socket.destroy();
            this.deleteSocket(socket.id);
        }, this);
    }, this));
}

ProxyClient.prototype.createLocalServerConnection = function (data, callback) {
    if (!this.socketio) {
        return;
    }

    var serverSideSocketId  = data.socketId;

    var client = new net.Socket();
    client.serverSideSocketId = serverSideSocketId;
    this.clientSockets[serverSideSocketId] = client;

    try {
        /**
         * Connect to local server
         */
        client.connect(this.targetPort, this.targetHost, _.bind(function () {

            client.on('data', _.bind(function (data) {
                console.log('**********Client Proxy on client(Socket) data');
                proxyUtils.emitMessage(this.socketio, 'data', proxyUtils.formatMessage(client.serverSideSocketId, data));

            }, this));

            client.on('close', _.bind(function () {
                console.log("Connection closed by server");
                proxyUtils.emitMessage(this.socketio, 'disconnect_client', proxyUtils.formatMessage(client.serverSideSocketId));

            }, this));

            client.on('end', _.bind(function () {
                console.log("Connection end by server");
                // this.socketio && this.socketio.emit('disconnect_client', {socketId: client.serverSideSocketId});
            }, this));
        }, this));

        client.on('error', _.bind(function (error) {
            console.log("Socket Error in ProxyClient " + data);

            if (this.socketio) {
                proxyUtils.emitMessage(this.socketio, '_error', proxyUtils.formatMessage(client.serverSideSocketId, null, error));
            }
        }, this));

    } catch (e) { console.error(JSON.stringify(e)) }

    callback && callback(data);
};

ProxyClient.prototype.destroy = function () {
    if (this.socketio) {
        this.socketio = null;
    }
    return this;
};

ProxyClient.prototype.deleteSocket = function(socketId) {
    if (socketId && this.clientSockets[socketId]) {
        var obj = this.clientSockets[socketId];
        obj.end();
        delete this.clientSockets[socketId];
    }
};

module.exports = ProxyClient;