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
var utils = require('beame-utils').Utils;


var ProxyClient = require('./ProxyClient');


//****************************Private helpers START****************************************//

/**
 * Update config file
 * @this {Server}
 * @param callback
 * @this {Server}
 */
var updateConfigData = function (callback) {

    serverConfig.ProxyHostName          = 'http://' +  this.host;
    serverConfig.Endpoint               = this.endpoint;

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
                res.end('host okay source ip ' + req.connection.remoteAddress + " port " + req.connection.remotePort);
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


//**********************************CONSTRUCTOR************************************************//
/**
 * @param {Number} clientServerPort
 * @param {ProxyUtilsSettings} settings
 * @constructor
 */
function Server(clientServerPort, settings) {
    var self = this;

    self.proxyUtils = new ProxyUtils(settings, function () {
        //set properties
        self.config                 = self.proxyUtils.config;
        self.state                  = 'init';

        if(clientServerPort && clientServerPort != serverConfig.DefaultPort) {
            serverConfig.DefaultPort = clientServerPort;
            updateConfigFile(null);
        }

        self.clientServerPort = serverConfig.DefaultPort;


        //check existing configuration
        if (!_.isEmpty(serverConfig.Endpoint) && !_.isEmpty(serverConfig.ProxyHostName)) {
            self.state = 'ready';
        }
        else {
            //*****************************************get available endpoint from provision**************************//
            self.host = null;
            self.proxyUtils.selectBestProxy((settings && settings.lb) || self.config.LoadBalanceEndpoint,function (error,data) {
                if(data && data.endpoint){
                    self.host = data.endpoint;


                    self.proxyUtils.makeHostnameForLocalIP(function(error,endpoint) {
                        if(error){
                            console.error("on get local hostname error",utils.stringify(error));
                            return;
                        }

                        if(!endpoint){
                            console.error("on get local hostname error: endpoint empty");
                            return;
                        }

                        self.endpoint = endpoint;

                        updateConfigData.call(self,function(error){
                            if(error) {
                                console.error("on update config error", utils.stringify(error));
                                return;
                            }

                            self.state = 'ready';
                        });
                    });

                }
                else {
                    console.log('!!!!!!!!!! Load Balancer: Instance not found');
                }
            });
        }

    });

    return self;
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

    var self = this;

    var interval = setInterval(function(){
        if(self.isReady()) {
            start.call(this, callback);
            clearInterval(interval);
        }
    }, 100);


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