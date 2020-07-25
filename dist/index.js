"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const dns = require("dns");
const fs = require("fs-extra");
const net_1 = require("net");
const util_1 = require("util");
const useThrottle_1 = require("@hyurl/utils/useThrottle");
const isEmpty_1 = require("@hyurl/utils/isEmpty");
const resolve4 = util_1.promisify(dns.resolve4);
const resolve6 = util_1.promisify(dns.resolve6);
const hostsThrottle = useThrottle_1.default("dnsLookup:loadHostsConfig", 10000);
const _createConnection = Symbol("_createConnection");
var HostsConfig;
var timer = setInterval(() => tslib_1.__awaiter(void 0, void 0, void 0, function* () {
    HostsConfig = yield hostsThrottle(loadHostsConfig);
}), 10000);
process.once("beforeExit", () => clearInterval(timer));
function loadHostsConfig(file = "") {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!file) {
            if (process.platform === "win32") {
                file = "c:\\Windows\\System32\\Drivers\\etc\\hosts";
            }
            else {
                file = "/etc/hosts";
            }
        }
        return (yield fs.readFile(file, "utf8")).split(/\r\n|\n/)
            .map(line => line.trim())
            .filter(line => !line.startsWith("#"))
            .map(line => line.split(/\s+/))
            .reduce((configs, segments) => {
            segments.slice(1).forEach(hostname => {
                let family = net_1.isIP(segments[0]);
                if (family) {
                    (configs[hostname] || (configs[hostname] = [])).push({
                        address: segments[0],
                        family
                    });
                }
            });
            return configs;
        }, {});
    });
}
function lookup(hostname, options = void 0, callback = null) {
    let family = 0;
    let all = false;
    if (typeof options === "object") {
        family = options.family || 0;
        all = options.all || false;
    }
    else if (typeof options === "number") {
        family = options;
    }
    else if (typeof options === "function") {
        callback = options;
    }
    let _family = net_1.isIP(hostname);
    if (_family) {
        if (all) {
            if (callback) {
                return callback(null, [{ address: hostname, family: _family }]);
            }
            else {
                return Promise.resolve([{ address: hostname, family: _family }]);
            }
        }
        else {
            if (callback) {
                return callback(null, hostname, _family);
            }
            else {
                return Promise.resolve(hostname);
            }
        }
    }
    let tag = `dnsLookup:${hostname}:${family}:${all}`;
    let query = useThrottle_1.default(tag, 10000)(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!HostsConfig) {
            HostsConfig = yield hostsThrottle(loadHostsConfig);
        }
        let addresses = HostsConfig[hostname] || [];
        let err4;
        let err6;
        if (isEmpty_1.default(addresses)) {
            if (!family || family === 4) {
                try {
                    addresses.push(...(yield resolve4(hostname)).map(address => ({ address, family: 4 })));
                }
                catch (e) {
                    err4 = e;
                }
            }
            if (!family || family === 6) {
                try {
                    addresses.push(...(yield resolve6(hostname)).map(address => ({ address, family: 6 })));
                }
                catch (e) {
                    if (e.code === "ENODATA" &&
                        e.syscall === "queryAaaa" &&
                        family === 6) {
                        try {
                            addresses.push(...(yield resolve4(hostname)).map(address => ({
                                address: `::ffff:${address}`,
                                family: 6
                            })));
                        }
                        catch (_e) {
                            err6 = e;
                        }
                    }
                    else {
                        err6 = e;
                    }
                }
            }
        }
        if (err4 && err6 && !family) {
            throw Object.assign(new Error(`queryA and queryAaaa ENODATA ${hostname}`), {
                errno: undefined,
                code: "ENODATA",
                syscall: undefined,
                hostname
            });
        }
        else if (err4 && family === 4) {
            throw err4;
        }
        else if (err6 && family === 6) {
            throw err6;
        }
        else {
            return addresses;
        }
    }));
    if (!callback) {
        return query.then(addresses => {
            if (all) {
                if (family) {
                    return addresses.filter(a => a.family === family);
                }
                else {
                    return addresses;
                }
            }
            else {
                if (family) {
                    return addresses.find(a => a.family === family).address;
                }
                else {
                    return addresses[0].address;
                }
            }
        });
    }
    else {
        query.then(addresses => {
            if (all) {
                if (family) {
                    callback(null, addresses.filter(a => a.family === family));
                }
                else {
                    callback(null, addresses);
                }
            }
            else {
                if (family) {
                    callback(null, addresses.find(a => a.family === family).address, family);
                }
                else {
                    callback(null, addresses[0].address, addresses[0].family);
                }
            }
        }).catch(err => {
            callback(err, void 0);
        });
    }
}
exports.lookup = lookup;
function install(agent, family = 0) {
    if (_createConnection in agent)
        return agent;
    else if (typeof agent["createConnection"] !== "function")
        throw new TypeError("Cannot install lookup function on the given agent");
    agent[_createConnection] = agent["createConnection"];
    agent["createConnection"] = function (options, callback) {
        if (!("lookup" in options)) {
            options["lookup"] = function (hostname, options, callback) {
                var _a;
                return lookup(hostname, (_a = options["family"]) !== null && _a !== void 0 ? _a : family, callback);
            };
        }
        return agent[_createConnection](options, callback);
    };
    return agent;
}
exports.install = install;
//# sourceMappingURL=index.js.map