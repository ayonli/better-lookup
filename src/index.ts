import * as dns from "dns";
import * as fs from "fs-extra";
import { isIP } from "net";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { promisify } from "util";
import useThrottle from "@hyurl/utils/useThrottle";
import isEmpty from "@hyurl/utils/isEmpty";
import timestamp from "@hyurl/utils/timestamp";

type AddressInfo = { address: string, family: 4 | 6; };
type AddressInfoDetail = AddressInfo & { expireAt: number; };
type LookupCallback<T extends string | AddressInfo[]> = (
    err: NodeJS.ErrnoException,
    address: T,
    family?: 4 | 6
) => void;

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);
const hostsThrottle = useThrottle("dnsLookup:loadHostsConfig", 10_000);
const _createConnection = Symbol("_createConnection");
const Cache: Record<string, AddressInfoDetail[]> = {};

var HostsConfig: Record<string, AddressInfoDetail[]>;
var timer = setInterval(async () => { // reload hosts file for every 10 seconds.
    HostsConfig = await hostsThrottle(loadHostsConfig);
}, 10_000);

process.once("beforeExit", () => clearInterval(timer));

async function loadHostsConfig(file: string = "") {
    if (!file) {
        if (process.platform === "win32") {
            file = "c:\\Windows\\System32\\Drivers\\etc\\hosts";
        } else {
            file = "/etc/hosts";
        }
    }

    return (await fs.readFile(file, "utf8")).split(/\r\n|\n/)
        .map(line => line.trim())
        .filter(line => !line.startsWith("#"))
        .map(line => line.split(/\s+/))
        .reduce((configs: Record<string, AddressInfoDetail[]>, segments) => {
            let expireAt = timestamp() + 10; // mark available for 10 seconds

            segments.slice(1).forEach(hostname => {
                let family = isIP(segments[0]) as 0 | 4 | 6;

                if (family) {
                    (configs[hostname] || (configs[hostname] = [])).push({
                        address: segments[0],
                        family,
                        expireAt
                    });
                }
            });

            return configs;
        }, {});
}

/**
 * Queries IP addresses of the given hostname, this operation is async and
 * atomic, and uses cache when available. When `family` is omitted, both
 * `A (IPv4)` and `AAAA (IPv6)` records are searched, however only one address
 * will be returned if `options.all` is not set.
 * 
 * NOTE: The internal TTL for an identical query is 10 seconds.
 */
export function lookup(hostname: string, family?: 0 | 4 | 6): Promise<string>;
export function lookup(hostname: string, callback: LookupCallback<string>): void;
export function lookup(
    hostname: string,
    family: 0 | 4 | 6,
    callback: LookupCallback<string>
): void;
export function lookup(
    hostname: string,
    options: { family?: 0 | 4 | 6; }
): Promise<string>;
export function lookup(
    hostname: string,
    options: { family?: 0 | 4 | 6; },
    callback: LookupCallback<string>
): void;
export function lookup(
    hostname: string,
    options: { family?: 0 | 4 | 6; all: true; }
): Promise<AddressInfo[]>;
export function lookup(
    hostname: string,
    options: { family?: 0 | 4 | 6; all: true; },
    callback: LookupCallback<AddressInfo[]>
): void;
export function lookup(
    hostname: string,
    options: any = void 0,
    callback: any = null
): any {
    let family: 0 | 4 | 6 = 0;
    let all = false;

    if (typeof options === "object") {
        family = options.family || 0;
        all = options.all || false;
    } else if (typeof options === "number") {
        family = options as 0 | 4 | 6;
    } else if (typeof options === "function") {
        callback = options;
    }

    let _family = isIP(hostname) as 0 | 4 | 6;

    if (_family) {
        if (all) {
            if (callback) {
                return callback(null, [{ address: hostname, family: _family }]);
            } else {
                return Promise.resolve([{ address: hostname, family: _family }]);
            }
        } else {
            if (callback) {
                return callback(null, hostname, _family);
            } else {
                return Promise.resolve(hostname);
            }
        }
    }

    let query: Promise<AddressInfo[]>;

    // If local cache contains records of the target hostname, try to retrieve
    // them and prevent network query.
    if (!isEmpty(Cache[hostname])) {
        let now = timestamp();
        let addresses = Cache[hostname].filter(a => a.expireAt > now);

        if (family) {
            addresses = addresses.filter(a => a.family === family);
        }

        if (!isEmpty(addresses)) {
            query = Promise.resolve(addresses);
        }
    }

    // If local cache doesn't contain available records, then goto network
    // query.
    if (!query) {
        let tag = `dnsLookup:${hostname}:${family}:${all}`;

        query = useThrottle(tag, 10_000)(async () => {
            if (!HostsConfig) {
                HostsConfig = await hostsThrottle(loadHostsConfig);
            }

            let result: AddressInfoDetail[] = HostsConfig[hostname] || [];
            let err4: NodeJS.ErrnoException;
            let err6: NodeJS.ErrnoException;

            if (isEmpty(result)) {
                if (!family || family === 4) {
                    try {
                        let records = await resolve4(hostname, { ttl: true });
                        let now = timestamp();
                        let addresses = records.map(record => ({
                            address: record.address,
                            family: 4 as 4,
                            // In case the DNS refresh the record, we only allow
                            // 10 seconds for maximum cache time.
                            expireAt: Math.max(record.ttl + now, 10)
                        }));

                        result.push(...addresses);

                        // Cache the records.
                        if (Cache[hostname]) {
                            Cache[hostname] = Cache[hostname].filter(
                                a => a.family !== 4 // remove history
                            );
                            Cache[hostname].unshift(...addresses);
                        } else {
                            Cache[hostname] = addresses;
                        }
                    } catch (e) {
                        err4 = e;
                    }
                }

                if (!family || family === 6) {
                    try {
                        let records = await resolve6(hostname, { ttl: true });
                        let now = timestamp();
                        let addresses = records.map(record => ({
                            address: record.address,
                            family: 6 as 6,
                            expireAt: Math.max(record.ttl + now, 10)
                        }));

                        result.push(...addresses);

                        // Cache the records.
                        if (Cache[hostname]) {
                            Cache[hostname] = Cache[hostname].filter(
                                a => a.family !== 6 // remove history
                            );
                            Cache[hostname].push(...addresses);
                        } else {
                            Cache[hostname] = addresses;
                        }
                    } catch (e) {
                        if (e.code === "ENODATA" &&
                            e.syscall === "queryAaaa" &&
                            family === 6
                        ) {
                            try {
                                let records = await resolve4(hostname, {
                                    ttl: true
                                });
                                let now = timestamp();

                                result.push(...records.map(record => ({
                                    address: `::ffff:${record.address}`,
                                    family: 6 as 6,
                                    expireAt: Math.max(record.ttl + now, 10)
                                })));

                                // Cache the records.
                                let addresses = records.map(record => ({
                                    address: record.address,
                                    family: 4 as 4,
                                    expireAt: Math.max(record.ttl + now, 10)
                                }));

                                if (Cache[hostname]) {
                                    Cache[hostname] = Cache[hostname].filter(
                                        a => a.family !== 4 // remove history
                                    );
                                    Cache[hostname].unshift(...addresses);
                                } else {
                                    Cache[hostname] = addresses;
                                }
                            } catch (_e) {
                                err6 = e;
                            }
                        } else {
                            err6 = e;
                        }
                    }
                }
            }

            if (err4 && err6 && !family) {
                throw Object.assign(
                    new Error(`queryA and queryAaaa ENODATA ${hostname}`),
                    {
                        errno: undefined,
                        code: "ENODATA",
                        syscall: undefined,
                        hostname
                    }
                );
            } else if (err4 && family === 4) {
                throw err4;
            } else if (err6 && family === 6) {
                throw err6;
            } else {
                return result;
            }
        });
    }

    if (query) {
        query = query.then(addresses => addresses.map(({ address, family }) => {
            // Make sure the result only contains 'address' and 'family'.
            return { address, family };
        }));
    }

    if (!callback) {
        return query.then(addresses => {
            if (all) {
                if (family) {
                    return addresses.filter(a => a.family === family);
                } else {
                    return addresses;
                }
            } else {
                if (family) {
                    return addresses.find(a => a.family === family).address;
                } else {
                    return addresses[0].address;
                }
            }
        });
    } else {
        query.then(addresses => {
            if (all) {
                if (family) {
                    callback(null, addresses.filter(a => a.family === family));
                } else {
                    callback(null, addresses);
                }
            } else {
                if (family) {
                    callback(
                        null,
                        addresses.find(a => a.family === family).address,
                        family
                    );
                } else {
                    callback(null, addresses[0].address, addresses[0].family);
                }
            }
        }).catch(err => {
            callback(err, void 0);
        });
    }
}

/**
 * Attaches the custom lookup functionality to the given `agent`, the `family` 
 * argument configures the default IP family used to resolve addresses when no
 * `family` option is specified in the `http.request()`, the default value is
 * `0`. 
 */
export function install<T extends HttpAgent | HttpsAgent>(
    agent: T,
    family: 0 | 4 | 6 = 0
): T {
    if (_createConnection in agent)
        return agent;
    else if (typeof agent["createConnection"] !== "function")
        throw new TypeError("Cannot install lookup function on the given agent");

    agent[_createConnection] = agent["createConnection"];
    agent["createConnection"] = function (options: any, callback: Function) {
        if (!("lookup" in options)) {
            options["lookup"] = function (
                hostname: string,
                options: any,
                callback: LookupCallback<string>
            ) {
                return lookup(hostname, options["family"] ?? family, callback);
            };
        }

        return agent[_createConnection](options, callback);
    };

    return agent;
}