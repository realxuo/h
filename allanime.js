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

async function extractStreamUrl(href) {
    try {
        var parts = href.split("|");
        var showId = parts[0];
        var translationType = parts[1] || "dub";
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

        const defaultSrc = sourceUrls.find(function(s) { return s.sourceName === "Default"; });
        if (!defaultSrc) {
            console.log("[allanime] no Default source found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const decrypted = decryptSource(defaultSrc.sourceUrl);
        const clockUrl = decrypted.replace("/clock?", "/clock.json?");
        const clockRes = await soraFetch("https://allanime.day/apivtwo" + clockUrl, { headers: { "Referer": BASE_URL + "/" } });
        const clockData = await clockRes.json();
        console.log("[allanime] clock links: " + JSON.stringify(clockData.links));
        const links = clockData.links || [];
        if (!links.length) {
            console.log("[allanime] no links in clock response");
            return JSON.stringify({ streams: [], subtitle: "" });
        }
        console.log("[allanime] clock links: " + JSON.stringify(links));

        // Prefer SharePoint/mp4, fallback to first
        var preferred = links.find(function(l) { return l.mp4 || l.link.includes("sharepoint.com"); });
        if (!preferred) preferred = links.find(function(l) { return l.link && !l.link.includes("fast4speed"); });
        if (!preferred) preferred = links[0];

        const streamUrl = preferred.link || preferred.src || "";
        const isMp4 = preferred.mp4 === true;

        if (!streamUrl) {
            console.log("[allanime] no stream link in clock response");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        console.log("[allanime] stream URL: " + streamUrl + " mp4:" + isMp4);
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