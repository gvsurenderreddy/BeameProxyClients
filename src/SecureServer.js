/**
 * Created by vaney on 03/05/2016.
 */

'use strict';

/**
 * @typedef {Object} SecureServerConfig
 * @property {String} EndpointUid
 * @property {String} ProxyHostName
 * @property {String} Endpoint
 * @property {Number} DefaultPort
 */


var https = require('https');
var _ = require('underscore');

var serverConfigJsonPath = './config/SecureServerConfig.json';

/**
 * @type {SecureServerConfig}
 */
var serverConfig = require('../config/SecureServerConfig.json');

var ProxyUtils = require('beame-utils').ProxyUtils;
var utils = require('beame-utils').Utils;


var ProxyClient = require('./ProxyClient');

var certificateServices,
    provisionApiServices;

//****************************Private helpers START****************************************//

/**
 * Read certificates from server
 * SERVER STATE CHANGED TO READY on success
 * @param callback
 * @this {SecureServer}
 */
var readCertificates = function(callback) {
    certificateServices.readCertificates(serverConfig.Endpoint,_.bind(function(error,data) {
        if(error){
            console.error('read server Certificates',utils.stringify(error));
            callback(error,null);
            return;
        }

        if(data){
            console.log('************************************************certificates read successfully');
            this.state = 'ready';
            callback(null,data);
        }


    },this));
};

/**
 * Update config file
 * @param provEndpoint
 * @param callback
 * @this {SecureServer}
 */
var updateConfigData = function (provEndpoint,callback) {

    if(!provEndpoint){
        console.error('!!!!!!!!!!!!!!!!Empty Endpoint received from API');
        callback && callback('Empty Endpoint received from API', null);
        return;
    }

    serverConfig.ProxyHostName          = 'https://' + provEndpoint.hostname;
    serverConfig.Endpoint               = provEndpoint.endpoint;
    serverConfig.EndpointUid            = provEndpoint.uid;

    updateConfigFile(callback);
};

/**
 * Save ClientServerConfig.json to disk
 * @param {Function} callback
 * @this {SecureServer}
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
 * @param {Object} certs
 * @param {Function} callback
 * @this {SecureServer}
 */
var start = function(certs, callback){
    console.log('------------------------Client Server starting on ',serverConfig.Endpoint, serverConfig.DefaultPort);
    try{
        this.clientServer = https.createServer(certs, function (req, res) {
            console.log("Client Server on connect", req.headers);
            if (req.url.indexOf('index.html') >= 0) {
                console.log('Server on request');
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end('host okay source ip' + req.connection.remoteAddress + " port " + req.connection.remotePort);
            }
        });

        this.clientServer.listen(this.clientServerPort, _.bind(function() {
            this.sslProxyClient = new ProxyClient(serverConfig.Endpoint, serverConfig.ProxyHostName, 'localhost', serverConfig.DefaultPort, {});
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
 * Response callback handler on saving Ssl Certificates
 * SERVER STATE CHANGED TO READY
 * @param error
 * @param data
 * @this {SecureServer}
 */
var onCertificatesSaved = function(error,data) {
    if (data) {
        console.log('************************************************certificates saved successfully');
        this.state = 'ready';
        return;
    }
    console.error('save certificates failed',error);
};

/**
 * Response callback handler on request for Ssl certificates from provision API
 * @param error
 * @param provEndpoint
 * @this {SecureServer}
 */
var onCertificateReceived = function(error,provEndpoint) {
    if (error) {
        console.error('on order pem error',utils.stringify(error));
        return;
    }
    //save received certificates
    certificateServices.saveCertificates(provEndpoint.endpoint,provEndpoint.options,_.bind(onCertificatesSaved,this));
};

/**
 * Response callback handler on request to CertificateServices for CSR
 * @param error
 * @param data
 * @this {SecureServer}
 */
var onCsrCreated = function(error,data) {
    if (error) {
        console.error('CSR creation error',error);
        return;
    }

    if (!data) {
        console.error('CSR data is empty');
        return;
    }

    //order ssl certificate from provision
    provisionApiServices.orderPem(data.uid, data.endpoint, data.privateKey, data.csr, _.bind(onCertificateReceived,this));
};

/**
 * Response callback handler on request for endpoint from provision API
 * @param error
 * @param provEndpoint
 * @this {SecureServer}
 */
var onEndpointReceived = function(error,provEndpoint){

    console.log('on find endpoint',provEndpoint);

    if(error){
        console.error('on find endpoint error',utils.stringify(error));
        return;
    }

    //update properties and save it to config json
    updateConfigData(provEndpoint,_.bind(function(error) {
        if(error) {
            console.error('!!!!!!!!!!!!!!!!!Update Config json failed on CLIENT SERVER',utils.stringify(error));
            return;
        }
        //create certificate for received endpoint
        certificateServices.createCSR(serverConfig.EndpointUid, serverConfig.Endpoint,_.bind(onCsrCreated,this));
    },this));

};

//****************************Private event handlers END****************************************//


//**********************************CONSTRUCTOR************************************************//
/**
 * @param {Number} clientServerPort
 * @param {ProxyUtilsSettings} settings
 * @constructor
 */
function SecureServer(clientServerPort, settings) {
    var self = this;

    console.log('Enter to Client Server constructor');

    self.proxyUtils = new ProxyUtils(settings, function (instanceData) {
        //set properties
        self.config                 = self.proxyUtils.config;
        self.availabilityZone       = (settings && settings.avlZone) || instanceData.avlZone;
        self.state                  = 'init';

        if(clientServerPort && clientServerPort != serverConfig.DefaultPort){
            serverConfig.DefaultPort = clientServerPort;
            updateConfigFile(null);
        }

        self.clientServerPort = serverConfig.DefaultPort;

        //init services
        certificateServices = self.proxyUtils.getCertificateServiceInstance();
        provisionApiServices = self.proxyUtils.getProvisionApiServiceInstance();

        var init = function(){
            //*****************************************get available endpoint from provision**************************//
            self.host = null;
            self.proxyUtils.selectBestProxy((settings && settings.lb) || self.config.LoadBalanceEndpoint,function (error,data) {
                if(data && data.endpoint){
                    self.host = data.endpoint;
                    self.availabilityZone = data.zone;

                    provisionApiServices.findEndpoint(self.host, self.availabilityZone, _.bind(onEndpointReceived,self));
                }
                else {
                    console.log('!!!!!!!!!! Load Balancer: Instance not found');
                }
            });
        };

        //check existing configuration
        if(!_.isEmpty(serverConfig.Endpoint) && !_.isEmpty(serverConfig.ProxyHostName)) {

            //*****************************************try read installed certificates**************************//
            readCertificates.call(self, function(error) {
                if(error) {
                    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!on read certificates',error);
                    init();
                }
            });
        }
        else {
            init();
        }



    });


    return self;
}


//****************************Public services START****************************************//
/**
 * Return state of Server
 * @returns {Boolean}
 */
SecureServer.prototype.isReady = function () {
    return this.state === 'ready';
};

//noinspection JSUnusedGlobalSymbols
/**
 * START SEVER METHOD
 * expecting existing certificates at this point
 * in callback suppose to return created https server
 * @param {Function} callback
 */
SecureServer.prototype.startServer = function(callback) {

    var self = this;

    var interval = setInterval(function(){
        if(self.isReady()){
            readCertificates.call(self, function(error,options) {
                if(error){
                    self.state = 'error';
                    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!read certificates failed on start',utils.stringify(error));
                    return;
                }

                start.call(self, options, callback);
            });
            clearInterval(interval);
        }
    }, 100);
};

/**
 * destroy server
 */
SecureServer.prototype.destroy = function(){
    //destroy proxy
    this.sslProxyClient && this.sslProxyClient.destroy();
    this.sslProxyClient = null;

    //destroy server
    this.clientServer.close(_.bind(function(){
        this.clientServer = null;
    },this));
};

//****************************Public services END****************************************//
/**
 * @type {SecureServer}
 */
module.exports = SecureServer;