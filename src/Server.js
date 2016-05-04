/**
 * Created by vaney on 04/05/2016.
 */

'use strict';

/**
 * @typedef {Object} ServerConfig
 * @property {String} EndpointUid
 * @property {String} ProxyHostName
 * @property {String} Endpoint
 * @property {Number} DefaultPort
 */


var http = require('http');
var _ = require('underscore');

var serverConfigJsonPath = './config/ServerConfig.json';

/**
 * @type {ServerConfig}
 */
var serverConfig = require('../config/ServerConfig.json');

var ProxyUtils = require('beame-utils').ProxyUtils;
var proxyUtils = new ProxyUtils();
var utils = require('beame-utils').Utils;


var ProxyClient = require('./ProxyClient');

var certificateServices,
    provisionApiServices;

//****************************Private helpers START****************************************//

/**
 * Update config file
 * @param provEndpoint
 * @param callback
 * @this {Server}
 */
var updateConfigData = function (provEndpoint,callback) {

    if(!provEndpoint){
        console.error('!!!!!!!!!!!!!!!!Empty Endpoint received from API');
        callback && callback('Empty Endpoint received from API', null);
        return;
    }

    serverConfig.ProxyHostName          = provEndpoint.hostname;
    serverConfig.Endpoint               = provEndpoint.endpoint;
    serverConfig.EndpointUid            = provEndpoint.uid;

    updateConfigFile(callback);
};

/**
 * Save ClientServerConfig.json to disk
 * @param {Function} callback
 * @this {Server}
 */
var updateConfigFile = function (callback) {
    utils.saveFile(serverConfigJsonPath, utils.stringify(serverConfig),function (error) {
        if(error){
            callback && callback(error,null);
        }
        callback && callback(null,{});
    });
};

/**
 * START SEVER FROM HERE
 * certs => certificates options
 * @param {Function} callback
 * @this {Server}
 */
var start = function(callback){
    console.log('------------------------Client Server starting on ',serverConfig.Endpoint, serverConfig.DefaultPort);
    try{
        this.clientServer = http.createServer(function (req, res) {
            console.log("Client Server on connect", req.headers);
            if (req.url.indexOf('index.html') >= 0) {
                console.log('Server on request');
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end('host okay source ip' + req.connection.remoteAddress + " port " + req.connection.remotePort);
            }
        });

        this.clientServer.listen(this.clientServerPort, _.bind(function() {
            this.proxyClient = new ProxyClient(serverConfig.Endpoint, serverConfig.ProxyHostName, 'localhost', serverConfig.DefaultPort, {});
        },this));

        callback  && callback(null, this.clientServer);
    } catch(error) {
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!! START CLIENT SERVER FAILED',utils.stringify(error));
        callback  && callback(error, null);
    }

};
//****************************Private helpers END****************************************//

//****************************Private event handlers START****************************************//

/**
 * Response callback handler on request for endpoint from provision API
 * @param error
 * @param provEndpoint
 * @this {Server}
 */
var onEndpointReceived = function(error, provEndpoint) {

    if(error){
        console.error('on find endpoint error',utils.stringify(error));
        return;
    }

    console.log('on find endpoint',provEndpoint);

    //update properties and save it to config json
    updateConfigData(provEndpoint,_.bind(function(error) {
        if(error) {
            console.error('!!!!!!!!!!!!!!!!!Update Config json failed on CLIENT SERVER',utils.stringify(error));
        }
    },this));
};

//****************************Private event handlers END****************************************//


//**********************************CONSTRUCTOR************************************************//
/**
 * @param {Number} clientServerPort
 * @constructor
 */
function Server(clientServerPort){
    console.log('Enter to Client Server constructor');

    proxyUtils.getInstanceData(_.bind(function(data){
        //set properties
        this.config                 = proxyUtils.config;
        this.availabilityZone       = data.avlZone;
        this.state                  = 'init';

        if(clientServerPort && clientServerPort != serverConfig.DefaultPort) {
            serverConfig.DefaultPort = clientServerPort;
            updateConfigFile(null);
        }

        this.clientServerPort = serverConfig.DefaultPort;

        //init services
        certificateServices = proxyUtils.getCertificateServiceInstance();
        provisionApiServices = proxyUtils.getProvisionApiServiceInstance();

        //check existing configuration
        if (!_.isEmpty(serverConfig.Endpoint) && !_.isEmpty(serverConfig.ProxyHostName)) {

            this.state = 'ready';
        } else {
            //*****************************************get available endpoint from provision**************************//
            this.host = null;
            utils.httpGet(this.config.LoadBalanceEndpoint, _.bind(function (error,data) {
                if (data && data.endpoint) {
                    this.host = data.endpoint;
                }
                else {
                    console.log('!!!!!!!!!! Load Balance: Instance not found');
                }

                console.log('call provision for available endpoint');
                provisionApiServices.findEndpoint(this.host, this.availabilityZone, _.bind(onEndpointReceived,this));
            },this));
        }

    },this));

    return this;
}


//****************************Public services START****************************************//
/**
 * Return state of Server
 * @returns {Boolean}
 */
Server.prototype.isReady = function () {
    return this.state === 'ready';
};

//noinspection JSUnusedGlobalSymbols
/**
 * START SEVER METHOD
 * expecting existing certificates at this point
 * in callback suppose to return created https server
 * @param {Function} callback
 */
Server.prototype.startServer = function(callback) {

    start.call(this, callback);
};

/**
 * destroy server
 */
Server.prototype.destroy = function(){
    //destroy proxy
    this.proxyClient && this.proxyClient.destroy();
    this.proxyClient = null;

    //destroy server
    this.clientServer.close(_.bind(function(){
        this.clientServer = null;
    },this));
};

//****************************Public services END****************************************//
/**
 * @type {Server}
 */
module.exports = Server;