/* global describe, it */
const { lookup, install } = require("..");
const { promisify } = require("util");
const dns = require("dns");
const http = require("http");
const https = require("https");
const HttpsProxyAgent = require("https-proxy-agent");
const assert = require("assert");

const dnsLookup = promisify(dns.lookup);
const hostname = "hyurl.com";
let hostnameIPv4 = "";

async function dnsLookup6(hostname, ipv4) {
    let ipv6;

    try {
        ipv6 = (await dnsLookup(hostname, { family: 6 })).address;
    } catch (err) {
        if (/getaddrinfo/.test(String(err))) {
            // The getaddrinfo function on some system may not resolve IPv6
            // address from the IPv4 address, we need to hack for that.
            ipv6 = `::ffff:${ipv4}`;
        } else {
            throw err;
        }
    }

    return ipv6;
}

describe("lookup()", () => {
    it("should lookup the hostname and return a promise of a string", async () => {
        let addr = await lookup(hostname);
        let _addr = (await dnsLookup(hostname)).address;
        assert.strictEqual(addr, _addr);

        let addr2 = await lookup("localhost");
        let _addr2 = (await dnsLookup("localhost")).address;
        assert.strictEqual(addr2, _addr2);

        let addr3 = await lookup("127.0.0.1");
        let _addr3 = (await dnsLookup("127.0.0.1")).address;
        assert.strictEqual(addr3, _addr3);
    });

    it("should lookup the hostname for IPv4 and return a promise of a string", async () => {
        let addr = await lookup(hostname, 4);
        let _addr = hostnameIPv4 = (await dnsLookup(hostname, { family: 4 })).address;
        assert.strictEqual(addr, _addr);
    });

    it("should lookup a hostname for IPv6 and return a promise of a string", async () => {
        let addr = await lookup(hostname, 6);
        let _addr = await dnsLookup6(hostname, hostnameIPv4);

        assert.strictEqual(addr, _addr);

        let addr2 = await lookup("localhost", 6);
        let _addr2 = (await dnsLookup("localhost", { family: 6 })).address;

        (_addr2 === "::ffff:127.0.0.1") && (_addr2 = "::1");
        assert.strictEqual(addr2, _addr2);

        let addr3 = await lookup("::1", 6);
        let _addr3 = (await dnsLookup("::1", { family: 6 })).address;

        (_addr2 === "::ffff:127.0.0.1") && (_addr2 = "::1");
        assert.strictEqual(addr3, _addr3);
    });

    it("should lookup a hostname and calls the callback function", async () => {
        let addr = await new Promise((resolve, reject) => {
            lookup(hostname, (err, address, family) => {
                err ? reject(err) : resolve({ address, family });
            });
        });
        let _addr = await dnsLookup(hostname);
        assert.deepStrictEqual(addr, _addr);
    });

    it("should lookup a hostname for IPv4 and calls the callback function", async () => {
        let addr = await new Promise((resolve, reject) => {
            lookup(hostname, 4, (err, address, family) => {
                err ? reject(err) : resolve({ address, family });
            });
        });
        let _addr = await dnsLookup(hostname, { family: 4 });
        assert.deepStrictEqual(addr, _addr);
    });

    it("should lookup a hostname for IPv6 and calls the callback function", async () => {
        let addr = await new Promise((resolve, reject) => {
            lookup(hostname, 6, (err, address, family) => {
                err ? reject(err) : resolve({ address, family });
            });
        });
        let _addr = {
            address: await dnsLookup6(hostname, hostnameIPv4),
            family: 6
        };

        assert.deepStrictEqual(addr, _addr);
    });

    it("should lookup the hostname with 'family' option", async () => {
        let addr0 = await lookup(hostname, { family: 0 });
        let _addr0 = (await dnsLookup(hostname, { family: 0 })).address;
        assert.strictEqual(addr0, _addr0);

        let addr4 = await lookup(hostname, { family: 4 });
        let _addr4 = (await dnsLookup(hostname, { family: 4 })).address;
        assert.strictEqual(addr4, _addr4);

        let addr6 = await lookup(hostname, { family: 6 });
        let _addr6 = await dnsLookup6(hostname, addr4);

        assert.strictEqual(addr6, _addr6);
    });

    it("should lookup the hostname with 'all' option", async () => {
        let addr = await lookup(hostname, { all: true });
        let _addr = await dnsLookup(hostname, { all: true });
        assert.deepStrictEqual(addr, _addr);

        let addr0 = await lookup(hostname, { family: 0, all: true });
        let _addr0 = await dnsLookup(hostname, { family: 0, all: true });
        assert.deepStrictEqual(addr0, _addr0);

        let addr4 = await lookup(hostname, { family: 4, all: true });
        let _addr4 = await dnsLookup(hostname, { family: 4, all: true });
        assert.deepStrictEqual(addr4, _addr4);

        let addr6 = await lookup(hostname, { family: 6, all: true });
        let _addr6 = [{
            address: await dnsLookup6(hostname, { family: 6, all: true }),
            family: 6
        }];
        assert.deepStrictEqual(addr6, _addr6);
    });

    it("should lookup the hostname with both options and callback", async () => {
        let addr = await new Promise((resolve, reject) => {
            lookup(hostname, { all: true }, (err, address) => {
                err ? reject(err) : resolve(address);
            });
        });
        let _addr = await dnsLookup(hostname, { all: true });
        assert.deepStrictEqual(addr, _addr);

        let addr6 = await new Promise((resolve, reject) => {
            lookup(hostname, { family: 6, all: true }, (err, address) => {
                err ? reject(err) : resolve(address);
            });
        });
        let _addr6 = [{
            address: await dnsLookup6(hostname, { family: 6, all: true }),
            family: 6
        }];
        assert.deepStrictEqual(addr6, _addr6);
    });
});

describe("install()", () => {
    it("should use custom lookup function after install()", async () => {
        install(http.globalAgent);

        var addr = await lookup(hostname);
        var req = http.get(`http://${hostname}:9000`);
        var msg = await new Promise((resolve) => {
            req.once("error", err => {
                resolve(String(err));
            });
        });

        assert.strictEqual(msg, `Error: connect ECONNREFUSED ${addr}:9000`);
    });

    it("should work with 'https-proxy-agent'", async () => {
        var agent = install(HttpsProxyAgent({ hostname, port: 9000 }));
        var addr = await lookup(hostname);
        var req = https.get(`https://${hostname}:9001`, { agent });
        var msg = await new Promise((resolve) => {
            req.once("error", err => {
                resolve(String(err));
            });
        });

        assert.strictEqual(msg, `Error: connect ECONNREFUSED ${addr}:9000`);
    });
});
