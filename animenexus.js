const BASE_API = "https://api.anime.nexus/api/anime";
const BASE_URL = "https://anime.nexus";
const ASSETS_URL = "https://assets.anime.nexus";

async function searchResults(keyword) {
    try {
        const url = BASE_API + "/shows?search=" + encodeURIComponent(keyword) +
            "&sortBy=name+asc&page=1&includes[]=poster&includes[]=genres&hasVideos=1";
        const res = await soraFetch(url);
        const json = await res.json();
        const list = json.data || json.shows || json.results || json;
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
        const url = BASE_API + "/details/episodes?id=" + id +
            "&page=1&perPage=1&order=asc&fillers=true&recaps=true";
        const res = await soraFetch(url);
        const json = await res.json();
        console.log("[nexus] details: " + JSON.stringify(json).slice(0, 300));

        const show = json.show || json.anime || json.data || {};
        return JSON.stringify([{
            description: show.description || show.synopsis || "No description available",
            aliases: show.name_alt || show.alternativeTitles || "Unknown",
            airdate: "Aired: " + (show.release_date || show.startDate || show.year || "Unknown")
        }]);
    } catch (e) {
        console.log("extractDetails error: " + e);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(id) {
    try {
        const episodes = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = BASE_API + "/details/episodes?id=" + id +
                "&page=" + page + "&perPage=24&order=asc&fillers=true&recaps=true";
            const res = await soraFetch(url);
            const json = await res.json();
            console.log("[nexus] episodes page " + page + ": " + JSON.stringify(json).slice(0, 200));

            const eps = json.data || json.episodes || json.results || [];
            if (!Array.isArray(eps) || eps.length === 0) { hasMore = false; break; }

            eps.forEach(function(ep) {
                episodes.push({
                    href: ep.id,
                    number: ep.number || ep.episode || ep.episodeNumber || episodes.length + 1
                });
            });

            hasMore = eps.length === 24;
            page++;
            if (page > 25) break;
        }

        return JSON.stringify(episodes);
    } catch (e) {
        console.log("extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(episodeId) {
    try {
        const streamInfoUrl = BASE_API + "/details/episode/stream?id=" + episodeId + "&fillers=true&recaps=true";
        const res = await soraFetch(streamInfoUrl);
        const json = await res.json();
        const d = json.data || json;

        // HLS stream URL directly provided
        const streamUrl = d.hls || d.streamUrl || d.url || "";
        if (!streamUrl) {
            console.log("[nexus] no hls URL found");
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        // Chapters (cues.vtt)
        const chapters = (d.video_meta && d.video_meta.chapters) || d.chapters || "";

        // English subtitle (.ass)
        let subtitle = "";
        const subs = d.subtitles || [];
        const enSub = subs.find(function(s) { return s.srcLang === "en"; }) ||
                      subs.find(function(s) { return /english/i.test(s.label); });
        if (enSub) subtitle = enSub.src;

        const stream = { title: "Anime Nexus", streamUrl: streamUrl };
        if (chapters) stream.chapters = chapters;

        return JSON.stringify({ streams: [stream], subtitle: subtitle });
    } catch (e) {
        console.log("extractStreamUrl error: " + e);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

async function soraFetch(url, options) {
    options = options || {};
    const headers = options.headers || {
        "Referer": BASE_URL + "/",
        "Origin": BASE_URL
    };
    const method = options.method || "GET";
    const body = options.body || null;
    try {
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        return await fetch(url, { headers: headers, method: method, body: body });
    }
}