const BASE_API = "https://api.anime.nexus/api/anime";
const BASE_URL = "https://anime.nexus";
const ASSETS_URL = "https://assets.anime.nexus";

async function searchResults(keyword) {
    try {
        const url = BASE_API + "/shows?search=" + encodeURIComponent(keyword) +
            "&sortBy=name+asc&page=1&includes[]=poster&includes[]=genres&hasVideos=1";
        const res = await soraFetch(url);
        const json = await res.json();
        const list = json.data || [];
        if (!Array.isArray(list)) return JSON.stringify([]);

        return JSON.stringify(list.map(function(s) {
            var image = "";
            if (s.poster && s.poster.resized) {
                var src = s.poster.resized["480x720"] || s.poster.resized["640x960"] || s.poster.resized["240x360"] || "";
                image = src.startsWith("http") ? src : ASSETS_URL + src;
            }
            return {
                title: s.name || s.title || "Unknown",
                image: image,
                href: s.id
            };
        }));
    } catch (e) {
        console.log("searchResults error: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(id) {
    try {
        // id here is the show id
        const url = BASE_API + "/details/episodes?id=" + id +
            "&page=1&perPage=1&order=asc&fillers=true&recaps=true";
        const res = await soraFetch(url);
        const json = await res.json();
        // Description is on the show object in search, not in episodes endpoint
        // Use meta total as episode count hint
        const total = (json.meta && json.meta.total) || 0;
        return JSON.stringify([{
            description: "Total episodes: " + total,
            aliases: "Unknown",
            airdate: "Unknown"
        }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(showId) {
    try {
        const episodes = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = BASE_API + "/details/episodes?id=" + showId +
                "&page=" + page + "&perPage=24&order=asc&fillers=true&recaps=true";
            const res = await soraFetch(url);
            const json = await res.json();
            const eps = json.data || [];
            if (!Array.isArray(eps) || eps.length === 0) { hasMore = false; break; }

            eps.forEach(function(ep) {
                episodes.push({
                    // Encode both showId and episodeId so we can use both later
                    href: showId + "|" + ep.id,
                    number: ep.number || episodes.length + 1
                });
            });

            const meta = json.meta || {};
            hasMore = page < (meta.last_page || 1);
            page++;
            if (page > 25) break;
        }

        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(href) {
    try {
        // href is "showId|episodeId"
        var parts = href.split("|");
        var episodeId = parts.length > 1 ? parts[1] : parts[0];

        const streamInfoUrl = BASE_API + "/details/episode/stream?id=" + episodeId + "&fillers=true&recaps=true";
        const res = await soraFetch(streamInfoUrl);
        const json = await res.json();
        const d = json.data || json;

        // HLS stream URL directly provided
        var streamUrl = d.hls || d.streamUrl || d.url || "";
        if (!streamUrl) {
            console.log("[nexus] no hls URL found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        // Fetch the master m3u8 and make all URIs absolute
        // The CDN uses MKV segments — we need to pass the full master
        // with absolute URLs so Sora's player can handle it
        try {
            const m3u8Res = await soraFetch(streamUrl);
            const m3u8Text = await m3u8Res.text();
            const baseM3u8 = streamUrl.substring(0, streamUrl.lastIndexOf("/") + 1);

            // Make all relative URIs absolute
            const absoluteM3u8 = m3u8Text.replace(
                /^([^#\n][^\n]+)$/gm,
                function(line) {
                    line = line.trim();
                    if (!line || line.startsWith("#")) return line;
                    return line.startsWith("http") ? line : baseM3u8 + line;
                }
            ).replace(
                /URI="([^"]+)"/g,
                function(match, uri) {
                    return 'URI="' + (uri.startsWith("http") ? uri : baseM3u8 + uri) + '"';
                }
            );

            streamUrl = "data:application/x-mpegURL;base64," + btoa(absoluteM3u8);
            console.log("[nexus] built absolute m3u8 data URI");
        } catch (e) {
            console.log("[nexus] m3u8 fetch failed, using original: " + e);
        }

        // Chapters (cues.vtt)
        var chapters = (d.video_meta && d.video_meta.chapters) || d.chapters || "";

        // English subtitle (.ass)
        var subtitle = "";
        var subs = d.subtitles || [];
        var enSub = null;
        for (var i = 0; i < subs.length; i++) {
            if (subs[i].srcLang === "en" || /english/i.test(subs[i].label)) {
                enSub = subs[i];
                break;
            }
        }
        if (enSub) subtitle = enSub.src;

        var stream = { title: "Anime Nexus", streamUrl: streamUrl };
        if (chapters) stream.chapters = chapters;

        return JSON.stringify({ streams: [stream], subtitle: subtitle });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

async function soraFetch(url, options) {
    options = options || {};
    var headers = options.headers || {
        "Referer": BASE_URL + "/",
        "Origin": BASE_URL
    };
    var method = options.method || "GET";
    var body = options.body || null;
    try {
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        return await fetch(url, { headers: headers, method: method, body: body });
    }
}