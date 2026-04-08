const BASE_URL = "https://cinetaro.tv";
const RAPID_CLOUD_URL = "https://rapid-cloud.co";

async function searchResults(keyword) {
    try {
        const url = BASE_URL + "/search?keyword=" + encodeURIComponent(keyword);
        const res = await soraFetch(url);
        const html = await res.text();

        const results = [];
        const itemRegex = /<div class="flw-item">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
        const hrefRegex = /href="([^"]+)"[^>]*title="([^"]+)"/;
        const imgRegex = /data-src="([^"]+)"/;
        const typeRegex = /tick-eps[^>]*>[^<]*([A-Za-z\s]+)<\/div>/;

        let match;
        while ((match = itemRegex.exec(html)) !== null) {
            const block = match[1];
            const hrefMatch = hrefRegex.exec(block);
            const imgMatch = imgRegex.exec(block);
            if (!hrefMatch) continue;

            const href = hrefMatch[1];
            const title = hrefMatch[2];
            const image = imgMatch ? imgMatch[1] : "";

            results.push({ title: title, image: image, href: href });
        }

        return JSON.stringify(results);
    } catch (e) {
        console.log("searchResults error: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(href) {
    try {
        const res = await soraFetch(BASE_URL + href);
        const html = await res.text();

        const descMatch = html.match(/class="text"[^>]*>\s*([\s\S]*?)<span/);
        const desc = descMatch ? descMatch[1].replace(/<[^>]*>/g, "").trim() : "No description available";

        const airedMatch = html.match(/Aired:<\/span>\s*<span[^>]*>([^<]+)/);
        const statusMatch = html.match(/Status:<\/span>\s*<span[^>]*>([^<]+)/);

        return JSON.stringify([{
            description: desc,
            aliases: "",
            airdate: "Aired: " + (airedMatch ? airedMatch[1].trim() : "Unknown") +
                     " | Status: " + (statusMatch ? statusMatch[1].trim() : "Unknown")
        }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(href) {
    try {
        // href like /watch/202555?tv&ep=1 or /details/202555?tv
        // Get the watch page to scrape episode list
        var watchUrl = href;
        if (href.includes("/details/")) {
            // Convert details page to watch page
            var idMatch = href.match(/\/details\/(\d+)/);
            if (idMatch) {
                var type = href.includes("?tv") ? "tv" : "m";
                watchUrl = "/watch/" + idMatch[1] + "?" + type + "&ep=1";
            }
        }

        const res = await soraFetch(BASE_URL + watchUrl);
        const html = await res.text();

        const episodes = [];
        // Extract episode items: data-number="1" data-id="202555-1-1"
        const epRegex = /data-number="(\d+)"\s+data-id="([^"]+)"/g;
        let match;
        while ((match = epRegex.exec(html)) !== null) {
            episodes.push({
                number: parseInt(match[1]),
                href: match[2] // e.g. "202555-1-1"
            });
        }

        episodes.sort(function(a, b) { return a.number - b.number; });
        console.log("[cinetaro] episodes found: " + episodes.length);
        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(episodeId) {
    try {
        // episodeId is like "202555-1-1" (showId-season-episode)
        console.log("[cinetaro] fetching servers for: " + episodeId);

        // Fetch server list
        const serverRes = await soraFetch(BASE_URL + "/src/ajax/anime/server.php?episodeId=" + episodeId);
        const servers = await serverRes.json();
        console.log("[cinetaro] servers: " + JSON.stringify(servers).slice(0, 300));

        // Find server — prefer dub over sub
        var server = null;
        var serverType = "dub";
        var categories = ["softdub", "harddub", "softsub", "hardsub"];
        for (var i = 0; i < categories.length; i++) {
            var cat = servers[categories[i]];
            if (cat && cat.length) {
                // Prefer Vidcloud/MegaCloud
                server = cat.find(function(s) { return /vidcloud|megacloud/i.test(s.serverName); }) || cat[0];
                serverType = (categories[i].includes("dub")) ? "dub" : "sub";
                break;
            }
        }

        if (!server) {
            console.log("[cinetaro] no server found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        console.log("[cinetaro] using server: " + server.serverName + " id:" + server.serverId);

        // Get the player page to extract embed URL
        var parts = episodeId.split("-");
        var epNum = parts[parts.length - 1];
        var encodedId = encodeURIComponent(episodeId);
        var playerUrl = BASE_URL + "/src/player/" + serverType + ".php?id=" + encodedId +
            "&server=" + server.serverId + "&embed=true&ep=" + epNum;

        const playerRes = await soraFetch(playerUrl);
        const playerHtml = await playerRes.text();
        console.log("[cinetaro] player html: " + playerHtml.slice(0, 300));

        // Extract RapidCloud embed ID
        var rcMatch = playerHtml.match(/rapid-cloud\.co\/embed[^"']*[?&]id=([A-Za-z0-9_-]+)/);
        if (!rcMatch) {
            rcMatch = playerHtml.match(/rapid-cloud\.co\/embed-[^"'\/]+\/([A-Za-z0-9_-]+)/);
        }
        if (!rcMatch) {
            console.log("[cinetaro] no rapidcloud embed found");
            // Try to extract m3u8 directly
            var m3u8Match = playerHtml.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
            if (m3u8Match) {
                return JSON.stringify({
                    streams: [{ title: "Cinetaro", streamUrl: m3u8Match[0] }],
                    subtitle: ""
                });
            }
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        var embedId = rcMatch[1];
        console.log("[cinetaro] embed id: " + embedId);

        // Fetch getSources
        const sourcesRes = await soraFetch(
            RAPID_CLOUD_URL + "/embed-2/v2/e-1/getSources?id=" + embedId,
            { headers: { "Referer": BASE_URL + "/", "X-Requested-With": "XMLHttpRequest" } }
        );
        const sourcesData = await sourcesRes.json();
        console.log("[cinetaro] sources: " + JSON.stringify(sourcesData).slice(0, 400));

        var streamUrl = "";
        var subtitle = "";

        // Sources may be encrypted — try direct first
        if (sourcesData.sources && typeof sourcesData.sources === "string") {
            // Encrypted — use enc-dec.app to decrypt
            try {
                const decRes = await soraFetch(
                    "https://enc-dec.app/api/dec-mega",
                    {
                        headers: { "Content-Type": "application/json" },
                        method: "POST",
                        body: JSON.stringify({ text: sourcesData.sources, agent: "Mozilla/5.0" })
                    }
                );
                const decData = await decRes.json();
                console.log("[cinetaro] decrypted: " + JSON.stringify(decData).slice(0, 300));
                if (decData.result && decData.result.sources && decData.result.sources[0]) {
                    streamUrl = decData.result.sources[0].file || decData.result.sources[0].url || "";
                }
            } catch (e) {
                console.log("[cinetaro] decrypt failed: " + e);
            }
        } else if (sourcesData.sources && Array.isArray(sourcesData.sources) && sourcesData.sources[0]) {
            streamUrl = sourcesData.sources[0].file || sourcesData.sources[0].url || "";
        }

        // Extract English subtitle from RapidCloud tracks
        if (sourcesData.tracks) {
            var enTrack = sourcesData.tracks.find(function(t) {
                return t.label && /english/i.test(t.label) && t.kind === "captions";
            }) || sourcesData.tracks.find(function(t) { return t.kind === "captions"; });
            if (enTrack) subtitle = enTrack.file || enTrack.src || "";
        }

        // Fallback: wyzie.io subtitles using TMDB ID
        if (!subtitle) {
            try {
                var tmdbId = episodeId.split("-")[0];
                var wyzieRes = await soraFetch(
                    "https://sub.wyzie.io/search?id=" + tmdbId + "&key=wyzie-53f263aa7f417f95f806e4bd5434eff7"
                );
                var wyzieData = await wyzieRes.json();
                if (Array.isArray(wyzieData)) {
                    var enSub = wyzieData.find(function(s) {
                        return s.language === "en" && !s.isHearingImpaired;
                    }) || wyzieData.find(function(s) { return s.language === "en"; });
                    if (enSub) {
                        subtitle = enSub.url;
                        console.log("[cinetaro] wyzie subtitle: " + subtitle);
                    }
                }
            } catch (e) {
                console.log("[cinetaro] wyzie failed: " + e);
            }
        }

        if (!streamUrl) {
            console.log("[cinetaro] no stream URL found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        return JSON.stringify({
            streams: [{ title: "Cinetaro", streamUrl: streamUrl, headers: { "Referer": RAPID_CLOUD_URL + "/" } }],
            subtitle: subtitle
        });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

async function soraFetch(url, options) {
    options = options || {};
    var headers = options.headers || {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": BASE_URL + "/"
    };
    var method = options.method || "GET";
    var body = options.body || null;
    try {
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        return await fetch(url, { headers: headers, method: method, body: body });
    }
}
