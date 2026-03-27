const BASE_API = "https://api.allanime.day/api";
const BASE_URL = "https://allmanga.to";

const HEADERS = {
    "Referer": "https://allmanga.to/",
    "Origin": "https://allmanga.to",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
};

const SEARCH_HASH = "a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c";
const DETAIL_HASH = "043448386c7a686bc2aabfbb6b80f6074e795d350df48015023b079527b0848a";
const EPISODE_HASH = "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec";

function buildUrl(variables, hash) {
    return BASE_API +
        "?variables=" + encodeURIComponent(JSON.stringify(variables)) +
        "&extensions=" + encodeURIComponent(JSON.stringify({
            persistedQuery: { version: 1, sha256Hash: hash }
        }));
}

async function searchResults(keyword) {
    try {
        const variables = {
            search: { query: keyword, allowAdult: false, allowUnknown: false },
            limit: 26,
            page: 1,
            translationType: "sub",
            countryOrigin: "ALL"
        };
        const res = await soraFetch(buildUrl(variables, SEARCH_HASH));
        const json = await res.json();
        console.log("[allanime] search: " + JSON.stringify(json).slice(0, 300));

        const edges = json.data && json.data.shows && json.data.shows.edges || [];
        return JSON.stringify(edges.map(function(s) {
            return {
                title: s.englishName || s.name || s.nativeName || "Unknown",
                image: s.thumbnail || "",
                href: s._id
            };
        }));
    } catch (e) {
        console.log("searchResults error: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(id) {
    try {
        const variables = { _id: id };
        const res = await soraFetch(buildUrl(variables, DETAIL_HASH));
        const json = await res.json();
        console.log("[allanime] details: " + JSON.stringify(json).slice(0, 300));

        const show = json.data && json.data.show || {};
        const genres = (show.genres || []).join(", ");
        const year = (show.season && show.season.year) || "Unknown";
        const status = show.status || "Unknown";

        return JSON.stringify([{
            description: (show.description || "No description available")
                .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
            aliases: "Type: " + (show.type || "Unknown") + " | Genres: " + genres,
            airdate: "Aired: " + year + " | Status: " + status
        }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(id) {
    try {
        const variables = { _id: id };
        const res = await soraFetch(buildUrl(variables, DETAIL_HASH));
        const json = await res.json();
        const show = json.data && json.data.show || {};
        console.log("[allanime] episodes detail: " + JSON.stringify(show).slice(0, 300));

        const subEps = (show.availableEpisodesDetail && show.availableEpisodesDetail.sub) || [];
        const episodes = subEps.map(function(ep) {
            return {
                href: id + "|sub|" + ep,
                number: parseFloat(ep) || 0
            };
        }).sort(function(a, b) { return a.number - b.number; });

        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(href) {
    try {
        // href is "showId|translationType|episodeString"
        var parts = href.split("|");
        var showId = parts[0];
        var translationType = parts[1] || "sub";
        var episodeString = parts[2] || "1";

        const variables = {
            showId: showId,
            translationType: translationType,
            episodeString: episodeString
        };
        const res = await soraFetch(buildUrl(variables, EPISODE_HASH));
        const json = await res.json();
        console.log("[allanime] stream: " + JSON.stringify(json).slice(0, 500));

        const sourceUrls = json.data && json.data.episode && json.data.episode.sourceUrls || [];
        console.log("[allanime] sources: " + JSON.stringify(sourceUrls).slice(0, 300));

        // Try each source in priority order
        var streamUrl = "";

        // 1. Default source (encrypted URL)
        const defaultSrc = sourceUrls.find(function(s) { return s.sourceName === "Default"; });
        if (defaultSrc) {
            try {
                const decrypted = decryptSource(defaultSrc.sourceUrl);
                const clockUrl = decrypted.replace("/clock?", "/clock.json?");
                const versionRes = await soraFetch(BASE_URL + "/getVersion");
                const versionData = await versionRes.json();
                const endpoint = versionData.episodeIframeHead;
                const clockRes = await soraFetch(endpoint + clockUrl, { headers: { "Referer": BASE_URL + "/" } });
                const clockData = await clockRes.json();
                if (clockData.links && clockData.links[0]) {
                    streamUrl = clockData.links[0].link;
                    console.log("[allanime] default stream: " + streamUrl);
                }
            } catch (e) {
                console.log("[allanime] default extractor failed: " + e);
            }
        }

        // 2. Fm-Hls (FileMoon)
        if (!streamUrl) {
            const fmSrc = sourceUrls.find(function(s) { return s.sourceName === "Fm-Hls"; });
            if (fmSrc) {
                try {
                    streamUrl = await extractFileMoon(fmSrc.sourceUrl);
                } catch (e) {
                    console.log("[allanime] filemoon failed: " + e);
                }
            }
        }

        // 3. Sw (StreamWish)
        if (!streamUrl) {
            const swSrc = sourceUrls.find(function(s) { return s.sourceName === "Sw"; });
            if (swSrc) {
                try {
                    streamUrl = await extractStreamWish(swSrc.sourceUrl);
                } catch (e) {
                    console.log("[allanime] streamwish failed: " + e);
                }
            }
        }

        // 4. Ok (OKru)
        if (!streamUrl) {
            const okSrc = sourceUrls.find(function(s) { return s.sourceName === "Ok"; });
            if (okSrc) {
                try {
                    streamUrl = await extractOkru(okSrc.sourceUrl);
                } catch (e) {
                    console.log("[allanime] okru failed: " + e);
                }
            }
        }

        if (!streamUrl) {
            console.log("[allanime] all extractors failed");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        return JSON.stringify({
            streams: [{ title: "AllAnime (" + translationType.toUpperCase() + ")", streamUrl: streamUrl }],
            subtitle: ""
        });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// Decrypt AllAnime's obfuscated source URL
function decryptSource(str) {
    if (str.startsWith("-")) {
        return str.substring(str.lastIndexOf("-") + 1)
            .match(/.{1,2}/g)
            .map(function(hex) { return parseInt(hex, 16); })
            .map(function(byte) { return String.fromCharCode(byte ^ 56); })
            .join("");
    }
    return str;
}

// FileMoon extractor
async function extractFileMoon(url) {
    const res = await soraFetch(url);
    const html = await res.text();
    const script = extractEvalScript(html);
    if (script) {
        const unpacked = unpack(script);
        const match = unpacked.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        if (match) return match[0];
    }
    // Try iframe
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
        const iframeRes = await soraFetch(iframeMatch[1]);
        const iframeHtml = await iframeRes.text();
        const iframeScript = extractEvalScript(iframeHtml);
        if (iframeScript) {
            const unpacked = unpack(iframeScript);
            const match = unpacked.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
            if (match) return match[0];
        }
    }
    return "";
}

// StreamWish extractor
async function extractStreamWish(url) {
    const res = await soraFetch(url);
    const html = await res.text();
    const script = extractEvalScript(html);
    if (script) {
        const unpacked = unpack(script);
        const match = unpacked.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        if (match) return match[0];
    }
    return "";
}

// OKru extractor
async function extractOkru(url) {
    const res = await soraFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36" }
    });
    const html = await res.text();
    const match = html.match(/data-options="([^"]*)"/);
    if (match) {
        const json = JSON.parse(match[1].replace(/&quot;/g, '"'));
        const metadata = JSON.parse(json.flashvars && json.flashvars.metadata || "{}");
        return metadata.hlsManifestUrl || metadata.ondemandHls || "";
    }
    return "";
}

function extractEvalScript(html) {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    while ((match = scriptRegex.exec(html)) !== null) {
        if (match[1].includes("eval") && (match[1].includes("m3u8") || match[1].includes("p,a,c,k,e,d"))) {
            return match[1];
        }
    }
    return null;
}

async function soraFetch(url, options) {
    options = options || {};
    var headers = options.headers || HEADERS;
    var method = options.method || "GET";
    var body = options.body || null;
    try {
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        return await fetch(url, { headers: headers, method: method, body: body });
    }
}

// p.a.c.k.e.r deobfuscator
class Unbaser {
    constructor(base) {
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
        };
        this.base = base;
        this.dictionary = {};
        if (2 <= base && base <= 36) {
            this.unbase = function(v) { return parseInt(v, base); };
        } else {
            var alpha = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
            var dict = this.dictionary;
            alpha.split("").forEach(function(c, i) { dict[c] = i; });
            this.unbase = this._dictunbaser.bind(this);
        }
    }
    _dictunbaser(value) {
        var ret = 0;
        var dict = this.dictionary;
        var base = this.base;
        value.split("").reverse().forEach(function(c, i) {
            ret += Math.pow(base, i) * (dict[c] || 0);
        });
        return ret;
    }
}

function unpack(source) {
    var juicers = [
        /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
        /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
    ];
    var args = null;
    for (var i = 0; i < juicers.length; i++) {
        args = juicers[i].exec(source);
        if (args) break;
    }
    if (!args) return source;
    var payload = args[1];
    var radix = parseInt(args[2]);
    var count = parseInt(args[3]);
    var symtab = args[4].split("|");
    if (count !== symtab.length) return source;
    var unbase = new Unbaser(radix);
    return payload.replace(/\b\w+\b/g, function(word) {
        var idx = radix === 1 ? parseInt(word) : unbase.unbase(word);
        return symtab[idx] || word;
    });
}
