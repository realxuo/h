const BASE_API = "https://api.allanime.day/api";
const BASE_URL = "https://allmanga.to";
const CLOCK_BASE = "https://allanime.day/apivtwo";

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
        "?variables=" + JSON.stringify(variables) +
        "&extensions=" + JSON.stringify({
            persistedQuery: { version: 1, sha256Hash: hash }
        });
}

function decryptSource(str) {
    if (str.startsWith("--")) {
        return str.substring(2)
            .match(/.{1,2}/g)
            .map(function(hex) { return parseInt(hex, 16); })
            .map(function(byte) { return String.fromCharCode(byte ^ 56); })
            .join("");
    }
    return str;
}

async function searchResults(keyword) {
    try {
        const variables = {
            search: { query: keyword, allowAdult: false, allowUnknown: false },
            limit: 26,
            page: 1,
            translationType: "dub",
            countryOrigin: "ALL"
        };
        const res = await soraFetch(buildUrl(variables, SEARCH_HASH));
        const json = await res.json();
        const edges = (json.data && json.data.shows && json.data.shows.edges) || [];
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
        const show = await fetchShowDetail(id);
        const genres = (show.genres || []).join(", ");
        const year = (show.season && show.season.year) || "Unknown";
        return JSON.stringify([{
            description: (show.description || "No description available")
                .replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(),
            aliases: "Type: " + (show.type || "Unknown") + " | Genres: " + genres,
            airdate: "Aired: " + year + " | Score: " + (show.score || "N/A")
        }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(id) {
    try {
        const show = await fetchShowDetail(id);
        const dubEps = (show.availableEpisodesDetail && show.availableEpisodesDetail.dub) || [];
        const episodes = dubEps.map(function(ep) {
            return {
                href: id + "|dub|" + ep,
                number: parseFloat(ep) || 0
            };
        }).sort(function(a, b) { return a.number - b.number; });
        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function fetchShowDetail(id) {
    const res = await soraFetch(buildUrl({ _id: id }, DETAIL_HASH));
    const json = await res.json();
    return (json.data && json.data.show) || {};
}

async function extractStreamUrl(href) {
    try {
        var parts = href.split("|");
        var showId = parts[0];
        var translationType = parts[1] || "dub";
        var episodeString = parts[2] || "1";

        const res = await soraFetch(buildUrl({
            showId: showId,
            translationType: translationType,
            episodeString: episodeString
        }, EPISODE_HASH));
        const json = await res.json();
        const episode = (json.data && json.data.episode) || {};
        const sourceUrls = episode.sourceUrls || [];
        console.log("[allanime] sources: " + sourceUrls.map(function(s) { return s.sourceName; }).join(", "));

        // Source priority: Yt-mp4 (direct) > S-mp4 (clock) > Luf-Mp4 (clock) > Default (clock)
        var streamUrl = "";

        // 1. Yt-mp4 — decrypts directly to a CDN URL
        var ytSrc = sourceUrls.find(function(s) { return s.sourceName === "Yt-mp4"; });
        if (ytSrc) {
            try {
                var decrypted = decryptSource(ytSrc.sourceUrl);
                if (decrypted.startsWith("http") && !decrypted.includes("fast4speed")) {
                    streamUrl = decrypted;
                    console.log("[allanime] Yt-mp4: " + streamUrl);
                }
            } catch(e) { console.log("[allanime] Yt-mp4 failed: " + e); }
        }

        // 2. Clock-based (S-mp4, Luf-Mp4) — skip SharePoint and fast4speed
        if (!streamUrl) {
            var clockSrc = sourceUrls.find(function(s) {
                return s.sourceName === "S-mp4" || s.sourceName === "Luf-Mp4";
            });
            if (clockSrc) {
                try {
                    var clockPath = decryptSource(clockSrc.sourceUrl).replace("/clock?", "/clock.json?");
                    var clockRes = await soraFetch(CLOCK_BASE + clockPath, { headers: { "Referer": BASE_URL + "/" } });
                    var clockData = await clockRes.json();
                    var links = (clockData.links || []).filter(function(l) {
                        return l.link && !l.link.includes("sharepoint") && !l.link.includes("fast4speed");
                    });
                    if (links.length) {
                        streamUrl = links[0].link || "";
                        console.log("[allanime] clock stream: " + streamUrl);
                    }
                } catch(e) { console.log("[allanime] clock failed: " + e); }
            }
        }

        // 3. Mp4Upload
        if (!streamUrl) {
            var mp4Src = sourceUrls.find(function(s) { return s.sourceName === "Mp4"; });
            if (mp4Src) {
                try {
                    streamUrl = await extractMp4Upload(mp4Src.sourceUrl);
                    console.log("[allanime] mp4upload: " + streamUrl);
                } catch(e) { console.log("[allanime] mp4upload failed: " + e); }
            }
        }

        // 4. OKru
        if (!streamUrl) {
            var okSrc = sourceUrls.find(function(s) { return s.sourceName === "Ok"; });
            if (okSrc) {
                try {
                    streamUrl = await extractOkru(okSrc.sourceUrl);
                    console.log("[allanime] okru: " + streamUrl);
                } catch(e) { console.log("[allanime] okru failed: " + e); }
            }
        }

        if (!streamUrl) {
            console.log("[allanime] no stream found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        return JSON.stringify({
            streams: [{ 
                title: "AllAnime (DUB)",
                streamUrl: streamUrl,
                headers: { "Referer": "https://allmanga.to/" }
            }],
            subtitle: ""
        });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

async function extractMp4Upload(url) {
    const res = await soraFetch(url, { headers: { "Referer": "https://mp4upload.com/" } });
    const html = await res.text();
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (var i = 0; i < scripts.length; i++) {
        var content = scripts[i].replace(/<\/?script[^>]*>/gi, "");
        if (content.includes("player.src")) {
            var match = content.match(/src:\s*["']([^"']+\.mp4[^"']*)['"]/);
            if (match) return match[1];
        }
    }
    return "";
}

async function extractOkru(url) {
    const res = await soraFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36" } });
    const html = await res.text();
    const match = html.match(/data-options="([^"]*)"/);
    if (match) {
        try {
            const opts = JSON.parse(match[1].replace(/&quot;/g, '"'));
            const metadata = JSON.parse((opts.flashvars && opts.flashvars.metadata) || "{}");
            return metadata.hlsManifestUrl || metadata.ondemandHls || "";
        } catch(e) {}
    }
    return "";
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