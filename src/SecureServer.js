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


/**
 * @typedef {Object} EdgeClientResponse
 * @property {String} uid
 * @property {String} hostname
 * @property {String} edgeHostname
 */

var https = require('https');
var _ = require('underscore');

var serverConfigJsonPath = './config/SecureServerConfig.json';

/**
 * @type {SecureServerConfig}
 */
var serverConfig = require('../config/SecureServerConfig.json');
var provisionSettings = require('../config/ProvApiSettings.json');
var cert_settings = require('../config/AppCertSettings.json');

var ProxyUtils = require('beame-utils').ProxyUtils;
var beameUtils = require('beame-utils').Utils;

var ProxyClient = require('./ProxyClient');

var BeameEdgeServices = require("beame-edge-services");

var ProvApi = BeameEdgeServices.ProvApiService;
var CertService = BeameEdgeServices.CertificateServices;

var Server = require('@zglozman/luckynetwork').Server;

var
    /** @type {CertificateServices} */
    certificateServices,
    /** @type {ProvApiService} */
    provisionApiServices;


//****************************Private helpers START****************************************//

/**
 * Read certificates from server
 * SERVER STATE CHANGED TO READY on success
 * @param callback
 * @this {SecureServer}
 */
var readCertificates = function (callback) {
    certificateServices.readCertificates(serverConfig.Endpoint, _.bind(function (error, data) {
        if (error) {
            console.error('read server Certificates', beameUtils.stringify(error));
            callback(error, null);
            return;
        }

        if (data) {
            console.log('************************************************certificates read successfully');
            this.state = 'ready';
            callback(null, data);
        }


    }, this));
};

/**
 * Update config file
 * @param {EdgeClientResponse} provEndpoint
 * @param callback
 * @this {SecureServer}
 */
var updateConfigData = function (provEndpoint, callback) {

    if (!provEndpoint) {
        console.error('!!!!!!!!!!!!!!!!Empty Endpoint received from API');
        callback && callback('Empty Endpoint received from API', null);
        return;
    }

    serverConfig.ProxyHostName = 'https://' + provEndpoint.edgeHostname;
    serverConfig.Endpoint = provEndpoint.hostname;
    serverConfig.EndpointUid = provEndpoint.uid;

    updateConfigFile(callback);
};

/**
 * Save ClientServerConfig.json to disk
 * @param {Function} callback
 * @this {SecureServer}
 */
var updateConfigFile = function (callback) {
    beameUtils.saveFile(serverConfigJsonPath, beameUtils.stringify(serverConfig), function (error) {
        if (error) {
            callback && callback(error, null);
        }
        callback && callback(null, {});
    });
};

/**
 * START SEVER FROM HERE
 * certs => certificates options
 * @param {ServerCertificates} certs
 * @param {Function} callback
 * @this {SecureServer}
 */
var start = function (certs, callback) {
    console.log('------------------------Client Server starting on ', serverConfig.Endpoint, serverConfig.DefaultPort);
    try {
        this.clientServer = https.createServer(certs, function (req, res) {
            console.log("Client Server on connect", req.headers);
            if (req.url.indexOf('index.html') >= 0) {
                console.log('Server on request');
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end('host okay source ip' + req.connection.remoteAddress + " port " + req.connection.remotePort);
            }
        });

        this.clientServer.listen(this.clientServerPort, _.bind(function () {
            this.sslProxyClient = new ProxyClient("HTTPS", serverConfig.Endpoint, serverConfig.ProxyHostName, 'localhost', serverConfig.DefaultPort, {}, this.agent, certs);
        }, this));

        callback && callback(null, this.clientServer);
    } catch (error) {
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!! START CLIENT SERVER FAILED', beameUtils.stringify(error));
        callback && callback(error, null);
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
var onCertificatesSaved = function (error, data) {
    if (data) {
        console.log('************************************************certificates saved successfully');
        this.state = 'ready';
        return;
    }
    console.error('save certificates failed', error);
};

/**
 * Response callback handler on request for Ssl certificates from provision API
 * @param error
 * @param provEndpoint
 * @this {SecureServer}
 */
var onCertificateReceived = function (error, provEndpoint) {
    if (error) {
        console.error('on order pem error', beameUtils.stringify(error));
        return;
    }
    //save received certificates
    certificateServices.saveCertificates(provEndpoint.endpoint, provEndpoint.options, _.bind(onCertificatesSaved, this));
};

/**
 * Response callback handler on request to CertificateServices for CSR
 * @param error
 * @param data
 * @this {SecureServer}
 */
var onCsrCreated = function (error, data) {
    var self = this;
    if (error) {
        console.error('CSR creation error', error);
        return;
    }

    if (!data) {
        console.error('CSR data is empty');
        return;
    }

    //order ssl certificate from provision
    var apiUrl = self.provApiEndpoint + provisionSettings.Actions.GetCert.endpoint;
    provisionApiServices.getCert(apiUrl, data.uid, data.endpoint, data.privateKey, data.csr, _.bind(onCertificateReceived, self));
};

/**
 * Response callback handler on request for endpoint from provision API
 * @param error
 * @param provEndpoint
 * @this {SecureServer}
 */
var onEndpointReceived = function (error, provEndpoint) {

    console.log('register host response', provEndpoint);

    if (error) {
        console.error('register host error', beameUtils.stringify(error));
        return;
    }

    //update properties and save it to config json
    updateConfigData(provEndpoint, _.bind(function (error) {
        if (error) {
            console.error('!!!!!!!!!!!!!!!!!Update Config json failed on CLIENT SERVER', beameUtils.stringify(error));
            return;
        }
        //create certificate for received endpoint
        certificateServices.createCSR(serverConfig.EndpointUid, serverConfig.Endpoint, _.bind(onCsrCreated, this));
    }, this));

};

//****************************Private event handlers END****************************************//


//**********************************CONSTRUCTOR************************************************//
/**
 * @param {Number} clientServerPort
 * @param {Object} settings
 * @param {HttpsProxyAgent|null|undefined} [agent]
 * @constructor
 */
function SecureServer(clientServerPort, settings, agent) {
    var self = this;

    this.agent = agent;

    console.log('Enter to Client Server constructor');

    self.proxyUtils = new ProxyUtils(function (instanceData) {
        //set properties
        self.config = self.proxyUtils.config;
        self.availabilityZone = (settings && settings.avlZone) || instanceData.avlZone;

        self.provApiEndpoint = beameUtils.isAmazon() ? provisionSettings.Endpoints.Online : provisionSettings.Endpoints.Local;

        self.state = 'init';

        if (clientServerPort && clientServerPort != serverConfig.DefaultPort) {
            serverConfig.DefaultPort = clientServerPort;
            updateConfigFile(null);
        }

        self.clientServerPort = serverConfig.DefaultPort;

        //init services
        certificateServices = new CertService(self.config.CertRootPath);
        provisionApiServices = new ProvApi(cert_settings);


        var apiUrl = self.provApiEndpoint + provisionSettings.Actions.RegisterHost.endpoint;


        var init = function () {
            if (settings && settings.edgeServerHostname) {
                self.host = settings.edgeServerHostname;

                provisionApiServices.registerHost(apiUrl, self.host, null, _.bind(onEndpointReceived, self));
            }
            else {
                //*****************************************get available endpoint from provision**************************//
                self.host = null;
                self.proxyUtils.selectBestProxy((settings && settings.lb) || self.config.LoadBalancerEndpoint, function (error, data) {
                    if (data && data.endpoint) {
                        // main logic
                        self.host = data.endpoint;
                        self.availabilityZone = data.zone;

                        // test method for local debug
                        // self.host = 'edge.us-east-1b-1.v1.beameio.net';
                        // self.availabilityZone = 'us-east-1b';

                        provisionApiServices.registerHost(apiUrl, self.host, self.availabilityZone, _.bind(onEndpointReceived, self));
                    }
                    else {
                        console.log('!!!!!!!!!! Load Balancer: Instance not found');
                    }
                });
            }

        };

        //check existing configuration
        if (!_.isEmpty(serverConfig.Endpoint) && !_.isEmpty(serverConfig.ProxyHostName)) {

            //*****************************************try read installed certificates**************************//
            readCertificates.call(self, function (error) {
                if (error) {
                    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!on read certificates', error);
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
SecureServer.prototype.startServer = function (callback) {

    var self = this;

    var interval = setInterval(function () {
        if (self.isReady()) {
            readCertificates.call(self, function (error, options) {
                if (error) {
                    self.state = 'error';
                    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!read certificates failed on start', beameUtils.stringify(error));
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
SecureServer.prototype.destroy = function () {
    //destroy proxy
    this.sslProxyClient && this.sslProxyClient.destroy();
    this.sslProxyClient = null;

    //destroy server
    this.clientServer.close(_.bind(function () {
        this.clientServer = null;
    }, this));
};

//****************************Public services END****************************************//
/**
 * @type {SecureServer}
 */
module.exports = SecureServer;