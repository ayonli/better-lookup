# Better Lookup

**A better async DNS lookup function for Node.js that implements atomic**
**cache operation.**

## The problem of `dns.lookup`

This is a quotation from the Node.js official website:

> Though the call to `dns.lookup()` will be asynchronous from JavaScript's
> perspective, it is implemented as a synchronous call to `getaddrinfo(3)`
> that runs on libuv's threadpool. This can have surprising negative performance
> implications for some applications.

It is very unfortunate that I have been suffering from this problem for quite a
long time before I realized it. Then I found some solutions on NPM:

- [cacheable-lookup](https://www.npmjs.com/package/cacheable-lookup)
- [dns-lookup-cache](https://www.npmjs.com/package/dns-lookup-cache)

But after trying them out, I found there are still some problems in them, for 
example, they don't implements atomic operation, which means the cache 
write-procedure may happen many times when firing multiple requests at the 
same time.

So I decided to write my own lookup function and after using it for a while, I
decided to share it on NPM.

### How to perform atomic operation

This package uses a throttle method to queue operations of the same 
source/tag, which guarantees an atomic operation in async scenarios, and that
will ensure no matter how many requests are fired at the same time, there will 
always be only one write-procedure for the cache.

This package uses `dns.resolve4()` and `dns.resolve6()` under the hood, which is
the real-async replacements for `dns.lookup()`, and implements the `/etc/hosts`
file support (both on Unix-like and WinNT platforms).

## Example

### Using `lookup`

```ts
import * as https from "https";
import { lookup } from "better-lookup";

var req = https.get("https://github.com/ayonli/better-lookup", {
    lookup
}, res => {
    // ...
});

// Or only resolve to Ipv4 records, works better for most of the websites.
var req = https.get("https://github.com/ayonli/better-lookup", {
    family: 4,
    lookup
}, res => {
    // ...
});
```

### Using `install`

Other than using the `lookup` option for requests (some packages, like Axios,
may not support it), we can attach the lookup functionality to the HTTP(S)
agent via `install()`.

```ts
import * as https from "https";
import { install } from "better-lookup";

install(https.globalAgent);

var req = https.get("https://github.com/ayonli/better-lookup", res => {
    // ...
});
```

## API

## Types

```ts
type AddressInfo = { address: string, family: 4 | 6; };
type LookupCallback<T extends string | AddressInfo[]> = (
    err: NodeJS.ErrnoException,
    address: T,
    family?: 4 | 6
) => void;
```

### lookup

```ts
/**
 * Queries IP addresses of the given hostname, this operation is async and
 * atomic, and uses cache when available. When `family` is omitted, both
 * `A (IPv4)` and `AAAA (IPv6)` records are searched, however only one address
 * will be returned if `options.all` is not set.
 * 
 * NOTE: TTL is support by this function, but it will enforce refreshing after
 * 10 seconds.
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
```

### install

```ts
/**
 * Attaches the custom lookup functionality to the given `agent`, the `family` 
 * argument configures the default IP family used to resolve addresses when no
 * `family` option is specified in the `http.request()`, the default value is
 * `0`. 
 */
export function install<T extends HttpAgent | HttpsAgent>(
    agent: T,
    family?: 0 | 4 | 6
): T;
```
